import fs from "node:fs"
import { z } from "zod"
import os from "node:os"
import { drawnBy, drawsOf, fallbackText, notesText, optionNotes, parseOptions, resolveOptions } from "./blocks.ts"
import { blockName, blocksIn, extract, scan, splitAnchor, stripHidden } from "./sections.ts"
import { type BlockCtx, enabled, HTTPError, type Plugin, propertyTypes, service, serviceFor, today } from "./plugins.ts"
import { typeNotes } from "./proptypes.ts"
import { noteHere, source, traced } from "./sources.ts"
import { formatInput, type Item, readText, sortBy, stemOf, type Vault } from "./vault.ts"
import { FM, prose } from "./frontmatter.ts"
import { notHereYet } from "./writegate.ts"
import { messageOf } from "./values.ts"

function ownerOf(plugins: Plugin[], on: Set<string>, name: string, options: Item = {}) {
  const has = (x: Plugin) => x.textBlocks.has(name) || Object.hasOwn(x.blocks, name)
  const declarer = plugins.find((x) => on.has(x.id) && Object.hasOwn(x.blocks, name)) ?? plugins.find((x) => Object.hasOwn(x.blocks, name))
  const by = declarer?.blocks[name].by
  if (!declarer || !by || !on.has(declarer.id)) {
    const live = plugins.find((x) => on.has(x.id) && has(x)) ?? null, off = plugins.find((x) => !on.has(x.id) && has(x)) ?? null
    const owner = live ?? off
    return { live, off, decl: owner && Object.hasOwn(owner.blocks, name) ? owner.blocks[name] : null, unnamed: "" }
  }
  const drawers = plugins.filter((x) => drawsOf(x.manifest).includes(name))
  const decl = drawnBy(declarer.blocks[name], drawers.filter((x) => on.has(x.id)).map((x) => x.id))
  const p = drawers.find((x) => x.id === String(options[by] ?? "")) ?? null
  const unnamed = p ? "" : `_(block-${name} needs \`${by}:\`, one of ${decl.options![by].values!.join(", ") || "none on"})_`
  return { live: p && on.has(p.id) ? p : null, off: p && !on.has(p.id) ? p : null, decl, unnamed }
}

/** `host`: the note embedding `rel`. */
export async function blockText(vault: Vault, plugins: Plugin[], rel: string, fm: Item, body: string, name: string,
  text: string, on?: Set<string>, host?: string): Promise<string> {
  on = on ?? enabled(vault, plugins)
  const parsed = parseOptions(text)
  const { live: p, off, decl, unnamed } = ownerOf(plugins, on, name, parsed.options)
  if (!p) return off ? `_(${off.manifest.name ?? off.id} is off)_` : unnamed || `_(no plugin draws block-${name})_`
  const notes = notesText(name, optionNotes(decl, parsed.options, parsed.error))
  const o = resolveOptions(decl, parsed.options)
  let remote = false
  const out = await drawn()
  return out && notes && !remote ? `${out}\n\n${notes}` : out || notes

  async function drawn() {
    if (typeof o.file === "string" && o.file.trim()) {
      const other = otherFile(vault, o.file, rel)
      const e = other && vault.entries.get(other)
      if (!e) return `_(no file ${o.file} to draw this ${name} block for)_`
      ;[rel, fm, body, host] = [other!, e.fm, e.body, undefined]
    }
    if (typeof o.machine === "string" && o.machine && (!decl || Object.hasOwn(decl.options ?? {}, "machine"))) {
      const there = await onMachine(plugins.filter((x) => on!.has(x.id)), o.machine, name, rel, parsed.options)
      if (there !== null) { remote = true; return there }
    }
    const fn = p!.textBlocks.get(name)
    if (!fn) return fallbackText(p!.manifest.name ?? p!.id, decl)
    const ctx = blockCtx(vault, rel, fm, prose(body), o, host)
    try {
      return ((await fn(ctx)) || "").trim()
    } catch (e) {
      return `_(${name} couldn't be shown: ${messageOf(e)})_`
    }
  }
}

/** Reading its path, fm or body records that the block read its file. */
function blockCtx(vault: Vault, rel: string, fm: Item, body: string, options: Item, host?: string): BlockCtx {
  const read = () => { if (rel) noteHere() }
  return {
    vault, options, today: today(), source, ...(host && host !== rel ? { host } : {}),
    get path() { read(); return rel },
    get fm() { read(); return fm },
    get body() { read(); return body },
  }
}

