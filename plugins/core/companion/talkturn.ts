export type Waiting<A> = { ask: A; again: boolean }
export type Cut = "withdrawn" | "stopped" | "lost"
export type Turn<A> = { n: number; asks: A[]; again: boolean; acted: boolean; said: boolean; shown: boolean; missed: boolean; did: string
  wrote: boolean; passed: boolean; cut: Cut | null }

export type Phase<A> =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "turn" }
  | { kind: "making"; asks: Waiting<A>[] }
  | { kind: "starting"; handed: boolean }

export type TurnState<A> = { phase: Phase<A>; waiting: Waiting<A>[]; turn: Turn<A>; round: number }

type Events<A, T> = {
  asked: { ask: A }
  free: {}
  pressed: { cold: boolean }
  made: {}
  unmade: { why: string }
  started: { news: News<T> | null }
  "start-failed": { why: string }
  "send-failed": { round: number; why: string }
  busy: {}
  ended: { error: string; words: { said: string; tags: T[] } | null; acting: boolean }
  gone: {}
  settled: { n: number }
  acted: { op?: string }
  wrote: { said: boolean }
  drew: { n: number; ok: boolean }
  answered: { text: string; error: boolean; ends: boolean }
  escaped: {}
  withdrawn: {}
  dropped: { ask: A }
  stopped: {}
}
export type EventKind = keyof Events<unknown, unknown>
export type TurnEvent<A, T = unknown, K extends EventKind = EventKind> = { [P in K]: { type: P } & Events<A, T>[P] }[K]
export type News<T> = TurnEvent<unknown, T, "busy" | "ended" | "gone">

type Effects<A, T> = {
  begin: { asks: A[] }
  send: { asks: A[]; round: number }
  handed: { asks: A[] }
  say: { text: string }
  tags: { tags: T[]; said: string }
  judge: { n: number }
  thinking: {}
  watching: { seen: boolean }
  done: {}
  note: { why: string }
  lose: {}
  interrupt: {}
  pump: {}
  "go-on": {}
}
export type EffectKind = keyof Effects<unknown, unknown>
export type Effect<A, T = unknown, K extends EffectKind = EffectKind> = { [P in K]: { do: P } & Effects<A, T>[P] }[K]

export type World = { on: () => boolean; fresh: () => boolean }

export const SHOWS = new Set(["handoff", "open", "act", "highlight", "pass"])
export const NOT_SHOWN = "I couldn't mark that on your screen. Ask me again?"
const LOST = "I lost my session there, ask me again?", OFF = "My session's off right now, so I couldn't answer that."

const blank = <A>(n: number, asks: A[] = [], again = false): Turn<A> =>
  ({ n, asks, again, acted: false, said: false, shown: false, missed: false, did: "", wrote: false, passed: false, cut: null })
export const start = <A>(): TurnState<A> => ({ phase: { kind: "idle" }, waiting: [], turn: blank(0), round: 0 })

export const handed = (s: TurnState<unknown>) => s.phase.kind === "turn" || (s.phase.kind === "starting" && s.phase.handed)
export const turning = (s: TurnState<unknown>) => handed(s) || s.phase.kind === "busy"
export const owes = (s: TurnState<unknown>) => s.waiting.length > 0 || s.phase.kind === "making" || (handed(s) && !s.turn.passed)
const unanswered = (t: Turn<unknown>) => !t.acted && !t.shown && !t.cut
const silent = (t: Turn<unknown>) => (!t.acted || (t.missed && !t.said)) && !t.shown && !t.cut
export const withdrawing = <A>(s: TurnState<A>): A[] => (s.waiting.length ? [s.waiting.at(-1)!.ask] : s.turn.asks)
export const drops = <A extends Ask>(s: TurnState<A>, ask: A) =>
  s.waiting.some((w) => w.ask === ask) || (handed(s) && s.turn.asks.includes(ask) && s.turn.asks.every((x) => x.tour))

export function quietly(did: string) {
  const x = (/^.*?(?:[.!?](?=\s|$)|$)/.exec(did.split("\n")[0].replace(/\s*\([^)]*\)/g, ""))?.[0] ?? "").replace(/\s+/g, " ").trim()
  return x && x.length <= 200 ? x : "I didn't get to an answer on that one. Ask me again?"
}

type Ask = { tour?: boolean }
type Out<A, T> = { to: TurnState<A>; do: Effect<A, T>[] }
type Handlers = { [K in EventKind]: <A extends Ask, T>(s: TurnState<A>, e: TurnEvent<A, T, K>, w: World) => Out<A, T> }

