// AI import: ChatGPT's and Claude's exports into chat notes, project notes, and a memory review list the user ticks
// before anything reaches ME.md or People/. One import at a time; uploads in 8 MB pieces so no request runs for minutes.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { HTTPError, OpError, Plugin, reply, type Request, vaultPath } from "../../../core/plugins.ts"
import { str, writeAtomic } from "../../../core/vault.ts"
import { DEFAULTS, type Job, newJob, type Options, runImport } from "./importer.ts"
import { afterApply, type Applied, LABELS, reviewItems } from "./note.ts"

export const plugin = new Plugin(import.meta.url)

// (the plugin's own folder, not /tmp: a chat export can be gigabytes, more than Linux's /tmp tmpfs, and it's private)
const uploads = () => path.join(plugin.localDir(), "uploads")
/** The biggest export taken (ChatGPT's with years of images can pass a few GB), and the biggest piece of one. */
const MAX = 8 * 1024 ** 3, MAX_PIECE = 64 << 20
const declared = (req: Request) => Number(req.http?.headers["content-length"] ?? 0) || 0
const jobs: Job[] = []
let queue: Promise<unknown> = Promise.resolve()
let n = 0

const on = () => { if (plugin.isOff()) throw new HTTPError(404, "the AI import plugin is off (Settings > Plugins)") }

/** The settings, with the request's query over them. */
function options(q: Record<string, string>): Options {
  const s = plugin.settings({})
  const num = (v: unknown, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : d)
  const bool = (v: unknown, d: boolean) => (v === undefined || v === "" ? d : v === true || v === "true" || v === "1")
  const folderIn = q.folder ?? (typeof s.folder === "string" && s.folder.trim() ? s.folder : DEFAULTS.folder)
  const folder = vaultPath(folderIn, false, plugin.vault).replace(/\/+$/, "") || DEFAULTS.folder
  return {
    folder,
    minMessages: num(q.minMessages ?? s.minMessages, DEFAULTS.minMessages),
    images: bool(q.images ?? s.images, DEFAULTS.images),
  }
}

/** Uploads waiting to be imported, and ones left behind (over a day old) cleared. */
function tmpFile(id: string) {
  const dir = uploads()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const f of fs.readdirSync(dir)) {
    try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 86400_000) fs.rmSync(path.join(dir, f), { force: true }) } catch { /* gone */ }
  }
  return path.join(dir, `${id}.upload`)
}
const newId = () => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`
const validId = (id: unknown) => typeof id === "string" && /^[a-z0-9]+-[a-f0-9]{8}$/.test(id)

/** A small JSON body, for a streamed route that got JSON. */
async function jsonBody(req: Request) {
  const http = req.http!
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of http) {
    size += (c as Buffer).length
    if (size > 1 << 20) throw new HTTPError(413, "a JSON body this big? Send the export itself as the body")
    chunks.push(c as Buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") } catch { throw new HTTPError(400, "the body isn't JSON") }
}

const isJson = (req: Request) => /json/i.test(String(req.http?.headers["content-type"] ?? ""))

/** Queue the import of `file` (removed after, when it's an upload). */
function start(file: string, name: string, opts: Options, temporary: boolean) {
  const job = newJob(`${Date.now().toString(36)}-${++n}`, name)
  jobs.unshift(job)
  jobs.splice(20)
  queue = queue.then(async () => {
    try {
      await runImport(plugin.vault, file, opts, job)
    } catch (e) {
      job.state = "failed"
      job.error = String((e as Error)?.message ?? e)
    } finally {
      job.finished = Date.now()
      if (temporary) fs.rmSync(file, { force: true })
    }
  })
  return job
}

plugin.route("POST", "ai-import", async (req) => {
  on()
  const opts = options(req.query)
  const body = req.http && isJson(req) ? await jsonBody(req) : !req.http ? req.body : null
  if (body) {
    if (validId(body.upload)) {
      const file = tmpFile(body.upload)
      if (!fs.existsSync(file)) throw new HTTPError(404, `no upload ${body.upload} (it's imported once, and kept a day)`)
      return reply(202, start(file, str(body.name) || "export.zip", opts, true))
    }
    if (typeof body.path === "string" && body.path) {
      const rel = vaultPath(body.path, true, plugin.vault)
      return reply(202, start(plugin.vault.abs(rel), rel.split("/").pop()!, opts, false))
    }
    throw new HTTPError(400, "send the export as the body (a zip or conversations.json), or {upload} or {path}")
  }
  // The body is the export: onto this machine's disk as it comes.
  if (declared(req) > MAX) throw new HTTPError(413, "an export over 8 GB: send its conversations.json alone")
  const file = tmpFile(newId())
  try {
    await pipeline(req.http!, fs.createWriteStream(file))
  } catch (e) {
    fs.rmSync(file, { force: true })
    throw new HTTPError(400, `the upload broke off: ${(e as Error).message}`)
  }
  if (!fs.statSync(file).size) { fs.rmSync(file, { force: true }); throw new HTTPError(400, "the body is empty: send the export's zip") }
  return reply(202, start(file, str(req.query.name) || "export.zip", opts, true))
}, { stream: true })