async function onMachine(plugins: Plugin[], id: string, name: string, rel: string, o: Item): Promise<string | null> {
  const find = service(plugins, "machines:machine")
  if (typeof find !== "function") return null
  const m = await find(id) as { label: string; url: string; online: boolean; self: boolean; dial?: boolean } | null
  if (!m) return `_(no machine ${id})_`
  if (m.self || m.dial) return null
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

type BlockSource =
  | { kind: "file"; path: string }
  | { kind: "files"; collection: string; type: string; paths: string[] }
  | { kind: "settings"; plugin: string; label: string; path: string }
  | { kind: "live"; plugin: string; label: string; folders: { path: string; label: string }[] }
export type BlockSources = {
  name: string; plugin: string | null; pluginName: string | null; on: boolean; description: string
  options: Item
  /** `line`: where its fence opens, 0-based, frontmatter counted. */
  path: string; line: number | null
  /** Its `file:`, when not the one it's in. */
  file: string | null
  sources: BlockSource[]
}

/** `name` with `nth` or `text` picks one block; else every block in the file. */
export async function blockSources(vault: Vault, plugins: Plugin[], query: Record<string, string>): Promise<BlockSources | { path: string; blocks: BlockSources[] }> {
  const rel = String(query.path ?? "").replace(/^\/+|\/+$/g, "")
  const e = rel ? vault.entries.get(rel) : undefined
  if (rel && !e) throw new HTTPError(404, `no file '${rel}'`)
  let raw = ""
  try { raw = e ? readText(vault.abs(rel)) : "" } catch (ex) { if (notHereYet(ex)) throw ex }
  const on = enabled(vault, plugins)
  const reader = (name: string) => name.startsWith("```") ? plugins.find((x) => on.has(x.id) && Object.hasOwn(x.services, `fence:${name.slice(3)}`)) ?? null : null
  const s = scan(raw)
  const inFile = s.fences.flatMap((f) => {
    const name = f.close === null ? null : blockName(f.info) ?? `\`\`\`${f.info.split(/\s/)[0].toLowerCase()}`
    return name && (!name.startsWith("```") || reader(name)) ? [{ name, text: s.lines.slice(f.open + 1, f.close!).join("\n"), line: f.open }] : []
  })
  const fm = e?.fm ?? {}, body = e?.body ?? ""
  if (query.name === undefined) return { path: rel, blocks: await Promise.all(inFile.map((b) => one(b.name, b.text, b.line))) }
  const name = String(query.name)
  if (!/^(```)?[\w-]{1,64}$/.test(name)) throw new HTTPError(400, "name: a block's name")
  const same = (a: string, b: string) => a.replace(/\s+$/gm, "").trim() === b.replace(/\s+$/gm, "").trim()
  const nth = query.nth === undefined ? NaN : Number(query.nth)
  const hit = Number.isInteger(nth) ? inFile.filter((b) => b.name === name)[nth]
    : inFile.find((b) => b.name === name && (query.text === undefined || same(b.text, query.text)))
  return await one(name, query.text ?? hit?.text ?? "", hit?.line ?? null)

  async function one(name: string, text: string, line: number | null): Promise<BlockSources> {
    const parsed = parseOptions(text).options, fence = reader(name)
    const { live: p, off, decl } = fence ? { live: fence, off: null, decl: null } : ownerOf(plugins, on, name, parsed)
    const owner = p ?? off
    const o = resolveOptions(decl, parsed)
    const other = typeof o.file === "string" && o.file.trim() ? otherFile(vault, o.file, rel) : null
    const out: BlockSources = { name, plugin: owner?.id ?? null, pluginName: owner ? owner.manifest.name ?? owner.id : null, on: !!p,
      description: decl?.description ?? "", options: decl?.options ?? {}, path: rel, line, file: other !== rel ? other : null, sources: [] }
    if (!owner) return out
    let timer: ReturnType<typeof setTimeout> | undefined
    const { trace } = await traced(() => fence ? (fence.services[`fence:${name.slice(3)}`] as (c: { path: string; text: string }) => unknown)({ path: rel, text })
      : p && p.textBlocks.has(name)
      ? Promise.race([blockText(vault, plugins, rel, fm, body, name, text, on), new Promise((r) => { timer = setTimeout(r, 8000) })])
      : null)
    clearTimeout(timer)
    const exists = (x: string) => vault.entries.has(x) || vault.others.has(x)
    const pathOf = (x: string) => exists(x) ? x : exists(`${x}.md`) ? `${x}.md` : null
    const here = other ?? rel
    const files: string[] = []
    const read = trace.named.size ? [] : [...(trace.here ? [here] : []), ...trace.files]
    for (const x of [...trace.named, ...(Array.isArray(decl?.reads) ? decl.reads.map(String) : []), ...read]) {
      const f = pathOf(x)
      if (f && !files.includes(f)) files.push(f)
    }
    for (const f of files) out.sources.push({ kind: "file", path: f })
    for (const c of trace.kinds) {
      const k = vault.kinds.find((x) => x.collection === c)
      if (!k) continue
      const of = [...vault.entries.values()].filter((x) => x.kind === k && x.item !== null && !x.archived).map((x) => x.rel)
      const shown = files.filter((f) => vault.entries.get(f)?.kind === k)
      if (!of.length || (shown.length && shown.every((f) => f === here)) || of.every((f) => files.includes(f))) continue
      out.sources.push({ kind: "files", collection: c, type: k.type, paths: sortBy(of, (x) => stemOf(x).toLowerCase()) })
    }
    const named = (id: string) => plugins.find((x) => x.id === id)?.manifest.name ?? id
    for (const id of trace.settings) {
      const path = `.vaultite/plugins/${id}/data.json`
      if (fs.existsSync(vault.abs(path))) out.sources.push({ kind: "settings", plugin: id, label: `${named(id)} settings`, path })
    }
    const live = typeof decl?.live === "string" && decl.live.trim() ? decl.live.trim() : null
    if (live || trace.live.has(owner.id) || trace.caches.has(owner.id)) {
      const folders = (p?.liveFolders() ?? []).map((d) => ({ path: d, label: d.startsWith(os.homedir() + "/") ? `~${d.slice(os.homedir().length)}` : d }))
      out.sources.push({ kind: "live", plugin: owner.id, label: live ?? named(owner.id), folders })
    }
    for (const id of trace.caches) if (id !== owner.id) out.sources.push({ kind: "live", plugin: id, label: named(id), folders: [] })
    return out
  }
}

function otherFile(vault: Vault, target: string, from?: string): string | null {
  const t = target.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim()
  if (t.endsWith("/")) {
    const dir = t.toLowerCase().replace(/^\/+/, "")
    return sortBy([...vault.entries.keys()].filter((r) => r.toLowerCase().startsWith(dir)), (r) => -Number(vault.entries.get(r)!.stat.ns / 1000000n))[0] ?? null
  }
  const hit = vault.resolveLink(t, from)
  return hit && vault.entries.has(hit) ? hit : null
}

/** `sub`: the part after the name, a base's view in `![[Books.base#Reading]]`. */
type At = { sub?: string; host?: string }
/** The service `text:<ext>`; files that aren't text (a workbook) get their bytes as a Buffer. */
function formatReader(plugins: Plugin[], on: Set<string>, rel: string): ((text: string | Buffer, rel: string, at?: At) => string) | null {
  return serviceFor(plugins.filter((x) => on.has(x.id)), "text", rel)
}

function embedded(vault: Vault, plugins: Plugin[], on: Set<string>, target: string, from: string): string | null {
  const hash = target.indexOf("#")
  if (hash > 0) {
    const hit = embedded(vault, plugins, on, target.slice(0, hash), from)
    return hit && formatReader(plugins, on, hit) ? hit : null
  }
  const hit = vault.resolveLink(target, from)
  return hit && vault.others.has(hit) && formatReader(plugins, on, hit) ? hit : null
}

function otherText(vault: Vault, rel: string, plugins: Plugin[], on: Set<string>, at: At = {}) {
  const read = formatReader(plugins, on, rel)
  if (read) {
    try { return read(formatInput(vault.abs(rel), rel), rel, at) } catch (e) { return `_(${rel} couldn't be read: ${messageOf(e)})_` }
  }
  return null
}

/** The service `fence:<lang>`: ({path, text, host}) -> Markdown, `host` the note embedding it. */
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
      md = `_(${f.info.split(/\s/)[0]} couldn't be shown: ${messageOf(e)})_`
    }
    out.push(md)
    at = f.close! + 1
  }
  out.push(...lines.slice(at))
  return out.join("\n")
}

/** The service `inline-code`: ({path, code, host}) -> Markdown, or null to leave it (Dataview's `= this.file.name`). */
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
        try { text = await read({ path: rel, code: m[2], ...(host && host !== rel ? { host } : {}) }) } catch (e) { text = `_(\`${m[2]}\` couldn't be shown: ${messageOf(e)})_` }
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

const DEPTH = 20
const EMBED = /^!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\][ \t]*$/gm

/** Obsidian's %%comments%% and ^ids out. `seen`: the notes embedding this one, against cycles; `host`: the nearest. */
async function expand(vault: Vault, plugins: Plugin[], on: Set<string>, rel: string, fm: Item, body: string, seen: string[], host?: string): Promise<string> {
  body = await inlineCode(plugins, on, rel, body, host)
  let text = ""
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
    if (seen.includes(key) || (!anchor && seen.some((k) => k === note || k.startsWith(`${note}#`)))) { parts.push(`_(${link} embeds itself: left out)_`); continue }
    if (seen.length > DEPTH) { parts.push(`_(${link} is embedded too deep: left out)_`); continue }
    const other = vault.entries.get(note)!
    let raw: string
    try { raw = readText(vault.abs(note)) } catch (ex) { parts.push(notHereYet(ex) ? `_(${link} is still coming from iCloud)_` : m[0]); continue }
    const fmm = FM.exec(raw)
    const part = extract(fmm ? raw.slice(fmm[0].length) : raw, anchor)
    if (part === null) { parts.push(`_(no ${anchor.startsWith("^") ? "block" : "heading"} ${anchor} in ${link.replace(/#.*\]\]$/, "]]")})_`); continue }
    const inner = await expand(vault, plugins, on, note, other.fm, part, [...seen, key], rel)
    parts.push(`> ${link}\n>\n` + inner.replace(/\s+$/, "").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"))
  }
  parts.push(text.slice(at))
  return parts.join("")
}

function noteFile(vault: Vault, name: string, from: string) {
  if (/\.(?!md$)[A-Za-z][A-Za-z0-9]{0,9}$/i.test(name)) return null
  return otherFile(vault, name, from)
}

type Page = { path: string; type: string | null; fm: Item }

function pageHeads(plugins: Plugin[], on: Set<string>, page: Page): string[] {
  return plugins.flatMap((p) => {
    const said = z.string().safeParse(on.has(p.id) ? p.services["page-head"]?.(page) : null)
    return said.success && said.data ? [said.data] : []
  })
}

async function pageText(plugins: Plugin[], on: Set<string>, page: Page, text: string): Promise<string> {
  for (const p of plugins) {
    const fn = on.has(p.id) ? p.services["page-text"] : undefined
    if (!fn) continue
    const said = z.string().safeParse(await Promise.resolve().then(() => fn({ ...page, text })).catch(() => null))
    if (said.success) text = said.data
  }
  return text
}

export async function render(vault: Vault, plugins: Plugin[], relPath: unknown) {
  const rel = vault.relocated(String(relPath ?? "").replace(/^\/+|\/+$/g, ""))
  if (vault.others.has(rel)) {
    const on = enabled(vault, plugins)
    if (formatReader(plugins, on, rel)) return `# ${stemOf(rel).replace(/\.[^.]+$/, "")}\n\n${otherText(vault, rel, plugins, on)}\n`
  }
  const e = vault.entries.get(rel)
  if (!e && vault.folders.includes(rel)) throw new HTTPError(404, `'${rel}' is a folder: vau files ${rel} lists what's in it`)
  if (!e) throw new HTTPError(404, `no file '${rel}'`)
  let raw: string
  try {
    raw = readText(vault.abs(rel))
  } catch (ex) {
    if (notHereYet(ex)) throw ex
    throw new HTTPError(404, `no file '${rel}'`)
  }
  const m = FM.exec(raw)
  const [head, body] = m ? [raw.slice(0, m[0].length), raw.slice(m[0].length)] : ["", raw]
  const on = enabled(vault, plugins)
  const page = { path: rel, type: e.type, fm: e.fm }
  const text = await pageText(plugins, on, page, await expand(vault, plugins, on, rel, e.fm, body, [rel]))
  let title = `# ${stemOf(rel)}\n\n`
  for (const under of pageHeads(plugins, on, page)) title += under + "\n\n"
  const notes = typeNotes(propertyTypes(vault, plugins), e.fm)
  if (notes.length) title += `_(properties: ${notes.join("; ")})_\n\n`
  return head + (head ? "\n" : "") + title + text + "\n"
}
