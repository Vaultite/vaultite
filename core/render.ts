// A file as an AI sees it (GET /api/render): its Markdown with each block replaced by its plugin's text, filled in on
// request and never saved, so files never hold a copy that goes stale. `machine:` blocks are asked of that machine.
import fs from "node:fs"
import os from "node:os"
import { fallbackText, notesText, onTop, optionNotes, parseOptions, resolveOptions } from "./blocks.ts"
import { blocksIn, extract, scan, splitAnchor, stripHidden } from "./sections.ts"
import { pageTabs, tabNames, type TabFile } from "./tabs.ts"
import { type BlockCtx, enabled, HTTPError, type Plugin, propertyTypes, service, serviceFor, today } from "./plugins.ts"
import { typeNotes } from "./proptypes.ts"
import { noteHere, source, traced } from "./sources.ts"
import { FM, formatInput, type Item, prose, readText, sortBy, stemOf, type Vault } from "./vault.ts"

/** Who draws block `name`: the plugin that's on and declares it (manifest.json) or has its text (plugin.block), else
 *  one that's off. */
function ownerOf(plugins: Plugin[], on: Set<string>, name: string) {
  const has = (x: Plugin) => x.textBlocks.has(name) || Object.hasOwn(x.blocks, name)
  return { live: plugins.find((x) => on.has(x.id) && has(x)) ?? null, off: plugins.find((x) => !on.has(x.id) && has(x)) ?? null }
}

/** One block as Markdown: its plugin's text view (or its declaration's description when it has none), then what's
 *  wrong with its options; a note when its plugin is off or no plugin draws it. `host`: the note embedding `rel`. */
export async function blockText(vault: Vault, plugins: Plugin[], rel: string, fm: Item, body: string, name: string,
  text: string, on?: Set<string>, host?: string): Promise<string> {
  on = on ?? enabled(vault, plugins)
  const { live: p, off } = ownerOf(plugins, on, name)
  if (!p) return off ? `_(${off.manifest.name ?? off.id} is off)_` : `_(no plugin draws block-${name})_`
  const decl = Object.hasOwn(p.blocks, name) ? p.blocks[name] : null
  const parsed = parseOptions(text)
  const notes = notesText(name, optionNotes(decl, parsed.options, parsed.error))
  const o = resolveOptions(decl, parsed.options)
  let remote = false // (another machine's answer has its own notes)
  const out = await drawn()
  return out && notes && !remote ? `${out}\n\n${notes}` : out || notes

  async function drawn() {
    // `file:` draws it for another file (the app's fileFor in components/Blocks.tsx).
    if (typeof o.file === "string" && o.file.trim()) {
      const other = otherFile(vault, o.file, rel)
      const e = other && vault.entries.get(other)
      if (!e) return `_(no file ${o.file} to draw this ${name} block for)_`
      ;[rel, fm, body, host] = [other!, e.fm, e.body, undefined]
    }
    // (only a block that takes `machine:`, or one with no declaration: another's would draw it here in the app)
    if (typeof o.machine === "string" && o.machine && (!decl || Object.hasOwn(decl.options ?? {}, "machine"))) {
      const there = await onMachine(plugins.filter((x) => on!.has(x.id)), o.machine, name, rel, parsed.options)
      if (there !== null) { remote = true; return there }
    }
    const fn = p!.textBlocks.get(name)
    if (!fn) return fallbackText(p!.manifest.name ?? p!.id, decl)
    const ctx = blockCtx(vault, rel, fm, prose(body), o, host)
    try {
      return ((await fn(ctx)) || "").trim()
    } catch (e) { // a block that can't be drawn mustn't break the rest of the file
      return `_(${name} couldn't be shown: ${(e as Error).message})_`
    }
  }
}

/** What a block's text gets (core/plugins.ts BlockCtx). Reading the file it's in (its path, frontmatter or body) is
 *  noted when its sources are being traced (core/sources.ts): the block reads that file. */
function blockCtx(vault: Vault, rel: string, fm: Item, body: string, options: Item, host?: string): BlockCtx {
  const read = () => { if (rel) noteHere() }
  return {
    vault, options, today: today(), source, ...(host && host !== rel ? { host } : {}),
    get path() { read(); return rel },
    get fm() { read(); return fm },
    get body() { read(); return body },
  }
}

