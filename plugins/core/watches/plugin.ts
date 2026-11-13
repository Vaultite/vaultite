import { OpError, Plugin } from "../../../core/plugins.ts"
import { type Item, joinPath, Kind, nowStamp, safeName, stemOf, str, truthy } from "../../../core/vault.ts"
import { changes, type Context, happened, hash, type Pane, parseSource, read, type Read, type Source, sourceText } from "./sources.ts"

export const plugin = new Plugin(import.meta.url)
export { changes, happened, parseSource }

const STATUSES = ["active", "paused"]
const UNIT: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }
export function periodOf(every: unknown): number | null {
  const s = str(every).trim().toLowerCase()
  if (!s || s === "live") return 0
  const m = /^(\d+)\s*([mhdw])$/.exec(s)
  return m && Number(m[1]) > 0 ? Number(m[1]) * UNIT[m[2]] : null
}
plugin.kind(new Kind({
  type: "watch", collection: "watches", folder: "Watches", label: "Watches",
  parse(fm, body, stem) {
    const status = truthy(fm.status) ? str(fm.status) : "active", source = str(fm.source).trim(), every = truthy(fm.every) ? str(fm.every) : "live"
    const problems = [...(STATUSES.includes(status) ? [] : [`status \`${status}\` isn't one of \`active\` or \`paused\``]),
      ...(parseSource(source) ? [] : ["source is note:<path>, terminal:<id>, site:<url> or group:<id>"]),
      ...(periodOf(every) === null ? [`every is live, or a number and m, h, d or w ("5m"), not \`${every}\``] : [])]
    return [{ title: truthy(fm.title) ? str(fm.title) : stem, source, every, until: truthy(fm.until) ? str(fm.until) : "", status, by: truthy(fm.by) ? str(fm.by) : "",
      created: fm.created ?? null, body }, problems]
  },
  render: (w) => [{ source: w.source || null, every: w.every || "live", until: w.until || null, status: w.status || "active", by: w.by || null, created: w.created || null }, w.body || ""],
  prepare(w) { w.created = w.created || nowStamp(); w.status = w.status || "active"; return w },
  filename: (w, at) => joinPath(at.folder, at.old ? stemOf(at.old.id) : safeName(w.title || "Watch")),
  stamps: ["created"],
}))

type Last = { hash: string; at: number; done?: number; hit?: number; error?: string }
const lasts = () => plugin.kept<Record<string, Last>>("lasts", {})
const keepLast = (id: string, l: Last | null) => { const all = { ...lasts() }; if (l) all[id] = l; else delete all[id]; plugin.keep("lasts", all) }
const seen = new Map<string, Read>()

const context = (): Context => ({
  panes: () => (plugin.service("companion:panes") as (() => Pane[]) | null)?.() ?? [],
  private: (url, container) => !!(plugin.service("companion:private") as ((u: string, c: string | null) => boolean) | null)?.(url, container),
})
export const watches = () => plugin.vault.shared("watches") as readonly Item[]

export type Hit = { id: string; title: string; source: string; why: string; until: string; done: boolean; changes: string[]; url?: string; title_now: string }

export async function check(w: Item, now = Date.now()): Promise<Hit | null> {
  const id = str(w.id), src = parseSource(str(w.source))
  if (!src) return null
  let r: Read
  try { r = await read(plugin, src, context()) } catch (e) { keepLast(id, { ...(lasts()[id] ?? { hash: "" }), at: now, error: (e as Error).message }); return null }
  if (r.missing) { keepLast(id, { ...(lasts()[id] ?? { hash: "" }), at: now, error: "not there now" }); return null }
  const h = hash(r), was = lasts()[id], before = seen.get(id) ?? null
  seen.set(id, r)
  const until = str(w.until)
  const first = !was?.hash
  if (!first && was.hash === h) { keepLast(id, { ...was, at: now, error: undefined }); return null }
  const lines = first ? [] : changes(before, r)
  const all = [r.state ?? "", r.text, ...lines].join("\n")
  if ((first && !until) || (until && !happened(until, all))) { keepLast(id, { hash: h, at: now }); return null }
  keepLast(id, { hash: h, at: now, hit: now, ...(until ? { done: now } : {}) })
  const hit: Hit = { id, title: str(w.title), source: sourceText(src), why: str(w.body).trim(), until, done: !!until, changes: lines.length ? lines : ["changed (what it was before isn't known: the server restarted)"],
    ...(r.url ? { url: r.url } : {}), title_now: r.title }
  await tell(hit)
  return hit
}

