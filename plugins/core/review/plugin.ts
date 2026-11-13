import { z } from "zod"
import { byUser, diffLines, FileMoved, fmtAgo, HTTPError, type OpCtx, OpError, Plugin, type Who, whoOf } from "../../../core/plugins.ts"
import { isHiddenPath, type Item, parseText, readText, setPropertyText, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

type Change = { t: number; last?: number; actor: { kind: string; name: string }; action: string; paths?: string[]; method?: string }
export type Pending = { path: string; by: string[]; first: number; last: number; added?: number; removed?: number; created?: boolean }
type Found = Pending & { start: number; base: { t: number; text: string; shown: string } | null; exact: boolean; yours: boolean }

const MARKS = z.record(z.string(), z.unknown()).catch({})
const WAS = z.object({ was: z.record(z.string(), z.unknown()) })
const MADE = z.record(z.string(), z.number()).catch({})
const DAY = 86_400_000
/** Claude Code tells its hook of an edit after the write. */
const HOOK_LAG = 3000
/** A file watcher sees a change up to this long after the write. */
const NOTICE_LAG = 10_000
/** Linux dates an mtime from a coarse clock: up to a tick (1 to 10 ms) before the write. */
const MTIME_LAG = 20
const OWN_LAG = 5

const byAi = (e: Change) => e.actor?.kind === "agent"
const keyOf = (name: string) => whoOf(null, name).agent ?? name.trim().toLowerCase()
function readable(name: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  const known = whoOf(null, name).label
  return known !== name ? known : name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}
const isAi = (w: Who) => w.client === "mcp" || !!w.agent
const hidden = (p: string) => isHiddenPath(p) || p.split("/").some((x) => x.startsWith("."))

let takenIn = false
function takeIn() {
  if (takenIn) return
  takenIn = true
  const conf = plugin.readSettings()
  if (!conf || !("files" in conf)) return
  const old = MARKS.parse(conf.files), cur = plugin.kept<Record<string, number>>("marks", {})
  for (const [k, t] of Object.entries(old)) if (typeof t === "number" && t > (cur[k] ?? 0)) cur[k] = t
  plugin.keep("marks", cur, { shared: true })
  const { files: _, ...rest } = conf
  plugin.saveSettings(Object.keys(rest).length ? rest : null)
}
const marks = (): Record<string, number> => { takeIn(); return plugin.kept<Record<string, number>>("marks", {}) }
function remark(change: (m: Record<string, number | null>) => void) {
  const next: Record<string, number | null> = { ...marks() }
  change(next)
  const old = Date.now() - 31 * DAY
  const kept = Object.entries(next).filter(([, t]) => typeof t === "number" && t > old).sort(([a], [b]) => a.localeCompare(b))
  plugin.keep("marks", kept.length ? Object.fromEntries(kept) : null, { shared: true })
}
const skipped = (): string[] => {
  const s = plugin.settings({}).skip
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^\/+|\/+$/g, "")).filter(Boolean) : []
}
const inSkipped = (p: string, folders: string[]) => folders.some((f) => p === f || p.startsWith(`${f}/`))
plugin.onMove((from, to) => {
  const m = marks()
  if (!Object.keys(m).some((k) => k === from || k.startsWith(`${from}/`))) return
  remark((n) => {
    for (const k of Object.keys(n)) if (k === from || k.startsWith(`${from}/`)) { const t = n[k]; delete n[k]; if (to) n[to + k.slice(from.length)] = t }
  })
})

const there = (vault: Vault, rel: string) => vault.entries.has(rel) || vault.others.has(rel)

const sizes = new Map<string, { added: number; removed: number }>()
function size(key: string, before: string, now: string) {
  let s = sizes.get(key)
  if (!s) {
    const lines = (t: string) => (t ? t.replace(/\n$/, "").split("\n") : [])
    const a = lines(before), b = lines(now)
    s = { added: 0, removed: 0 }
    for (const [tag, i1, i2, j1, j2] of diffLines(a, b)) if (tag !== "equal") { s.removed += i2 - i1; s.added += j2 - j1 }
    if (sizes.size > 500) sizes.clear()
    sizes.set(key, s)
  }
  return s
}

