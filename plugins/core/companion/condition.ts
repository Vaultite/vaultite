// Condition over time: the ui model's checks (core/desktop/uimodel.ts) with what happens (click, type, idle, after),
// joined (and, or) and bounded (within 10s). Waiting watches one over time. No Node: the tests read it.
import { type Condition as Check, conditionText as checkText, normWords, parseCondition as parseCheck } from "../../../core/desktop/uimodel.ts"

export type Clause =
  /** The user clicked (the thing saying `text`), or typed (into it): seen as it happens, kept once seen. */
  | { kind: "click"; text?: string } | { kind: "type"; text?: string }
  /** Nothing they did and nothing on screen changed for `ms`; or `ms` went by. */
  | { kind: "idle"; ms: number } | { kind: "after"; ms: number }
  /** A state of the screen, checked by the ui model (changed: since the wait began). */
  | { kind: "check"; check: Check }
/** Any of its groups met, each group's clauses all at once (`and` binds tighter than `or`); `within`: how long to wait. */
export type Condition = { any: Clause[][]; within?: number; source: string }
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)?$/i
/** `1s`, `500ms`, `2m` (seconds when bare) as milliseconds, or null. */
export function durationOf(s: string): number | null {
  const m = DURATION.exec(s.trim())
  if (!m) return null
  const n = Number(m[1]), u = (m[2] ?? "s").toLowerCase()
  return Math.round(u === "ms" ? n : u.startsWith("m") ? n * 60_000 : n * 1000)
}

/** `source` as a condition; throws saying what's wrong, with the words it knows. */
export function parseCondition(source: string): Condition {
  const src = source.trim()
  if (!src) throw new Error("an empty condition: say what to wait for (click, type, shows \"Saved\", gone \"Loading\", changed, idle 1s)")
  let body = src, within: number | undefined
  const w = /\s+within\s+(\S+)\s*$/i.exec(body)
  if (w) {
    const ms = durationOf(w[1])
    if (ms === null) throw new Error(`"within ${w[1]}": give a time, as within 10s`)
    within = ms
    body = body.slice(0, w.index)
  }
  // (clauses split at and / or outside quotes)
  const any: Clause[][] = []
  let group: Clause[] = [], cur = ""
  const end = () => { const c = cur.trim(); cur = ""; if (!c) throw new Error(`"${src}": something is missing beside and / or`); group.push(clauseOf(c)) }
  for (const m of body.matchAll(/"(?:[^"\\]|\\.)*"|“[^”]*”|\S+|\s+/g)) {
    const t = m[0].toLowerCase()
    if (t === "and") { end(); continue }
    if (t === "or") { end(); any.push(group); group = []; continue }
    cur += m[0].replace(/^“|”$/g, '"')
  }
  end()
  any.push(group)
  return { any, ...(within !== undefined ? { within } : {}), source: src }
}
function clauseOf(c: string): Clause {
  const m = /^(\w+)\s*(.*)$/s.exec(c)!, word = m[1].toLowerCase(), rest = m[2].trim()
  if (word === "click" || word === "type") {
    const q = /^"((?:[^"\\]|\\.)*)"$/.exec(rest)
    if (rest && !q) throw new Error(`${word} takes the words of what, quoted: ${word} "Send"`)
    return { kind: word as "click", ...(q?.[1].trim() ? { text: q[1].trim() } : {}) }
  }
  if (word === "idle" || word === "after" || word === "wait") {
    const ms = durationOf(rest)
    if (ms === null) throw new Error(`"${word}" needs a time after it: ${word} 1s`)
    return { kind: word === "idle" ? "idle" : "after", ms }
  }
  try { return { kind: "check", check: parseCheck(word === "show" ? `shows ${rest}` : c) } } catch (e) {
    throw new Error(`${(e as Error).message}; or what happens: click, type, idle 1s, after 2s (and, or, within 10s)`)
  }
}

const q = (s: string) => JSON.stringify(s)
const secs = (ms: number) => (ms % 1000 ? `${ms}ms` : `${ms / 1000}s`)
export function clauseText(c: Clause): string {
  // (the ui model writes gone as not exists: said as written)
  if (c.kind === "check") return checkText(c.check).replace(/^not exists /, "gone ")
  if (c.kind === "click" || c.kind === "type") return c.text ? `${c.kind} ${q(c.text)}` : c.kind
  return `${c.kind} ${secs(c.ms)}`
}
/** A condition written back, as it parses. */
export const conditionText = (c: Condition) => `${c.any.map((g) => g.map(clauseText).join(" and ")).join(" or ")}${c.within !== undefined ? ` within ${secs(c.within)}` : ""}`

