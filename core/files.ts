// The vault as files, for the file tree and the editor: /api/files, /api/file (+ move, copy, restore), /api/search,
// /api/raw. Hidden files are out of reach unless shown, but the app's own settings open by exact path (SETTINGS).
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { HTTPError, LOADED, type Plugin, reply, serviceFor } from "./plugins.ts"
import { ARCHIVE_DIR, inArchive, inPagesDir } from "./fileprops.ts"
import { isTextKind, kindOf, tooBig } from "./filetypes.ts"
import { highlighter, matches, type Node, parse, SearchError } from "./searchquery.ts"
import { merge3 } from "./textedit.ts"
import { textHash } from "./texthash.ts"
import { blocksIn } from "./sections.ts"
import { tabNames } from "./tabs.ts"
import { addEntry, entryLine, KINDS, type NewEntry } from "./timeline.ts"
import { cmp, type Entry, fetchFromICloud, type Item, ms, newFile, newFileAt, readSoon, readText, sameFile, sortBy, statFrom, stemOf, type Vault, writeAtomic, writeNew } from "./vault.ts"

const WIKI = () => /\[\[([^[\]\n|#^]+)((?:#[^[\]\n|]*)?)((?:\|[^[\]\n]*)?)\]\]/g
const SKIP = new Set([".DS_Store", ".git", ".localized"]) // never shown, even with hidden files on
const STAMP = / \d{4}-\d{2}-\d{2} \d{6}$/ // what trashing adds to a name
const CODE = /(`+)(?:(?!\1).)+?\1/g // an inline code span

export function showHidden(vault: Vault | null) {
  return !!(vault && vault.config("files").showHidden)
}

/** Read-only: the trash (restore or delete things there) and the app's generated copies. (The rules for AIs,
 *  .vaultite/AGENTS.md, take the user's own under their heading: Agent files.) */
export function locked(rel: string) {
  return rel.startsWith(".trash/") || rel === ".vaultite/generated" || rel.startsWith(".vaultite/generated/")
}

/** [stem, extension] like Python's os.path.splitext: a leading dot isn't an extension. */
function splitext(rel: string): [string, string] {
  const slash = rel.lastIndexOf("/")
  const name = rel.slice(slash + 1)
  const dot = name.replace(/^\.+/, (m) => " ".repeat(m.length)).lastIndexOf(".")
  return dot > 0 ? [rel.slice(0, slash + 1 + dot), name.slice(dot)] : [rel, ""]
}

/** The app's settings files, reachable by exact path even with hidden files off: .vaultite/**.{json,md,vim}, and the
 *  snippets and themes folders. */
const SETTINGS = /^\.vaultite\/(?:(?:[^./][^/]*\/)*[^./][^/]*\.(?:json|md|vim)|(?:snippets|themes)(?:\/[^./][^/]*)*)$/

/** A safe vault-relative path, or a 400. Hidden ones only when Settings shows hidden files, or (`explicit`: opening
 *  one file by its path) the app's settings files, or (`trash`: restoring) something in .trash. */
export function clean(p: unknown, mustExist = false, vault: Vault | null = null, explicit = false, trash = false) {
  const parts = String(p ?? "").replaceAll("\\", "/").trim().replace(/^\/+|\/+$/g, "").split("/").filter((x) => x !== "" && x !== ".")
  const hidden = showHidden(vault) || (explicit && SETTINGS.test(parts.join("/"))) ||
    // Something in the trash, to restore it (Undo after a delete), even with hidden files off.
    (trash && parts.length > 1 && parts[0] === ".trash" && !parts.slice(1).some((x) => x.startsWith(".")))
  const pages = inPagesDir(parts.join("/")) && parts.length > 2 // (a page in it, not the folder)
  if (!parts.length || parts.some((x) => x === ".." || SKIP.has(x) || (x.startsWith(".") && x !== ARCHIVE_DIR && !hidden && !pages))) {
    throw new HTTPError(400, `not a path in the vault: '${p ?? "None"}'`)
  }
  if (parts.some((x) => /[*"\\<>:|?]/.test(x))) throw new HTTPError(400, 'names can\'t contain * " \\ < > : | ?')
  const rel = parts.join("/")
  if (mustExist && vault && !fs.existsSync(vault.abs(rel))) throw new HTTPError(404, `no file '${rel}'`)
  return rel
}

/** The first `n` characters, an ellipsis saying when there were more. */
const chars = (s: string, n: number) => { const c = [...s]; return c.length > n ? `${c.slice(0, n).join("")}…` : s }

/** A line as search shows it: without its list mark, task box, quote or heading marks, up to 200 characters, from a
 *  little before the match (`at`, an index in the line) when that's further in, so it's in what's shown. */
function context(line: string, at?: (s: string) => [number, number][]) {
  let s = line.replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?|>\s*|#{1,6}\s+)/, "").trim()
  const first = at?.(s)[0]?.[0] ?? 0
  if (first > 100) { const from = s.indexOf(" ", first - 40); s = `…${s.slice(from >= 0 && from < first ? from + 1 : first - 40)}` }
  return chars(s, 200)
}

/** A Markdown link to a note (`[text](Some%20Note.md#Heading)`, written instead of a wikilink): not a URL. */
const MDLINK = () => /\[[^\]\n]*\]\((?:<([^>\n]+?\.md)>|((?![a-z][a-z0-9+.-]*:)[^)\s]+?\.md))(?:#[^)\s]*)?\)/gi

/** What a Markdown link names, as a wikilink target: its path from the vault's top when it's relative to the file and
 *  such a file exists, else as written (a name or a vault path), without .md. */
function mdTarget(vault: Vault | null, rel: string, href: string) {
  let t = href
  try { t = decodeURIComponent(href) } catch { /* not encoded */ }
  t = t.replace(/^\/+/, "")
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""
  const joined = path.posix.normalize(dir ? `${dir}/${t}` : t)
  if (vault && !joined.startsWith("..") && vault.entries.has(joined)) t = joined
  return t.replace(/^(\.\.?\/)+/, "").replace(/\.md$/i, "")
}

/** [target, the line it's on] for every wikilink in a file (body and frontmatter values), and Markdown links to notes. */
function linksOf(e: Entry, vault: Vault | null = null) {
  const out: [string, string][] = []
  let fence: string | null = null
  for (const line of e.body.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length))) {
      fence = fence ? null : f[1]
      continue
    }
    if (fence) continue // a link in code is just text
    const text = line.replace(CODE, "")
    for (const m of text.matchAll(WIKI())) out.push([m[1].trim(), context(line)])
    if (text.includes("](")) for (const m of text.matchAll(MDLINK())) out.push([mdTarget(vault, e.rel, m[1] ?? m[2]), context(line)])
  }
  for (const [k, v] of Object.entries(e.fm)) {
    for (const s of Array.isArray(v) ? v : [v]) {
      if (typeof s === "string") for (const m of s.matchAll(WIKI())) out.push([m[1].trim(), `${k}: ${context(s)}`])
    }
  }
  return out
}


/** A Markdown file's row in the tree. */
function row(vault: Vault, rel: string, e: Entry): Item {
  const aliases = e.fm.aliases
  // How it shows in the tree, tabs and the sidebar (a dashboard's icon and colour, the plugin that brought it), if the file says.
  const look: Item = {}
  for (const k of ["icon", "tint", "plugin", "tab"]) if (typeof e.fm[k] === "string") look[k] = e.fm[k]
  // A page with tabs (core/tabs.ts): the files after it.
  const tabs = tabNames(e.fm.tabs)
  if (tabs) look.tabs = tabs
  const title = e.fm.title || e.fm.name || stemOf(rel)
  return {
    ...look,
    path: rel, type: e.type, kind: e.kind ? e.kind.collection : null, title: typeof title === "string" ? title : String(title),
    aliases: (Array.isArray(aliases) ? aliases : aliases ? [aliases] : []).map(String),
    mtime: ms(e.stat.ns), ctime: e.stat.born, size: e.stat.size, links: linksOf(e, vault),
    problems: e.problems.length,
    ...(e.archived ? { archived: true } : {}),
    // Frontmatter tags and inline #tags (the Tags panel, the tag sheet)
    ...(e.tags.length ? { tags: e.tags } : {}),
    blocks: blocksIn(e.body).map((b) => [b.name, b.text]),
  }
}

// Rows are worked out once per read of a file (an Entry is new each time its file is read), except for files with
// Markdown links, which resolve against the other files there are now (mdTarget).
const rows = new WeakMap<Entry, Item>()
// The tree as of a vault version (it bumps on any change: a file, another file, a folder) and the plugins drawing pages
// (`looks:<ext>`), hidden files aside.
type Tree = { files: Item[]; others: Item[]; folders: string[] }
const trees = new WeakMap<object, { version: number; settings: number; pages: Plugin[]; tree: Tree }>()
type Looks = (vault: Vault, rel: string, mtime: number) => Item

/** The plugins that are on and make some files pages (the service `looks:<ext>`: HTML's .html, Tables' .csv). */
function pagePlugins(vault: Vault) {
  const off = vault.switchedOff()
  return LOADED.filter((p) => !off.has(p.id) && Object.keys(p.services).some((k) => k.startsWith("looks:")))
}

/** Every file and folder, for the tree, links and backlinks: the same frozen object while the vault is unchanged, so
 *  it's serialized once. Its rows are shared: don't change them. */
export function tree(vault: Vault): Tree {
  let hit = trees.get(vault)
  const pages = pagePlugins(vault)
  if (hit?.version !== vault.version || hit.settings !== vault.settingsVersion || hit.pages.length !== pages.length || hit.pages.some((p, i) => p !== pages[i])) {
    const files: Item[] = [], others: Item[] = []
    for (const [rel, e] of [...vault.entries].sort(([a], [b]) => cmp(a, b))) {
      let r = rows.get(e)
      if (!r) {
        r = row(vault, rel, e)
        if (!e.body.includes("](")) rows.set(e, r)
      }
      // Its kind's blocks, drawn on top where it doesn't place them (a log's can follow its area's settings).
      const view = e.kind?.blocksFor(e.fm) ?? []
      files.push(view.length ? { ...r, kindBlocks: view } : r)
    }
    // Files a plugin makes pages (its `looks:<ext>`: an artifact, a table) are files you open, like notes, named by their
    // title (else their name without the extension); the rest (images, PDFs, canvases) are only served.
    for (const [r, st] of [...vault.others].sort(([a], [b]) => cmp(a, b))) {
      const base = { path: r, mtime: ms(st.ns), ctime: st.born, size: st.size, ...(inArchive(r) ? { archived: true } : {}) }
      const looks = serviceFor(pages, "looks", r) as Looks | null
      if (!looks) {
        others.push(base)
        continue
      }
      const look = looks(vault, r, base.mtime) ?? {}
      files.push({ ...look, ...base, type: null, kind: null, title: look.title ?? stemOf(r).replace(/\.[^.]+$/, ""), aliases: [], links: [], problems: 0, blocks: [] })
    }
    hit = { version: vault.version, settings: vault.settingsVersion, pages, tree: Object.freeze({ files, others, folders: [...vault.folders] }) }
    trees.set(vault, hit)
  }
  if (!showHidden(vault)) return hit.tree
  const [hf, hd] = hiddenFiles(vault)
  return { files: hit.tree.files, others: [...hit.tree.others, ...hf], folders: [...hit.tree.folders, ...hd].sort() }
}

/** Hidden files and folders (.vaultite, .trash, a dot file anywhere), for the tree when Settings shows them. They
 *  stay out of the index: a person file in .trash isn't a person. */
function hiddenFiles(vault: Vault): [Item[], string[]] {
  const files: Item[] = [], folders: string[] = []
  const stack: [string, boolean][] = [["", false]]
  while (stack.length) {
    const [sub, inside] = stack.pop()!
    let names: string[]
    try {
      names = fs.readdirSync(sub ? vault.abs(sub) : vault.path)
    } catch {
      continue
    }
    for (const name of names) {
      if (SKIP.has(name) || name.endsWith(".icloud") || name.includes(".tmp-")) continue
      const rel = sub ? `${sub}/${name}` : name
      const hid = inside || (name.startsWith(".") && name !== ARCHIVE_DIR) // (archive folders are indexed: in the tree already)
      let st: fs.BigIntStats
      try {
        st = fs.statSync(vault.abs(rel), { bigint: true })
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (hid) folders.push(rel)
        stack.push([rel, hid])
        continue
      }
      if (!hid || inPagesDir(rel)) continue // (the pages folder's are indexed: in the tree already)
      files.push({ path: rel, mtime: ms(st.mtimeNs), ctime: statFrom(st).born, size: Number(st.size) })
    }
  }
  return [sortBy(files, (f) => f.path), folders]
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** A file's text, or null when it isn't text (not UTF-8, or has NUL bytes: a binary file that happens to decode). */
function textOf(data: Buffer) {
  if (data.subarray(0, 8000).includes(0)) return null
  try {
    return utf8.decode(data).replace(/\r\n?/g, "\n")
  } catch (e) {
    if (tooBig(e)) throw e
    return null
  }
}

export function read(vault: Vault, rel: string) {
  let data: Buffer, st: fs.BigIntStats
  try {
    st = fs.statSync(vault.abs(rel), { bigint: true })
    if (st.isDirectory()) throw new HTTPError(400, `'${rel}' is a folder`)
    data = fs.readFileSync(vault.abs(rel))
  } catch (e) {
    if (e instanceof HTTPError) throw e
    if (tooBig(e)) throw new HTTPError(413, `'${rel}' is too big to open as text`)
    throw new HTTPError(404, `no file '${rel}'`)
  }
  let text: string | null
  try { text = textOf(data) } catch { throw new HTTPError(413, `'${rel}' is too big to open as text`) }
  if (text === null) throw new HTTPError(415, `'${rel}' isn't text`)
  const e = vault.entries.get(rel)
  return { path: rel, text, mtime: ms(st.mtimeNs), size: Number(st.size), kind: e && e.kind ? e.kind.collection : null, problems: e ? [...e.problems] : [] }
}

/** Wait, off the main thread, for a text file iCloud may still be downloading: a 503 when it takes over `wait` ms. */
async function downloaded(vault: Vault, rel: string, wait = 10_000) {
  let st: fs.Stats
  try { st = fs.statSync(vault.abs(rel)) } catch { return }
  if (st.isDirectory()) return
  if (await readSoon(vault.abs(rel), wait).catch(() => true) === null) throw new HTTPError(503, `iCloud is still downloading ${rel}; try again in a moment`)
}

/** Whether the editor may write this file as text: a kind that's text, or a file that reads as text now. */
function writable(vault: Vault, rel: string) {
  if (isTextKind(kindOf(rel))) return true
  try {
    const st = fs.statSync(vault.abs(rel))
    return st.isFile() && textOf(fs.readFileSync(vault.abs(rel))) !== null
  } catch {
    return false
  }
}

/** A file written with Windows line endings (\r\n) keeps them: the editor works in \n. */
function crlf(abs: string) {
  try {
    const fd = fs.openSync(abs, "r")
    const buf = Buffer.alloc(8192)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    return buf.subarray(0, n).includes("\r\n")
  } catch {
    return false
  }
}

/** A PDF's page count, when it's cheap to see (its page objects are plain in the file); null otherwise. Read a piece at a
 *  time off the main thread, at any size: a match is counted in the piece it starts in, the last MB carried over. */
async function pdfPages(abs: string) {
  const PIECE = 32 << 20, OVER = 1 << 20
  let most = 0, pages = 0, carry = "", at = 0
  const fh = await fs.promises.open(abs)
  try {
    const buf = Buffer.alloc(Math.min(PIECE, (await fh.stat()).size + 1))
    for (;;) {
      const { bytesRead, buffer } = await fh.read(buf, 0, buf.length, at)
      at += bytesRead
      const s = carry + buffer.subarray(0, bytesRead).toString("latin1"), end = bytesRead < buf.length ? s.length : s.length - OVER
      for (const m of s.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) if (m.index < end) most = Math.max(most, Number(m[1] ?? m[2]))
      for (const m of s.matchAll(/\/Type\s*\/Page\b(?!s)/g)) if (m.index < end) pages++
      if (bytesRead < buf.length) break
      carry = s.slice(end)
    }
  } finally {
    await fh.close()
  }
  return most || pages || null
}

async function info(vault: Vault, rel: string) {
  let st: fs.BigIntStats
  try {
    st = fs.statSync(vault.abs(rel), { bigint: true })
  } catch {
    throw new HTTPError(404, `no file '${rel}'`)
  }
  const kind = kindOf(rel)
  const out: Item = { path: rel, kind, size: Number(st.size), mtime: ms(st.mtimeNs), ctime: statFrom(st).born }
  if (kind === "pdf") out.pages = await pdfPages(vault.abs(rel)).catch(() => null)
  return out
}

/** Drop a moved or trashed folder's files from the index (a missing top-level folder alone doesn't count as deleted:
 *  the vault may be mid-sync). */
function forget(vault: Vault, rel: string) {
  for (const r of [...vault.entries.keys()]) if (r === rel || r.startsWith(rel + "/")) vault.drop(r)
}

/** `rel`, or "Name 1", "Name 2"... when that's taken: Obsidian's rule, everywhere the app names a new file or folder
 *  (a dropped one, a restored one, "Untitled"). */
export function freeName(vault: Vault, rel: string) {
  const [stem, ext] = splitext(rel)
  let n = 1, out = rel
  while (fs.existsSync(vault.abs(out))) out = `${stem} ${n++}${ext}`
  return out
}

/** A new text file's text with what plugins add to a note (onCreate); another file's are told of it (onCreateFile). */
function newText(vault: Vault, rel: string, text: string) {
  if (/\.md$/i.test(rel)) return vault.created(rel, text)
  vault.fileCreated(rel, newFile(Buffer.from(text, "utf8")))
  return text
}

/** A timeline entry sent to POST /api/timeline, checked. */
function newEntry(b: Item): NewEntry {
  const kind = String(b.kind ?? "").trim().toLowerCase()
  if (!/^\d{4}-\d\d-\d\d$/.test(String(b.date ?? "")) || !KINDS.has(kind)) {
    throw new HTTPError(400, `need a date (YYYY-MM-DD) and a kind: one of ${[...KINDS].sort().join(", ")}`)
  }
  const min = b.duration_min === null || b.duration_min === undefined || b.duration_min === "" ? null : Number(b.duration_min)
  if (min !== null && !(Number.isFinite(min) && min > 0)) throw new HTTPError(400, "duration_min is a number of minutes, more than 0")
  const text = (k: string) => (typeof b[k] === "string" ? b[k].trim() : "")
  if (kind === "note" && !text("notes")) throw new HTTPError(400, "a note needs its text (notes)")
  return { date: b.date, kind, duration_min: min, subject: text("subject"), notes: text("notes"), url: text("url") }
}

/** Put a trashed file or folder back where it came from, minus the time trashing added to its name. */
function restore(vault: Vault, rel: string) {
  if (!rel.startsWith(".trash/")) throw new HTTPError(400, "only things in .trash can be restored")
  if (!fs.existsSync(vault.abs(rel))) throw new HTTPError(404, `${rel} isn't in the trash any more`)
  let [stem, ext] = splitext(rel.slice(".trash/".length))
  if (fs.statSync(vault.abs(rel)).isDirectory()) [stem, ext] = [stem + ext, ""]
  const dst = freeName(vault, stem.replace(STAMP, "") + ext)
  fs.mkdirSync(path.dirname(vault.abs(dst)), { recursive: true })
  fs.renameSync(vault.abs(rel), vault.abs(dst))
  return dst
}

/** How long things stay in .trash, like Recently deleted. */
export const TRASH_DAYS = 30
const TRASHED_AT = / (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})(?: \d+)?$/

/** Delete for good what went to .trash over TRASH_DAYS ago: by the time in its name, else (put there by another app)
 *  when it was moved there. A few at a time; an iCloud placeholder counts as its file. Returns what it deleted. */
export async function emptyTrash(vault: Vault, now = Date.now()) {
  const cutoff = now - TRASH_DAYS * 86_400_000, gone: string[] = []
  const top = vault.abs(".trash")
  try { if (!fs.lstatSync(top).isDirectory()) return gone } catch { return gone }
  const sweep = async (dir: string): Promise<boolean> => {
    let names: string[]
    try { names = fs.readdirSync(path.join(top, dir)) } catch { return false }
    let removed = false
    for (const name of names) {
      const rel = dir ? `${dir}/${name}` : name, abs = path.join(top, rel)
      let st: fs.Stats
      try { st = fs.lstatSync(abs) } catch { continue }
      // (an iCloud placeholder: ".Name 2026-09-01 101500.md.icloud")
      const real = name.replace(/^\.(.+)\.icloud$/, "$1")
      const m = TRASHED_AT.exec(st.isDirectory() ? real : splitext(real)[0])
      if (!m && st.isDirectory()) {
        // A folder the trash keeps a path in: what's in it, then itself once that's all gone.
        if (await sweep(rel) && !fs.readdirSync(abs).length) { try { fs.rmdirSync(abs); removed = true } catch { /* in use */ } }
        continue
      }
      const at = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : st.ctimeMs
      if (at > cutoff) continue
      try { fs.rmSync(abs, { recursive: true, force: true }); gone.push(`.trash/${rel}`); removed = true } catch (e) { console.error("trash:", e) }
      if (gone.length % 20 === 0) await turn()
    }
    return removed
  }
  await sweep("")
  return gone
}


/** Where a duplicate of a file goes: next to it, "Name 1", "Name 2"... (the number after an existing one's). */
export function copyName(vault: Vault, rel: string) {
  const [stem, ext] = splitext(rel)
  const m = / (\d+)$/.exec(stem)
  const base = m ? stem.slice(0, -m[0].length) : stem
  let n = m ? Number(m[1]) + 1 : 1, out = `${base} ${n}${ext}`
  while (fs.existsSync(vault.abs(out))) out = `${base} ${++n}${ext}`
  return out
}

/** Every file's text for search besides the notes (whole, any number of them): text files as they are, and files a
 *  plugin reads (`text:<ext>`: a workbook's cells) as it gives them. Read off the main thread, again only when changed;
 *  kept in memory up to KEEP in all, the rest read again by each search (memory stays bounded, nothing is left out). */
const KEEP = 256 << 20
/** Bigger than this, a file is read a piece at a time (one string can't hold much more): a query matches a piece. */
const PIECE = 128 << 20
/** `text`: its text kept; "disk": text, read when searched; null: not text (or nothing a reader could read). */
type Indexed = { ns: bigint; reader: Reader | null; text: string | "disk" | null }
type Index = { files: Map<string, Indexed>; kept: number; version: string; busy: Promise<void> | null }
const indexes = new WeakMap<Vault, Index>()
const DISK = "disk"

/** The plugins that are on and read some kind of file as text (`text:<ext>`). */
function readerPlugins(vault: Vault) {
  const off = vault.switchedOff()
  return LOADED.filter((p) => !off.has(p.id) && Object.keys(p.services).some((k) => k.startsWith("text:")))
}

type Reader = (b: Buffer, rel: string) => string
/** The files search reads besides the notes, each with the plugin reader that turns it into text, if any. */
function searchFiles(vault: Vault) {
  const readers = readerPlugins(vault)
  const out = new Map<string, Reader | null>()
  for (const rel of vault.others.keys()) {
    const k = kindOf(rel)
    if (k === "image" || k === "pdf" || k === "audio" || k === "video") continue
    const reader = k === "binary" ? serviceFor(readers, "text", rel) as Reader | null : null
    if (k !== "binary" || reader) out.set(rel, reader)
  }
  return out
}

/** Embedded files' bytes (a data: URL's base64: a drawing's pasted images) aren't text anyone looks for, and short
 *  words would match inside them: left out of what's searched. */
const DATA_URL = /(data:[\w.+-]+\/[\w.+-]+;base64,)[A-Za-z0-9+/=]{256,}/g
const searchText = (t: string) => t.replace(DATA_URL, "$1…")

/** A file's text to search, read now: null when it isn't text; DISK when it's too big to keep (read when searched);
 *  undefined while it's only in iCloud (asked for, not waited on: tried again next time). */
async function readIndexed(abs: string, rel: string, reader: Reader | null, room: number): Promise<string | null | undefined> {
  const st = await fs.promises.stat(abs)
  if (st.blocks === 0 && st.size > 0) { fetchFromICloud(abs, { errno: 11 }); return undefined }
  if (reader) {
    const text = String(reader(await fs.promises.readFile(abs), rel) ?? "")
    return text.length > room ? DISK : text
  }
  const fh = await fs.promises.open(abs)
  try {
    const head = Buffer.alloc(Math.min(st.size, 8000))
    await fh.read(head, 0, head.length, 0)
    if (head.includes(0)) return null
    if (st.size > PIECE || st.size > room) return DISK
    const text = textOf(await fh.readFile())
    return text === null ? null : searchText(text)
  } finally {
    await fh.close()
  }
}

/** Bring the index up to date: files new or changed since are read (a few at a time), gone ones dropped. */
function refresh(vault: Vault): Promise<void> {
  let ix = indexes.get(vault)
  if (!ix) indexes.set(vault, ix = { files: new Map(), kept: 0, version: "", busy: null })
  const idx = ix
  if (idx.busy) return idx.busy.then(() => refresh(vault))
  // (plugins turned on or off read other files, or none)
  const version = `${vault.version}:${LOADED.length}:${[...vault.switchedOff()].join(",")}`
  if (idx.version === version) return Promise.resolve()
  const want = searchFiles(vault)
  const drop = (rel: string) => {
    const had = idx.files.get(rel)
    if (had && typeof had.text === "string" && had.text !== DISK) idx.kept -= had.text.length
    idx.files.delete(rel)
  }
  for (const rel of [...idx.files.keys()]) if (!want.has(rel)) drop(rel)
  const todo = [...want].filter(([rel, reader]) => { const f = idx.files.get(rel); return f?.ns !== vault.others.get(rel)?.ns || f?.reader !== reader })
  let missed = false
  const work = async () => {
    while (todo.length) {
      const [rel, reader] = todo.pop()!
      const st = vault.others.get(rel)
      if (!st) continue
      let text: string | null | undefined = null
      try { text = await readIndexed(vault.abs(rel), rel, reader, KEEP - idx.kept) } catch (e) { if (tooBig(e)) text = DISK }
      drop(rel)
      if (text === undefined) { missed = true; continue }
      idx.files.set(rel, { ns: st.ns, reader, text })
      if (text !== null && text !== DISK) idx.kept += text.length
    }
  }
  idx.busy = Promise.all(Array.from({ length: 8 }, work)).then(() => { if (!missed) idx.version = version }).finally(() => { idx.busy = null })
  return idx.busy
}

/** Read the index ahead (the file tree was asked for: a search may follow), off any request. */
export function warmSearch(vault: Vault) {
  refresh(vault).catch((e) => console.error(`search index: ${(e as Error).message}`))
}

/** A file the index didn't keep, a piece at a time (whole when it fits one), cut at line ends. */
async function* pieces(abs: string): AsyncGenerator<string> {
  const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  const crlf = (s: string) => s.replace(/\r\n?/g, "\n")
  let carry = ""
  try {
    for await (const chunk of fs.createReadStream(abs, { highWaterMark: PIECE })) {
      const text = carry + dec.decode(chunk as Buffer, { stream: true })
      const cut = text.lastIndexOf("\n")
      if (cut < 0 && text.length < PIECE) { carry = text; continue }
      yield searchText(crlf(cut < 0 ? text : text.slice(0, cut)))
      carry = cut < 0 ? "" : text.slice(cut + 1)
    }
    carry += dec.decode()
  } catch { /* gone meanwhile, or not UTF-8 after all */ }
  if (carry) yield searchText(crlf(carry))
}

/** The texts to search a file in: the one kept, or read now (by its reader, or in pieces). */
async function* textsOf(vault: Vault, rel: string, f: Indexed): AsyncGenerator<string> {
  if (f.text === null) return
  if (f.text !== DISK) { yield f.text; return }
  if (!f.reader) { yield* pieces(vault.abs(rel)); return }
  let text = ""
  try { text = String(f.reader(await fs.promises.readFile(vault.abs(rel)), rel) ?? "") } catch { /* gone meanwhile */ }
  if (text) yield text
}

/** How results can be ordered: by how well they match (the default), name, or when they were changed or made. */
const SORTS: Record<string, [key: (r: Item) => unknown, reverse: boolean]> = {
  relevance: [(r) => [-r.score, -r.mtime], false],
  name: [(r) => [String(r.title).toLowerCase(), r.path], false],
  "name-desc": [(r) => [String(r.title).toLowerCase(), r.path], true],
  modified: [(r) => r.mtime, true],
  "modified-old": [(r) => r.mtime, false],
  created: [(r) => r.created, true],
  "created-old": [(r) => r.created, false],
}

type SearchOpts = { lines?: number; folder?: string; matchCase?: boolean; sort?: string; context?: number; offset?: number }

/** Files matching a query (core/searchquery.ts: words, "phrases", -not, OR, file:, path:, tag:, line:(), [property]...),
 *  with the first line that matched, and with `lines` every such line (and `context` lines around each). */
export async function search(vault: Vault, q: string, limit = 60, opts: SearchOpts = {}) {
  if (!q.trim()) return []
  let node: Node
  try { node = parse(q, { matchCase: opts.matchCase }) } catch (e) {
    if (e instanceof SearchError) throw new HTTPError(400, e.message)
    throw e
  }
  if (node.t === "all") return []
  const marks = highlighter(node, "text"), names = highlighter(node, "name")
  const folder = (opts.folder ?? "").replace(/^\/+|\/+$/g, "")
  const whole = q.trim().toLowerCase()
  /** The file's item when `body` (its text, or the piece of it from line `from` on) matches. */
  const check = (rel: string, body: string, ns: bigint, born: number, e: Entry | null, from = 0): Item | null => {
    const file = rel.split("/").pop()!
    const name = e ? stemOf(rel) : file
    if (!matches(node, { name, file, path: rel, text: body, tags: e?.tags, props: e?.fm })) return null
    const score = names(name).length * 3 + (name.toLowerCase().includes(whole) ? 5 : 0)
    const item: Item = { path: rel, title: name, context: "", score, mtime: ms(ns), created: born, ...(e?.archived ? { archived: true } : {}) }
    // The search tab (view:search) shows every line that matched, like a search editor; `context` lines around each
    // come marked `ctx: true`, each line once.
    if (opts.lines) {
      const lines = body.split("\n")
      const hits: number[] = []
      lines.forEach((l, i) => { if (marks(l).length) hits.push(i) })
      const hit = new Set(hits)
      const around = Math.min(opts.context ?? 0, 5)
      const shown = new Set<number>()
      const matched: { line: number; text: string; ctx?: true }[] = []
      for (const i of hits.slice(0, opts.lines)) {
        for (let k = Math.max(0, i - around); k <= Math.min(lines.length - 1, i + around); k++) {
          if (shown.has(k)) continue
          shown.add(k)
          matched.push({ line: from + k + 1, text: chars(lines[k].trim(), 300), ...(hit.has(k) ? {} : { ctx: true as const }) })
        }
      }
      item.context = context(hits.length ? lines[hits[0]] : "", marks)
      item.matches = matched.sort((a, b) => a.line - b.line)
      item.count = hits.length
    } else {
      // (line by line, not split: a big file's first match is near its top more often than not)
      for (let i = 0; i <= body.length;) {
        const j = body.indexOf("\n", i), end = j < 0 ? body.length : j, line = body.slice(i, end)
        if (marks(line).length) { item.context = context(line, marks); break }
        i = end + 1
      }
    }
    return item
  }
  const out: Item[] = []
  for (const [rel, e] of vault.entries) {
    if (folder && !rel.startsWith(`${folder}/`)) continue
    const item = check(rel, e.body, e.stat.ns, e.stat.born, e)
    if (item) out.push(item)
  }
  await refresh(vault)
  for (const [rel, f] of indexes.get(vault)!.files) {
    const st = vault.others.get(rel)
    if (!st || (folder && !rel.startsWith(`${folder}/`))) continue
    // A file read in pieces matches when one of them does; its lines are counted on from piece to piece.
    let item: Item | null = null, from = 0
    for await (const text of textsOf(vault, rel, f)) {
      const got = check(rel, text, st.ns, st.born, null, from)
      from += (text.match(/\n/g)?.length ?? 0) + 1
      if (!got) continue
      if (!item) { item = got; if (!opts.lines) break; continue }
      item.matches = [...item.matches, ...got.matches]
      item.count += got.count
    }
    if (item) out.push(item)
  }
  // Archived files last (core/fileprops.ts), like the quick switcher.
  const [key, reverse] = SORTS[opts.sort ?? ""] ?? SORTS.relevance
  const sorted = sortBy(out, key, reverse)
  const from = opts.offset ?? 0
  return [...sorted.filter((r) => !r.archived), ...sorted.filter((r) => r.archived)].slice(from, from + limit)
}

let uploadN = 0
/** POST /api/upload?path=: a new file of any size, its bytes (the request's body; in-process, `bytes`: a Buffer or a
 *  stream) streamed beside where it goes, hidden, then put there holding the vault: never over a file. The vault is held
 *  only for that, not while the bytes come. */
export async function upload(vault: Vault, query: Record<string, string>, body: Item, http: IncomingMessage | undefined, hold: <T>(fn: () => Promise<T>) => Promise<T>) {
  const rel = clean(query.path ?? body.path, false, vault)
  if (locked(rel)) throw new HTTPError(403, `${rel} is read-only`)
  const abs = vault.abs(rel)
  if (fs.existsSync(abs)) throw new HTTPError(409, `${rel} already exists`)
  const bytes = Buffer.isBuffer(body.bytes) ? body.bytes : null
  const src = bytes ? null : body.bytes instanceof Readable ? body.bytes : http instanceof Readable && !http.readableEnded ? http : null
  if (!bytes && !src) throw new HTTPError(400, "send the file's bytes as the request's body")
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.upload-${process.pid}-${++uploadN}`)
  try {
    if (bytes) fs.writeFileSync(tmp, bytes, { flag: "wx" })
    else await pipeline(src!, fs.createWriteStream(tmp, { flags: "wx" }))
    return await hold(async () => {
      vault.fileCreated(rel, newFileAt(tmp)) // (plugins look at it: onCreateFile)
      if (fs.existsSync(abs)) throw new HTTPError(409, `${rel} already exists`)
      fs.renameSync(tmp, abs)
      await vault.sync()
      return reply(201, { path: rel })
    })
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** The file routes, or undefined if the request isn't one of them. */
export async function handle(vault: Vault, method: string, parts: string[], query: Record<string, string>, body: Item): Promise<unknown> {
  const route = parts.join("/")
  if (route === "files" && method === "GET") { warmSearch(vault); return tree(vault) }
  if (route === "search" && method === "GET") {
    const n = (v: string | undefined, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))
    if (query.sort && !(query.sort in SORTS)) throw new HTTPError(400, `sort is one of ${Object.keys(SORTS).join(", ")}`)
    return search(vault, query.q ?? "", n(query.limit, 500) || 60,
      { lines: n(query.lines, 50), folder: query.folder, matchCase: query.case === "1" || query.case === "true", sort: query.sort, context: n(query.context, 5), offset: n(query.offset, Infinity) })
  }
  if (route === "file/info" && method === "GET") return info(vault, clean(query.path, true, vault, true))
  if (route === "file") {
    if (method === "GET") {
      const rel = clean(query.path, false, vault, true)
      await downloaded(vault, rel)
      return read(vault, rel)
    }
    if (method === "DELETE") {
      const rel = clean(query.path || body.path, true, vault)
      if (rel === ".vaultite" || rel === ".vaultite/generated" || rel.startsWith(".vaultite/generated/")) {
        throw new HTTPError(403, `${rel} is the app's; it can't be deleted`)
      }
      let trashed: string | undefined
      if (rel === ".trash" || rel.startsWith(".trash/")) fs.rmSync(vault.abs(rel), { recursive: true }) // gone for good
      else {
        trashed = vault.toTrash(rel)
        forget(vault, rel)
        vault.moved(rel, null, trashed) // what follows files (plugin.onMove: pinned pages) lets it go
      }
      await vault.sync()
      return { ok: true, ...(trashed ? { trashed } : {}) }
    }
    // Saving a settings file opened by its path (hidden files off): only one that's there; or making one at its exact
    // path (POST without `unique`: Vim's init.vim).
    const rel = clean(body.path, false, vault, method === "PUT" || (method === "POST" && !body.unique))
    if (method === "PUT" && rel.startsWith(".") && !showHidden(vault) && !fs.existsSync(vault.abs(rel))) throw new HTTPError(404, `no file '${rel}'`)
    if (!writable(vault, rel)) throw new HTTPError(400, `${rel} isn't a text file, so it can't be written here`)
    if (locked(rel)) throw new HTTPError(403, `${rel} is read-only`)
    let text = body.text ?? ""
    if (typeof text !== "string") throw new HTTPError(400, "text must be a string")
    if (method === "POST") {
      let target = rel
      if (fs.existsSync(vault.abs(target))) {
        if (!body.unique) throw new HTTPError(409, `${target} already exists`)
        target = freeName(vault, target)
      }
      text = newText(vault, target, text) // what plugins add to a new file (plugin.onCreate, onCreateFile)
      writeAtomic(vault.abs(target), text)
      await vault.sync()
      await vault.fillIn(target, null) // (a note's id and dates)
      return reply(201, read(vault, target))
    }
    if (method === "PUT") {
      let cur: string | null
      try {
        cur = readText(vault.abs(rel))
      } catch {
        cur = null
      }
      const base = body.base ?? null, baseHash = typeof body.baseHash === "string" ? body.baseHash : null, sent = text
      // An editor saving a file that was deleted or moved meanwhile: don't bring it back.
      if (cur === null && (base !== null || baseHash !== null)) throw new HTTPError(404, `${rel} isn't in the vault any more (moved or deleted)`)
      // A big file's save sends its base's fingerprint: the base itself only when the file changed on disk, to merge.
      if (cur !== null && base === null && baseHash !== null && cur !== text && textHash(cur) !== baseHash) {
        return reply(412, { error: "the file changed on disk: send its base to merge" })
      }
      if (cur !== null && base !== null && cur !== base && cur !== text) {
        const merged = merge3(base, text, cur)
        if (merged === null) return reply(409, { error: "the file changed on disk in the same place", ...read(vault, rel) })
        text = merged
      }
      if (cur === null) text = newText(vault, rel, text)
      const before = vault.entries.get(rel) ?? null
      if (cur !== text) writeAtomic(vault.abs(rel), cur !== null && crlf(vault.abs(rel)) ? text.replace(/\n/g, "\r\n") : text)
      await vault.sync()
      // An edit in the app: plugins may fill things in (a note's id and dates), and the editor gets the result.
      if (cur !== text) await vault.fillIn(rel, before)
      const f = read(vault, rel)
      // (a big file's text back only when it isn't what was sent)
      if (body.lean && f.text === sent) { const { text: _, ...rest } = f; return { ...rest, same: true } }
      return f
    }
  }
  if (route === "timeline" && method === "POST") {
    const rel = clean(body.path, true, vault)
    if (!/\.md$/i.test(rel)) throw new HTTPError(400, "only a Markdown file has a timeline")
    if (locked(rel)) throw new HTTPError(403, `${rel} is read-only`)
    const e = newEntry(body)
    const abs = vault.abs(rel), cur = readText(abs)
    const text = addEntry(cur, e) ?? `${cur.replace(/\n*$/, "")}${cur.trim() ? "\n\n" : ""}## Timeline\n\n${entryLine(e)}\n`
    writeAtomic(abs, crlf(abs) ? text.replace(/\n/g, "\r\n") : text)
    await vault.sync()
    return reply(201, read(vault, rel))
  }
  if (route === "file/move" && method === "POST") {
    const src = clean(body.from, true, vault)
    const dst = clean(body.to, false, vault)
    for (const p of [src, dst]) {
      if (p === ".vaultite" || p === ".trash" || locked(p)) throw new HTTPError(403, `${p} can't be moved (restore things from the trash instead)`)
    }
    if (src === dst) return { path: dst, updated: [] }
    const same = fs.existsSync(vault.abs(dst)) && sameFile(vault.abs(src), vault.abs(dst))
    if (fs.existsSync(vault.abs(dst)) && !same) throw new HTTPError(409, `${dst} already exists`)
    if (dst.startsWith(src + "/")) throw new HTTPError(400, "can't move a folder into itself")
    fs.mkdirSync(path.dirname(vault.abs(dst)), { recursive: true })
    fs.renameSync(vault.abs(src), vault.abs(dst))
    forget(vault, src)
    vault.moved(src, dst) // open apps follow it (core/live.ts), and so do plugins (plugin.onMove: an artifact's storage, pinned pages)
    await vault.sync()
    // Links to what moved follow it: a folder's files each, by where they are now.
    const moves: [string, string][] = !fs.statSync(vault.abs(dst)).isDirectory() ? [[src, dst]]
      : [...vault.entries.keys(), ...vault.others.keys()].filter((p) => p.startsWith(`${dst}/`)).map((p) => [src + p.slice(dst.length), p])
    const updated = vault.relink(moves)
    if (updated.length) await vault.sync()
    return { path: dst, updated }
  }
  if (route === "file/copy" && method === "POST") {
    const src = clean(body.path, true, vault)
    if (fs.statSync(vault.abs(src)).isDirectory()) throw new HTTPError(400, `'${src}' is a folder; only files can be duplicated`)
    const dst = copyName(vault, src)
    if (locked(dst)) throw new HTTPError(403, `${dst} is read-only`)
    // The file as it is, as Obsidian copies it (read and written, not cloned, so it has its own dates). A note's copy gets
    // its own id when it's first edited in the app.
    if (!writeNew(vault.abs(dst), fs.readFileSync(vault.abs(src)))) throw new HTTPError(409, `${dst} already exists`)
    await vault.sync()
    return reply(201, { path: dst })
  }
  if (route === "file/restore" && method === "POST") {
    // Something in the trash, also with hidden files off: the app's Undo after a delete restores it by this path.
    const raw = String(body.path ?? "").replace(/^\/+/, "")
    const rel = raw.startsWith(".trash/") ? `.trash/${clean(raw.slice(".trash/".length), false, vault)}` : clean(raw, true, vault)
    const dst = restore(vault, rel)
    vault.moved(rel, dst) // (back out of the trash: what followed it there follows it back)
    await vault.sync()
    return { path: dst }
  }
  if (route === "upload/name" && method === "POST") {
    const folder = body.folder ? clean(body.folder, true, vault) : ""
    if (folder && locked(folder)) throw new HTTPError(403, `${folder} is read-only`)
    const rel = clean(`${folder}/${String(body.name ?? "").replaceAll("/", " ")}`, false, vault)
    return { path: freeName(vault, rel) }
  }
  if (route === "folder" && method === "POST") {
    let rel = clean(body.path, false, vault)
    if (locked(rel)) throw new HTTPError(403, `${rel} is read-only`)
    if (fs.existsSync(vault.abs(rel))) {
      if (!body.unique) throw new HTTPError(409, `${rel} already exists`)
      rel = freeName(vault, rel)
    }
    fs.mkdirSync(vault.abs(rel), { recursive: true })
    await vault.sync()
    return reply(201, { path: rel })
  }
  return undefined
}