async function asNow(vault: Vault, rel: string, before: string, now: string) {
  let fm: Item, had: Item
  try { fm = parseText(now)[0]; had = parseText(before)[0] } catch { return before }
  const keys = [...(vault.kindFor(rel, fm)?.spec.stamps ?? []), ...await plugin.ask<string[]>("note-dates:stamps", [], rel, fm)]
  let out = before
  for (const k of new Set(keys)) if (k in had && fm[k] != null && had[k] !== fm[k]) out = setPropertyText(out, k, fm[k]) ?? out
  return out
}

async function find(vault: Vault, opts: { by?: string; path?: string; texts?: boolean } = {}): Promise<Found[]> {
  const m = marks(), now = Date.now(), skip = skipped()
  const changes = await plugin.ask<Change[]>("activity:changes", [], now - 15 * DAY)
  const files = new Map<string, { by: string[]; first: number; last: number; start: number; created: boolean; own: Set<Change> }>()
  for (const e of changes) {
    if (!byAi(e)) continue
    const end = e.last ?? e.t
    for (const p of e.paths ?? []) {
      if ((opts.path && p !== opts.path) || hidden(p) || inSkipped(p, skip) || end <= (m[p] ?? 0)) continue
      const t0 = e.t > (m[p] ?? 0) ? e.t : end
      const f = files.get(p) ?? { by: [], first: t0, last: end, start: e.method || t0 > e.t ? t0 - OWN_LAG : t0 - HOOK_LAG, created: false, own: new Set<Change>() }
      f.own.add(e)
      const who = readable(e.actor.name)
      if (!f.by.some((x) => keyOf(x) === keyOf(who))) f.by.push(who)
      f.last = Math.max(f.last, end)
      if (e.action === "create" && t0 === f.first) f.created = true
      files.set(p, f)
    }
  }
  const want = opts.by ? keyOf(opts.by) : null
  const out: Found[] = []
  for (const [p, f] of files) {
    if (want && !f.by.some((b) => keyOf(b) === want)) continue
    if (!there(vault, p)) continue
    const { versions } = await plugin.ask<{ versions: { t: number }[] }>("history:versions", { versions: [] }, p)
    const before = versions.filter((v) => v.t < f.start).at(-1) ?? null
    const created = (f.created || (made()[p] ?? 0) >= f.first) && !before
    const here = changes.filter((e) => e.paths?.includes(p) && !f.own.has(e) && !(e.actor.kind === "script" && e.actor.name === "Vaultite"))
    const inside = (e: Change, x: number) => x > before!.t + (e.method ? MTIME_LAG : NOTICE_LAG) && x < f.first
    const exact = created || (!!before && !here.some((e) => inside(e, e.t) || inside(e, e.last ?? e.t)))
    const yours = here.some((e) => !byAi(e) && (e.last ?? e.t) > f.first)
    let base: Found["base"] = null, added: number | undefined, removed: number | undefined
    if (created || (before && exact)) {
      const text = created ? "" : await plugin.ask<string | null>("history:text", null, p, before!.t)
      if (text !== null) {
        let cur: string
        try { cur = readText(vault.abs(p)) } catch { continue }
        const st = (vault.entries.get(p)?.stat ?? vault.others.get(p))?.ns
        const shown = created ? text : await asNow(vault, p, text, cur)
        ;({ added, removed } = size(`${p}\0${created ? "new" : before!.t}\0${st}`, shown, cur))
        if (!added && !removed && !created) continue
        base = { t: created ? f.first : before!.t, text: opts.texts ? text : "", shown: opts.texts ? shown : "" }
      }
    }
    out.push({ path: p, by: f.by, first: f.first, last: f.last, ...(base ? { added, removed } : {}), ...(created ? { created: true } : {}),
      start: f.start, base, exact: !!base, yours })
  }
  return out.sort((a, b) => b.last - a.last)
}

const listed = (r: Found): Pending => ({ path: r.path, by: r.by, first: r.first, last: r.last,
  ...(r.added !== undefined ? { added: r.added, removed: r.removed } : {}), ...(r.created ? { created: true } : {}) })

