import type { DrawnLine } from "@/core/anchors"
import type { Spot } from "@/components/filePlace"
import type { Mode } from "@/components/fileState"

type Ask = { spot: Spot | null; into: boolean; reveal: boolean }
type Run =
  | { kind: "waiting"; n: number; spot: Spot; into: boolean }
  | { kind: "placing"; n: number; into: boolean; waited: boolean }
  | { kind: "landed"; n: number; holding: boolean; waited: boolean }
type Open = "none" | "due" | "awaiting" | "focusing" | "took"

export type SwitchState = { ask: Ask | null; run: Run | null; open: Open; n: number }
export const SWITCH_START: SwitchState = { ask: null, run: null, open: "none", n: 0 }

export type LineAt = { line: number; find?: string; from?: DrawnLine; col: number }
export type Timer = "placed" | "late-shown" | "gave-up"
export const WAITS: Record<Timer, number> = { placed: 400, "late-shown": 800, "gave-up": 5000 }

type Events = {
  pick: { to: Mode; shown: Mode }
  elsewhere: { to: Mode; shown: Mode; follows: boolean }
  "edit-at": { shown: Mode; edit: Mode; at: LineAt }
  properties: { shown: Mode; to: Mode; hidden: boolean }
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

type Effects = {
  note: {}; keep: { from: Mode; to: Mode }; blur: {}; pick: { mode: Mode }
  "to-line": { at: LineAt; veil: boolean }; "cancel-restores": {}
  hide: {}; show: {}; resume: {}
  place: { n: number; spot: Spot; editor: boolean }
  arm: { n: number; timer: Timer }; disarm: { n: number; timer: Timer }
  land: { n: number }; halt: { n: number }
  frames: {}; "cancel-frames": {}; "await-placed": {}; "focus-open": {}; "end-open": {}
}
export type EffectOf<K extends keyof Effects> = { do: K } & Effects[K]
export type SwitchEffect = { [K in keyof Effects]: EffectOf<K> }[keyof Effects]
export type SwitchDoers = { [K in keyof Effects]: (fx: EffectOf<K>) => void }
export function doEffect<K extends keyof Effects>(doers: SwitchDoers, fx: EffectOf<K>) {
  const run: SwitchDoers[K] = doers[fx.do]
  run(fx)
}

export type SwitchStep = { state: SwitchState; effects: SwitchEffect[] }
type On<T extends keyof Events> = (s: SwitchState, e: EventOf<T>) => SwitchStep

const go = (state: SwitchState, ...effects: SwitchEffect[]): SwitchStep => ({ state, effects })
const placing = (s: SwitchState, run: Extract<Run, { kind: "waiting" }>, editor: boolean) =>
  go({ ...s, run: { kind: "placing", n: run.n, into: run.into, waited: true } },
    { do: "hide" }, { do: "arm", n: run.n, timer: "placed" }, { do: "place", n: run.n, spot: run.spot, editor })
const landing = (s: SwitchState, run: Run, holding: boolean): SwitchStep => {
  if (run.kind === "waiting") return go(s)
  if (run.kind === "landed") return go({ ...s, run: { ...run, holding: run.holding && holding } }, { do: "show" })
  const landed: SwitchStep = go({ ...s, run: { kind: "landed", n: run.n, holding, waited: run.waited } },
    { do: "disarm", n: run.n, timer: "placed" }, { do: "show" })
  if (run.into) landed.effects.push({ do: "land", n: run.n })
  return landed
}
const current = (s: SwitchState, n: number) => (s.run?.n === n ? s.run : null)

const pick: On<"pick"> = (s, e) => {
  if (e.to === e.shown) return go(s, { do: "pick", mode: e.to })
  const ask = { spot: null, into: e.to !== "read", reveal: s.ask?.reveal ?? false }
  return go({ ...s, ask }, { do: "note" }, { do: "keep", from: e.shown, to: e.to }, ...(e.to === "read" ? [{ do: "blur" } as const] : []), { do: "pick", mode: e.to })
}
const elsewhere: On<"elsewhere"> = (s, e) => {
  if (!e.follows || e.to === e.shown || s.ask?.spot) return go(s)
  return go({ ...s, ask: { spot: null, into: s.ask?.into ?? false, reveal: s.ask?.reveal ?? false } }, { do: "note" })
}
const editAt: On<"edit-at"> = (s, e) => {
  const opened = s.open === "awaiting" || s.open === "focusing"
  const effects: SwitchEffect[] = [...(opened ? [{ do: "end-open" } as const] : []), { do: "cancel-restores" }]
  if (e.shown !== "read") return go({ ...s, open: "took" }, ...effects, { do: "to-line", at: e.at, veil: false })
  const ask = { spot: s.ask?.spot ?? null, into: s.ask?.into ?? false, reveal: true }
  return go({ ...s, open: "took", ask }, ...effects, { do: "pick", mode: e.edit }, { do: "to-line", at: e.at, veil: true })
}
const properties: On<"properties"> = (s, e) =>
  (e.shown !== e.to && (e.shown === "read" || e.hidden) ? go(s, { do: "pick", mode: e.to }) : go(s))
const noted: On<"noted"> = (s, e) => (s.ask ? go({ ...s, ask: { ...s.ask, spot: e.spot } }) : go(s))

const shown: On<"shown"> = (s, e) => {
  const spot = s.ask && !s.ask.reveal ? s.ask.spot : null
  const into = !!s.ask?.into && e.canFocus && e.shown !== "read"
  const n = s.n + 1, base = { ...s, ask: null, n }
  if (!spot) return into ? go({ ...base, run: { kind: "landed", n, holding: false, waited: false } }, { do: "land", n }) : go({ ...base, run: null })
  if (e.coming) {
    return go({ ...base, run: { kind: "waiting", n, spot, into } },
      { do: "hide" }, { do: "arm", n, timer: "late-shown" }, { do: "arm", n, timer: "gave-up" })
  }
  return go({ ...base, run: { kind: "placing", n, into, waited: false } },
    { do: "hide" }, { do: "arm", n, timer: "placed" }, { do: "place", n, spot, editor: e.editor })
}
const left: On<"left"> = (s) => {
  const run = s.run, gone = { ...s, run: null }
  if (!run) return go(s)
  if (run.kind === "waiting") return go(gone, { do: "halt", n: run.n }, { do: "show" })
  if (run.kind === "placing") return go(gone, { do: "show" }, ...(run.into ? [{ do: "land", n: run.n } as const] : []), { do: "halt", n: run.n })
  return go(gone, ...(run.holding || run.waited ? [{ do: "show" } as const] : []), { do: "halt", n: run.n })
}
const ready: On<"ready"> = (s) => (s.run?.kind === "waiting" ? placing(s, s.run, true) : go(s, { do: "resume" }))
const gaveUp: On<"gave-up"> = (s, e) => {
  const run = current(s, e.n)
  return run?.kind === "waiting" ? placing(s, run, false) : go(s)
}
const placed: On<"placed"> = (s, e) => { const run = current(s, e.n); return run ? landing(s, run, true) : go(s) }
const held: On<"held"> = (s, e) => { const run = current(s, e.n); return run ? landing(s, run, false) : go(s) }
const lateShown: On<"late-shown"> = (s, e) => (current(s, e.n) ? go(s, { do: "show" }) : go(s))

const mounted: On<"mounted"> = (s, e) => (e.opens && s.open === "none" ? go({ ...s, open: "due" }, { do: "frames" }) : go(s))
const framed: On<"framed"> = (s, e) => {
  if (s.open !== "due") return go(s)
  return e.typing ? go({ ...s, open: "none" }) : go({ ...s, open: "awaiting" }, { do: "await-placed" })
}
const found: On<"found"> = (s) => (s.open === "awaiting" ? go({ ...s, open: "focusing" }, { do: "focus-open" }) : go(s))
const pressed: On<"pressed"> = (s) => (s.open === "awaiting" ? go({ ...s, open: "none" }, { do: "end-open" }) : go(s))
const unmounted: On<"unmounted"> = (s) => {
  if (s.open === "due") return go({ ...s, open: "none" }, { do: "cancel-frames" })
  return s.open === "awaiting" || s.open === "focusing" ? go({ ...s, open: "none" }, { do: "end-open" }) : go(s)
}

const table: { [T in keyof Events]: On<T> } = {
  pick, elsewhere, "edit-at": editAt, properties, noted, shown, left, ready, placed, held, "late-shown": lateShown, "gave-up": gaveUp,
  mounted, framed, found, pressed, unmounted,
}

export function stepSwitch<T extends keyof Events>(s: SwitchState, e: EventOf<T>): SwitchStep {
  const on: On<T> = table[e.type]
  return on(s, e)
}

export const switchLabel = (s: SwitchState) => [s.ask ? "asked" : "", s.run ? `${s.run.kind} ${s.run.n}` : "steady", s.open === "none" ? "" : `open ${s.open}`].filter(Boolean).join(", ")
