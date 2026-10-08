// The vault as files, for the file tree and the editor: /api/files, /api/file (+ move, copy, restore), /api/search,
// /api/raw. Hidden files are out of reach unless shown, but the app's own settings open by exact path (SETTINGS).
import fs from "node:fs"
import path from "node:path"
import { HTTPError, LOADED, type Plugin, reply, serviceFor } from "./plugins.ts"
import { ARCHIVE_DIR, inArchive, inPagesDir } from "./fileprops.ts"
import { isTextKind, kindOf, TEXT_MAX } from "./filetypes.ts"
import { highlighter, matches, type Node, parse, SearchError } from "./searchquery.ts"
import { merge3, patchFrontmatter } from "./textedit.ts"
import { dump, load } from "./yaml.ts"
import { blocksIn } from "./sections.ts"
import { tabNames } from "./tabs.ts"
import { addEntry, entryLine, KINDS, type NewEntry } from "./timeline.ts"
import { cmp, type Entry, type Item, ms, readSoon, readText, sameFile, sortBy, statFrom, stemOf, type Vault, writeAtomic, writeNew } from "./vault.ts"

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

const chars = (s: string, n: number) => [...s].slice(0, n).join("")

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
  } catch {
    return null
  }
}

export function read(vault: Vault, rel: string) {
  let data: Buffer, st: fs.BigIntStats
  try {
    st = fs.statSync(vault.abs(rel), { bigint: true })
    if (st.isDirectory()) throw new HTTPError(400, `'${rel}' is a folder`)
    if (Number(st.size) > TEXT_MAX) throw new HTTPError(413, `'${rel}' is too big to open as text`)
    data = fs.readFileSync(vault.abs(rel))
  } catch (e) {
    if (e instanceof HTTPError) throw e
    throw new HTTPError(404, `no file '${rel}'`)
  }
  const text = textOf(data)
  if (text === null) throw new HTTPError(415, `'${rel}' isn't text`)
  const e = vault.entries.get(rel)
  return { path: rel, text, mtime: ms(st.mtimeNs), size: Number(st.size), kind: e && e.kind ? e.kind.collection : null, problems: e ? [...e.problems] : [] }
}

/** Wait, off the main thread, for a text file iCloud may still be downloading: a 503 when it takes over `wait` ms. */
async function downloaded(vault: Vault, rel: string, wait = 10_000) {
  let st: fs.Stats
  try { st = fs.statSync(vault.abs(rel)) } catch { return }
  if (st.isDirectory() || st.size > TEXT_MAX) return
  if (await readSoon(vault.abs(rel), wait).catch(() => true) === null) throw new HTTPError(503, `iCloud is still downloading ${rel}; try again in a moment`)
}

