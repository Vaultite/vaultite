// One import as a job: Notion's zip (maybe of zips), Evernote's .enex (or a zip of them), Keep's Takeout, Bear's backup, HTML pages, CSV rows. Every file gets its path
// first, so links point where files land; written a few per hold of the vault; idempotent by `ext_id`.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import { csvRecords, entryBytes, isZip, type ZipEntry, zipEntries } from "../../../core/plugins.ts"
import { frontmatter, safeName, stamp, type Vault, writeAtomic } from "../../../core/vault.ts"
import { bearInfo, bearNote } from "./bear.ts"
import { noteBody, readEnex, type Resource } from "./evernote.ts"
import { toMarkdown } from "./html.ts"
import { readKeep } from "./keep.ts"
import { barePath, hrefPath, idOf, links, notionNote } from "./notion.ts"

import type { Job, Source } from "./job.ts"
export type { Job } from "./job.ts"
export type Options = { folder: string; tmp: string }

export const newJob = (id: string, name: string): Job =>
  ({ id, state: "queued", name, source: null, notes: 0, created: 0, unchanged: 0, files: 0, folder: null, problems: [], started: Date.now() })

/** The most an .enex is read whole (its attachments are inside, as base64). */
const ENEX_MAX = 512 << 20
const BATCH = 20
const LABEL: Record<Source, string> = { notion: "Notion", evernote: "Evernote", keep: "Keep", html: "HTML", bear: "Bear", csv: "CSV" }
/** A TextBundle's text in Bear's backup (its folder: the bundle). */
const BUNDLE = /^(.*\.textbundle)\/text\.(markdown|md|txt)$/i
/** A Keep note's JSON in a Takeout zip. */
const KEEP = /(^|\/)Keep\/[^/]+\.json$/i

type Write = { rel: string; data: () => Promise<Buffer | string>; note: boolean }

const join = (...p: string[]) => p.filter(Boolean).join("/")
const split = (rel: string) => { const i = rel.lastIndexOf("/"); return { dir: rel.slice(0, i + 1), name: rel.slice(i + 1) } }
const extOf = (name: string) => { const d = name.lastIndexOf("."); return d > 0 ? name.slice(d) : "" }
const say = (job: Job, p: string) => { if (job.problems.length < 10) job.problems.push(p) }

/** Writes and paths for one import: a path free in the vault and in this import, kept per source path. */
function planner(vault: Vault) {
  const taken = new Set<string>()
  const there = (rel: string) => taken.has(rel) || vault.entries.has(rel) || fs.existsSync(vault.abs(rel))
  return {
    /** `rel`, or "Name 1.ext"... when that's taken; `same` says a file there is this one (an attachment imported before). */
    free(rel: string, same?: (abs: string) => boolean) {
      const { dir, name } = split(rel)
      const ext = extOf(name), stem = [...safeName(ext ? name.slice(0, -ext.length) : name)].slice(0, 120).join("").replace(/^[.\s]+|[.\s]+$/g, "") || "Untitled"
      const inside = path.resolve(vault.abs(dir || "."))
      if (inside !== path.resolve(vault.path) && !inside.startsWith(path.resolve(vault.path) + path.sep)) throw new Error(`${rel} is outside the vault`)
      for (let n = 0; ; n++) {
        const p = `${dir}${n ? `${stem} ${n}` : stem}${ext}`
        if (!there(p)) { taken.add(p); return { rel: p, exists: false } }
        if (!taken.has(p) && same && fs.existsSync(vault.abs(p)) && same(vault.abs(p))) { taken.add(p); return { rel: p, exists: true } }
      }
    },
  }
}

/** Notes already imported, by ext_id. */
function knownIds(vault: Vault, prefix: string) {
  const out = new Map<string, string>()
  for (const e of vault.entries.values()) {
    const x = e.fm.ext_id
    if (typeof x === "string" && x.startsWith(prefix)) out.set(x, e.rel)
  }
  return out
}

