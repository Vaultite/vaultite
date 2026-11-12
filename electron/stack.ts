// What's over what in a vault window, and where the pointer goes: one owner, pure, so every rule is tested on Node.
// web.ts applies it; nothing else orders a window's views or passes the pointer to a page.

/** How the window's own page is over its pages: not (null), taking the pointer ("app": a menu, a drag), or letting it
 *  through to the page under it ("through": a toast, a sidebar peeking). */
export type Raise = "app" | "through" | null
export const raiseOf = (x: unknown): Raise => (x === "app" || x === "through" ? x : null)

/** A view of a vault window: its own page, a page (`full`: full screen in the window), or chrome drawn over all of
 *  them (an extension's popup, a top strip). */
export type Role = "window" | "page" | "full" | "chrome"

/** The window's views in the order its state makes, whatever came before: its pages (`top` over the others), its own
 *  page over them while raised, pages in full screen over that, then chrome. `top` is a page, in the window or not yet. */
export function stackOrder<V>(views: readonly V[], roleOf: (v: V) => Role, raise: Raise, top?: V): V[] {
  const group = (role: Role) => {
    const vs = views.filter((v) => v !== top && roleOf(v) === role)
    if (top !== undefined && roleOf(top) === role) vs.push(top)
    return vs
  }
  const win = views.filter((v) => roleOf(v) === "window"), pages = group("page")
  return [...(raise ? [...pages, ...win] : [...win, ...pages]), ...group("full"), ...group("chrome")]
}

export type PointerKind = "mouseMove" | "mouseDown" | "mouseUp" | "mouseLeave" | "mouseWheel"
export type Button = "left" | "middle" | "right"
export type Key = "alt" | "control" | "meta" | "shift"
/** The pointer over a page while the window's page lets it through, at the page's CSS pixels from its corner. */
export type Passed = { kind: PointerKind; x: number; y: number; button: Button; clickCount: number; dx: number; dy: number; keys: Key[] }

const KINDS: readonly PointerKind[] = ["mouseMove", "mouseDown", "mouseUp", "mouseLeave", "mouseWheel"]
const KEYS: readonly Key[] = ["alt", "control", "meta", "shift"]
const isKind = (x: unknown): x is PointerKind => KINDS.some((k) => k === x)
const isKey = (x: unknown): x is Key => KEYS.some((k) => k === x)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** What the window's page sent (`web:pointer`), or null when it isn't a pointer event. */
export function passedOf(m: unknown): Passed | null {
  if (!m || typeof m !== "object" || !("type" in m) || !isKind(m.type)) return null
  const field = (k: string): unknown => Reflect.get(m, k)
  const button = field("button"), keys = field("keys")
  return { kind: m.type, x: num(field("x")), y: num(field("y")), button: button === "right" || button === "middle" ? button : "left",
    clickCount: Math.max(1, Math.min(3, num(field("clickCount")))), dx: num(field("dx")), dy: num(field("dy")),
    keys: Array.isArray(keys) ? KEYS.filter((k) => keys.some((x) => isKey(x) && x === k)) : [] }
}

/** A window's pointer: how its page is raised, whether a pinch goes to the page under the pointer, and the buttons a
 *  passed press holds down in each page (by id), as the DevTools protocol's bits. */
export type Pointer = { raise: Raise; pinch: boolean; held: ReadonlyMap<number, number> }
export const NO_POINTER: Pointer = { raise: null, pinch: false, held: new Map() }

export type PointerEvent =
  | { type: "raise"; how: Raise }
  | { type: "pass"; page: number; kind: PointerKind; button: Button }
  /** The page ended: what it held goes. */
  | { type: "gone"; page: number }

/** `hover`: the pointer told to the window's page where it rests, so it says what's under it. `send`: with the buttons
 *  held after it; `leave` has no protocol event, so it goes as a plain one. */
export type PointerEffect =
  | { do: "restack" }
  | { do: "pinch"; on: boolean }
  | { do: "hover" }
  | { do: "send"; buttons: number }
  | { do: "leave" }

const BITS: Record<Button, number> = { left: 1, right: 2, middle: 4 }

export function pointerStep(s: Pointer, e: PointerEvent): { to: Pointer; do: PointerEffect[] } {
  const pinch = (on: boolean): PointerEffect[] => (s.pinch === on ? [] : [{ do: "pinch", on }])
  const holding = (page: number, buttons: number) => {
    const held = new Map(s.held)
    if (buttons) held.set(page, buttons); else held.delete(page)
    return held
  }
  switch (e.type) {
    case "raise":
      return { to: { ...s, raise: e.how, pinch: false }, do: [{ do: "restack" }, ...pinch(false), ...(e.how === "through" ? [{ do: "hover" } as const] : [])] }
    case "gone":
      return { to: { ...s, held: holding(e.page, 0) }, do: [] }
    case "pass": {
      const was = s.held.get(e.page) ?? 0
      // (a press passed while through is let go even once the window dropped under the page: else it's held for good)
      if (s.raise !== "through" && !(was && (e.kind === "mouseUp" || e.kind === "mouseMove"))) return { to: s, do: [] }
      const pinched = s.raise === "through" ? e.kind !== "mouseLeave" : s.pinch
      const to = { ...s, pinch: pinched }
      if (e.kind === "mouseLeave") return { to: { ...to, held: holding(e.page, 0) }, do: [...pinch(pinched), { do: "leave" }] }
      const bit = BITS[e.button], now = e.kind === "mouseDown" ? was | bit : e.kind === "mouseUp" ? was & ~bit : was
      return { to: { ...to, held: holding(e.page, now) }, do: [...pinch(pinched), { do: "send", buttons: now }] }
    }
  }
}