plugin.route("POST", "ai-import/upload", async (req) => {
  on()
  if (!req.http) throw new HTTPError(400, "pieces of an upload come over HTTP")
  const id = req.query.id
  if (id !== undefined && !validId(id)) throw new HTTPError(400, `no upload ${id}`)
  const up = id ?? newId()
  const file = tmpFile(up)
  const offset = Number(req.query.offset ?? 0)
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0
  if (id === undefined ? offset !== 0 : offset !== size) throw new HTTPError(409, `this piece goes at ${offset}, the upload has ${size} bytes`)
  if (declared(req) > MAX_PIECE || size + declared(req) > MAX) throw new HTTPError(413, "a piece over 64 MB, or an export over 8 GB")
  await pipeline(req.http, fs.createWriteStream(file, { flags: "a" }))
  return { id: up, size: fs.statSync(file).size }
}, { stream: true })

plugin.route("GET", "ai-import/jobs", () => jobs)
plugin.route("GET", "ai-import/jobs/*", (req) => {
  const job = jobs.find((j) => j.id === req.arg(0))
  if (!job) throw new HTTPError(404, `no import ${req.arg(0)}`)
  return job
})

/** Ticked memories added one by one through `run` (people.remember: its answer, or the text it says), then the list
 *  rewritten as it is by then. */
export async function applyReview(text: string, source: string, run: (args: Record<string, unknown>) => Promise<string | { person?: string | null; already?: boolean; path?: string }>) {
  const results: Applied[] = []
  for (const it of reviewItems(text).filter((x) => x.done)) {
    try {
      const said = await run({ fact: it.fact, about: it.about, source })
      const person = typeof said === "string"
        ? /^Remembered in People\/(.+?)\.md/.exec(said)?.[1] ?? (/^People\/(.+?)\.md already/.exec(said)?.[1])
        : said.person ?? undefined
      const already = typeof said === "string" ? /already says that/.test(said) : said.already === true
      const mine = typeof said === "object" && said.path ? said.path : "ME.md"
      const where = it.about === "me" ? `${mine}, About me` : it.about === "preference" ? `${mine}, How to work with me` : `[[${person ?? it.about}]]`
      results.push({ fact: it.fact, where: already ? `${where} (already there)` : where })
    } catch (e) {
      results.push({ fact: it.fact, error: String((e as Error)?.message ?? e) })
    }
  }
  return results
}

// ---------- operations (core/ops.ts)

/** A job's summary, in lines (what `vau import` prints). */
function jobText(job: Job) {
  if (job.state === "queued" || job.state === "running") {
    return `Importing ${job.name} (job ${job.id}): ${job.state}${job.total ? `, ${Math.floor((job.read / Math.max(1, job.total)) * 100)}%` : ""}, ${job.chats} chats so far. vau ai-import.job ${job.id} --wait follows it.`
  }
  if (job.state === "failed") return `Couldn't import ${job.name}: ${job.error}`
  return [
    `${job.source === "claude" ? "Claude" : "ChatGPT"}: ${job.chats} chats in ${job.folder}/: ${job.created} new, ${job.updated} updated, ${job.unchanged} already there, ${job.skipped} short one${job.skipped === 1 ? "" : "s"} skipped.`,
    ...(job.projects ? [`${job.projects} project notes.`] : []),
    ...(job.images ? [`${job.images} images.`] : []),
    ...(job.files ? [`${job.files} long attachments as files of their own.`] : []),
    job.review ? `${job.memories} memories to review in ${job.review}: tick the ones to keep, then Add (ai-import.apply).` : "No memories to review.",
    ...(job.problems?.length ? [`Not read: ${job.problems.join("; ")}`] : []),
  ].join("\n")
}

/** A job, once it's done or failed (`wait`), or as it is now. */
async function jobOf(id: string, wait: boolean): Promise<Job> {
  for (;;) {
    const job = jobs.find((j) => j.id === id)
    if (!job) throw new OpError(`no import ${id} (the last 20 are kept, in memory: a restart forgets them)`, 404)
    if (!wait || (job.state !== "queued" && job.state !== "running")) return job
    await new Promise((ok) => setTimeout(ok, 500))
  }
}

