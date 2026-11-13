// A web page kept over its box (WebPage.tsx runs it): one look at a time, the hole in step with the page, and the page
// off the window behind its picture while its pane moves. Every change of it is a `placeStep`.

/** What covers a page: something that takes every click over it ("app": a menu, a dialog, a drag), only what lets the
 *  rest through ("through": a toast, the mini player, a sidebar peeking over it), or nothing (null). */
export type Cover = "app" | "through" | null
/** What a change may change of what covers a page: "hits", only its floats (in a toast or tooltip), or nothing (in the
 *  box, the status bar, or another pane, whose scroller clips it, but for a fixed element added there). */
export type Change = "hits" | "floats" | null

export type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number }
export const boxAt = (left: number, top: number, width: number, height: number): Box =>
  ({ left, top, width, height, right: left + width, bottom: top + height })
export const sameBox = (a: Box | null, b: Box | null) =>
  (a && b ? a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height : a === b)
export function overlap(a: Box, b: Box) {
  const l = Math.max(a.left, b.left), r = Math.min(a.right, b.right), t = Math.max(a.top, b.top), btm = Math.min(a.bottom, b.bottom)
  return l < r && t < btm ? boxAt(l, t, r - l, btm - t) : null
}

export type Where = { kind: "opened-by-web-open" } | { kind: "off" } | { kind: "over"; at: Box; radius: number }

type KeysAfter = { ifPageHasThem: boolean; take: boolean }
export type Phase =
  | { kind: "idle" } | { kind: "due" }
  | { kind: "moving"; n: number; to: Box | null; radius: number; holeShrunk: boolean; keys: KeysAfter; lookAgain: boolean }
  | { kind: "shooting"; motion: number; was: Box }
  | { kind: "pictured"; motion: number; sentOff: boolean }
  | { kind: "thawing"; n: number; holePainting: boolean }

export type Placement = { where: Where; phase: Phase; dirty: Change; lastHits: Cover; cover: Cover; hadKeysWhenHidden: boolean; lastMove: number }
export const placementStart = (hadKeysWhenHidden: boolean): Placement => ({ where: { kind: "opened-by-web-open" }, phase: { kind: "idle" },
  dirty: "hits", lastHits: null, cover: null, hadKeysWhenHidden, lastMove: 0 })

export type Seen = { area: Box; radius: number; error: boolean; passkey: boolean; held: boolean; keysFree: boolean; paneFocused: boolean }
const shows = (s: Seen) => !s.error && !s.passkey && !s.held && s.area.width >= 2 && s.area.height >= 2
export type Look = { hits: (area: Box) => Cover; floats: (area: Box) => Cover }

export type PlaceEvent =
  | { type: "changed"; change: Change } | { type: "tick" } | { type: "frame"; seen: Seen } | { type: "painted"; n: number }
  | { type: "placed"; n: number; to: Box | null; radius: number; shown: boolean; focused: boolean }
  | { type: "motion"; motion: number } | { type: "shot"; motion: number; ok: boolean } | { type: "drawn"; motion: number }
  | { type: "stopped"; motion: number; seen: Seen }
type EventOf<T extends PlaceEvent["type"]> = Extract<PlaceEvent, { type: T }>

export type PlaceEffect =
  | { do: "ask" } | { do: "cover"; cover: Cover } | { do: "hole"; at: Box | null; radius: number } | { do: "paint"; n: number }
  | { do: "place"; n: number; to: Box | null; radius: number } | { do: "focus" } | { do: "on-screen"; on: boolean } | { do: "spent" }
  | { do: "shoot"; motion: number } | { do: "picture"; was: Box } | { do: "off" } | { do: "unpicture" }
export type PlaceStep = { to: Placement; do: PlaceEffect[] }

const go = (to: Placement, ...fx: (PlaceEffect | false)[]): PlaceStep => ({ to, do: fx.filter((x): x is PlaceEffect => !!x) })
const overOf = (s: Placement) => (s.where.kind === "over" ? s.where : null)
const frozen = (p: Phase) => p.kind === "shooting" || p.kind === "pictured" || p.kind === "thawing"
const lookAgainNextFrame = (s: Placement, ...fx: PlaceEffect[]) => go({ ...s, phase: { kind: "due" }, dirty: "hits" }, ...fx, { do: "ask" })
const resume = (s: Placement) => (s.phase.kind === "idle" ? go({ ...s, phase: { kind: "due" } }, { do: "ask" })
  : s.phase.kind === "moving" ? go({ ...s, phase: { ...s.phase, lookAgain: true } }) : go(s))

function moveShrinkingHoleFirst(s: Placement, to: Box | null, radius: number, keys: KeysAfter, fx: PlaceEffect[]): PlaceStep {
  const at = overOf(s), both = at && to ? overlap(at.at, to) : null, n = s.lastMove + 1
  const moving = (holeShrunk: boolean): Placement => ({ ...s, lastMove: n, phase: { kind: "moving", n, to, radius, holeShrunk, keys, lookAgain: false } })
  if (at && !sameBox(both, at.at)) return go(moving(false), ...fx, { do: "hole", at: both, radius: at.radius }, { do: "paint", n })
  return go(moving(true), ...fx, { do: "place", n, to, radius })
}