async function tell(h: Hit) {
  if (await plugin.ask<boolean>("companion:watch", false, h)) return
  await plugin.ask("inbox:event", null, { source: "watches", kind: "watch", key: h.id, title: `${h.title}: ${h.done ? "it happened" : "it changed"}`,
    body: [h.why, ...h.changes.slice(0, 20)].filter(Boolean).join("\n"), ...(h.url ? { link: h.url } : {}) })
}

const due = (w: Item, now: number) => {
  if (str(w.status) === "paused") return false
  const l = lasts()[str(w.id)], every = periodOf(w.every)
  return every !== null && !l?.done && (!l || now - l.at >= every)
}
let ticking = false
export async function tick(now = Date.now()) {
  if (ticking) return
  ticking = true
  try { for (const w of watches().filter((x) => due(x, now))) await check(w, now).catch(() => null) } finally { ticking = false }
}
plugin.every("check", { every: "1m" }, () => tick())
plugin.onChange((paths) => {
  if (!paths) return
  const noteOf = (w: Item) => { const s = parseSource(str(w.source)); return s?.kind === "note" ? s.ref : "" }
  const hit = watches().filter((w) => str(w.status) !== "paused" && periodOf(w.every) === 0 && paths.includes(noteOf(w)))
  for (const w of hit) void check(w).catch(() => null)
})
plugin.onEvent({ types: ["terminal.state"] }, (ev) => {
  const id = str(ev.id)
  for (const w of watches()) if (str(w.status) !== "paused" && periodOf(w.every) === 0 && str(w.source) === `terminal:${id}`) void check(w).catch(() => null)
})

function find(ref: string) {
  const r = ref.trim().replace(/\.md$/i, ""), all = watches()
  const w = all.find((x) => x.id === r) ?? all.find((x) => str(x.title).toLowerCase() === r.toLowerCase()) ?? all.find((x) => stemOf(str(x.id)).toLowerCase() === r.toLowerCase())
  if (!w) throw new OpError(`no watch \`${ref}\` (vau watches lists them)`, 404)
  return w
}
const stateOf = (w: Item) => { const l = lasts()[str(w.id)]; return l?.done ? "done" : str(w.status) === "paused" ? "paused" : l?.error ? `active (${l.error})` : "active" }
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }

plugin.op({
  id: "watches.add",
  cli: "watches add",
  summary: "Keep an eye on something for the user: a terminal, a web page, a note or a tab group, live or every few minutes, until something happens.",
  help: `The server checks it (no model: a check that sees no change wakes no one). A change comes to the companion as a
watch moment, or to the inbox when it isn't running; with until, only a change that has those words (or matches a
/regular expression/), and the watch ends there. why says what to do then, in the user's words.

  vau watches add terminal:claude-k3j2h1g0 --until "idle" --why "Tell me when the migration finishes"
  vau watches add https://example.com/order/1042 --every 30m --until Shipped --why "Tell me when it ships"
  vau watches add "Projects/Launch.md" --every 1h`,
  kind: "write",
  params: {
    source: { type: "string", required: true, description: "what to watch: note:<path>, terminal:<id>, site:<url> or group:<tab group id> (a path or an address alone works too)" },
    title: { type: "string", description: "its name (the file's; default: what it watches)" },
    every: { type: "string", default: "live", description: "live (as it changes), or how often: 5m, 2h, 1d" },
    until: { type: "string", description: "what it waits for: words (any case) or a /regular expression/; it ends once it's there" },
    why: { type: "string", description: "what to do when it happens, in the user's words" },
    by: { type: "string", description: "who asked for it (default: you, as the server knows the caller)" },
  },
  args: ["source"],
  run: async (p, ctx) => {
    const src = parseSource(str(p.source))
    if (!src || src.kind === "pane") throw new OpError("give `source` as note:<path>, terminal:<id>, site:<url> or group:<id>")
    if (periodOf(p.every) === null) throw new OpError("`every` is live, or a number and m, h, d or w (5m, 2h)")
    const title = str(p.title).trim() || defaultTitle(src)
    const r = await ctx.api("POST", "watches", { title, source: sourceText(src), every: str(p.every) || "live", until: str(p.until).trim(), status: "active", by: str(p.by).trim() || ctx.who.label, body: str(p.why).trim() }) as Item
    void tick()
    return { id: str(r.id), title, source: sourceText(src) }
  },
  text: (r) => `Watching ${r.source} (${r.id}.md).`,
})
const defaultTitle = (s: Source) => (s.kind === "site" ? `Watch ${s.ref.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}` : `Watch ${s.ref.replace(/^.*\//, "").replace(/\.md$/i, "")}`)

