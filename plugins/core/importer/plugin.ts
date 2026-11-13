import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { HTTPError, OpError, Plugin, reply, type Request, vaultPath } from "../../../core/plugins.ts"
import { str } from "../../../core/vault.ts"
import { type Job, newJob, runImport } from "./importer.ts"

export const plugin = new Plugin(import.meta.url)

const MAX = 8 * 1024 ** 3
const jobs: Job[] = []
let queue: Promise<unknown> = Promise.resolve()
let n = 0

const on = () => { if (plugin.isOff()) throw new HTTPError(404, "the Importer plugin is off (Plugins)") }
const folder = (given?: string) => {
  const s = plugin.settings({})
  const f = (given ?? (typeof s.folder === "string" ? s.folder : "")).trim()
  return f ? vaultPath(f, false, plugin.vault).replace(/\/+$/, "") : ""
}

function scratch() {
  const dir = path.join(plugin.localDir(), "uploads")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const f of fs.readdirSync(dir)) {
    try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 86400_000) fs.rmSync(path.join(dir, f), { recursive: true, force: true }) } catch {}
  }
  return dir
}

function start(file: string, name: string, into: string, temporary: boolean) {
  const job = newJob(`${Date.now().toString(36)}-${++n}`, name)
  jobs.unshift(job)
  jobs.splice(20)
  const tmp = path.join(scratch(), `${job.id}.parts`)
  queue = queue.then(async () => {
    try {
      await runImport(plugin.vault, file, { folder: into, tmp }, job)
    } catch (e) {
      job.state = "failed"
      job.error = e instanceof Error ? e.message : String(e)
    } finally {
      job.finished = Date.now()
      fs.rmSync(tmp, { recursive: true, force: true })
      if (temporary) fs.rmSync(file, { force: true })
    }
  })
  return job
}

const isJson = (req: Request) => /json/i.test(String(req.http?.headers["content-type"] ?? ""))