const go = <A, T>(to: TurnState<A>, ...d: Effect<A, T>[]): Out<A, T> => ({ to, do: d })
const plus = <A, T>(a: Out<A, T>, ...d: Effect<A, T>[]): Out<A, T> => ({ to: a.to, do: [...a.do, ...d] })
const chain = <A, T>(a: Out<A, T>, f: (s: TurnState<A>) => Out<A, T>): Out<A, T> => { const b = f(a.to); return { to: b.to, do: [...a.do, ...b.do] } }
const pump = <A, T>(a: Out<A, T>) => plus(a, { do: "pump" })
const idle = <A>(x: TurnState<A>): TurnState<A> => ({ ...x, phase: { kind: "idle" } })
const between = (x: TurnState<unknown>) => x.phase.kind === "making" || x.phase.kind === "starting"
const cut = <A>(x: TurnState<A>, c: Cut): TurnState<A> => ({ ...x, turn: { ...x.turn, cut: c } })
const unhand = <A>(x: TurnState<A>): TurnState<A> =>
  (x.phase.kind === "making" ? x : x.phase.kind === "starting" ? { ...x, phase: { ...x.phase, handed: false } } : idle(x))
const say = <A, T>(x: TurnState<A>, text: string, more: Partial<Turn<A>> = {}): Out<A, T> =>
  go({ ...x, turn: { ...x.turn, ...more, acted: true, said: true } }, { do: "say", text })
const give = <A>(x: TurnState<A>, ms: Waiting<A>[]): TurnState<A> =>
  ({ ...x, turn: blank(x.turn.n + 1, ms.map((m) => m.ask), ms.some((m) => m.again)), round: x.round + 1 })
const handedOf = <A>(x: TurnState<A>): Waiting<A>[] => x.turn.asks.map((ask) => ({ ask, again: x.turn.again }))
const ended = <A, T>(x: TurnState<A>): Out<A, T> =>
  go(idle(x), { do: "watching", seen: !(x.turn.acted && (x.turn.said || !x.turn.shown)) }, { do: "done" })

function next<A, T>(x: TurnState<A>, w: World): Out<A, T> {
  if (x.phase.kind !== "idle") return go(x)
  if (!w.on()) return x.waiting.length ? failed({ ...x, waiting: [] }, x.waiting, "the Talk key's session is off", w) : go(x)
  if (!x.waiting.length) return go(x)
  const ms = x.waiting
  if (w.fresh()) return go({ ...x, waiting: [], phase: { kind: "making", asks: ms } }, { do: "begin", asks: ms.map((m) => m.ask) })
  const g = give({ ...x, waiting: [], phase: { kind: "turn" } }, ms)
  return go(g, { do: "handed", asks: g.turn.asks }, { do: "send", asks: g.turn.asks, round: g.round })
}

function failed<A, T>(x: TurnState<A>, ms: Waiting<A>[], why: string, w: World): Out<A, T> {
  const y = { ...x, round: x.round + 1 }
  if (!ms.length) return go(y, { do: "note", why })
  if (w.on() && !ms.some((m) => m.again)) {
    const again = ms.map((m) => ({ ask: m.ask, again: true }))
    return go({ ...cut(y, "lost"), waiting: [...again, ...y.waiting] }, { do: "note", why }, { do: "lose" }, { do: "pump" })
  }
  const r = say<A, T>(y, w.on() ? LOST : OFF, { asks: ms.map((m) => m.ask) })
  const lose: Effect<A, T>[] = w.on() ? [{ do: "lose" }] : []
  return { to: r.to, do: [{ do: "note", why }, ...r.do, { do: "watching", seen: false }, ...lose, { do: "pump" }] }
}

function lost<A, T>(x: TurnState<A>, to: TurnState<A>, why: string, w: World): Out<A, T> {
  if (!handed(x)) return go(to, { do: "note", why })
  if (unanswered(x.turn)) return failed(to, handedOf(x), why, w)
  return chain<A, T>(go(to, { do: "note", why }), ended)
}

function answer<A, T>(out: Out<A, T>, t: Turn<A>, n: TurnEvent<A, T, "ended">): Out<A, T> {
  const words = !t.acted && !t.wrote && t.cut !== "withdrawn" ? n.words : null
  let o = out
  if (words?.tags.length) o = plus(o, { do: "tags", tags: words.tags, said: words.said })
  if (words?.said) o = chain(o, (y) => say(y, words.said))
  if (!silent(o.to.turn)) return o
  return n.acting || words?.tags.length ? plus(o, { do: "judge", n: t.n }) : chain(o, (y) => say(y, quietly(y.turn.did)))
}

function started<A extends Ask, T>(s: TurnState<A>, e: TurnEvent<A, T, "started">, w: World): Out<A, T> {
  if (s.phase.kind !== "starting") return go(s)
  const up: TurnState<A> = { ...s, phase: s.phase.handed ? { kind: "turn" } : { kind: "idle" } }
  return pump(e.news ? step(up, e.news, w) : go(up))
}