async function targets(vault: Vault, p: { path?: string; all?: boolean; by?: string }) {
  if (p.path) {
    const rel = String(p.path)
    const hit = (await find(vault, { path: rel, texts: true }))[0]
    if (!hit) throw new OpError(`${rel} has no AI changes to review`, 404)
    return [hit]
  }
  if (!p.all && !p.by) throw new OpError("which file? path, or all (by: one writer's)")
  return await find(vault, { by: p.by, texts: true })
}

const usersOnly = (who: Who, what: string) => {
  if (!byUser(who)) throw new OpError(`${what} is the user's to do, in the app or with vau typed by hand`, 403)
}

async function keep(ctx: OpCtx, files: Found[]) {
  const now = Date.now(), was: Record<string, number | null> = {}, m = marks(), relabeled: { path: string; was: string }[] = []
  const ai = (await plugin.ask<string>("provenance:agent", "")) || "ai"
  for (const f of files) {
    was[f.path] = m[f.path] ?? null
    try {
      const o = z.looseObject({ origin: z.string().nullish() }).parse(await ctx.op("provenance.get", { path: f.path }))
      if (o.origin !== ai) continue
      await ctx.op("provenance.set", { path: f.path, origin: "reviewed" })
      relabeled.push({ path: f.path, was: ai })
    } catch { /* Provenance off, or a vault without that value */ }
  }
  remark((n) => { for (const f of files) n[f.path] = now })
  return { was, relabeled }
}

const PATH = { type: "string", format: "path", description: "the file (a path, or a name as the user says it)" } as const
const BY = { type: "string", description: "only what this writer changed, as Activity names it (ChatGPT, Claude, Claude Code)" } as const
const ALL = { type: "boolean", description: "every file to review (with by: that writer's)" } as const
const line = (f: Pending) => {
  const size = f.created ? "new file" : f.added !== undefined ? `+${f.added} −${f.removed}` : "no earlier version kept"
  return `- ${f.path}: ${f.by.join(", ")} · ${size} · ${fmtAgo(f.last)}`
}

plugin.op({
  id: "review.list",
  cli: "review",
  summary: "The files AI apps and coding agents changed that the user hasn't reviewed yet, newest first.",
  help: `Each with who changed it (by, as Activity names them), when (first and last, ms), the lines added and removed
since the text before (absent when no earlier version is kept), and created for a file an AI made. The user keeps or
reverts each in the app (view:review).

vau review
vau review --by ChatGPT`,
  kind: "read",
  params: { by: BY },
  run: async ({ by }, ctx) => ({ files: (await find(ctx.vault, { by })).map(listed) }),
  text: (r) => (r.files.length ? r.files.map(line).join("\n") : "Nothing to review."),
})

plugin.op({
  id: "review.keep",
  cli: "review keep",
  summary: "Mark AI changes reviewed: one file, or all (by: one writer's); a file an AI wrote (origin ai) becomes reviewed.",
  help: `The user's to do (the app, or vau typed by hand): an agent can't mark its own changes reviewed. A later AI change
shows the file again.

vau review keep "People/Alice Park.md"
vau review keep --all`,
  kind: "write",
  params: { path: PATH, all: ALL, by: BY },
  args: ["path"],
  run: async (p, ctx) => {
    usersOnly(ctx.who, "Keeping AI changes")
    const files = await targets(ctx.vault, p)
    return { kept: files.map((f) => f.path), ...(await keep(ctx, files)) }
  },
  text: (r) => (r.kept.length ? `Kept ${r.kept.length === 1 ? r.kept[0] : `${r.kept.length} files`}.` : "Nothing to review."),
  did: (p) => ({ action: "save", text: p.path ? `Kept the AI changes to ${p.path}` : `Kept every AI change${p.by ? ` by ${p.by}` : ""}`, paths: p.path ? [p.path] : [] }),
})