async function flush(vault: Vault, pending: Write[], job: Job) {
  while (pending.length) {
    const batch = pending.splice(0, BATCH)
    const data = await Promise.all(batch.map((w) => w.data().catch((e) => { say(job, `${w.rel}: ${(e as Error).message}`); return null })))
    await vault.lock(async () => {
      batch.forEach((w, i) => {
        const d = data[i]
        if (d === null) return
        fs.mkdirSync(path.dirname(vault.abs(w.rel)), { recursive: true })
        writeAtomic(vault.abs(w.rel), d)
        if (w.note) job.created++
        else job.files++
      })
      await vault.sync()
    })
    await turn()
  }
}

type Zip = { file: string; entries: ZipEntry[] }

/** The zip's entries, and a zip of zips (Notion's big exports come in parts) opened into `tmp`. */
async function zips(file: string, tmp: string, depth = 0): Promise<Zip[]> {
  const entries = zipEntries(file).filter((e) => !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(e.name))
  const inner = entries.filter((e) => /\.zip$/i.test(e.name))
  if (depth > 1 || !inner.length || inner.length < entries.length) return [{ file, entries }]
  const out: Zip[] = []
  for (const e of inner) {
    const f = path.join(tmp, `${crypto.randomBytes(6).toString("hex")}.zip`)
    fs.writeFileSync(f, await entryBytes(file, e))
    out.push(...await zips(f, tmp, depth + 1))
  }
  return out
}

/** What the file is: Notion's export, Evernote's, Keep's, Bear's, HTML pages or CSV tables. */
function kindOfExport(parts: Zip[] | null, file: string, name: string): Source {
  if (!parts && /\.csv$/i.test(name)) return "csv"
  if (!parts) {
    const fd = fs.openSync(file, "r")
    const head = Buffer.alloc(512)
    try { fs.readSync(fd, head, 0, 512, 0) } finally { fs.closeSync(fd) }
    if (/<en-export\b|<!DOCTYPE en-export/i.test(head.toString("utf8"))) return "evernote"
    if (/<!DOCTYPE html|<html\b/i.test(head.toString("utf8"))) return "html"
    throw new Error("this isn't a Notion, Evernote or Keep export or an HTML page: Notion's is a zip (Markdown & CSV), Evernote's an .enex file, Keep's a Takeout zip")
  }
  const names = parts.flatMap((z) => z.entries.map((e) => e.name))
  if (names.some((n) => /\.enex$/i.test(n))) return "evernote"
  if (names.some((n) => KEEP.test(n))) return "keep"
  if (names.some((n) => BUNDLE.test(n))) return "bear"
  if (names.some((n) => /\.md$/i.test(n))) return "notion"
  if (names.some((n) => /\.html?$/i.test(n))) return "html"
  if (names.some((n) => /\.csv$/i.test(n))) return "csv"
  throw new Error("no notes in this zip: is it Notion's export (Markdown & CSV), Evernote's .enex files, Keep's Takeout, Bear's backup, HTML pages or CSV tables?")
}

/** Runs the import of `file` (on this machine) into `vault`, updating `job` as it goes. */
export async function runImport(vault: Vault, file: string, opts: Options, job: Job) {
  job.state = "running"
  fs.mkdirSync(opts.tmp, { recursive: true })
  const parts = isZip(file) ? await zips(file, opts.tmp) : null
  const source = kindOfExport(parts, file, job.name)
  job.source = source
  // (HTML pages and tables go in a folder named as the export: they could be any app's)
  job.folder = join(opts.folder, source === "html" || source === "csv" ? [...safeName(job.name.replace(/\.(zip|html?|csv)$/i, ""))].slice(0, 120).join("") : LABEL[source])
  if (source === "csv") await csvRows(vault, parts ?? [{ file, entries: [{ name: job.name, method: 0, size: fs.statSync(file).size, packed: 0, offset: -1 }] }], job.folder, job)
  else if (source === "html") await htmlPages(vault, parts ?? [{ file, entries: [{ name: job.name, method: 0, size: fs.statSync(file).size, packed: 0, offset: -1 }] }], job.folder, job)
  else if (source === "notion") await notion(vault, parts!, job.folder, job)
  else if (source === "bear") await bear(vault, parts!, job.folder, job)
  else if (source === "keep") await keep(vault, parts!, job.folder, job)
  else if (parts) {
    for (const z of parts) for (const e of z.entries.filter((x) => /\.enex$/i.test(x.name))) {
      if (e.size > ENEX_MAX) { say(job, `${e.name} is over ${ENEX_MAX >> 20} MB: export that notebook in parts`); continue }
      try {
        await evernote(vault, (await entryBytes(z.file, e)).toString("utf8"), e.name.split("/").pop()!.replace(/\.enex$/i, ""), job.folder, job)
      } catch (err) { say(job, `${e.name}: ${(err as Error).message}`) }
    }
  } else {
    if (fs.statSync(file).size > ENEX_MAX) throw new Error(`an .enex over ${ENEX_MAX >> 20} MB: export that notebook in parts`)
    await evernote(vault, fs.readFileSync(file, "utf8"), job.name.replace(/\.enex$/i, "") || "Evernote", job.folder, job)
  }
  if (!job.notes) throw new Error("found no notes in this export")
  job.state = "done"
}