function over<A, T>(s: TurnState<A>, e: TurnEvent<A, T, "ended">, w: World): Out<A, T> {
  if (between(s)) return go(s)
  const notes: Effect<A, T>[] = e.error ? [{ do: "note", why: e.error }] : []
  if (!handed(s)) return pump(go(idle(s), ...notes))
  if (e.error && unanswered(s.turn)) return failed(idle(s), handedOf(s), e.error, w)
  return pump(chain<A, T>(answer(go(idle(s), ...notes), s.turn, e), ended))
}

function drew<A, T>(s: TurnState<A>, e: TurnEvent<A, T, "drew">): Out<A, T> {
  const t = s.turn
  if (e.n !== t.n) return go(s)
  if (e.ok) return go({ ...s, turn: { ...t, shown: true, missed: false } })
  if (t.said || t.shown || t.cut) return go(s)
  if (!handed(s)) return say(s, NOT_SHOWN, { missed: false, did: NOT_SHOWN })
  return go({ ...s, turn: { ...t, missed: true, did: NOT_SHOWN } })
}

function answered<A, T>(s: TurnState<A>, e: TurnEvent<A, T, "answered">): Out<A, T> {
  const t = s.turn
  const to = { ...s, turn: { ...t, did: t.missed ? NOT_SHOWN : e.text && e.error ? `I couldn't: ${e.text}` : e.text } }
  return e.ends && handed(s) && !t.said && !t.shown && t.cut !== "withdrawn" ? go(to, { do: "go-on" }) : go(to)
}

const ON: Handlers = {
  free: (s, _e, w) => next(s, w),
  asked: (s, e, w) => next({ ...s, waiting: [...s.waiting, { ask: e.ask, again: false }] }, w),
  pressed: (s, e, w) => (s.phase.kind !== "idle" || !w.on() || !e.cold ? go(s) : go({ ...s, phase: { kind: "starting", handed: false } }, { do: "begin", asks: [] })),
  made: (s) => {
    if (s.phase.kind !== "making") return go(s)
    const g = give({ ...s, phase: { kind: "starting", handed: true } }, s.phase.asks)
    return go(g, { do: "handed", asks: g.turn.asks })
  },
  unmade: (s, e, w) => (s.phase.kind === "making" ? pump(failed(idle(s), s.phase.asks, e.why, w)) : go(s)),
  started,
  "start-failed": (s, e, w) => (s.phase.kind === "starting" ? pump(lost(s, idle(s), e.why, w)) : go(s)),
  "send-failed": (s, e, w) => (e.round === s.round ? pump(lost(s, unhand(s), e.why, w)) : go(s)),
  busy: (s) => (between(s) ? go(s) : go(s.phase.kind === "idle" ? { ...s, phase: { kind: "busy" } } : s, ...(handed(s) ? [{ do: "thinking" } as const] : []))),
  gone: (s, _e, w) => {
    if (between(s)) return go(s)
    if (handed(s) && unanswered(s.turn)) return failed(idle(s), handedOf(s), "its session ended before it answered", w)
    return pump(handed(s) ? ended(s) : go(idle(s)))
  },
  ended: over,
  settled: (s, e) => (e.n === s.turn.n && silent(s.turn) ? say(s, quietly(s.turn.did)) : go(s)),
  acted: (s, e) => {
    const op = e.op ?? "", t = s.turn
    return go({ ...s, turn: { ...t, acted: true, said: t.said || op === "say" || op === "word", shown: t.shown || SHOWS.has(op), passed: t.passed || op === "pass" } })
  },
  wrote: (s, e) => go({ ...s, turn: { ...s.turn, wrote: true, acted: s.turn.acted || e.said, said: s.turn.said || e.said } }),
  drew,
  answered,
  escaped: (s) => (turning(s) ? go(cut(s, s.turn.cut ?? "stopped")) : go(s)),
  withdrawn: (s) => {
    if (s.waiting.length) return go({ ...s, waiting: s.waiting.slice(0, -1) })
    return handed(s) ? go(cut(s, "withdrawn"), { do: "interrupt" }) : go(s)
  },
  dropped: (s, e) => {
    const i = s.waiting.findIndex((x) => x.ask === e.ask)
    if (i >= 0) return go({ ...s, waiting: s.waiting.filter((_, k) => k !== i) })
    return drops(s, e.ask) ? go(cut(s, "withdrawn"), { do: "interrupt" }) : go(s)
  },
  stopped: (s) => go(unhand({ ...s, waiting: [] })),
}

const LATE = new Set<EventKind>(["acted", "wrote", "drew", "answered"])

export function step<A extends Ask, T, K extends EventKind>(s: TurnState<A>, e: TurnEvent<A, T, K>, w: World): Out<A, T> {
  if (s.turn.cut === "lost" && LATE.has(e.type)) return go(s)
  const on: Handlers[K] = ON[e.type]
  return on(s, e, w)
}

export const label = (s: TurnState<unknown>) => (handed(s) ? `${s.phase.kind} ${s.turn.n}` : s.phase.kind)