plugin.route("POST", "importer", async (req) => {
  on()
  const into = folder(req.query.folder)
  if (!req.http || isJson(req)) {
    let body = req.body
    if (req.http) {
      const chunks: Buffer[] = []
      for await (const c of req.http) { const piece: Buffer = c; chunks.push(piece) }
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") } catch { throw new HTTPError(400, "the body isn't JSON") }
    }
    if (typeof body?.path !== "string" || !body.path) throw new HTTPError(400, "send the export as the body, or {path} of one in the vault")
    const rel = vaultPath(body.path, true, plugin.vault)
    return reply(202, start(plugin.vault.abs(rel), rel.split("/").pop()!, into, false))
  }
  if (Number(req.http.headers["content-length"] ?? 0) > MAX) throw new HTTPError(413, "an export over 8 GB")
  const file = path.join(scratch(), `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}.upload`)
  try {
    await pipeline(req.http, fs.createWriteStream(file))
  } catch (e) {
    fs.rmSync(file, { force: true })
    throw new HTTPError(400, `the upload broke off: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!fs.statSync(file).size) { fs.rmSync(file, { force: true }); throw new HTTPError(400, "the body is empty: send the export") }
  return reply(202, start(file, str(req.query.name) || "export", into, true))
}, { stream: true })

plugin.route("GET", "importer/jobs/*", (req) => {
  const job = jobs.find((j) => j.id === req.arg(0))
  if (!job) throw new HTTPError(404, `no import ${req.arg(0)}`)
  return job
})

const LABEL = { notion: "Notion", evernote: "Evernote", keep: "Google Keep", html: "HTML pages", bear: "Bear", csv: "CSV", roam: "Roam" }

export function jobText(job: Job) {
  if (job.state === "queued" || job.state === "running") return `Importing ${job.name} (job ${job.id}): ${job.state}, ${job.notes} notes so far. vau importer.job ${job.id} --wait follows it.`
  if (job.state === "failed") return `Couldn't import ${job.name}: ${job.error}`
  return [
    `${job.source ? LABEL[job.source] : "Export"}: ${job.notes} notes in ${job.folder || "the vault"}/: ${job.created} new, ${job.unchanged} imported before (left as they are)${job.files ? `, ${job.files} attachments` : ""}.`,
    ...(job.problems.length ? [`Not read: ${job.problems.join("; ")}`] : []),
  ].join("\n")
}

const Started = z.looseObject({ id: z.string() })

async function jobOf(id: string, wait: boolean): Promise<Job> {
  for (;;) {
    const job = jobs.find((j) => j.id === id)
    if (!job) throw new OpError(`no import ${id} (the last 20 are kept, in memory: a restart forgets them)`, 404)
    if (!wait || (job.state !== "queued" && job.state !== "running")) return job
    await new Promise((ok) => setTimeout(ok, 300))
  }
}

plugin.op({
  id: "importer.run",
  summary: "Import Notion's, Evernote's or Google Keep's export already in the vault: every page or note a Markdown note, attachments and links kept.",
  help: `Notion (Settings > Export all workspace content, or a page's ... > Export, as Markdown & CSV: a zip, sometimes of
zips) goes into Notion/: names without Notion's ids, subpages in their page's folder, links between pages as wikilinks,
a database as its CSV and a note per row with the row's properties as frontmatter. Evernote (a notebook's ... > Export
notebook, as .enex; or a zip of them) goes into Evernote/<notebook>/: tags, dates and source as frontmatter, to-dos as
tasks, tables, attachments in Attachments/ embedded where they were. Google Keep (Google Takeout's zip with Keep in it)
goes into Keep/: checklists as tasks, labels as tags, archived notes archived, trashed ones left out. Bear (File > Backup notes: a .bear2bk)
goes into Bear/: highlights and tags with spaces made the vault's, pictures in Bear/Attachments/, trashed notes left
out. HTML pages (a
page, or a zip of them: another app's export) go into a folder named as the file: a note per page, links between pages
as wikilinks, images and other files beside them. Roam (Export all, as JSON) goes into Roam/: a page's blocks as nested lists, TODOs as tasks, block refs as their text,
daily pages named by their date. A CSV table (or a zip of them) gives a note per row in a folder named as
the file: its first column the note's name, a Content (or Body, Notes) column its text, the others its properties. Importing again
adds only what's new (by ext_id);
notes imported before stay as they are. wait: answer once it's done.

  vau importer.run Imports/notion-export.zip --wait
  vau importer.run "Imports/Recipes.enex" --folder Archive`,
  kind: "write",
  lock: false,
  params: {
    path: { type: "string", format: "path", required: true, description: "the export in the vault (Notion's zip, an .enex or a zip of them, Takeout's zip, Bear's .bear2bk, HTML pages, a CSV, Roam's JSON)" },
    folder: { type: "string", description: "the folder Notion/, Evernote/ or Keep/ goes in (default the setting's: the vault's top)" },
    wait: { type: "boolean", description: "answer once the import is done (else at once, with the job to follow)" },
  },
  args: ["path"],
  run: async (p, ctx) => {
    on()
    const job = Started.parse(await ctx.api("POST", `importer${p.folder !== undefined ? `?folder=${encodeURIComponent(p.folder)}` : ""}`, { path: p.path }))
    return p.wait ? await jobOf(job.id, true) : job
  },
  text: (job: Job) => jobText(job),
  did: ({ path }) => ({ action: "create", text: `Imported ${path}` }),
})

plugin.op({
  id: "importer.job",
  summary: "An import's job: how far it got, what it made (notes new, imported before, attachments); the last one without an id.",
  help: "  vau importer.job\n  vau importer.job mg3k2a-1 --wait",
  kind: "read",
  params: {
    id: { type: "string", description: "the job's id (default the latest import)" },
    wait: { type: "boolean", description: "answer once it's done" },
  },
  args: ["id"],
  run: async ({ id, wait }) => {
    on()
    const which = id ?? jobs[0]?.id
    if (!which) throw new OpError("no import since the server started", 404)
    return await jobOf(which, !!wait)
  },
  text: (job: Job) => jobText(job),
})