plugin.op({
  id: "review.revert",
  cli: "review revert",
  summary: "Undo AI changes: a file back to its text before the AI's first unreviewed change (a file an AI made is archived).",
  help: `The text before comes from File history; a file with no version from just before can only be kept. What it said
is kept in File history, so a revert can be undone. The user's to do (the app, or vau typed by hand).

vau review revert "People/Alice Park.md"`,
  kind: "write",
  params: { path: PATH, all: ALL, by: BY },
  args: ["path"],
  run: async (p, ctx) => {
    usersOnly(ctx.who, "Reverting AI changes")
    const files = await targets(ctx.vault, p)
    const reverted: { path: string; archived?: string; text?: string; was?: string }[] = [], skipped: { path: string; why: string }[] = []
    for (const f of files) {
      if (!f.base) { skipped.push({ path: f.path, why: "no version from just before the change is kept" }); continue }
      if (f.created) {
        const r = FileMoved.parse(await ctx.op("archive.add", { path: f.path }))
        reverted.push({ path: f.path, archived: r.path })
        continue
      }
      const now = readText(ctx.vault.abs(f.path))
      await ctx.api("PUT", "file", { path: f.path, text: f.base.text, base: now })
      reverted.push({ path: f.path, text: f.base.text, was: now })
    }
    if (p.path && skipped.length) throw new OpError(`${skipped[0].path}: ${skipped[0].why}; keep it, or open its version history`, 409)
    const done = new Set(reverted.map((r) => r.path))
    const m = marks(), was: Record<string, number | null> = {}
    for (const f of files) if (done.has(f.path)) was[f.path] = m[f.path] ?? null
    const now = Date.now()
    remark((n) => { for (const p of done) n[p] = now })
    return { reverted, skipped, was }
  },
  text: (r) => [r.reverted.length ? `Reverted ${r.reverted.map((x: { path: string; archived?: string }) => x.archived ? `${x.path} (archived: ${x.archived})` : x.path).join(", ")}.` : "Nothing reverted.",
    ...r.skipped.map((s: { path: string; why: string }) => `- not ${s.path}: ${s.why}`)].join("\n"),
  did: (p) => ({ action: "edit", text: p.path ? `Reverted the AI changes to ${p.path}` : `Reverted every AI change${p.by ? ` by ${p.by}` : ""}`, paths: p.path ? [p.path] : [] }),
})

plugin.route("GET", "review", async (req) => ({ files: (await find(plugin.vault, { by: req.query.by || undefined })).map(listed) }))
plugin.route("GET", "review/file", async (req) => {
  const rel = String(req.query.path ?? "")
  if (!rel) throw new HTTPError(400, "which file? ?path=")
  const f = (await find(plugin.vault, { path: rel, texts: true }))[0]
  if (!f) return { path: rel, pending: false }
  return { ...listed(f), pending: true, base: f.base && { t: f.base.t, text: f.base.shown }, exact: f.exact, yours: f.yours }
})
plugin.route("POST", "review/marks", (req) => {
  const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
  if (!byUser(whoOf(h("x-vaultite-client"), h("x-vaultite-agent")))) throw new HTTPError(403, "only the app puts review marks back")
  const body = WAS.safeParse(req.body)
  if (!body.success) throw new HTTPError(400, "was: { path: ms or null }, as keep or revert answered")
  remark((n) => {
    for (const [k, v] of Object.entries(body.data.was)) {
      if (typeof v === "number") n[k] = v; else delete n[k]
    }
  })
  return { ok: true }
})

const made = (): Record<string, number> => MADE.parse(plugin.readCache()?.made)
function madeByAi(rel: string) {
  const old = Date.now() - 15 * DAY
  plugin.writeCache({ made: Object.fromEntries([...Object.entries(made()).filter(([, t]) => t > old), [rel, Date.now()]]) })
}

plugin.around("*", async (call, next) => {
  if (call.kind === "read" || !isAi(call.who) || plugin.host.did(call.op, call.params)?.action === "ui") return next()
  const fresh: string[] = []
  for (const k of ["path", "from", "file"]) {
    const v = call.params[k]
    if (typeof v !== "string" || !v) continue
    const rel = v.replace(/^\/+/, "")
    const hit = [rel, `${rel}.md`].find((r) => there(plugin.vault, r))
    if (hit) await plugin.ask("history:keep", false, hit)
    else if (k === "path") fresh.push(rel)
  }
  const out = await next()
  for (const rel of fresh) if (there(plugin.vault, rel)) madeByAi(rel)
  return out
})