/** A block drawn by another machine (its `machine:`), or null when it's this one or there's no Machines plugin. */
async function onMachine(plugins: Plugin[], id: string, name: string, rel: string, o: Item): Promise<string | null> {
  const find = service(plugins, "machines:machine")
  if (typeof find !== "function") return null
  const m = await find(id) as { label: string; url: string; online: boolean; self: boolean } | null
  if (!m) return `_(no machine ${id})_`
  if (m.self) return null
  if (!m.online) return `_(${m.label} isn't answering)_`
  const { machine: _, ...rest } = o
  const q = new URLSearchParams({ name, path: rel, options: JSON.stringify(rest) })
  try {
    const r = await fetch(`${m.url}/api/render/block?${q}`, { signal: AbortSignal.timeout(15000) })
    return r.ok ? (await r.text()).trim() : `_(${m.label} couldn't show this ${name} block)_`
  } catch {
    return `_(${m.label} isn't answering)_`
  }
}

/** GET /api/render/block: one block drawn here, for another machine (its `machine:`, above). The file is this vault's
 *  when it has it (the same vault, usually), else none. */
export async function blockOn(vault: Vault, plugins: Plugin[], query: Record<string, string>) {
  const name = String(query.name ?? "")
  if (!/^[\w-]{1,64}$/.test(name)) throw new HTTPError(400, "name: a block's name")
  let o: Item = {}
  try { o = JSON.parse(query.options || "{}") } catch { throw new HTTPError(400, "options: JSON") }
  delete o.machine
  const rel = String(query.path ?? "")
  const e = rel ? vault.entries.get(rel) : undefined
  return await blockText(vault, plugins, e ? rel : "", e?.fm ?? {}, e?.body ?? "", name, JSON.stringify(o))
}

// ---------- where a block's data comes from (GET /api/blocks/sources) ----------

/** One place a block's data comes from: a file (it shows it, or read it), every file of a kind (`files`: the paths),
 *  a plugin's settings or cache (a hidden file to open), or live data (in words: nothing in the vault). */
export type BlockSource =
  | { kind: "file"; path: string }
  | { kind: "files"; collection: string; type: string; paths: string[] }
  | { kind: "settings" | "cache"; plugin: string; label: string; path: string }
  | { kind: "live"; plugin: string; label: string; folders: { path: string; label: string }[] }
export type BlockSources = {
  name: string; plugin: string | null; pluginName: string | null; on: boolean; description: string
  /** Its declared options (core/blocks.ts), for its docs. */
  options: Item
  /** The file it's in, and the line its fence opens on (0-based, frontmatter counted), when found there. */
  path: string; line: number | null
  /** The file it's drawn for (its `file:`), when not the one it's in. */
  file: string | null
  sources: BlockSource[]
}

/** Where a block's data comes from: its text side run while recording what it reads (core/sources.ts), plus its
 *  declared `reads` and `live`. `name` with `nth` or `text` picks one block; else every block in the file. */
