// What's over what in a vault window, and where the pointer goes: one owner, pure, so every rule is tested on Node.
// web.ts applies it; nothing else orders a window's views or passes the pointer to a page.
import { z } from "zod"

/** How the window's own page is over its pages: not (null), taking the pointer ("app": a menu, a drag), or letting it
 *  through to the page under it ("through": a toast, a sidebar peeking). */
export const RAISE = z.enum(["app", "through"]).nullable().catch(null)
export type Raise = z.infer<typeof RAISE>

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

const KEYS = ["alt", "control", "meta", "shift"] as const
const finite = (or: number) => z.number().catch(or)
/** The pointer over a page while the window's page lets it through, as the window's page sends it (`web:pointer`), at
 *  the page's CSS pixels from its corner. */
export const PASSED = z.object({
  type: z.enum(["mouseMove", "mouseDown", "mouseUp", "mouseLeave", "mouseWheel"]),
  x: finite(0), y: finite(0), dx: finite(0), dy: finite(0),
  button: z.enum(["left", "middle", "right"]).catch("left"),
  clickCount: finite(1).transform((n) => Math.max(1, Math.min(3, n))),
  keys: z.array(z.string()).catch([]).transform((ks) => KEYS.filter((k) => ks.includes(k))),
}).transform(({ type, ...rest }) => ({ kind: type, ...rest }))
export type Passed = z.infer<typeof PASSED>
export type PointerKind = Passed["kind"]
export type Button = Passed["button"]

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

export type PointerMove = { to: Pointer; do: PointerEffect[] }

export function pointerStep(s: Pointer, e: PointerEvent): PointerMove {
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

/** Where each kind of window the app floats over others sits: macOS's level, and its place among that level's. */
export const LEVELS = {
  /** A window the user keeps on top (ontop.ts). */
  onTop: ["floating", 0],
  /** A tab's card dragged past its window (dragghost.ts). */
  ghost: ["pop-up-menu", 0],
  /** The companion over the whole screen, take-over's border and cards. */
  screen: ["screen-saver", 0],
  /** A cursor's conversation, over the companion's screen. */
  panel: ["screen-saver", 1],
  /** The notch's island, over everything of the app's. */
  island: ["screen-saver", 2],
} as const satisfies Record<string, readonly ["floating" | "pop-up-menu" | "screen-saver", number]>
export type Layer = keyof typeof LEVELS

/** A box in a window's points, from its corner. */
export type Box = { x: number; y: number; width: number; height: number }

/** Whether an overlay window (screen points) takes the pointer at `at`: shown, answering, and over one of the boxes its
 *  page marks, or a press begun on one goes on (`pressing`) while it's over the window. Else it lets it through. */
export function overlayTakes(o: { win: Box; shown: boolean; stalled: boolean; boxes: readonly Box[]; at: { x: number; y: number }; pressing: boolean }) {
  const x = o.at.x - o.win.x, y = o.at.y - o.win.y
  if (!o.shown || o.stalled || x < 0 || y < 0 || x >= o.win.width || y >= o.win.height) return false
  return o.pressing || o.boxes.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height)
}
