// What a watch (or the companion's follow) looks at, read as text: a note, a terminal's screen, a web page, a pane of the
// window (today's tab), or a tab group's panes. Read through services and the desktop's browser, never by the model.
import crypto from "node:crypto"
import type { Plugin } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"

export type Kind = "note" | "terminal" | "site" | "pane" | "group"
/** note:<path>, terminal:<id>, site:<url>, pane:<id>, group:<id>. */
export type Source = { kind: Kind; ref: string }
/** A source read: its text, title and (a terminal's agent) state; a page's address; what was read, one per pane of a
 *  group. `missing`: it isn't there now (no window has the pane, the terminal ended). */
export type Read = { text: string; title: string; state?: string; url?: string; selection?: string; kind: Exclude<Kind, "pane" | "group">; missing?: boolean; parts?: Read[] }
/** A browser tab as the desktop's engine lists it (`pane`: the window's tab showing it). */
type BrowserTab = { tab: number; url: string; title: string; container: string | null; access: string; pane?: string }

const KINDS = new Set<Kind>(["note", "terminal", "site", "pane", "group"])
/** A source from its text: "terminal:claude-k3j2", "site:https://example.com", a bare address or path as a site or a note. */
export function parseSource(s: string): Source | null {
  const t = s.trim(), m = /^([a-z]+):(.+)$/.exec(t)
  if (m && KINDS.has(m[1] as Kind)) return { kind: m[1] as Kind, ref: m[2].trim() }
  if (/^https?:\/\//i.test(t)) return { kind: "site", ref: t }
  if (/\.(md|excalidraw|canvas)$/i.test(t)) return { kind: "note", ref: t }
  return null
}
export const sourceText = (s: Source) => `${s.kind}:${s.ref}`
/** A pane of the app's windows (the companion says, `companion:panes`): its id, title, tab group and what it shows
 *  (note:, terminal:, site:; null: a view with nothing to read). */
export type Pane = { id: string; title: string; group?: string; source: string | null }

export const hash = (r: Read) => crypto.createHash("sha1").update(`${r.state ?? ""}\n${r.url ?? ""}\n${r.text}`).digest("hex").slice(0, 16)

const BY = { name: "Watches", session: "", task: "watch", summary: "", remote: false }
/** What reads need from the companion: the window's panes, and whether a page is private. */
export type Context = { panes: () => Pane[]; private: (url: string, container: string | null) => boolean }

/** Read a source now. Throws (a plain reason) when it can't be read: private, not allowed, no browser. */
export async function read(plugin: Plugin, s: Source, c: Context, o: { pane?: string; open?: boolean } = {}): Promise<Read> {
  if (s.kind === "pane" || s.kind === "group") {
    const panes = c.panes().filter((p) => (s.kind === "pane" ? p.id === s.ref : p.group === s.ref))
    if (!panes.length) return { kind: "note", text: "", title: s.ref, missing: true }
    const parts: Read[] = []
    for (const p of panes) {
      const src = p.source ? parseSource(p.source) : null
      if (!src || src.kind === "pane" || src.kind === "group") continue
      try { parts.push({ ...await read(plugin, src, c, { pane: p.id, open: false }), title: p.title || src.ref }) } catch (e) { parts.push({ kind: src.kind as Read["kind"], title: p.title, text: `(${(e as Error).message})` }) }
    }
    if (s.kind === "pane") return parts[0] ?? { kind: "note", text: "", title: panes[0].title, missing: true }
    return { kind: "note", title: s.ref, text: parts.map((r) => `## ${r.title}\n${r.text}`).join("\n\n"), parts }
  }
  if (s.kind === "note") {
    if (await plugin.ask<boolean>("companion:hidden", false, s.ref)) throw new Error(`${s.ref} is private`)
    try { return { kind: "note", title: s.ref.replace(/^.*\//, "").replace(/\.md$/i, ""), text: readText(plugin.vault.abs(s.ref)) } } catch { return { kind: "note", title: s.ref, text: "", missing: true } }
  }
  if (s.kind === "terminal") {
    const runs = await plugin.ask<boolean>("terminal:runs", false, s.ref)
    if (!runs) return { kind: "terminal", title: s.ref, text: "", missing: true }
    const text = await plugin.ask<string>("terminal:screen", "", s.ref, 200)
    const st = await plugin.ask<{ state?: string; msg?: string } | null>("terminal:state", null, s.ref)
    return { kind: "terminal", title: s.ref, text, ...(st?.state ? { state: `${st.state}${st.msg ? `: ${st.msg}` : ""}` } : {}) }
  }
  // (a site: the user's tab showing it, else a page opened in the background for the read, then closed)
  const tabs = await plugin.desktop("agent:tabs", BY) as BrowserTab[]
  let t = tabs.find((x) => o.pane && x.pane === o.pane) ?? tabs.find((x) => x.url === s.ref) ?? null
  if (t && c.private(t.url, t.container)) throw new Error(`${hostLabel(t.url)} is private`)
  if (!t && c.private(s.ref, null)) throw new Error(`${hostLabel(s.ref)} is private`)
  let opened = 0
  if (!t) {
    if (o.open === false) return { kind: "site", title: s.ref, text: "", url: s.ref, missing: true }
    const p = await plugin.desktop("agent:open", s.ref, null, { ...BY, summary: `Checking ${hostLabel(s.ref)} for a watch` }) as { tab: number; url: string; title: string }
    opened = p.tab
    t = { tab: p.tab, url: p.url, title: p.title, container: null, access: "act" }
  }
  try {
    const r = await plugin.desktop("agent:read", t.tab) as { url: string; title: string; text: string }
    const sel = o.pane ? await plugin.desktop("agent:selection", t.tab).then((x) => String((x as { selection?: string }).selection ?? ""), () => "") : ""
    return { kind: "site", title: r.title || hostLabel(r.url), url: r.url, text: r.text, ...(sel.trim() ? { selection: sel.trim() } : {}) }
  } finally { if (opened) await plugin.desktop("agent:close", opened).catch(() => {}) }
}
const hostLabel = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url } }

/** What changed from `a` to `b`, in a few lines: a terminal's new output (its last lines), else the lines gone and new. */
export function changes(a: Read | null, b: Read, most = 24): string[] {
  const out: string[] = []
  if (a?.url !== undefined && b.url !== undefined && a.url !== b.url) out.push(`went to ${b.url} (${b.title})`)
  if (b.state && a?.state !== b.state) out.push(`its state: ${b.state}`)
  if (a?.selection !== b.selection && b.selection) out.push(`selected: ${JSON.stringify(cut(b.selection, 400))}`)
  const before = (a?.text ?? "").split("\n"), after = b.text.split("\n")
  if (b.kind === "terminal") {
    const added = newOutput(before, after).filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1))
    if (added.length) out.push(...(added.length > most ? [`… ${added.length - most} lines above`] : []), ...added.slice(-most).map((l) => `  ${cut(l, 300)}`))
    return out
  }
  const had = new Set(before.map((l) => l.trim())), has = new Set(after.map((l) => l.trim()))
  const gone = before.filter((l) => l.trim() && !has.has(l.trim())), added = after.filter((l) => l.trim() && !had.has(l.trim()))
  const room = Math.max(4, most - Math.min(gone.length, 6))
  for (const l of gone.slice(0, Math.min(6, most - Math.min(added.length, room)))) out.push(`- ${cut(l, 200)}`)
  for (const l of added.slice(0, room)) out.push(`+ ${cut(l, 200)}`)
  const more = gone.length + added.length - out.filter((l) => l.startsWith("- ") || l.startsWith("+ ")).length
  if (more > 0) out.push(`… ${more} more lines changed`)
  return out
}
/** A screen's lines after what it showed before: past the longest run of its old last lines found in the new text, but
 *  its very last (the prompt, which a command is then typed into). */
function newOutput(before: string[], after: string[]) {
  const tail = before.map((l) => l.trimEnd())
  while (tail.length && !tail.at(-1)) tail.pop()
  if (tail.length > 1) tail.pop()
  const now = after.map((l) => l.trimEnd())
  for (let k = Math.min(tail.length, 12); k > 0; k--) {
    const end = tail.slice(-k).join("\n")
    for (let i = now.length - k; i >= 0; i--) if (now.slice(i, i + k).join("\n") === end) return now.slice(i + k)
  }
  return now
}
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Whether `text` has what a watch waits for: words (any case), or a /regular expression/. */
export function happened(until: string, text: string) {
  const u = until.trim()
  if (!u) return true
  const re = /^\/(.+)\/([a-z]*)$/.exec(u)
  if (re) { try { return new RegExp(re[1], re[2].replace(/[gy]/g, "")).test(text) } catch { return false } }
  return text.toLowerCase().includes(u.toLowerCase())
}