plugin.op({
  id: "ai-import.run",
  summary: "Import ChatGPT's or Claude's export already in the vault (or uploaded): a note per chat, their memories as a list to review.",
  help: `The export's zip (or its conversations.json) becomes a job: every chat a note in Chats/ChatGPT/ or Chats/Claude/
(Claude's projects in Chats/Claude/Projects/), ChatGPT's images and long attachments in their Attachments/, and what the AI
remembered about the user added to Chats/<AI>/Memories to review.md, never straight to ME.md (the user ticks the ones to
keep, then ai-import.apply). Importing again updates chats that changed and never makes a second copy. A file on the
computer you're on: vau import <file> (it uploads it). wait: answer once it's done.

  ChatGPT: Settings > Data controls > Export data (a link by email to a zip).
  Claude:  Settings > Privacy > Export data (a zip, sometimes named .dms).

  vau ai-import.run Imports/chatgpt-export.zip --wait
  vau ai-import.run Imports/data-2026-10-01.dms --min-messages 4 --folder Archive/Chats`,
  kind: "write",
  lock: false, // the job holds the vault a few files at a time
  params: {
    path: { type: "string", format: "path", description: "the export in the vault (a zip, a .dms, or conversations.json)" },
    upload: { type: "string", description: "or an upload's id (POST /api/ai-import/upload: the app sends big files in pieces)" },
    minMessages: { type: "integer", minimum: 0, description: "skip chats with fewer messages (default the setting's, 1)" },
    images: { type: "boolean", description: "bring ChatGPT's images (default the setting's, true)" },
    folder: { type: "string", description: "where the chats go (default the setting's, Chats)" },
    wait: { type: "boolean", description: "answer once the import is done (else at once, with the job to follow)" },
  },
  args: ["path"],
  run: async (p, ctx) => {
    if (!p.path === !p.upload) throw new OpError("say which export: path (a file in the vault) or upload (an upload's id)")
    const q = new URLSearchParams()
    if (p.minMessages !== undefined) q.set("minMessages", String(p.minMessages))
    if (p.images !== undefined) q.set("images", String(p.images))
    if (p.folder) q.set("folder", p.folder)
    const job = await ctx.api("POST", `ai-import${q.size ? `?${q}` : ""}`, p.path ? { path: p.path } : { upload: p.upload })
    return p.wait ? await jobOf(job.id, true) : job
  },
  text: (job: Job) => jobText(job),
})

plugin.op({
  id: "ai-import.job",
  summary: "An import's job: how far it read, what it made (chats new, updated, skipped; memories to review); the last one without an id.",
  help: "  vau ai-import.job\n  vau ai-import.job mg3k2a-1 --wait",
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

plugin.op({
  id: "ai-import.apply",
  summary: "Add the memories the user ticked in an import's review list to the user's file (ME.md) and People/, then move them under ## Added.",
  help: `Each ticked memory goes where its bold label says (Me: About me; How to work with me; a person's name: their file,
with where it came from), through people.remember. One that can't be added (no such person) stays ticked with why
under it. Don't tick memories for the user: this adds what they ticked.

  vau ai-import.apply "Chats/ChatGPT/Memories to review.md"`,
  kind: "write",
  params: { path: { type: "string", format: "path", required: true, description: "the review list (Chats/<AI>/Memories to review.md)" } },
  args: ["path"],
  run: async ({ path: given }, ctx) => {
    on()
    const rel = vaultPath(given, true, plugin.vault)
    const abs = plugin.vault.abs(rel)
    let text: string
    try { text = fs.readFileSync(abs, "utf8") } catch { throw new OpError(`no file ${rel}`, 404) }
    const fmSource = /^source:\s*(\S+)/m.exec(text)?.[1]?.toLowerCase() ?? ""
    const source = LABELS[fmSource as keyof typeof LABELS] ?? "an AI's export"
    const results = await applyReview(text, source, async (args) => {
      try {
        return await ctx.op("people.remember", args)
      } catch (e) {
        if (e instanceof OpError && e.status === 404 && /no operation/.test(e.message)) throw new OpError("adding memories needs the People plugin (people.remember): turn it on (Settings > Plugins)", 409)
        throw e
      }
    })
    // The list as it is now (only what was added comes off). The vault is held for this op: written here, then read.
    const now = fs.readFileSync(abs, "utf8")
    const next = afterApply(now, results)
    if (next !== now) writeAtomic(abs, next)
    await plugin.vault.sync()
    return { added: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results }
  },
  text: (r) => (!r.added && !r.failed ? "Nothing ticked to add." : [`Added ${r.added} memor${r.added === 1 ? "y" : "ies"}${r.failed ? `; ${r.failed} couldn't be (why is under each)` : ""}.`,
    ...r.results.map((x: Applied) => `- ${x.fact}: ${x.error ? `not added: ${x.error}` : x.where}`)].join("\n")),
})

// ```block-memory-review as text: what's left to review in the file it's in.
plugin.block("memory-review", (ctx) => {
  const items = reviewItems(ctx.body)
  if (!items.length) return "_No memories left to review._"
  const ticked = items.filter((i) => i.done).length
  const by = new Map<string, number>()
  for (const i of items) by.set(i.label, (by.get(i.label) ?? 0) + 1)
  return `${items.length} memor${items.length === 1 ? "y" : "ies"} to review, ${ticked} ticked (${[...by].map(([l, c]) => `${c} ${l}`).join(", ")}). ` +
    `Ticked ones are added with the op ai-import.apply (vau ai-import.apply "${ctx.path}").`
})

