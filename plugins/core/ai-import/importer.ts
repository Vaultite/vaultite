// One import as a job: the zip and conversations.json are streamed so a big export never sits in memory, written in
// small batches holding the vault briefly. Idempotent by `ext_id`; memories only reach the review list.
import fs from "node:fs"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import { isTextKind, kindOf } from "../../../core/plugins.ts"
import { FM, frontmatter, nowUtc, safeName, setPropertyText, str, type Vault, writeAtomic } from "../../../core/vault.ts"
import { aboutOf, type Chat, isObj, type Job, type Memory, type Project } from "./chat.ts"
export type { Job } from "./chat.ts"
import * as chatgpt from "./chatgpt.ts"
import * as claude from "./claude.ts"
import { jsonItems } from "./jsonstream.ts"
import { chatNote, INLINE, LABELS, localDate, projectNote, reviewText, splitBody } from "./note.ts"
import { entryBytes, entryStream, isZip, type ZipEntry, zipEntries } from "./zip.ts"

export type Options = {
  /** The folder chats go in (a subfolder per source). */
  folder: string
  /** Chats with fewer messages (the user's and the AI's, with something in them) are skipped; 0 imports every one. */
  minMessages: number
  /** Import ChatGPT's images, whatever their size. */
  images: boolean
}

export const DEFAULTS: Options = { folder: "Chats", minMessages: 1, images: true }

export const newJob = (id: string, name: string): Job => ({
  id, state: "queued", name, source: null, read: 0, total: 0, chats: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, images: 0,
  files: 0, projects: 0, memories: 0, review: null, folder: null, problems: [], started: Date.now(),
})

/** Files written per hold of the vault. */
const BATCH = 20

type Write =
  | { kind: "note"; ext: string; dir: string; name: string; fm: Record<string, unknown>; body: string }
  | { kind: "file"; rel: string; data: Buffer; counts: "images" | "files" }

/** A file name for `name` in `dir` that's free ("Name.md", "Name 1.md"...). */
function freePath(vault: Vault, dir: string, name: string, taken: Set<string>) {
  const base = [...safeName(name)].slice(0, 100).join("").replace(/^[.\s]+|[.\s]+$/g, "") || "Untitled"
  for (let n = 0; ; n++) {
    const rel = `${dir}/${n ? `${base} ${n}` : base}.md`
    if (!taken.has(rel) && !vault.entries.has(rel) && !fs.existsSync(vault.abs(rel))) return rel
  }
}

/** A chat's file as it is now, rewritten: the importer's keys set (only their lines), what the user wrote above the
 *  transcript kept, the transcript replaced. */
export function rewritten(now: string, fm: Record<string, unknown>, body: string) {
  let t = now
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) continue
    const next = setPropertyText(t, k, v)
    if (next !== null) t = next
  }
  const m = FM.exec(t)
  const head = m ? t.slice(0, m[0].length).replace(/\n?$/, "\n") : ""
  const { own } = splitBody(m ? t.slice(m[0].length) : t)
  return `${head}\n${[own, body].filter(Boolean).join("\n\n")}\n`
}