export async function blockSources(vault: Vault, plugins: Plugin[], query: Record<string, string>): Promise<BlockSources | { path: string; blocks: BlockSources[] }> {
  const rel = String(query.path ?? "").replace(/^\/+|\/+$/g, "")
  const e = rel ? vault.entries.get(rel) : undefined
  if (rel && !e) throw new HTTPError(404, `no file '${rel}'`)
  let raw = ""
  try { raw = e ? readText(vault.abs(rel)) : "" } catch { /* gone meanwhile: no lines */ }
  // Its blocks as they are in the file (```block-<name> fences): name, options' text, line.
  const inFile = blocksIn(raw).map((b) => ({ name: b.name, text: b.text, line: b.open }))
  const on = enabled(vault, plugins)
  const fm = e?.fm ?? {}, body = e?.body ?? ""
  // (its kind's blocks it doesn't place are drawn on top: no line)
  const top = onTop(e?.kind?.blocksFor(fm), body).map((name) => ({ name, text: "", line: null }))
  if (query.name === undefined) return { path: rel, blocks: await Promise.all([...top, ...inFile].map((b) => one(b.name, b.text, b.line))) }
  const name = String(query.name)
  if (!/^[\w-]{1,64}$/.test(name)) throw new HTTPError(400, "name: a block's name")
  const same = (a: string, b: string) => a.replace(/\s+$/gm, "").trim() === b.replace(/\s+$/gm, "").trim()
  // (`nth`: which of the file's blocks of that name; else the first with that text)
  const nth = query.nth === undefined ? NaN : Number(query.nth)
  const hit = Number.isInteger(nth) ? inFile.filter((b) => b.name === name)[nth]
    : inFile.find((b) => b.name === name && (query.text === undefined || same(b.text, query.text)))
  return await one(name, query.text ?? hit?.text ?? "", hit?.line ?? null)

  async function one(name: string, text: string, line: number | null): Promise<BlockSources> {
    const { live: p, off } = ownerOf(plugins, on, name)
    const owner = p ?? off
    const decl = owner && Object.hasOwn(owner.blocks, name) ? owner.blocks[name] : null
    const o = resolveOptions(decl, parseOptions(text).options)
    const other = typeof o.file === "string" && o.file.trim() ? otherFile(vault, o.file, rel) : null
    const out: BlockSources = { name, plugin: owner?.id ?? null, pluginName: owner ? String(owner.manifest.name ?? owner.id) : null, on: !!p,
      description: decl?.description ?? "", options: decl?.options ?? {}, path: rel, line, file: other !== rel ? other : null, sources: [] }
    if (!owner) return out
    // (drawn only to see what it reads: a slow one, live data on its way, is left at what it read by then)
    let timer: ReturnType<typeof setTimeout> | undefined
    const { trace } = await traced(() => p && p.textBlocks.has(name)
      ? Promise.race([blockText(vault, plugins, rel, fm, body, name, text, on), new Promise((r) => { timer = setTimeout(r, 8000) })])
      : null)
    clearTimeout(timer)
    const exists = (x: string) => vault.entries.has(x) || vault.others.has(x)
    const pathOf = (x: string) => exists(x) ? x : exists(`${x}.md`) ? `${x}.md` : null
    const here = other ?? rel
    // What it names (the people it lists) and its declared `reads`; the file it's in and what it read from disk only
    // when it names nothing (a query reads the file it's in, and a graph every file, to show a few).
    const files: string[] = []
    const read = trace.named.size ? [] : [...(trace.here ? [here] : []), ...trace.files]
    for (const x of [...trace.named, ...(Array.isArray(decl?.reads) ? decl.reads.map(String) : []), ...read]) {
      const f = pathOf(x)
      if (f && !files.includes(f)) files.push(f)
    }
    for (const f of files) out.sources.push({ kind: "file", path: f })
    // Every file of a kind it read, unless all it showed of that kind is the file it's in (a person's profile), or it
    // showed them all already.
    for (const c of trace.kinds) {
      const k = vault.kinds.find((x) => x.collection === c)
      if (!k) continue
      const of = [...vault.entries.values()].filter((x) => x.kind === k && x.item !== null && !x.archived).map((x) => x.rel)
      const shown = files.filter((f) => vault.entries.get(f)?.kind === k)
      if (!of.length || (shown.length && shown.every((f) => f === here)) || of.every((f) => files.includes(f))) continue
      out.sources.push({ kind: "files", collection: c, type: k.type, paths: sortBy(of, (x) => stemOf(x).toLowerCase()) })
    }
    const named = (id: string) => String(plugins.find((x) => x.id === id)?.manifest.name ?? id)
    for (const id of trace.settings) {
      const path = `.vaultite/plugins/${id}/data.json`
      if (fs.existsSync(vault.abs(path))) out.sources.push({ kind: "settings", plugin: id, label: `${named(id)} settings`, path })
    }
    for (const id of trace.caches) {
      const path = `.vaultite/cache/${id}.json`
      if (fs.existsSync(vault.abs(path))) out.sources.push({ kind: "cache", plugin: id, label: `${named(id)} cache`, path })
    }
    const live = typeof decl?.live === "string" && decl.live.trim() ? decl.live.trim() : null
    if (live || trace.live.has(owner.id)) {
      const folders = (p?.liveFolders() ?? []).map((d) => ({ path: d, label: d.startsWith(os.homedir() + "/") ? `~${d.slice(os.homedir().length)}` : d }))
      out.sources.push({ kind: "live", plugin: owner.id, label: live ?? named(owner.id), folders })
    }
    return out
  }
}