async function notion(vault: Vault, parts: Zip[], base: string, job: Job) {
  const all = parts.flatMap((z) => z.entries.map((e) => ({ z, e })))
  // One top folder for the whole export (Export-<uuid>/) says nothing: dropped.
  const tops = new Set(all.map(({ e }) => e.name.split("/")[0]))
  const strip = tops.size === 1 && all.every(({ e }) => e.name.includes("/")) && /^Export-[\w-]+$/i.test([...tops][0])
  const local = (name: string) => (strip ? name.slice(name.indexOf("/") + 1) : name)
  /** A page's id: Notion's, else its path's (a page named without one is still known when imported again). */
  const noteId = (name: string) => idOf(name) ?? crypto.createHash("sha1").update(barePath(local(name))).digest("hex").slice(0, 16)
  // A database's rows are in a folder named as its CSV; its _all.csv (every property) wins over the view's.
  const names = new Set(all.map(({ e }) => e.name))
  const files = all.filter(({ e }) => !(/\.csv$/i.test(e.name) && !/_all\.csv$/i.test(e.name) && names.has(e.name.replace(/\.csv$/i, "_all.csv"))))
  const databases = new Set(files.filter(({ e }) => /\.csv$/i.test(e.name)).map(({ e }) => barePath(local(e.name)).replace(/\.csv$/i, "")))

  const known = knownIds(vault, "notion-")
  const plan = planner(vault)
  const to = new Map<string, { rel: string; md: boolean; skip: boolean }>()
  const byId = new Map<string, string>()
  for (const { e } of files) {
    const md = /\.md$/i.test(e.name)
    const id = md ? noteId(e.name) : null
    if (id) byId.set(id, e.name)
    const had = id ? known.get(`notion-${id}`) : undefined
    if (had) { to.set(e.name, { rel: had, md, skip: true }); continue }
    const want = join(base, barePath(local(e.name)))
    // (an attachment imported before is the same size; a CSV lost its byte-order mark)
    const p = plan.free(want, md ? undefined : (abs) => [e.size, e.size - 3].includes(fs.statSync(abs).size))
    to.set(e.name, { rel: p.rel, md, skip: p.exists })
  }

  const pending: Write[] = []
  for (const { z, e } of files) {
    const t = to.get(e.name)!
    if (t.md) job.notes++
    if (t.skip) { if (t.md) job.unchanged++; continue }
    if (!t.md) { pending.push({ rel: t.rel, note: false, data: async () => { const b = await entryBytes(z.file, e); return /\.csv$/i.test(e.name) ? b.toString("utf8").replace(/^﻿/, "") : b } }); continue }
    const id = noteId(e.name)
    const row = databases.has(barePath(local(e.name)).split("/").slice(0, -1).join("/"))
    pending.push({
      rel: t.rel, note: true,
      data: async () => {
        const resolve = (href: string) => {
          const p = hrefPath(href, e.name, (i) => byId.get(i))
          const hit = p === null ? undefined : to.get(p) ?? to.get(p.replace(/\.csv$/i, "_all.csv"))
          return hit ? { rel: hit.rel, md: hit.md } : null
        }
        const { fm, body } = notionNote((await entryBytes(z.file, e)).toString("utf8"), resolve, row)
        if (id) fm.ext_id = `notion-${id}`
        return Object.keys(fm).length ? frontmatter(fm, body) : `${body}\n`
      },
    })
    if (pending.length >= BATCH) await flush(vault, pending, job)
  }
  await flush(vault, pending, job)
}