/** Runs the import of `file` (the upload, on this machine) into `vault`, updating `job` as it goes. */
export async function runImport(vault: Vault, file: string, opts: Options, job: Job) {
  job.state = "running"
  const zip = isZip(file)
  const entries: ZipEntry[] = zip ? zipEntries(file).filter((e) => !e.name.startsWith("__MACOSX/")) : []
  const named = (re: RegExp) => entries.filter((e) => re.test(e.name))
  const convs = zip ? named(/(^|\/)conversations(-\d+)?\.json$/i).sort((a, b) => a.name.localeCompare(b.name)) : []
  if (zip && !convs.length) throw new Error("no conversations.json in this zip: is it ChatGPT's or Claude's export?")
  if (!zip) {
    const fd = fs.openSync(file, "r")
    const head = Buffer.alloc(64)
    try { fs.readSync(fd, head, 0, 64, 0) } finally { fs.closeSync(fd) }
    if (!/^(\ufeff)?\s*[[{]/.test(head.toString("utf8"))) throw new Error("this isn't a ChatGPT or Claude export (their zip, or its conversations.json)")
  }
  job.total = zip ? convs.reduce((n, e) => n + e.size, 0) : fs.statSync(file).size
  const wholeJson = async (e: ZipEntry | undefined) => {
    if (!e) return undefined
    try { return JSON.parse((await entryBytes(file, e)).toString("utf8")) } catch { return undefined }
  }

  // What every chat is, by its ext_id: so importing again updates instead of adding.
  const known = new Map<string, string>()
  for (const e of vault.entries.values()) {
    const x = e.fm.ext_id
    if (typeof x === "string" && /^(chatgpt|claude)-/.test(x)) known.set(x, e.rel)
  }
  const taken = new Set<string>()

  // Claude's projects first (a chat links to its project's note).
  const projects: Project[] = claude.readProjects(await wholeJson(named(/(^|\/)projects\.json$/i)[0]))
  const projectNames = new Map(projects.map((p) => [p.id, p.name]))
  const projectLinks = new Map<string, string>()

  const pending: Write[] = []
  /** Write what's pending a few files per hold, each batch synced before the next, so no sync has thousands of new files
   *  and requests keep being answered. */
  const flush = async () => {
    while (pending.length) {
      const batch = pending.splice(0, BATCH)
      await vault.lock(async () => { for (const w of batch) write(w); await vault.sync() })
      await turn()
    }
  }
  const write = (w: Write) => {
    if (w.kind === "file") {
      const abs = vault.abs(w.rel)
      if (!fs.existsSync(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, w.data); job[w.counts]++ }
      return
    }
    const rel = known.get(w.ext)
    if (rel && fs.existsSync(vault.abs(rel))) {
      const now = fs.readFileSync(vault.abs(rel), "utf8")
      const next = rewritten(now, w.fm, w.body)
      if (next !== now) { writeAtomic(vault.abs(rel), next); count(w.fm.type, "updated") } else count(w.fm.type, "unchanged")
    } else {
      const p = freePath(vault, w.dir, w.name, taken)
      taken.add(p)
      known.set(w.ext, p)
      writeAtomic(vault.abs(p), frontmatter(Object.fromEntries(Object.entries(w.fm).filter(([, v]) => v !== undefined)), w.body))
      count(w.fm.type, "created")
    }
  }
  const count = (type: unknown, what: "created" | "updated" | "unchanged") => {
    if (type === "chat-project") { if (what !== "unchanged") job.projects++ } else job[what]++
  }
  /** Unchanged since the last import (same updated time and message count): nothing to write. */
  const same = (ext: string, fm: Record<string, unknown>) => {
    const rel = known.get(ext)
    const e = rel ? vault.entries.get(rel) : undefined
    return !!e && str(e.fm.updated) === str(fm.updated ?? "") && str(e.fm.messages ?? "") === str(fm.messages ?? "")
  }

  /** A long text as a file in `dir` (a text kind keeps its name, else ".txt" is added): its name, the same file again
   *  when it's there with these bytes (importing again), else the next free name. */
  const saveText = (dir: string, name: string, text: string) => {
    const base = [...safeName(name)].slice(0, 100).join("").replace(/^[.\s]+|[.\s]+$/g, "") || "Attachment"
    const full = isTextKind(kindOf(base)) ? base : `${base}.txt`
    const dot = full.lastIndexOf("."), stem = dot > 0 ? full.slice(0, dot) : full, ext = dot > 0 ? full.slice(dot) : ""
    const data = Buffer.from(text)
    for (let n = 1; ; n++) {
      const file = n === 1 ? full : `${stem} ${n}${ext}`, rel = `${dir}/${file}`
      const queued = pending.find((w): w is Write & { kind: "file" } => w.kind === "file" && w.rel === rel)
      const there = queued?.data ?? (fs.existsSync(vault.abs(rel)) ? fs.readFileSync(vault.abs(rel)) : null)
      if (there?.equals(data)) return file
      if (there) continue
      pending.push({ kind: "file", rel, data, counts: "files" })
      return file
    }
  }

  for (const p of projects) {
    const dir = `${opts.folder}/Claude/Projects`
    for (const d of p.docs) if (d.text.length > INLINE) d.saved = saveText(`${opts.folder}/Claude/Attachments`, d.name, d.text)
    const { fm, body } = projectNote(p)
    const ext = String(fm.ext_id)
    if (!same(ext, fm)) pending.push({ kind: "note", ext, dir, name: p.name, fm, body })
    await flush()
    const rel = known.get(ext)
    if (rel) projectLinks.set(p.id, `[[${rel.replace(/\.md$/, "")}|${p.name}]]`)
  }

  // ChatGPT's images by asset id, and the newest memory list it showed the model.
  const assets = chatgpt.assetIndex(entries.map((e) => e.name))
  const byName = new Map(entries.map((e) => [e.name, e]))
  const memories: Memory[] = []
  let memoryList: { at: number; facts: string[] } | undefined

  const take = async (item: unknown) => {
    let chat: Chat | null = null
    if (isObj(item) && isObj(item.mapping)) {
      const r = chatgpt.readConversation(item)
      if (r) {
        chat = r.chat
        memories.push(...r.memories)
        if (r.memoryList && (!memoryList || r.memoryList.at >= memoryList.at)) memoryList = r.memoryList
      }
    } else if (isObj(item) && Array.isArray(item.chat_messages)) chat = claude.readConversation(item)
    if (!chat) {
      if (job.problems.length < 10) job.problems.push(`an item of conversations.json that isn't a conversation${isObj(item) && item.id ? ` (${String(item.id)})` : ""}`)
      return
    }
    job.chats++
    job.source ??= chat.source
    const ext = `${chat.source}-${chat.id}`
    const { fm } = chatNote(chat)
    if (!known.has(ext) && (fm.messages as number) < opts.minMessages) { job.skipped++; return }
    if (same(ext, fm)) { job.unchanged++; return }
    const label = LABELS[chat.source]
    for (const m of chat.messages) for (const p of m.parts) {
      if (p.kind === "file" && p.text && p.text.length > INLINE) p.saved = saveText(`${opts.folder}/${label}/Attachments`, p.name, p.text)
    }
    // Its images: the ones the zip has, once each.
    const images = new Map<string, string>()
    if (opts.images && zip) {
      for (const m of chat.messages) for (const p of m.parts) {
        if (p.kind !== "image" || !p.ref || images.has(p.ref)) continue
        const at = assets.get(p.ref)
        const e = at ? byName.get(at) : undefined
        if (!e) continue
        const base = e.name.split("/").pop()!.replace(/[^\w.-]+/g, "-")
        const rel = `${opts.folder}/${label}/Attachments/${base}`
        images.set(p.ref, base)
        if (!fs.existsSync(vault.abs(rel)) && !pending.some((w) => w.kind === "file" && w.rel === rel)) {
          pending.push({ kind: "file", rel, data: await entryBytes(file, e), counts: "images" })
        }
      }
    }
    const note = chatNote(chat, images, chat.project ? projectLinks.get(chat.project) : undefined)
    const day = chat.created ?? chat.messages.find((m) => m.at)?.at
    pending.push({ kind: "note", ext, dir: `${opts.folder}/${label}`, name: `${day ? `${localDate(day)} ` : ""}${chat.title}`, fm: note.fm, body: note.body })
    if (pending.length >= 24) await flush()
  }

  const onBytes = (n: number) => { job.read += n }
  let n = 0
  if (zip) {
    for (const e of convs) for await (const item of jsonItems(entryStream(file, e), onBytes)) {
      try { await take(item) } catch (err) { if (job.problems.length < 10) job.problems.push(String((err as Error).message ?? err)) }
      if (++n % 50 === 0) await turn()
    }
  } else {
    for await (const item of jsonItems(fs.createReadStream(file), onBytes)) {
      try { await take(item) } catch (err) { if (job.problems.length < 10) job.problems.push(String((err as Error).message ?? err)) }
      if (++n % 50 === 0) await turn()
    }
  }
  await flush()
  if (!job.chats && !projects.length) throw new Error("found no conversations: is this ChatGPT's or Claude's export?")

  // Memories: into the review list, never straight into ME.md.
  const source: Chat["source"] = job.source ?? (projects.length ? "claude" : "chatgpt")
  if (memoryList) { const at = memoryList.at; memories.unshift(...memoryList.facts.map((f) => ({ text: f, about: aboutOf(f), from: "ChatGPT's memory", at }))) }
  const memFile = named(/(^|\/)memories\.json$/i)[0]
  if (memFile) {
    const v = await wholeJson(memFile)
    memories.push(...(source === "claude" ? claude.readMemories(v, projectNames) : chatgpt.memoriesFile(v)))
  }
  job.folder = `${opts.folder}/${LABELS[source]}`
  if (memories.length) {
    const rel = `${opts.folder}/${LABELS[source]}/Memories to review.md`
    await vault.lock(async () => {
      await vault.sync()
      const abs = vault.abs(rel)
      const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null
      const knownText = [...vault.entries.values()].filter((e) => e.kind?.collection === "me" || e.kind?.collection === "people")
        .map((e) => { try { return fs.readFileSync(vault.abs(e.rel), "utf8") } catch { return "" } }).join("\n")
      const { text, added } = reviewText(LABELS[source], memories, existing, knownText, nowUtc())
      job.memories = added
      if (added) { writeAtomic(abs, text); await vault.sync() }
      if (added || existing !== null) job.review = rel
    })
  }
  job.state = "done"
}