/** A block's `file:`: a link to a note (written in `from`, so the closest of its name), or a folder ending in / for its
 *  newest file. */
export function otherFile(vault: Vault, target: string, from?: string): string | null {
  const t = target.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim()
  if (t.endsWith("/")) {
    const dir = t.toLowerCase().replace(/^\/+/, "")
    return sortBy([...vault.entries.keys()].filter((r) => r.toLowerCase().startsWith(dir)), (r) => -Number(vault.entries.get(r)!.stat.ns / 1000000n))[0] ?? null
  }
  const hit = vault.resolveLink(t, from)
  return hit && vault.entries.has(hit) ? hit : null
}

/** Where a file read as text is embedded: the file it's in (`host`) and the part after the name (`sub`: a base's
 *  view, `![[Books.base#Reading]]`). */
type At = { sub?: string; host?: string }
/** The text view (service `text:<ext>`) a plugin that's on gives files like this one, or null. Files that aren't text
 *  (a workbook) get their bytes as a Buffer. */
function formatReader(plugins: Plugin[], on: Set<string>, rel: string): ((text: string | Buffer, rel: string, at?: At) => string) | null {
  return serviceFor(plugins.filter((x) => on.has(x.id)), "text", rel)
}

/** A file a plugin reads as text embedded on a line of its own (`![[Finance/Spending.html]]`), found as any
 *  embed is: by path or file name, with an optional part after it (`![[Books.base#Reading]]`). */
function embedded(vault: Vault, plugins: Plugin[], on: Set<string>, target: string, from: string): string | null {
  const hash = target.indexOf("#")
  if (hash > 0) {
    const hit = embedded(vault, plugins, on, target.slice(0, hash), from)
    return hit && formatReader(plugins, on, hit) ? hit : null
  }
  const hit = vault.resolveLink(target, from)
  return hit && vault.others.has(hit) && formatReader(plugins, on, hit) ? hit : null
}

/** A file's text as the plugin that reads it gives it, or null if none does. `at`: where it's embedded. */
function otherText(vault: Vault, rel: string, plugins: Plugin[], on: Set<string>, at: At = {}) {
  const read = formatReader(plugins, on, rel)
  if (read) {
    try { return read(formatInput(vault.abs(rel), rel), rel, at) } catch (e) { return `_(${rel} couldn't be read: ${(e as Error).message})_` }
  }
  return null
}

/** Code fences a plugin reads as text, by their language (the service `fence:<lang>`, ({path, text, host}) -> Markdown:
 *  a ```base fence is a base, `this` the note embedding it or else its own), replaced by that text; others stay. */
async function fenced(plugins: Plugin[], on: Set<string>, rel: string, body: string, host?: string): Promise<string> {
  const { lines, fences } = scan(body)
  const readers = fences.map((f) => {
    const name = `fence:${f.info.split(/\s/)[0].toLowerCase()}`
    const p = f.close !== null && f.info ? plugins.find((x) => on.has(x.id) && Object.hasOwn(x.services, name)) : undefined
    return p ? { f, read: p.services[name] as (ctx: { path: string; text: string; host?: string }) => string | Promise<string> } : null
  }).filter((x) => !!x)
  if (!readers.length) return body
  const out: string[] = []
  let at = 0
  for (const { f, read } of readers) {
    out.push(...lines.slice(at, f.open))
    let md: string
    try { md = String(await read({ path: rel, text: lines.slice(f.open + 1, f.close!).join("\n"), ...(host && host !== rel ? { host } : {}) }) ?? "").trim() } catch (e) {
      md = `_(${f.info.split(/\s/)[0]} couldn't be shown: ${(e as Error).message})_`
    }
    out.push(md)
    at = f.close! + 1
  }
  out.push(...lines.slice(at))
  return out.join("\n")
}

