import type { VaultTest } from "./harness.ts"
import { type Effect, type EffectKind, handed, NOT_SHOWN, owes, start, step, type Turn, type TurnEvent, type TurnState, withdrawing } from "../../../plugins/core/companion/talkturn.ts"
import fc from "fast-check"

type Ask = { id: number; tour?: boolean }
/** What the world around the machine may do next, in any order: each thing the runner started may finish or fail. */
type Moves = {
  ask: { tour: boolean }; press: { cold: boolean }; busy: {}; end: { error: boolean; words: boolean; tags: boolean }; gone: {}
  acted: { op: string }; answered: { error: boolean; ends: boolean }; drew: { stale: boolean; ok: boolean }
  write: { tag: boolean }; queue: { ok: boolean }; make: { ok: boolean }; start: { ok: boolean; busy: boolean }; send: { i: number; ok: boolean }
  escape: {}; withdraw: {}; drop: { i: number }; stop: {}; toggle: {}; due: {}
}
export type Move<K extends keyof Moves = keyof Moves> = { [P in K]: { t: P } & Moves[P] }[K]
type MoveRunners = { [K in keyof Moves]: (m: Move<K>) => void }
type EffectRunners = { [K in EffectKind]?: (x: Effect<Ask, string, K>) => void }

const LOST = "I lost my session there, ask me again?", OFF = "My session's off right now, so I couldn't answer that."
/** `superseded`: its answer still being judged (its marks drawing) when a newer ask was handed, told what didn't show. */
type Fate = "waiting" | "handed" | "answered" | "withdrawn" | "stopped" | "cut" | "superseded"
const LOSES = new Set(["gone", "send-failed", "start-failed"])