function frame(s: Placement, seen: Seen, look: Look): PlaceStep {
  const { area, radius } = seen, show = shows(seen), at = overOf(s)
  const there = !!at && sameBox(at.at, area) && radius === at.radius
  if (!s.dirty && show && there) return go({ ...s, phase: { kind: "idle" } })
  const hits = s.dirty === "hits" || !sameBox(at?.at ?? null, area) ? (show ? look.hits(area) : null) : s.lastHits
  const cover = show ? hits ?? look.floats(area) : null
  const next: Placement = { ...s, phase: { kind: "idle" }, dirty: null, lastHits: hits, cover }
  const fx: PlaceEffect[] = [{ do: "cover", cover }]
  const backFromUnderAMenu = s.cover === "app" && cover !== "app"
  if (backFromUnderAMenu && seen.keysFree && seen.paneFocused) fx.push({ do: "focus" })
  const failedBeforeItsFirstLook = s.where.kind === "opened-by-web-open" && seen.error
  if (!show) return at || failedBeforeItsFirstLook ? moveShrinkingHoleFirst(next, null, 0, { ifPageHasThem: false, take: false }, fx) : go(next, ...fx)
  if (there) return go(next, ...fx)
  const ifPageHasThem = !at && seen.keysFree
  return moveShrinkingHoleFirst(next, area, radius, { ifPageHasThem, take: ifPageHasThem && (s.hadKeysWhenHidden || seen.paneFocused) }, fx)
}

function placed(s: Placement, e: EventOf<"placed">): PlaceStep {
  if (e.n !== s.lastMove) return go(s)
  const where: Where = e.shown && e.to ? { kind: "over", at: e.to, radius: e.radius } : { kind: "off" }, p = s.phase
  const fx: PlaceEffect[] = [{ do: "on-screen", on: where.kind === "over" }, { do: "hole", at: where.kind === "over" ? e.to : null, radius: e.radius }]
  const next = { ...s, where }
  if (p.kind === "thawing") return go({ ...next, phase: { ...p, holePainting: true } }, ...fx, { do: "paint", n: e.n })
  if (p.kind !== "moving" || p.n !== e.n) return go(next, ...fx)
  const focus = p.keys.take || (p.keys.ifPageHasThem && e.focused)
  const phase: Phase = p.lookAgain ? { kind: "due" } : { kind: "idle" }
  return go({ ...next, hadKeysWhenHidden: e.to ? false : s.hadKeysWhenHidden, phase },
    ...fx, focus && { do: "focus" }, !!e.to && s.hadKeysWhenHidden && { do: "spent" }, p.lookAgain && { do: "ask" })
}

function painted(s: Placement, e: EventOf<"painted">): PlaceStep {
  const p = s.phase
  if (p.kind === "moving" && p.n === e.n && !p.holeShrunk) return go({ ...s, phase: { ...p, holeShrunk: true } }, { do: "place", n: p.n, to: p.to, radius: p.radius })
  return p.kind === "thawing" && p.n === e.n && p.holePainting ? lookAgainNextFrame(s, { do: "unpicture" }) : go(s)
}

function motion(s: Placement, e: EventOf<"motion">): PlaceStep {
  const p = s.phase, at = overOf(s)
  if (p.kind === "pictured" || p.kind === "thawing") return go({ ...s, phase: { kind: "pictured", motion: e.motion, sentOff: p.kind === "pictured" && p.sentOff } })
  if (!at) return go(s)
  // (the window over the live page till its picture's up: a sidebar coming in slides over it, not under)
  const cover = s.cover ?? "through"
  return go({ ...s, cover, phase: { kind: "shooting", motion: e.motion, was: at.at } }, !s.cover && { do: "cover", cover }, { do: "shoot", motion: e.motion })
}

function shot(s: Placement, e: EventOf<"shot">): PlaceStep {
  const p = s.phase
  if (p.kind !== "shooting" || p.motion !== e.motion) return go(s)
  if (!e.ok) return lookAgainNextFrame(s)
  return go({ ...s, phase: { kind: "pictured", motion: p.motion, sentOff: false } }, { do: "picture", was: p.was }, { do: "hole", at: null, radius: 0 })
}

function drawn(s: Placement, e: EventOf<"drawn">): PlaceStep {
  const p = s.phase
  if (p.kind !== "pictured" || p.motion !== e.motion || p.sentOff) return go(s)
  return go({ ...s, lastMove: s.lastMove + 1, where: { kind: "off" }, cover: null, phase: { ...p, sentOff: true } }, { do: "off" }, { do: "cover", cover: null })
}

function stopped(s: Placement, e: EventOf<"stopped">): PlaceStep {
  const p = s.phase
  if (p.kind === "shooting" && p.motion === e.motion) return lookAgainNextFrame(s)
  if (p.kind !== "pictured" || p.motion !== e.motion) return go(s)
  if (!shows(e.seen)) return lookAgainNextFrame(s, { do: "unpicture" })
  const n = s.lastMove + 1
  return go({ ...s, lastMove: n, phase: { kind: "thawing", n, holePainting: false } }, { do: "place", n, to: e.seen.area, radius: e.seen.radius })
}

export function placeStep(s: Placement, e: PlaceEvent, look: Look): PlaceStep {
  switch (e.type) {
    case "changed": return !e.change || s.dirty === "hits" ? go(s) : resume({ ...s, dirty: e.change })
    case "tick": return frozen(s.phase) ? go(s) : resume(s)
    case "frame": return s.phase.kind === "due" ? frame(s, e.seen, look) : go(s)
    case "painted": return painted(s, e)
    case "placed": return placed(s, e)
    case "motion": return motion(s, e)
    case "shot": return shot(s, e)
    case "drawn": return drawn(s, e)
    case "stopped": return stopped(s, e)
    default: { const never: never = e; return never }
  }
}

const heartbeat = (p: Phase) => p.kind === "idle" || p.kind === "due"
export const worthTracing = (a: Placement, b: Placement) => a.where.kind !== b.where.kind
  || (a.phase.kind !== b.phase.kind && !(heartbeat(a.phase) && heartbeat(b.phase)))
