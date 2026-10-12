// Review: the files AI apps and coding agents changed that the user hasn't looked at yet. Who changed what is Activity's
// (asked as a service), the text before is File history's; what's reviewed is a mark per file (its data.json).
import { diffLines, fmtAgo, HTTPError, type OpCtx, OpError, Plugin, type Who, whoOf } from "../../../core/plugins.ts"
import { isHiddenPath, readText, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** An Activity event, as much of it as the review reads. */
type Change = { t: number; last?: number; actor: { kind: string; name: string }; action: string; paths?: string[]; method?: string }
/** A file to review, as review.list answers it. */
export type Pending = { path: string; by: string[]; first: number; last: number; added?: number; removed?: number; created?: boolean }
/** And what the app's diff needs: the text before (null: not kept), whether it's the text just before (`exact`), and
 *  whether the user changed it too since (`yours`). */
type Found = Pending & { start: number; base: { t: number; text: string } | null; exact: boolean; yours: boolean }

const DAY = 86_400_000
/** A hook's event (no request: Claude Code's own edit) is told after the write: the text before is older than this. */
const HOOK_LAG = 3000
/** And a change on disk is noticed up to this long after it was written. */
const NOTICE_LAG = 10_000

/** An AI app or a coding agent: what Activity calls an agent (an MCP app, the CLI or the API under a coding agent, a
 *  coding agent's own edits). Not the user, vau typed by hand, scripts or changes on disk. */
const byAi = (e: Change) => e.actor?.kind === "agent"
/** A writer's name as one key: "Claude" and "claude", "Grok Bot" and "grok-bot" are the same (slugged, lowercase). */
const keyOf = (name: string) => whoOf(null, name).agent ?? name.trim().toLowerCase()
/** A writer as the user reads it: Activity named MCP apps by their slug before it kept their names ("grok-bot"). */
function readable(name: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  const known = whoOf(null, name).label
  return known !== name ? known : name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}
/** Who asked is an AI or a script, not the user (the app, or vau typed by hand). */
const notUser = (w: Who) => !w.client?.startsWith("app") && !(w.client === "cli" && !w.agent)
/** An AI app or a coding agent calling: an MCP client, or a client that names its agent. */
const isAi = (w: Who) => w.client === "mcp" || !!w.agent
/** Not the user's files: settings, the app's own pages, the trash, archives (a path with a part starting with a dot). */
const hidden = (p: string) => isHiddenPath(p) || p.split("/").some((x) => x.startsWith("."))

// ---------- what's been reviewed: { files: { "<path>": <reviewed up to, ms> } } in its data.json

const marks = (): Record<string, number> => {
  const f = plugin.settings({}).files
  return f && typeof f === "object" ? f as Record<string, number> : {}
}
/** Change the marks (read from disk, so nothing another write made is lost); old ones dropped. */
function remark(change: (m: Record<string, number | null>) => void) {
  const cur = ((plugin.readSettings() ?? {}).files ?? {}) as Record<string, number>
  const next: Record<string, number | null> = { ...cur }
  change(next)
  const old = Date.now() - 31 * DAY
  const kept = Object.entries(next).filter(([, t]) => typeof t === "number" && t > old).sort(([a], [b]) => a.localeCompare(b))
  plugin.saveSettings({ ...(plugin.readSettings() ?? {}), files: kept.length ? Object.fromEntries(kept) : undefined })
}
// Marks follow their files (moved by the app or vau move).
plugin.onMove((from, to) => {
  const m = marks()
  if (!Object.keys(m).some((k) => k === from || k.startsWith(`${from}/`))) return
  remark((n) => {
    for (const k of Object.keys(n)) if (k === from || k.startsWith(`${from}/`)) { const t = n[k]; delete n[k]; if (to) n[to + k.slice(from.length)] = t }
  })
})

const there = (vault: Vault, rel: string) => vault.entries.has(rel) || vault.others.has(rel)

/** The diff's size, kept per file version (each list asks again after every change in the vault). */
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

/** Every file an AI changed since it was last reviewed, newest first; `only` keeps those one writer changed; `path`
 *  just that file. With the text before when `texts`. */
async function find(vault: Vault, opts: { by?: string; path?: string; texts?: boolean } = {}): Promise<Found[]> {
  const m = marks(), now = Date.now()
  const changes = await plugin.ask<Change[]>("activity:changes", [], now - 15 * DAY)
  const files = new Map<string, { by: string[]; first: number; last: number; start: number; created: boolean; own: Set<Change> }>()
  for (const e of changes) {
    if (!byAi(e)) continue
    const end = e.last ?? e.t
    for (const p of e.paths ?? []) {
      if ((opts.path && p !== opts.path) || hidden(p) || end <= (m[p] ?? 0)) continue
      // (a run of writes that went on past the last review: its last one is after it)
      const t0 = e.t > (m[p] ?? 0) ? e.t : end
      const f = files.get(p) ?? { by: [], first: t0, last: end, start: e.method || t0 > e.t ? t0 : t0 - HOOK_LAG, created: false, own: new Set<Change>() }
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
    if (!there(vault, p)) continue // deleted or moved since
    const { versions } = await plugin.ask<{ versions: { t: number }[] }>("history:versions", { versions: [] }, p)
    const before = versions.filter((v) => v.t < f.start).at(-1) ?? null
    const created = (f.created || (made()[p] ?? 0) >= f.first) && !before
    // Anyone's change between the version kept and the AI's: that version isn't the text just before (it was written
    // within File history's interval). An event is a run of writes (t to last): one whose start or end is in between.
    const here = changes.filter((e) => e.paths?.includes(p) && !f.own.has(e) && !(e.actor.kind === "script" && e.actor.name === "Vaultite"))
    const inside = (e: Change, x: number) => x > before!.t + (e.method ? 0 : NOTICE_LAG) && x < f.first
    const exact = created || (!!before && !here.some((e) => inside(e, e.t) || inside(e, e.last ?? e.t)))
    const yours = here.some((e) => !byAi(e) && (e.last ?? e.t) > f.first)
    let base: Found["base"] = null, added: number | undefined, removed: number | undefined
    if (created || (before && exact)) {
      const text = created ? "" : await plugin.ask<string | null>("history:text", null, p, before!.t)
      if (text !== null) {
        let cur: string
        try { cur = readText(vault.abs(p)) } catch { continue }
        const st = (vault.entries.get(p)?.stat ?? vault.others.get(p))?.ns
        ;({ added, removed } = size(`${p}\0${created ? "new" : before!.t}\0${st}`, text, cur))
        if (!added && !removed && !created) continue // (back as it was: nothing to review)
        base = { t: created ? f.first : before!.t, text: opts.texts ? text : "" }
      }
    }
    out.push({ path: p, by: f.by, first: f.first, last: f.last, ...(base ? { added, removed } : {}), ...(created ? { created: true } : {}),
      start: f.start, base, exact: !!base, yours })
  }
  return out.sort((a, b) => b.last - a.last)
}

const listed = (r: Found): Pending => ({ path: r.path, by: r.by, first: r.first, last: r.last,
  ...(r.added !== undefined ? { added: r.added, removed: r.removed } : {}), ...(r.created ? { created: true } : {}) })

/** Which files a keep or a revert is about: one, every one, or one writer's. */
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

/** The user's to do, in the app or with vau typed by hand: an AI marking its own changes reviewed would defeat it. */
const usersOnly = (who: Who, what: string) => {
  if (notUser(who)) throw new OpError(`${what} is the user's to do, in the app or with vau typed by hand`, 403)
}

/** Mark files reviewed (up to now), and label those an AI wrote (Provenance's origin ai) reviewed: what that value
 *  means. `relabeled`: what each was, for the app's Undo. */
async function keep(ctx: OpCtx, files: Found[]) {
  const now = Date.now(), was: Record<string, number | null> = {}, m = marks(), relabeled: { path: string; was: string }[] = []
  const ai = (await plugin.ask<string>("provenance:agent", "")) || "ai"
  for (const f of files) {
    was[f.path] = m[f.path] ?? null
    try {
      const o = await ctx.op("provenance.get", { path: f.path })
      if (o?.origin !== ai) continue
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
        const r = await ctx.op("archive.add", { path: f.path })
        reverted.push({ path: f.path, archived: r.path })
        continue
      }
      const now = readText(ctx.vault.abs(f.path))
      await ctx.api("PUT", "file", { path: f.path, text: f.base.text, base: now })
      // (both texts, for the app's Undo)
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

// The app's: one file with its text before, for the diff; and the marks put back (Undo).
plugin.route("GET", "review", async (req) => ({ files: (await find(plugin.vault, { by: req.query.by || undefined })).map(listed) }))
plugin.route("GET", "review/file", async (req) => {
  const rel = String(req.query.path ?? "")
  if (!rel) throw new HTTPError(400, "which file? ?path=")
  const f = (await find(plugin.vault, { path: rel, texts: true }))[0]
  if (!f) return { path: rel, pending: false }
  return { ...listed(f), pending: true, base: f.base, exact: f.exact, yours: f.yours }
})
plugin.route("POST", "review/marks", (req) => {
  const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
  if (notUser(whoOf(h("x-vaultite-client"), h("x-vaultite-agent")))) throw new HTTPError(403, "only the app puts review marks back")
  const given = (req.body as { was?: unknown })?.was
  if (!given || typeof given !== "object") throw new HTTPError(400, "was: { path: ms or null }, as keep or revert answered")
  remark((n) => {
    for (const [k, v] of Object.entries(given as Record<string, unknown>)) {
      if (typeof v === "number") n[k] = v; else delete n[k]
    }
  })
  return { ok: true }
})

/** Files an AI made through an op that names no kind of change (file.write): path -> when, in its cache (a restart
 *  keeps them). */
const made = (): Record<string, number> => (plugin.readCache()?.made ?? {}) as Record<string, number>
function madeByAi(rel: string) {
  const old = Date.now() - 15 * DAY
  plugin.writeCache({ made: Object.fromEntries([...Object.entries(made()).filter(([, t]) => t > old), [rel, Date.now()]]) })
}

/** Before an AI's write, the file's text is kept as a version, whatever File history's interval: the review's diff
 *  starts from it. A file that wasn't there and is after is one it made. */
plugin.around("*", async (call, next) => {
  if (call.kind === "read" || !isAi(call.who)) return next()
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