/** The machine driven by `moves`, then let finish: every in-flight thing done, every turn ended. What each ask got. */
export function world(moves: Move[]) {
  let s: TurnState<Ask> = start<Ask>(), on = true, kept = false, due = false, making: Ask[] | null = null, starting = false, ids = 0
  const judging: { n: number; asks: Ask[] }[] = []
  const sends: number[] = [], queue: ({ k: "mark"; n: number } | { k: "words"; n: number } | { k: "judge"; n: number })[] = []
  const asks: Ask[] = [], fate = new Map<Ask, Fate>(), answeredIn = new Map<Ask, Set<number>>()
  const says: string[] = [], effects: string[] = [], laneSays = new Map<string, number>(), streamed = new Set<string>(), lines = new Map<Ask, string>(), lostOnce = new Set<Ask>(), bad: string[] = []
  const w = { on: () => on, fresh: () => !kept || due }
  const tries = new Map<Ask, number>(), tried = (as: Ask[]) => { for (const a of as) tries.set(a, (tries.get(a) ?? 0) + 1) }
  const of = (a: Ask, n: number) => `${a.id}@${n}`

  function takenBack(e: TurnEvent<Ask, string>, was: TurnState<Ask>) {
    if (e.type === "withdrawn" && was.waiting.length) for (const a of withdrawing(was)) fate.set(a, "withdrawn")
    if (e.type === "dropped" && was.waiting.some((x) => x.ask === e.ask)) fate.set(e.ask, "withdrawn")
    if (e.type !== "stopped") return
    for (const x of was.waiting) fate.set(x.ask, "stopped")
    if (was.phase.kind === "making") for (const x of was.phase.asks) fate.set(x.ask, "stopped")
    if (handed(was)) for (const a of was.turn.asks) if (fate.get(a) === "handed") fate.set(a, "stopped")
  }
  function lostBy(e: TurnEvent<Ask, string>, was: TurnState<Ask>) {
    const t = was.turn
    if (!(LOSES.has(e.type) || (e.type === "ended" && e.error)) || !handed(was) || !on || t.acted || t.shown || t.cut || t.again) return
    if (e.type === "send-failed" && e.round !== was.round) return
    for (const a of t.asks) lostOnce.add(a)
  }
  function answeredBy(t: Turn<Ask>) {
    for (const a of t.asks) {
      if (t.acted || t.said || t.shown) { fate.set(a, "answered"); (answeredIn.get(a) ?? answeredIn.set(a, new Set()).get(a)!).add(t.n) }
      if (t.cut === "withdrawn" || t.cut === "stopped") fate.set(a, t.cut === "withdrawn" ? "withdrawn" : "cut")
    }
  }
  function go(e: TurnEvent<Ask, string>) {
    takenBack(e, s)
    lostBy(e, s)
    const r = step(s, e, w)
    s = r.to
    answeredBy(s.turn)
    for (const x of r.do) effect(x)
  }

  function said(text: string) {
    for (const a of s.turn.asks) {
      const k = of(a, s.turn.n), n = (laneSays.get(k) ?? 0) + 1
      laneSays.set(k, n)
      if (n > 1) bad.push(`ask ${a.id} told twice by the lane in handing ${s.turn.n}`)
      if (streamed.has(k)) bad.push(`ask ${a.id} told "${text}" by the lane over its own words, handing ${s.turn.n}`)
      if (text === LOST || text === OFF) lines.set(a, text)
    }
    says.push(text)
    // Its own say is logged as an act of its, which the plugin tells the lane.
    go({ type: "acted", op: "say" })
  }
  const runs: EffectRunners = {
    begin: (x) => { kept = false; if (x.asks.length) making = x.asks; else starting = true; tried(x.asks) },
    send: (x) => { sends.push(x.round); tried(x.asks) },
    handed: (x) => {
      for (const j of judging.splice(0)) for (const a of j.asks) if (fate.get(a) === "handed") fate.set(a, "superseded")
      for (const a of x.asks) fate.set(a, "handed")
    },
    say: (x) => said(x.text),
    tags: () => void queue.push({ k: "mark", n: s.turn.n }),
    judge: (x) => { queue.push({ k: "judge", n: x.n }); judging.push({ n: x.n, asks: s.turn.asks }) },
    lose: () => { kept = false },
    pump: () => go({ type: "free" }),
  }
  function effect<K extends EffectKind>(x: Effect<Ask, string, K>) {
    effects.push(x.do)
    const f: EffectRunners[K] = runs[x.do]
    f?.(x)
  }

  const moved: MoveRunners = {
    ask: (m) => { const a: Ask = { id: ++ids }; if (m.tour) a.tour = true; asks.push(a); fate.set(a, "waiting"); go({ type: "asked", ask: a }) },
    press: (m) => go({ type: "pressed", cold: m.cold || !kept }),
    busy: () => { if (kept) go({ type: "busy" }) },
    end: (m) => { if (kept) go({ type: "ended", error: m.error ? "boom" : "", words: m.words ? { said: "Over here.", tags: m.tags ? ["a1"] : [] } : null, acting: queue.length > 0 }) },
    gone: () => { if (kept) go({ type: "gone" }) },
    acted: (m) => go({ type: "acted", op: m.op }),
    answered: (m) => go({ type: "answered", text: "Opened it.", error: m.error, ends: m.ends }),
    drew: (m) => go({ type: "drew", n: s.turn.n - (m.stale ? 1 : 0), ok: m.ok }),
    write: (m) => {
      if (!handed(s)) return
      // A block of its words: its tag's mark, then its words, acted on in order.
      if (m.tag) queue.push({ k: "mark", n: s.turn.n })
      queue.push({ k: "words", n: s.turn.n })
      if (s.turn.cut !== "withdrawn") go({ type: "wrote", said: true })
      for (const a of s.turn.asks) streamed.add(of(a, s.turn.n))
    },
    queue: (m) => {
      const q = queue.shift()
      if (!q) return
      if (q.k === "judge") { judging.splice(0, judging.findIndex((j) => j.n === q.n) + 1); return go({ type: "settled", n: q.n }) }
      go({ type: "acted", op: q.k === "words" ? "say" : "draw" })
      if (q.k === "mark") go({ type: "drew", n: q.n, ok: m.ok })
    },
    make: (m) => { if (!making) return; making = null; starting = m.ok; go(m.ok ? { type: "made" } : { type: "unmade", why: "no picture" }) },
    start: (m) => {
      if (!starting || making) return
      starting = false
      if (!m.ok) return go({ type: "start-failed", why: "spawn failed" })
      kept = true
      go({ type: "started", news: m.busy ? { type: "busy" } : { type: "ended", error: "", words: null, acting: queue.length > 0 } })
    },
    send: (m) => { if (!sends.length) return; const [round] = sends.splice(m.i % sends.length, 1); if (!m.ok) go({ type: "send-failed", round, why: "socket closed" }) },
    escape: () => go({ type: "escaped" }),
    withdraw: () => go({ type: "withdrawn" }),
    drop: (m) => { if (asks.length) go({ type: "dropped", ask: asks[m.i % asks.length] }) },
    stop: () => { kept = false; go({ type: "stopped" }) },
    toggle: () => { on = !on },
    due: () => { due = !due },
  }
  function move<K extends keyof Moves>(m: Move<K>) {
    const f: MoveRunners[K] = moved[m.t]
    f(m)
  }

  for (const m of moves) move(m)
  // Then left to finish: what's in flight lands, each turn ends; the asks waiting go.
  for (let i = 0; i < 40; i++) {
    move({ t: "make", ok: true }); move({ t: "start", ok: true, busy: true })
    while (sends.length) move({ t: "send", i: 0, ok: true })
    while (queue.length) move({ t: "queue", ok: true })
    if (s.phase.kind === "turn" || s.phase.kind === "busy") move({ t: "end", error: false, words: false, tags: false })
    while (queue.length) move({ t: "queue", ok: true })
  }
  return { s, asks, fate, tries, answeredIn, lines, lostOnce, bad, on, says, effects }
}