/** Inline code a plugin reads as text (the service `inline-code`, ({path, code, host}) -> Markdown, or null to leave it:
 *  Dataview's `= this.file.name`), replaced by that text in prose lines; code fences stay as they are. */
async function inlineCode(plugins: Plugin[], on: Set<string>, rel: string, body: string, host?: string): Promise<string> {
  const readers = plugins.filter((x) => on.has(x.id) && Object.hasOwn(x.services, "inline-code"))
    .map((x) => x.services["inline-code"] as (ctx: { path: string; code: string; host?: string }) => string | null | Promise<string | null>)
  if (!readers.length || !body.includes("`")) return body
  const { lines, code } = scan(body)
  for (let i = 0; i < lines.length; i++) {
    if (code[i] || !lines[i].includes("`")) continue
    let out = "", at = 0
    for (const m of lines[i].matchAll(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) {
      let text: string | null = null
      for (const read of readers) {
        try { text = await read({ path: rel, code: m[2], ...(host && host !== rel ? { host } : {}) }) } catch (e) { text = `_(\`${m[2]}\` couldn't be shown: ${(e as Error).message})_` }
        if (typeof text === "string") break
      }
      if (typeof text !== "string") continue
      out += lines[i].slice(at, m.index) + text
      at = m.index + m[0].length
    }
    if (at) lines[i] = out + lines[i].slice(at)
  }
  return lines.join("\n")
}

/** How deep embedded notes go (a note embedding a note embedding...): only a guard, loops are caught by `seen`. */
const DEPTH = 20
const EMBED = /^!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\][ \t]*$/gm

/** A body as the user reads it: blocks as text, %%comments%% and ^ids out, embeds on their own line inlined (a note or
 *  its section as a quote under its link). `seen`: the notes embedding this one, against cycles; `host`: the nearest. */
