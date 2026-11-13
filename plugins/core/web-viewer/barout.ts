/** How long the pointer rests at the page's top or the pane's before the bar comes (a quick pass doesn't bring it), and
 *  how long it's been off the bar before it goes. */
export const REST_MS = 60, LINGER_MS = 350

/** Both can hold: the page's word on its top comes later than the window's on the pane's. */
type At = { page: boolean; pane: boolean }
export type Bar = At & { kind: "in" | "resting" | "out" | "lingering" }
export const barStart: Bar = { kind: "in", page: false, pane: false }

export type Pressed = "top" | "top-control" | "bar" | "elsewhere"
export type BarEvent =
  | { type: "page"; at: boolean; now: boolean; left: boolean } | { type: "over"; paneTop: boolean }
  | { type: "move"; onIt: boolean } | { type: "press"; on: Pressed } | { type: "waited"; menu: boolean }
export type BarEffect = { do: "show"; out: boolean } | { do: "wait"; ms: number } | { do: "stop" }
export type BarStep = { to: Bar; do: BarEffect[] }

const go = (to: Bar, ...fx: (BarEffect | false)[]): BarStep => ({ to, do: fx.filter((x): x is BarEffect => !!x) })
const stop: BarEffect = { do: "stop" }
const out = (s: Bar, timing: boolean): BarStep => go({ ...s, kind: "out" }, timing && stop, { do: "show", out: true })
const goIn = (s: Bar, timing: boolean): BarStep => go({ ...s, kind: "in" }, timing && stop, { do: "show", out: false })

function ask(s: Bar, now: boolean): BarStep {
  if (s.kind === "out" || s.kind === "lingering") return go(s)
  if (!s.page && !s.pane) return s.kind === "resting" ? go({ ...s, kind: "in" }, stop) : go(s)
  if (now) return out(s, s.kind === "resting")
  return s.kind === "resting" ? go(s) : go({ ...s, kind: "resting" }, { do: "wait", ms: REST_MS })
}

function move(s: Bar, onIt: boolean): BarStep {
  if (s.kind === "out") return onIt ? go(s) : go({ ...s, kind: "lingering" }, { do: "wait", ms: LINGER_MS })
  return s.kind === "lingering" && onIt ? go({ ...s, kind: "out" }, stop) : go(s)
}

function press(s: Bar, on: Pressed): BarStep {
  if (s.kind === "in" || s.kind === "resting") return on === "top" ? out(s, s.kind === "resting") : go(s)
  return on === "elsewhere" ? goIn(s, s.kind === "lingering") : go(s)
}

function waited(s: Bar, menu: boolean): BarStep {
  if (s.kind === "resting") return out(s, false)
  if (s.kind !== "lingering") return go(s)
  return menu ? go({ ...s, kind: "out" }) : goIn(s, false)
}

export function barStep(s: Bar, e: BarEvent): BarStep {
  switch (e.type) {
    case "page": return ask({ ...s, page: e.at, pane: !e.at && !e.left ? false : s.pane }, e.at && e.now)
    case "over": return ask({ ...s, pane: e.paneTop, page: e.paneTop ? false : s.page }, false)
    case "move": return move(s, e.onIt)
    case "press": return press(s, e.on)
    case "waited": return waited(s, e.menu)
    default: { const never: never = e; return never }
  }
}