const EMBEDS = /^(image|audio|video)\/|^application\/pdf$/

async function evernote(vault: Vault, xml: string, notebook: string, base: string, job: Job) {
  const dir = join(base, [...safeName(notebook)].slice(0, 120).join(""))
  const known = knownIds(vault, "evernote-")
  const plan = planner(vault)
  const pending: Write[] = []
  const seen = new Map<string, number>()
  for (const n of readEnex(xml)) {
    job.notes++
    // (two notes of one title and time are told apart by their order)
    const key = `${notebook}\n${n.title}\n${n.created ?? ""}`
    const nth = (seen.get(key) ?? 0) + 1
    seen.set(key, nth)
    const ext = `evernote-${crypto.createHash("sha1").update(nth > 1 ? `${key}\n${nth}` : key).digest("hex").slice(0, 16)}`
    if (known.has(ext)) { job.unchanged++; continue }
    const saved = new Map<Resource, string>()
    for (const r of n.resources) {
      const p = plan.free(join(dir, "Attachments", safeName(r.name)), (abs) => fs.readFileSync(abs).equals(r.data))
      saved.set(r, p.rel)
      if (!p.exists) pending.push({ rel: p.rel, note: false, data: async () => r.data })
    }
    const body = noteBody(n, (r) => `${EMBEDS.test(r.mime) ? "!" : ""}[[${saved.get(r)}]]`)
    const fm: Record<string, unknown> = {}
    if (n.tags.length) fm.tags = n.tags.map((t) => t.replace(/[\s#,]+/g, "-"))
    if (n.source) fm.source = n.source
    if (n.author) fm.author = n.author
    if (n.created) fm.created = stamp(new Date(n.created))
    if (n.updated) fm.updated = stamp(new Date(n.updated))
    fm.ext_id = ext
    const rel = plan.free(join(dir, `${safeName(n.title)}.md`)).rel
    known.set(ext, rel)
    pending.push({ rel, note: true, data: async () => frontmatter(fm, body) })
    if (pending.length >= BATCH) await flush(vault, pending, job)
  }
  await flush(vault, pending, job)
}

async function keep(vault: Vault, parts: Zip[], dir: string, job: Job) {
  const known = knownIds(vault, "keep-")
  const plan = planner(vault)
  const pending: Write[] = []
  for (const z of parts) {
    const byName = new Map(z.entries.map((e) => [e.name, e]))
    for (const e of z.entries.filter((x) => KEEP.test(x.name))) {
      let n
      try { n = readKeep(JSON.parse((await entryBytes(z.file, e)).toString("utf8"))) } catch { n = null }
      if (!n) { say(job, `${e.name} isn't a Keep note`); continue }
      if (n.trashed) continue
      job.notes++
      const ext = `keep-${crypto.createHash("sha1").update(e.name.split("/").pop()!).digest("hex").slice(0, 16)}`
      if (known.has(ext)) { job.unchanged++; continue }
      const folder = e.name.slice(0, e.name.lastIndexOf("/") + 1)
      const embeds: string[] = []
      for (const a of n.attachments) {
        const src = byName.get(folder + a.path) ?? byName.get(a.path)
        if (!src) { say(job, `${a.path} (in ${n.title}) isn't in the export`); continue }
        const p = plan.free(join(dir, "Attachments", safeName(a.path.split("/").pop())), (abs) => fs.statSync(abs).size === src.size)
        if (!p.exists) pending.push({ rel: p.rel, note: false, data: () => entryBytes(z.file, src) })
        embeds.push(`${EMBEDS.test(a.mime) ? "!" : ""}[[${p.rel}]]`)
      }
      const fm: Record<string, unknown> = {}
      if (n.tags.length) fm.tags = n.tags.map((t) => t.replace(/[\s#,]+/g, "-"))
      if (n.created) fm.created = stamp(new Date(n.created))
      if (n.updated) fm.updated = stamp(new Date(n.updated))
      if (n.archived) fm.archived = true
      fm.ext_id = ext
      const body = [n.body, ...embeds].filter(Boolean).join("\n\n")
      const rel = plan.free(join(dir, `${safeName(n.title)}.md`)).rel
      known.set(ext, rel)
      pending.push({ rel, note: true, data: async () => frontmatter(fm, body) })
      if (pending.length >= BATCH) await flush(vault, pending, job)
    }
  }
  await flush(vault, pending, job)
}

/** A page's HTML as Markdown: its body, its first heading off when it's the page's name (the file says it). */
export function pageMarkdown(html: string, name: string) {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html.replace(/<head\b[\s\S]*?<\/head>/i, "")
  const md = toMarkdown(body)
  const first = /^# (.+)\n*/.exec(md)
  return first && first[1].trim() === name ? md.slice(first[0].length) : md
}

async function htmlPages(vault: Vault, parts: Zip[], dir: string, job: Job) {
  const all = parts.flatMap((z) => z.entries.map((e) => ({ z, e })))
  const read = (z: Zip, e: ZipEntry) => (e.offset < 0 ? Promise.resolve(fs.readFileSync(z.file)) : entryBytes(z.file, e))
  const known = knownIds(vault, "html-")
  const plan = planner(vault)
  const to = new Map<string, { rel: string; md: boolean; skip: boolean; ext: string }>()
  for (const { e } of all) {
    const page = /\.html?$/i.test(e.name)
    const bare = barePath(e.name)
    const ext = `html-${crypto.createHash("sha1").update(bare).digest("hex").slice(0, 16)}`
    const had = page ? known.get(ext) : undefined
    if (had) { to.set(e.name, { rel: had, md: true, skip: true, ext }); continue }
    const want = join(dir, page ? bare.replace(/\.html?$/i, ".md") : bare)
    const p = plan.free(want, page ? undefined : (abs) => fs.statSync(abs).size === e.size)
    to.set(e.name, { rel: p.rel, md: page, skip: p.exists, ext })
  }
  const pending: Write[] = []
  for (const { z, e } of all) {
    const t = to.get(e.name)!
    if (t.md) job.notes++
    if (t.skip) { if (t.md) job.unchanged++; continue }
    if (!t.md) { pending.push({ rel: t.rel, note: false, data: () => read(z, e) }); continue }
    pending.push({
      rel: t.rel, note: true,
      data: async () => {
        const resolve = (href: string) => {
          const p = hrefPath(href, e.name, () => undefined)
          const hit = p === null ? undefined : to.get(p)
          return hit ? { rel: hit.rel, md: hit.md } : null
        }
        const name = t.rel.split("/").pop()!.replace(/\.md$/, "")
        return frontmatter({ ext_id: t.ext }, links(pageMarkdown((await read(z, e)).toString("utf8"), name), resolve))
      },
    })
    if (pending.length >= BATCH) await flush(vault, pending, job)
  }
  await flush(vault, pending, job)
}

async function bear(vault: Vault, parts: Zip[], dir: string, job: Job) {
  const known = knownIds(vault, "bear-")
  const plan = planner(vault)
  const pending: Write[] = []
  for (const z of parts) {
    const byName = new Map(z.entries.map((e) => [e.name, e]))
    for (const e of z.entries) {
      const m = BUNDLE.exec(e.name)
      if (!m) continue
      const bundle = m[1]
      const infoEntry = byName.get(`${bundle}/info.json`)
      let info = bearInfo(null)
      try { if (infoEntry) info = bearInfo(JSON.parse((await entryBytes(z.file, infoEntry)).toString("utf8"))) } catch { /* no dates then */ }
      if (info.trashed) continue
      job.notes++
      const ext = `bear-${crypto.createHash("sha1").update(info.id ?? bundle).digest("hex").slice(0, 16)}`
      if (known.has(ext)) { job.unchanged++; continue }
      const { title, body } = bearNote((await entryBytes(z.file, e)).toString("utf8"))
      // Its pictures and files (assets/ in its bundle) into Bear/Attachments/, linked where they were.
      const assets = new Map<string, string>()
      for (const a of z.entries.filter((x) => x.name.startsWith(`${bundle}/assets/`))) {
        const p = plan.free(join(dir, "Attachments", safeName(a.name.split("/").pop())), (abs) => fs.statSync(abs).size === a.size)
        if (!p.exists) pending.push({ rel: p.rel, note: false, data: () => entryBytes(z.file, a) })
        assets.set(a.name.slice(bundle.length + 1), p.rel)
      }
      const text = links(body, (href) => {
        let rel: string | undefined
        try { rel = assets.get(decodeURIComponent(href)) } catch { rel = undefined }
        return rel ? { rel, md: false } : null
      })
      const fm: Record<string, unknown> = {}
      if (info.created) fm.created = stamp(new Date(info.created))
      if (info.updated) fm.updated = stamp(new Date(info.updated))
      if (info.archived) fm.archived = true
      fm.ext_id = ext
      const rel = plan.free(join(dir, `${safeName(title)}.md`)).rel
      known.set(ext, rel)
      pending.push({ rel, note: true, data: async () => frontmatter(fm, text) })
      if (pending.length >= BATCH) await flush(vault, pending, job)
    }
  }
  await flush(vault, pending, job)
}

/** A column whose text is the note's body, by its name. */
const BODY = /^(content|body|text|notes?|description)$/i

/** A CSV row as a note: its first column names it, a Content (Body, Notes...) column is its text, the rest are its
 *  properties (whole numbers and decimals as numbers, empty ones left out). */
export function rowNote(row: Record<string, string>): { title: string; fm: Record<string, unknown>; body: string } {
  const keys = Object.keys(row)
  const title = (row[keys[0]] ?? "").trim()
  const fm: Record<string, unknown> = {}
  let body = ""
  for (const k of keys.slice(1)) {
    const v = (row[k] ?? "").trim(), key = k.trim()
    if (!v || !key) continue
    if (BODY.test(key) && !body) { body = v; continue }
    fm[key] = /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v
  }
  return { title, fm, body }
}

async function csvRows(vault: Vault, parts: Zip[], base: string, job: Job) {
  const known = knownIds(vault, "csv-")
  const plan = planner(vault)
  const pending: Write[] = []
  const tables = parts.flatMap((z) => z.entries.filter((e) => /\.csv$/i.test(e.name)).map((e) => ({ z, e })))
  for (const { z, e } of tables) {
    const table = e.name.split("/").pop()!.replace(/\.csv$/i, "")
    // (one table: its rows in the export's folder; several: a folder each)
    const dir = tables.length > 1 ? join(base, [...safeName(table)].slice(0, 120).join("")) : base
    const text = (e.offset < 0 ? fs.readFileSync(z.file) : await entryBytes(z.file, e)).toString("utf8")
    const seen = new Map<string, number>()
    csvRecords(text).forEach((row, i) => {
      const { title, fm, body } = rowNote(row)
      const name = title || `Row ${i + 1}`
      const nth = (seen.get(name) ?? 0) + 1
      seen.set(name, nth)
      job.notes++
      const ext = `csv-${crypto.createHash("sha1").update(`${e.name}\n${name}\n${nth}`).digest("hex").slice(0, 16)}`
      if (known.has(ext)) { job.unchanged++; return }
      fm.ext_id = ext
      const rel = plan.free(join(dir, `${safeName(name)}.md`)).rel
      known.set(ext, rel)
      pending.push({ rel, note: true, data: async () => frontmatter(fm, body) })
    })
    await flush(vault, pending, job)
  }
}