async function expand(vault: Vault, plugins: Plugin[], on: Set<string>, rel: string, fm: Item, body: string, seen: string[], host?: string, whole = false): Promise<string> {
  body = await inlineCode(plugins, on, rel, body, host)
  let text = ""
  // A whole file: its kind's blocks it doesn't place, on top (the app's FileView draws them there too).
  if (whole) for (const name of onTop(vault.entries.get(rel)?.kind?.blocksFor(fm), body)) {
    const out = await blockText(vault, plugins, rel, fm, body, name, "", on, host)
    text += out ? out + "\n\n" : ""
  }
  // Each block placed in it, with the blank lines after it, as its text.
  const { lines } = scan(body)
  let from = 0
  for (const b of blocksIn(body)) {
    text += lines.slice(from, b.open).map((l) => l + "\n").join("")
    const out = await blockText(vault, plugins, rel, fm, body, b.name, b.text, on, host)
    text += out ? out + "\n\n" : ""
    for (from = b.close + 1; from < lines.length && !lines[from].trim(); from++);
  }
  text = stripHidden((await fenced(plugins, on, rel, text + lines.slice(from).join("\n"), host)).replace(/^\n+|\n+$/g, ""))
  const parts: string[] = []
  let at = 0
  const lineAt = (s: string) => { let from = 0, n = 0; return (i: number) => { for (; from < i; from++) if (s.charCodeAt(from) === 10) n++; return n } }
  // (not in code: a fence showing `![[Note]]` shows it as it is)
  const { code } = scan(text)
  const textLine = lineAt(text)
  for (const m of text.matchAll(EMBED)) {
    if (code[textLine(m.index)]) continue
    parts.push(text.slice(at, m.index))
    at = m.index + m[0].length
    const target = m[1].trim()
    const hit = embedded(vault, plugins, on, target, rel)
    if (hit) {
      const sub = target.includes("#") ? target.slice(target.indexOf("#") + 1).trim() : ""
      parts.push(`**${hit}${sub ? `#${sub}` : ""}**\n\n${otherText(vault, hit, plugins, on, { host: rel, ...(sub ? { sub } : {}) })}`)
      continue
    }
    const [name, anchor] = splitAnchor(target)
    const note = name ? noteFile(vault, name, rel) : rel
    if (!note) { parts.push(m[0]); continue }
    const link = `[[${name ? stemOf(note) : ""}${anchor ? `#${anchor}` : ""}]]`
    const key = anchor ? `${note}#${anchor}` : note
    // (a section of a note it's in is fine; the note itself, or the same section again, would never end)
    if (seen.includes(key) || (!anchor && seen.some((k) => k === note || k.startsWith(`${note}#`)))) { parts.push(`_(${link} embeds itself: left out)_`); continue }
    if (seen.length > DEPTH) { parts.push(`_(${link} is embedded too deep: left out)_`); continue }
    const other = vault.entries.get(note)!
    let raw: string
    try { raw = readText(vault.abs(note)) } catch { parts.push(m[0]); continue }
    const fmm = FM.exec(raw)
    const part = extract(fmm ? raw.slice(fmm[0].length) : raw, anchor)
    if (part === null) { parts.push(`_(no ${anchor.startsWith("^") ? "block" : "heading"} ${anchor} in ${link.replace(/#.*\]\]$/, "]]")})_`); continue }
    const inner = await expand(vault, plugins, on, note, other.fm, part, [...seen, key], rel, !anchor)
    parts.push(`> ${link}\n>\n` + inner.replace(/\s+$/, "").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"))
  }
  parts.push(text.slice(at))
  return parts.join("")
}

/** A note an embed in `from` names (`![[Alice Park]]`, a path, an alias), or null. Images and other files aren't notes. */
function noteFile(vault: Vault, name: string, from: string) {
  if (/\.(?!md$)[A-Za-z][A-Za-z0-9]{0,9}$/i.test(name)) return null
  return otherFile(vault, name, from)
}

export async function render(vault: Vault, plugins: Plugin[], relPath: unknown) {
  // (a path from before the user moved its folder still reads the file: Vault.relocated)
  const rel = vault.relocated(String(relPath ?? "").replace(/^\/+|\/+$/g, ""))
  if (vault.others.has(rel)) {
    const on = enabled(vault, plugins)
    if (formatReader(plugins, on, rel)) return `# ${stemOf(rel).replace(/\.[^.]+$/, "")}\n\n${otherText(vault, rel, plugins, on)}\n`
  }
  const e = vault.entries.get(rel)
  if (!e) throw new HTTPError(404, `no file '${rel}'`)
  let raw: string
  try {
    raw = readText(vault.abs(rel))
  } catch {
    throw new HTTPError(404, `no file '${rel}'`)
  }
  const m = FM.exec(raw)
  const [head, body] = m ? [raw.slice(0, m[0].length), raw.slice(m[0].length)] : ["", raw]
  const on = enabled(vault, plugins)
  const text = await expand(vault, plugins, on, rel, e.fm, body, [rel], undefined, true)
  let title = `# ${stemOf(rel)}\n\n`
  // What a plugin that's on draws under the title (Dashboards: a dashboard's subtitle), as Markdown.
  const under = service(plugins.filter((p) => on.has(p.id)), "page-head")?.({ path: rel, type: e.type, fm: e.fm })
  if (typeof under === "string" && under) title += under + "\n\n"
  // A page with tabs (core/tabs.ts): which tab this is, and links to the others.
  const files: TabFile[] = [...vault.entries].map(([path, x]) => ({
    path, tab: typeof x.fm.tab === "string" ? x.fm.tab : undefined, tabs: tabNames(x.fm.tabs),
    plugin: typeof x.fm.plugin === "string" ? x.fm.plugin : undefined,
  }))
  const tabs = pageTabs(files, rel, (f) => !!f.plugin && plugins.some((p) => p.id === f.plugin) && !on.has(f.plugin))
  if (tabs.length) title += "Tabs: " + tabs.map((t) => t.path === rel ? `**${t.label}**` : `[[${stemOf(t.path)}|${t.label}]]`).join(" · ") + "\n\n"
  // Values that aren't of their property's type (the vault's types: core/proptypes.ts), as the editor notes them.
  const notes = typeNotes(propertyTypes(vault, plugins), e.fm)
  if (notes.length) title += `_(properties: ${notes.join("; ")})_\n\n`
  return head + (head ? "\n" : "") + title + text + "\n"
}