plugin.op({
  id: "watches.list",
  cli: "watches",
  summary: "The user's watches: what each watches, how often, what it waits for, and whether it's active, paused or done.",
  kind: "read",
  run: async () => watches().map((w) => ({ id: str(w.id), title: str(w.title), source: str(w.source), every: str(w.every), until: str(w.until), state: stateOf(w),
    last: lasts()[str(w.id)]?.at ?? null, hit: lasts()[str(w.id)]?.hit ?? null })),
  text: (ws: { id: string; title: string; source: string; every: string; until: string; state: string; last: number | null; hit: number | null }[]) => ws.length
    ? ws.map((w) => `${w.id}.md  ${w.state}  ${w.source}  every ${w.every}${w.until ? `, until "${w.until}"` : ""}${w.last ? `; checked ${ago(w.last)}` : ""}${w.hit ? `, last change ${ago(w.hit)}` : ""}`).join("\n")
    : "No watches.",
})

plugin.op({
  id: "watches.pause",
  cli: "watches pause",
  summary: "Pause a watch (it keeps its file, checked no more), or resume it.",
  help: `  vau watches pause "Watch order 1042"
  vau watches pause "Watch order 1042" --resume`,
  kind: "write",
  params: { id: { type: "string", required: true, description: "the watch: its path, or its title" }, resume: { type: "boolean", description: "check it again (one that ended starts over)" } },
  args: ["id"],
  run: async (p, ctx) => {
    const w = find(str(p.id))
    await ctx.api("PUT", `watches/${encodeURIComponent(str(w.id))}`, { status: p.resume ? "active" : "paused" })
    if (p.resume) { keepLast(str(w.id), null); seen.delete(str(w.id)); void tick() }
    return { id: str(w.id), paused: !p.resume }
  },
  text: (r) => `${r.paused ? "Paused" : "Resumed"} ${r.id}.md.`,
})

plugin.op({
  id: "watches.remove",
  cli: "watches remove",
  summary: "Remove a watch: its file goes (to the trash), and it's checked no more.",
  kind: "write",
  params: { id: { type: "string", required: true, description: "the watch: its path, or its title" } },
  args: ["id"],
  run: async (p, ctx) => {
    const w = find(str(p.id))
    await ctx.api("DELETE", `watches/${encodeURIComponent(str(w.id))}`)
    keepLast(str(w.id), null); seen.delete(str(w.id))
    return { id: str(w.id) }
  },
  text: (r) => `Removed ${r.id}.md.`,
})

/** A source read now (note:, terminal:, site:); null: none such. */
plugin.provide("watches:read", async (source: string, pane?: string) => { const s = parseSource(source); return s ? await read(plugin, s, context(), { pane, open: false }) : null })
/** What changed between two reads, in a few lines. */
plugin.provide("watches:changes", (a: Read | null, b: Read, most?: number) => changes(a, b, most))