/** Whether the editor may write this file as text: a kind that's text, or a file that reads as text now. */
function writable(vault: Vault, rel: string) {
  if (isTextKind(kindOf(rel))) return true
  try {
    const st = fs.statSync(vault.abs(rel))
    return st.isFile() && st.size <= TEXT_MAX && textOf(fs.readFileSync(vault.abs(rel))) !== null
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

/** A PDF's page count, when it's cheap to see (its page objects are plain in the file); null otherwise. */
function pdfPages(abs: string, size: number) {
  if (size > 64 << 20) return null
  const s = fs.readFileSync(abs).toString("latin1")
  const counts = [...s.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map((m) => Number(m[1] ?? m[2]))
  if (counts.length) return Math.max(...counts)
  const pages = s.match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0
  return pages || null
}

function info(vault: Vault, rel: string) {
  let st: fs.BigIntStats
  try {
    st = fs.statSync(vault.abs(rel), { bigint: true })
  } catch {
    throw new HTTPError(404, `no file '${rel}'`)
  }
  const kind = kindOf(rel)
  const out: Item = { path: rel, kind, size: Number(st.size), mtime: ms(st.mtimeNs), ctime: statFrom(st).born }
  if (kind === "pdf") out.pages = pdfPages(vault.abs(rel), out.size)
  return out
}

/** Drop a moved or trashed folder's files from the index (a missing top-level folder alone doesn't count as deleted:
 *  the vault may be mid-sync). */
function forget(vault: Vault, rel: string) {
  for (const r of [...vault.entries.keys()]) if (r === rel || r.startsWith(rel + "/")) vault.drop(r)
}

function unique(vault: Vault, rel: string) {
  const [stem, ext] = splitext(rel)
  let n = 2, out = rel
  while (fs.existsSync(vault.abs(out))) out = `${stem} ${n++}${ext}`
  return out
}

/** Where a dropped file or folder goes: its own name, or "Name 1", "Name 2"... when that's taken. */
export function dropName(vault: Vault, rel: string) {
  const [stem, ext] = splitext(rel)
  let n = 1, out = rel
  while (fs.existsSync(vault.abs(out))) out = `${stem} ${n++}${ext}`
  return out
}

/** A new text file's text with what plugins add: a note's keys (onCreate), another file's bytes (onCreateFile: an SVG's). */
function newText(vault: Vault, rel: string, text: string) {
  if (/\.md$/i.test(rel)) return vault.created(rel, text)
  const bytes = Buffer.from(text, "utf8"), out = vault.createdFile(rel, bytes)
  return out === bytes ? text : out.toString("utf8")
}

/** A JSON file must stay JSON (plugins read their settings from it), and a notebook too. */
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

function valid(rel: string, text: string) {
  if (!/\.(json|ipynb)$/i.test(rel)) return
  try {
    JSON.parse(text)
  } catch (e) {
    throw new HTTPError(400, `not valid JSON: ${(e as Error).message}`)
  }
}

/** Put a trashed file or folder back where it came from, minus the time trashing added to its name. */
function restore(vault: Vault, rel: string) {
  if (!rel.startsWith(".trash/")) throw new HTTPError(400, "only things in .trash can be restored")
  if (!fs.existsSync(vault.abs(rel))) throw new HTTPError(404, `${rel} isn't in the trash any more`)
  let [stem, ext] = splitext(rel.slice(".trash/".length))
  if (fs.statSync(vault.abs(rel)).isDirectory()) [stem, ext] = [stem + ext, ""]
  const dst = unique(vault, stem.replace(STAMP, "") + ext)
  fs.mkdirSync(path.dirname(vault.abs(dst)), { recursive: true })
  fs.renameSync(vault.abs(rel), vault.abs(dst))
  return dst
}


/** Keys that say which file this is (its other names for links, its ids): a duplicate leaves them out, so it doesn't
 *  take the original's links or key. */
const CLAIMS = ["aliases", "name", "id", "ext_id"]
export function unclaimed(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text)
  if (!m) return text
  const read = (t: string) => (load(t) ?? {}) as Record<string, unknown>
  let fm: Record<string, unknown>
  try { fm = read(m[1]) } catch { return text }
  const drop = CLAIMS.filter((k) => Object.hasOwn(fm, k))
  if (!drop.length) return text
  const inner = patchFrontmatter(m[1], fm, {}, drop, [], (k, v) => dump({ [k]: v }), read)
  if (inner === null) return text
  return inner.trim() ? `---\n${inner}\n---${m[2]}${text.slice(m[0].length)}` : text.slice(m[0].length).replace(/^\r?\n/, "")
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

/** Text files' text for search, re-read when changed (capped per file and in count); files that aren't text but a
 *  plugin reads (`text:<ext>`: a workbook's cells) as that plugin gives it. */
const SEARCH_MAX = 256 << 10, SEARCH_FILES = 5000, READ_MAX = 64 << 20
const cache = new WeakMap<Vault, Map<string, { ns: bigint; text: string }>>()

/** The plugins that are on and read some kind of file as text (`text:<ext>`). */
function readerPlugins(vault: Vault) {
  const off = vault.switchedOff()
  return LOADED.filter((p) => !off.has(p.id) && Object.keys(p.services).some((k) => k.startsWith("text:")))
}

function searchable(vault: Vault): [string, string, bigint, number][] {
  let texts = cache.get(vault)
  if (!texts) cache.set(vault, (texts = new Map()))
  const out: [string, string, bigint, number][] = []
  const seen = new Set<string>()
  const readers = readerPlugins(vault)
  for (const [rel, st] of vault.others) {
    const k = kindOf(rel)
    const reader = k === "binary" && st.size <= READ_MAX ? serviceFor(readers, "text", rel) as ((b: Buffer, rel: string) => string) | null : null
    if (out.length >= SEARCH_FILES || !(reader || (st.size <= SEARCH_MAX && (k === "code" || k === "json")))) continue
    seen.add(rel)
    let hit = texts.get(rel)
    if (!hit || hit.ns !== st.ns) {
      let text = ""
      try {
        const bytes = fs.readFileSync(vault.abs(rel))
        text = reader ? String(reader(bytes, rel) ?? "").slice(0, SEARCH_MAX) : textOf(bytes) ?? ""
      } catch { /* gone meanwhile, or a file its reader can't read */ }
      hit = { ns: st.ns, text }
      texts.set(rel, hit)
    }
    if (hit.text) out.push([rel, hit.text, st.ns, st.born])
  }
  for (const rel of texts.keys()) if (!seen.has(rel)) texts.delete(rel)
  return out
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

type SearchOpts = { lines?: number; folder?: string; matchCase?: boolean; sort?: string; context?: number }

/** Files matching a query (core/searchquery.ts: words, "phrases", -not, OR, file:, path:, tag:, line:(), [property]...),
 *  with the first line that matched, and with `lines` every such line (and `context` lines around each). */
export function search(vault: Vault, q: string, limit = 60, opts: SearchOpts = {}) {
  if (!q.trim()) return []
  let node: Node
  try { node = parse(q, { matchCase: opts.matchCase }) } catch (e) {
    if (e instanceof SearchError) throw new HTTPError(400, e.message)
    throw e
  }
  if (node.t === "all") return []
  const marks = highlighter(node, "text"), names = highlighter(node, "name")
  const out: Item[] = []
  const all: [string, string, bigint, number, Entry | null][] = [
    ...[...vault.entries].map(([rel, e]): [string, string, bigint, number, Entry | null] => [rel, e.body, e.stat.ns, e.stat.born, e]),
    ...searchable(vault).map(([rel, text, ns, born]): [string, string, bigint, number, Entry | null] => [rel, text, ns, born, null]),
  ]
  const folder = (opts.folder ?? "").replace(/^\/+|\/+$/g, "")
  const whole = q.trim().toLowerCase()
  for (const [rel, body, ns, born, e] of all) {
    if (folder && !rel.startsWith(`${folder}/`)) continue
    const file = rel.split("/").pop()!
    const name = e ? stemOf(rel) : file
    if (!matches(node, { name, file, path: rel, text: body, tags: e?.tags, props: e?.fm })) continue
    const lines = body.split("\n")
    const first = lines.find((l) => marks(l).length) ?? ""
    const score = names(name).length * 3 + (name.toLowerCase().includes(whole) ? 5 : 0)
    const item: Item = { path: rel, title: name, context: context(first, marks), score, mtime: ms(ns), created: born, ...(e?.archived ? { archived: true } : {}) }
    // The search tab (view:search) shows every line that matched, like a search editor; `context` lines around each
    // come marked `ctx: true`, each line once.
    if (opts.lines) {
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
          matched.push({ line: k + 1, text: chars(lines[k].trim(), 300), ...(hit.has(k) ? {} : { ctx: true as const }) })
        }
      }
      item.matches = matched.sort((a, b) => a.line - b.line)
      item.count = hits.length
    }
    out.push(item)
  }
  // Archived files last (core/fileprops.ts), like the quick switcher.
  const [key, reverse] = SORTS[opts.sort ?? ""] ?? SORTS.relevance
  const sorted = sortBy(out, key, reverse)
  return [...sorted.filter((r) => !r.archived), ...sorted.filter((r) => r.archived)].slice(0, limit)
}

/** The file routes, or undefined if the request isn't one of them. */
export async function handle(vault: Vault, method: string, parts: string[], query: Record<string, string>, body: Item): Promise<unknown> {
  const route = parts.join("/")
  if (route === "files" && method === "GET") return tree(vault)
  if (route === "search" && method === "GET") {
    const n = (v: string | undefined, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))
    if (query.sort && !(query.sort in SORTS)) throw new HTTPError(400, `sort is one of ${Object.keys(SORTS).join(", ")}`)
    return search(vault, query.q ?? "", n(query.limit, 500) || 60,
      { lines: n(query.lines, 50), folder: query.folder, matchCase: query.case === "1" || query.case === "true", sort: query.sort, context: n(query.context, 5) })
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
        target = unique(vault, target)
      }
      text = newText(vault, target, text) // what plugins add to a new file (plugin.onCreate, onCreateFile)
      valid(target, text)
      writeAtomic(vault.abs(target), text)
      await vault.sync()
      return reply(201, read(vault, target))
    }
    if (method === "PUT") {
      let cur: string | null
      try {
        cur = readText(vault.abs(rel))
      } catch {
        cur = null
      }
      const base = body.base ?? null
      // An editor saving a file that was deleted or moved meanwhile: don't bring it back.
      if (cur === null && base !== null) throw new HTTPError(404, `${rel} isn't in the vault any more (moved or deleted)`)
      if (cur !== null && base !== null && cur !== base && cur !== text) {
        const merged = merge3(base, text, cur)
        if (merged === null) return reply(409, { error: "the file changed on disk in the same place", ...read(vault, rel) })
        text = merged
      }
      if (cur === null) text = newText(vault, rel, text)
      valid(rel, text)
      if (cur !== text) writeAtomic(vault.abs(rel), cur !== null && crlf(vault.abs(rel)) ? text.replace(/\n/g, "\r\n") : text)
      await vault.sync() // plugins may fill things in (a note's id and dates): the editor gets the result
      return read(vault, rel)
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
    // Read and written (not cloned), so the copy is a new file with its own dates.
    const raw = fs.readFileSync(vault.abs(src))
    if (!writeNew(vault.abs(dst), /\.md$/i.test(src) ? unclaimed(raw.toString("utf8")) : raw)) throw new HTTPError(409, `${dst} already exists`)
    await vault.sync() // a note's fill gives the copy its own id and dates
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
    return { path: dropName(vault, rel) }
  }
  if (route === "upload" && method === "POST") {
    const rel = clean(body.path, false, vault)
    if (locked(rel)) throw new HTTPError(403, `${rel} is read-only`)
    if (typeof body.data !== "string") throw new HTTPError(400, "data must be base64 text")
    if (fs.existsSync(vault.abs(rel))) throw new HTTPError(409, `${rel} already exists`)
    if (!writeNew(vault.abs(rel), vault.createdFile(rel, Buffer.from(body.data, "base64")))) throw new HTTPError(409, `${rel} already exists`)
    await vault.sync()
    return reply(201, { path: rel })
  }
  if (route === "folder" && method === "POST") {
    let rel = clean(body.path, false, vault)
    if (locked(rel)) throw new HTTPError(403, `${rel} is read-only`)
    if (fs.existsSync(vault.abs(rel))) {
      if (!body.unique) throw new HTTPError(409, `${rel} already exists`)
      rel = unique(vault, rel)
    }
    fs.mkdirSync(vault.abs(rel), { recursive: true })
    await vault.sync()
    return reply(201, { path: rel })
  }
  return undefined
}