/** What the user did, as the helper or the app's window saw it: never what keys they pressed, only where. */
export type Input = { kind: "click" | "type"; t: number; label?: string; role?: string; x?: number; y?: number }
type Rect = { x: number; y: number; width: number; height: number }
/** What a watch reads the screen with. `holds` checks once (the ui model's check; `before`, the snapshot as the wait
 *  began, for changed); `snapshot` is what the screen says now; `where` is where the thing saying words is, for a click. */
export type Env = {
  now: () => number
  sleep: (ms: number) => Promise<void>
  holds: (c: Check, before?: string) => Promise<boolean>
  snapshot: () => Promise<string>
  inputs: (since: number) => Input[]
  where?: (text: string) => Promise<Rect | null>
}
export type Watched = { met: boolean; why: "met" | "timeout" | "stopped"; ms: number
  /** The group that was met, as written. */
  by?: string }

/** Whether an input's element is the one saying `text`: its words, or (a click) its point inside where those words are. */
export function inputOn(i: Input, text: string | undefined, at?: Rect | null) {
  if (!text) return true
  const want = normWords(text), got = normWords(i.label ?? "")
  if (got && (got === want || ` ${got} `.includes(` ${want} `))) return true
  return !!at && i.x !== undefined && i.y !== undefined && i.x >= at.x && i.x <= at.x + at.width && i.y >= at.y && i.y <= at.y + at.height
}

const STEP_MS = 250
/** What it waits for when no `within` says: long enough to read a step and do it. */
export const WAIT_MS = 5 * 60_000

/** Wait until `c` is met (polled every `every` ms), `within` (or `timeout`) passes, or `signal` aborts. */
export async function watch(c: Condition, env: Env, o: { every?: number; timeout?: number; signal?: AbortSignal } = {}): Promise<Watched> {
  const start = env.now(), limit = c.within ?? o.timeout ?? WAIT_MS, every = o.every ?? STEP_MS
  const all = c.any.flat()
  const needsSig = all.some((x) => x.kind === "idle" || (x.kind === "check" && x.check.kind === "changed"))
  const base = needsSig ? await env.snapshot() : undefined
  let sig = base, still = start
  /** Event clauses once seen stay met for the rest of the wait. */
  const seen = new Set<Clause>()
  const aims = new Map<string, Rect | null>()
  for (;;) {
    if (o.signal?.aborted) return { met: false, why: "stopped", ms: env.now() - start }
    const now = env.now(), ins = env.inputs(start)
    // (where the things clicked on are now, so a click on them counts by its point too)
    await Promise.all(all.flatMap((x) => (x.kind === "click" && x.text && env.where ? [env.where(x.text).then((b) => { if (b) aims.set(x.text!, b) }, () => {})] : [])))
    for (const x of all) if ((x.kind === "click" || x.kind === "type") && ins.some((i) => i.kind === x.kind && inputOn(i, x.text, x.text ? aims.get(x.text) : null))) seen.add(x)
    if (needsSig) {
      const s = await env.snapshot()
      if (s !== sig) { sig = s; still = now }
    }
    const lastIn = ins.reduce((m, i) => Math.max(m, i.t), 0)
    const quietSince = Math.max(still, lastIn)
    const met = async (x: Clause): Promise<boolean> => {
      if (x.kind === "check") return env.holds(x.check, base).catch(() => false)
      if (x.kind === "click" || x.kind === "type") return seen.has(x)
      if (x.kind === "after") return now - start >= x.ms
      return now - quietSince >= x.ms
    }
    for (const g of c.any) {
      const ok = await Promise.all(g.map(met))
      if (ok.every(Boolean)) return { met: true, why: "met", ms: env.now() - start, by: g.map(clauseText).join(" and ") }
    }
    if (env.now() - start >= limit) return { met: false, why: "timeout", ms: env.now() - start }
    await env.sleep(Math.min(every, Math.max(1, limit - (env.now() - start))))
  }
}

/** Test `c` once, now: the screen's states as they are; what happens over time (a click, changed, idle) can't be
 *  checked once and is said so. */
export async function check(c: Condition, env: Pick<Env, "holds">): Promise<{ met: boolean; by?: string; cant?: string[] }> {
  const once = (x: Clause) => x.kind === "check" && x.check.kind !== "changed"
  const cant = c.any.flat().filter((x) => !once(x)).map(clauseText)
  for (const g of c.any) {
    if (!g.every(once)) continue
    const ok = await Promise.all(g.map((x) => env.holds((x as Extract<Clause, { kind: "check" }>).check).catch(() => false)))
    if (ok.every(Boolean)) return { met: true, by: g.map(clauseText).join(" and ") }
  }
  return { met: false, ...(cant.length ? { cant: [...new Set(cant)] } : {}) }
}
