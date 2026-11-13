import type { DrawnLine } from "@/core/anchors"
import type { Spot } from "@/components/filePlace"
import type { Mode } from "@/components/fileState"

type Ask = { spot: Spot | null; into: boolean; reveal: boolean }
type Run = { kind: "waiting" | "placing" | "landed"; n: number; spot: Spot | null; into: boolean; editor: boolean; waited: boolean; holding: boolean }
type Open = "none" | "due" | "awaiting" | "focusing" | "took"
export type SwitchState = { ask: Ask | null; run: Run | null; open: Open; n: number }
export const SWITCH_START: SwitchState = { ask: null, run: null, open: "none", n: 0 }

export type LineAt = { line: number; find?: string; from?: DrawnLine; col: number }
export type Timer = "placed" | "late-shown" | "gave-up"
export const WAITS: Record<Timer, number> = { placed: 400, "late-shown": 800, "gave-up": 5000 }

type Events = {
  pick: { to: Mode; shown: Mode }
  elsewhere: { to: Mode; shown: Mode; follows: boolean }
  "edit-at": { to: Mode; shown: Mode; at: LineAt }
  properties: { to: Mode; shown: Mode; hidden: boolean }
  noted: { spot: Spot }
  shown: { shown: Mode; canFocus: boolean; editor: boolean; coming: boolean }
  left: {}
  ready: {}
  placed: { n: number }
  held: { n: number }
  "late-shown": { n: number }
  "gave-up": { n: number }
  mounted: { opens: boolean }
  framed: { typing: boolean }
  found: {}
  pressed: {}
  unmounted: {}
}
type EventOf<T extends keyof Events> = { type: T } & Events[T]
export type SwitchEvent = { [T in keyof Events]: EventOf<T> }[keyof Events]

export type SwitchEffect = "note" | "leave" | "blur" | "pick" | "cancel" | "veil" | "line" | "show" | "wait" | "place" | "shown" | "land" | "halt"
  | "resume" | "frames" | "unframe" | "await" | "focus" | "unopen"
export type SwitchStep = { state: SwitchState; effects: SwitchEffect[] }
type On<T extends keyof Events> = (s: SwitchState, e: EventOf<T>) => SwitchStep

const go = (state: SwitchState, ...effects: (SwitchEffect | false)[]): SwitchStep =>
  ({ state, effects: effects.filter((x): x is SwitchEffect => !!x) })
const current = (s: SwitchState, n: number) => (s.run?.n === n ? s.run : null)
const placing = (s: SwitchState, run: Run, editor: boolean) => go({ ...s, run: { ...run, kind: "placing", editor, waited: true } }, "place")
const landing = (s: SwitchState, n: number, holding: boolean) => {
  const run = current(s, n)
  if (!run || run.kind === "waiting") return go(s)
  if (run.kind === "landed") return go({ ...s, run: { ...run, holding: run.holding && holding } }, "show")
  return go({ ...s, run: { ...run, kind: "landed", holding } }, "shown", run.into && "land")
}

const table: { [T in keyof Events]: On<T> } = {
  pick: (s, e) => (e.to === e.shown ? go(s, "pick")
    : go({ ...s, ask: { spot: null, into: e.to !== "read", reveal: !!s.ask?.reveal } }, "note", "leave", e.to === "read" && "blur", "pick")),
  elsewhere: (s, e) => (!e.follows || e.to === e.shown || s.ask?.spot ? go(s)
    : go({ ...s, ask: { spot: null, into: !!s.ask?.into, reveal: !!s.ask?.reveal } }, "note")),
  "edit-at": (s, e) => {
    const unopen = (s.open === "awaiting" || s.open === "focusing") && "unopen"
    if (e.shown !== "read") return go({ ...s, open: "took" }, unopen, "cancel", "line")
    return go({ ...s, open: "took", ask: { spot: s.ask?.spot ?? null, into: !!s.ask?.into, reveal: true } }, unopen, "cancel", "pick", "veil", "line")
  },
  properties: (s, e) => go(s, e.shown !== e.to && (e.shown === "read" || e.hidden) && "pick"),
  noted: (s, e) => go(s.ask ? { ...s, ask: { ...s.ask, spot: e.spot } } : s),
  shown: (s, e) => {
    const spot = s.ask?.reveal ? null : s.ask?.spot ?? null, into = !!s.ask?.into && e.canFocus && e.shown !== "read", n = s.n + 1
    const run: Run = { kind: "placing", n, spot, into, editor: e.editor, waited: false, holding: false }, base = { ...s, ask: null, n }
    if (!spot) return into ? go({ ...base, run: { ...run, kind: "landed" } }, "land") : go({ ...base, run: null })
    return e.coming ? go({ ...base, run: { ...run, kind: "waiting" } }, "wait") : go({ ...base, run }, "place")
  },
  left: (s) => {
    const run = s.run, gone = { ...s, run: null }
    if (!run) return go(s)
    if (run.kind === "waiting") return go(gone, "halt", "show")
    if (run.kind === "placing") return go(gone, "show", run.into && "land", "halt")
    return go(gone, (run.holding || run.waited) && "show", "halt")
  },
  ready: (s) => (s.run?.kind === "waiting" ? placing(s, s.run, true) : go(s, "resume")),
  "gave-up": (s, e) => { const run = current(s, e.n); return run?.kind === "waiting" ? placing(s, run, false) : go(s) },
  placed: (s, e) => landing(s, e.n, true),
  held: (s, e) => landing(s, e.n, false),
  "late-shown": (s, e) => go(s, !!current(s, e.n) && "show"),
  mounted: (s, e) => (e.opens && s.open === "none" ? go({ ...s, open: "due" }, "frames") : go(s)),
  framed: (s, e) => (s.open !== "due" ? go(s) : e.typing ? go({ ...s, open: "none" }) : go({ ...s, open: "awaiting" }, "await")),
  found: (s) => (s.open === "awaiting" ? go({ ...s, open: "focusing" }, "focus") : go(s)),
  pressed: (s) => (s.open === "awaiting" ? go({ ...s, open: "none" }, "unopen") : go(s)),
  unmounted: (s) => (s.open === "due" ? go({ ...s, open: "none" }, "unframe")
    : s.open === "awaiting" || s.open === "focusing" ? go({ ...s, open: "none" }, "unopen") : go(s)),
}

export function stepSwitch<T extends keyof Events>(s: SwitchState, e: EventOf<T>): SwitchStep {
  const on: On<T> = table[e.type]
  return on(s, e)
}

export const switchLabel = (s: SwitchState) => [s.ask && "asked", s.run ? `${s.run.kind} ${s.run.n}` : "steady", s.open !== "none" && `open ${s.open}`].filter(Boolean).join(", ")
