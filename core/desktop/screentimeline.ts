// The screen's timeline's rules (electron/timeline.ts keeps it, the screen plugin reads it): the last seconds on one clock, in memory only,
// read by a time range or from when they said something. No Electron: the tests read it.
export type Rect = { x: number; y: number; width: number; height: number }
/** A thing acted on, as the companion's ui model reads it: its role, words, frame and the labelled things it's in. */
export type El = { role: string; label: string; frame: Rect; inside?: { role: string; label: string }[] }
export type Happened = { t: number } & (
  | { kind: "pointer"; x: number; y: number }
  | { kind: "app"; app: string; name: string; title?: string; private?: boolean }
  /** `el`: the thing it was on; `window`: its window's frame then. */
  | { kind: "click"; x: number; y: number; under?: string; el?: El; window?: Rect }
  /** A shortcut, or Return, Tab or Esc: never a character typed. */
  | { kind: "key"; key: string }
  /** What a field says once typing in it settled (never a password's, or what looks like a key). */
  | { kind: "field"; el: El; value: string; window?: Rect }
  | { kind: "said"; text: string }
  | { kind: "box"; rect: Rect | null }
  /** The thing the pointer rested on as they said something (a QA walk's item): its role, name and what it's in. */
  | { kind: "thing"; x: number; y: number; thing: string })
export type Kind = Happened["kind"]
export const KINDS: Kind[] = ["pointer", "app", "click", "key", "field", "said", "box", "thing"]
/** Why nothing's kept, as the desktop app says it when the timeline is off; an agent asking then offers to turn it on
 *  (off is the user's choice, the default; a dead end never is). */
export const OFF_WHY = "the timeline is off: it's kept only while the companion is on and its setting timeline (Keep the last 30 s of screen) is"
export const OFFER_ON = `off by the user's choice, so tell them in one short line and offer to turn it on (a button, or their spoken yes); on their yes: vau screen keep. It keeps from then on, never what came before: say so`
export const offWhy = (why: string) => (why === OFF_WHY ? `${why}; ${OFFER_ON}` : why)
/** How far back it reaches (ms), and the most it keeps: bounded however busy. What was done reaches further (ACTS_MS):
 *  "make what I just did a skill" needs its minutes, and it's small. */
export const KEEP_MS = 30_000, ACTS_MS = 5 * 60_000, MOST = 6000
export const ACTS: ReadonlySet<Kind> = new Set(["app", "click", "key", "field", "said"])

/** What's kept at `now`: the last KEEP_MS, what was done for ACTS_MS, at most MOST (the app in front then always: what
 *  came before is known). */
export function kept(h: Happened[], now: number): Happened[] {
  const from = now - KEEP_MS, acts = now - ACTS_MS, i = h.findIndex((e) => e.t >= acts)
  const lastApp = h.slice(0, i < 0 ? h.length : i).findLast((e) => e.kind === "app")
  const recent = (i < 0 ? [] : h.slice(i)).filter((e) => e.t >= from || ACTS.has(e.kind))
  return [...(lastApp ? [{ ...lastApp, t: acts }] : []), ...recent].slice(-MOST)
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
/** A stretch of it: `last` seconds, `from`/`to` (ms since 1970), or from when they last said `said` (its key-down) on. */
export type Query = { last?: number; from?: number; to?: number; said?: string; kinds?: Kind[] }
export function rangeOf(h: Happened[], q: Query, now: number): { from: number; to: number } | { why: string } {
  const to = Math.min(now, q.to ?? now), oldest = now - (q.kinds?.length && q.kinds.every((k) => ACTS.has(k)) ? ACTS_MS : KEEP_MS)
  if (q.said?.trim()) {
    const w = words(q.said), hit = h.findLast((e) => e.kind === "said" && e.t <= to && ` ${words(e.text)} `.includes(` ${w} `))
    if (!hit) return { why: `nothing said like "${q.said.trim()}" in the last ${(now - oldest) / 1000} s` }
    return { from: hit.t, to }
  }
  const from = q.from ?? (q.last ? to - q.last * 1000 : oldest)
  if (from >= to) return { why: "from is after to" }
  return { from: Math.max(oldest, from), to }
}

/** What happened in `r` (only `kinds`; the app in front as it began first), the pointer thinned to a point every quarter second. */
export function within(h: Happened[], r: { from: number; to: number }, kinds: Kind[] = KINDS): Happened[] {
  let lastPointer = -Infinity
  // (the app in front as it began: what came before is known)
  const was = kinds.includes("app") ? h.findLast((e) => e.kind === "app" && e.t < r.from) : undefined
  return [...(was ? [{ ...was, t: r.from }] : []), ...h.filter((e) => {
    if (e.t < r.from || e.t > r.to || !kinds.includes(e.kind)) return false
    if (e.kind !== "pointer") return true
    if (e.t - lastPointer < 250) return false
    lastPointer = e.t
    return true
  })]
}

/** One line each, its time from the stretch's start. */
export function timelineLines(h: Happened[], from: number) {
  const at = (t: number) => `[${((t - from) / 1000).toFixed(1)} s]`
  return h.map((e) => {
    if (e.kind === "pointer") return `${at(e.t)} pointer at ${Math.round(e.x)},${Math.round(e.y)}`
    if (e.kind === "app") return `${at(e.t)} ${e.private ? "a private app" : `${e.name}${e.title ? ` "${e.title}"` : ""}`} in front`
    if (e.kind === "click") return `${at(e.t)} clicked at ${Math.round(e.x)},${Math.round(e.y)}${e.el ? `: ${e.el.role} ${JSON.stringify(e.el.label)}${e.el.inside?.[0] ? ` in ${JSON.stringify(e.el.inside[0].label)}` : ""}` : e.under ? `: ${e.under}` : ""}`
    if (e.kind === "said") return `${at(e.t)} said ${JSON.stringify(e.text)}`
    if (e.kind === "thing") return `${at(e.t)} pointing at ${e.thing} (${Math.round(e.x)},${Math.round(e.y)})`
    if (e.kind === "key") return `${at(e.t)} pressed ${e.key}`
    if (e.kind === "field") return `${at(e.t)} ${e.el.role} ${JSON.stringify(e.el.label)} says ${JSON.stringify(e.value)}`
    return `${at(e.t)} ${e.rect ? `box at ${e.rect.x},${e.rect.y} ${e.rect.width}×${e.rect.height}` : "box closed"}`
  })
}