/** What must hold whatever the world did: each ask is answered, passed, told it failed, or taken back (withdrawn, the
 *  lane stopped, Esc); none is answered in two handings, nor told twice; a lost one goes again once, never twice. */
export function invariants(r: ReturnType<typeof world>) {
  const bad = [...r.bad]
  for (const a of r.asks) {
    const f = r.fate.get(a), n = r.tries.get(a) ?? 0
    if (f === "waiting" || f === "handed") bad.push(`ask ${a.id} ended in silence (${f}, tried ${n}x)`)
    if ((r.answeredIn.get(a)?.size ?? 0) > 1) bad.push(`ask ${a.id} answered in handings ${[...r.answeredIn.get(a)!]}`)
    if (n > 2) bad.push(`ask ${a.id} tried ${n} times`)
    if (r.lostOnce.has(a) && n < 2 && f !== "withdrawn" && f !== "stopped" && r.lines.get(a) !== OFF) bad.push(`ask ${a.id} lost once and never tried again (${f})`)
  }
  return bad
}

const MOVE: fc.Arbitrary<Move> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant("ask" as const), tour: fc.constantFrom(false, false, false, false, true) }), weight: 4 },
  fc.record({ t: fc.constant("press" as const), cold: fc.boolean() }),
  { arbitrary: fc.constant({ t: "busy" as const }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant("end" as const), error: fc.boolean(), words: fc.boolean(), tags: fc.boolean() }), weight: 3 },
  fc.constant({ t: "gone" as const }),
  fc.record({ t: fc.constant("acted" as const), op: fc.constantFrom("say", "word", "look", "draw", "pass", "handoff", "act", "open") }),
  fc.record({ t: fc.constant("answered" as const), error: fc.boolean(), ends: fc.boolean() }),
  fc.record({ t: fc.constant("drew" as const), stale: fc.boolean(), ok: fc.boolean() }),
  { arbitrary: fc.record({ t: fc.constant("write" as const), tag: fc.boolean() }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant("queue" as const), ok: fc.boolean() }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant("make" as const), ok: fc.constantFrom(true, true, true, true, false) }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant("start" as const), ok: fc.boolean(), busy: fc.boolean() }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant("send" as const), i: fc.nat(3), ok: fc.boolean() }), weight: 3 },
  fc.constant({ t: "escape" as const }), fc.constant({ t: "withdraw" as const }), fc.record({ t: fc.constant("drop" as const), i: fc.nat(9) }),
  fc.constant({ t: "stop" as const }), fc.constant({ t: "toggle" as const }), fc.constant({ t: "due" as const }),
)
export function counterexample(runs: number) {
  const r = fc.check(fc.property(fc.array(MOVE, { maxLength: 60 }), (ms) => invariants(world(ms)).length === 0), { numRuns: runs })
  return r.failed ? { moves: r.counterexample![0], why: invariants(world(r.counterexample![0])), seed: r.seed } : null
}

const busyStart: Move[] = [{ t: "ask", tour: false }, { t: "make", ok: true }, { t: "start", ok: true, busy: true }]
/** Each past fix's case, on the machine alone: its moves, and what must come of them besides the invariants. */
const REPLAYS: [string, Move[], (w: ReturnType<typeof world>) => boolean][] = [
  ["a turn that ends with nothing says it got nowhere (563f1b3e)", [...busyStart, { t: "end", error: false, words: false, tags: false }],
    (w) => w.says.join() === "I didn't get to an answer on that one. Ask me again?"],
  ["a mark still drawing as its turn ends is judged once it's done, said once (36986ac1)",
    [...busyStart, { t: "end", error: false, words: true, tags: true }, { t: "queue", ok: false }, { t: "queue", ok: false }], (w) => w.says.join("|") === "Over here."],
  ["its session gone mid-ask: the ask goes again, once, to a fresh one (09b4c2ef)", [...busyStart, { t: "gone" }],
    (w) => w.tries.get(w.asks[0]) === 2 && w.fate.get(w.asks[0]) === "answered" && !w.says.includes(LOST)],
  ["its session lost twice: one short line, never a third try (09b4c2ef)", [...busyStart, { t: "gone" }, { t: "make", ok: true }, { t: "start", ok: true, busy: true }, { t: "gone" }],
    (w) => w.tries.get(w.asks[0]) === 2 && w.says.join() === LOST],
  ["the realtime voice answered alone: its turn stops, nothing of it said (5f46a27c)", [...busyStart, { t: "withdraw" }, { t: "end", error: false, words: true, tags: false }],
    (w) => w.fate.get(w.asks[0]) === "withdrawn" && !w.says.length && w.effects.includes("interrupt")],
  ["a tour's step dropped alone stops its turn; with their own ask it isn't (0e3f4770)",
    [{ t: "ask", tour: true }, { t: "make", ok: true }, { t: "start", ok: true, busy: true }, { t: "drop", i: 0 }], (w) => w.fate.get(w.asks[0]) === "withdrawn"],
  ["Esc stops its turn: nothing more said for it", [...busyStart, { t: "escape" }, { t: "end", error: false, words: false, tags: false }], (w) => !w.says.length],
  ["turned off with an ask waiting: it's told so", [...busyStart, { t: "ask", tour: false }, { t: "toggle" }, { t: "end", error: false, words: true, tags: false }],
    (w) => w.lines.get(w.asks[1]) === OFF],
  ["words on their way are its answer: never said whole too, nor told they didn't show", [...busyStart, { t: "write", tag: true }, { t: "end", error: false, words: true, tags: true }],
    (w) => !w.says.length],
  ["a lost turn's late mark says nothing while its ask goes again", [...busyStart, { t: "gone" }, { t: "drew", stale: false, ok: false }], (w) => !w.says.includes(NOT_SHOWN)],
  ["asks behind a twice-lost one go on", [...busyStart, { t: "gone" }, { t: "make", ok: true }, { t: "start", ok: true, busy: true }, { t: "ask", tour: false }, { t: "gone" }],
    (w) => w.fate.get(w.asks[1]) === "answered"],
  ["an ask as it stops goes on", [...busyStart, { t: "stop" }, { t: "ask", tour: false }], (w) => w.fate.get(w.asks[1]) === "answered"],
  ["a send failing after its words came ends its turn", [{ t: "press", cold: true }, { t: "start", ok: true, busy: false }, { t: "ask", tour: false }, { t: "write", tag: false }, { t: "send", i: 0, ok: false }],
    (w) => w.tries.get(w.asks[0]) === 1],
  ["stopped as a fresh session starts: the session it gets is let go", [{ t: "press", cold: true }, { t: "stop" }, { t: "start", ok: true, busy: false }],
    (w) => w.effects.includes("lose") && w.s.phase.kind === "idle"],
  ["stopped as an ask's message is made: it's never handed", [{ t: "ask", tour: false }, { t: "stop" }, { t: "make", ok: true }],
    (w) => !w.effects.includes("handed") && w.fate.get(w.asks[0]) === "stopped" && w.s.phase.kind === "idle"],
  ["a message that can't be made is tried once more, then told", [{ t: "ask", tour: false }, { t: "make", ok: false }, { t: "make", ok: false }], (w) => w.says.join() === LOST],
]

export default async ($: VaultTest) => {
  const { check } = $
  for (const [name, moves, ok] of REPLAYS) { const w = world(moves); check(`talkturn machine: ${name}`, !invariants(w).length && ok(w), { why: invariants(w), says: w.says, effects: w.effects }) }
  {
    const ask: Ask = { id: 1 }, on = { on: () => true, fresh: () => false }, cold = { on: () => true, fresh: () => true }
    const run = (w: typeof on, ...es: TurnEvent<Ask, string>[]) => { let s = start<Ask>(); const out = [owes(s)]; for (const e of es) { s = step(s, e, w).to; out.push(owes(s)) } return out.join() }
    const ended: TurnEvent<Ask, string> = { type: "ended", error: "", words: null, acting: false }
    const runs = [run(on, { type: "asked", ask }, { type: "busy" }, { type: "acted", op: "say" }, ended), run(on, { type: "asked", ask }, { type: "acted", op: "pass" }, ended), run(cold, { type: "asked", ask }, { type: "made" }, { type: "started", news: null }, ended)]
    check("talkturn: it owes an answer from the ask till it's passed or its turn is over, a fresh session's too",
      runs.join("|") === "false,true,true,true,false|false,true,false,false|false,true,true,true,false", runs)
  }
  const found = counterexample(3000)
  check("talkturn machine: whatever happens around it, every ask is answered, passed, told it failed or taken back, none twice; a lost one is tried once more", !found, found)
}
