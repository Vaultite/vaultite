// The summoned companion's own session: asks from its Talk key (on screen or in the app) go to a small, warm Claude Code
// session with a short prompt, apart from the long one that watches notes. Same character: its cursor, name and colour.
import { AsyncLocalStorage } from "node:async_hooks"
import fs from "node:fs"
import type { Agent, Chat, ChatHow, ChatState as State, ChatTool, Moment } from "./plugin.ts"

type Tool = ChatTool
type Start = ChatHow & { prompt?: string }
export type Lane = ReturnType<typeof summonedLane>
const READY = "Get ready: end your turn now, with no call. Asks come as your next messages."
/** Set while the summoned session's tool runs: its acts are logged as its own (timings), not the long session's. */
export const inSummoned = new AsyncLocalStorage<boolean>()

/** What its session is told, the same every time (its prompt cache stays warm). */
export const SUMMONED_PROMPT = `You're the user's companion in Vaultite, called up where they are: they held your Talk key over something on their screen or in the app, spoke (or drew), and let go. Each ask comes as a message, with what was under their pointer, the elements near it (by id), what they drew, and the display's picture attached.
Answer there, fast: your first call is a say with a sentence or two (more only when they ask for it), pointing at what you mean: say or look with ax (an element's id near their pointer) snaps to it; else sx, sy. When a mark explains it better than words (where to click, which one, a sequence), one draw call with marks and your words in its say does both. Read nothing unless the ask needs it: what you were given is usually enough.
Your say is often read aloud: write it as you'd say it, the answer in its first sentence, no lists, code or addresses in it (those go on a draw's paper); mark labels stay a few words.
You are Vaultite's own companion: asked about Vaultite or yourself, or told what they'd like from it, look first (a quick vau search of the vault's notes on it) and answer from what you find; a wish or a fix for the app you offer to hand off as a job (say with ask), never just that you can't tell.
Work that takes more than a minute (research, a document, code, a long errand, writing in their notes) you hand off: handoff starts a background agent with the task and this ask's context and returns at once; say in a few words that it's on it.
An ask may come with the user's guide to that app or site (their note): follow it. With none, after answering an ask about how something works there, you may offer once (say with ask) to write one; if they say yes, hand that off (its format: vau docs guides).
Your last call for an ask says done: true, which ends your turn: words outside your tools reach no one, so write none. Their next ask is your next message (a follow-up goes on from the last).`

/** The summoned session of the companion `name()`: on while it runs Claude Code and `model()` is set. `send` gives an
 *  ask's text (its excerpts, guide), `tools` its tools, `options` how it runs; the rest is plugin.ts' own. */
export function summonedLane(o: {
  file: () => string; chat: () => Chat | null; name: () => string; model: () => string; fresh: () => number
  options: (model: string) => Start; text: (ms: Moment[]) => Promise<{ text: string; images: string[] }>
  agent: (name: string) => Agent | undefined; setAgent: (name: string, a: Partial<Agent>) => void
  did: (as: string, op: string, seqs?: number[]) => void; say: (name: string, text: string) => void
}) {
  type Kept = { id: string; model: string; t: number; handed: number }
  let kept: Kept | null = null
  try { kept = JSON.parse(fs.readFileSync(o.file(), "utf8")) } catch { /* none yet */ }
  const keep = (k: Kept | null) => { kept = k; try { if (k) fs.writeFileSync(o.file(), JSON.stringify(k)); else fs.rmSync(o.file(), { force: true }) } catch { /* as it was */ } }
  const pending: Moment[] = []
  let given: Moment[] = []
  let turning = false, starting: Promise<unknown> | null = null, handed = false, acted = false, asking = false, unhear: (() => void) | null = null
  const newsOf = new Map<string, number>()

  const on = () => !!o.model() && !!o.chat()
  const hostedNow = () => (kept ? o.chat()?.list().find((s) => s.id === kept!.id && s.state !== "error") ?? null : null)
  /** Its session's tools, each call (and its words as they stream) run as its own. */
  const tools = (ts: Tool[]) => ts.map((t) => ({ ...t, run: (args: unknown, use?: string) => inSummoned.run(true, () => t.run(args, use)),
    ...(t.stream ? { stream: (use: string, json: string, end?: "done" | "stop") => inSummoned.run(true, () => t.stream!(use, json, end)) } : {}) }))
  const options = (model: string) => { const x = o.options(model); return { ...x, tools: tools(x.tools ?? []) } }

  function hear() {
    const c = o.chat()
    if (unhear || !c) return
    unhear = c.on((id, s) => { if (id === kept?.id) heard(s) })
  }
  /** Its turn: running shows its cursor busy; ended, a seen tick when it let the ask pass, and what came meanwhile goes. */
  function heard(s: State | null) {
    const name = o.name()
    if (!s) { turning = false; return }
    if (s.state === "working" || s.state === "waiting" || s.state === "starting") {
      newsOf.delete(s.id)
      turning = true
      const a = o.agent(name)
      if (handed && (!a || a.state === "watching" || a.state === "away")) o.setAgent(name, { state: "thinking" })
      return
    }
    if (s.seq !== undefined) { if (newsOf.get(s.id) === s.seq) return; newsOf.set(s.id, s.seq) }
    const was = turning
    turning = false
    // (its answer written as words, not said: a small model forgets its tools now and then)
    const words = handed && !acted && s.state === "idle" ? s.turn?.text?.trim() ?? "" : ""
    if (words) { acted = true; inSummoned.run(true, () => o.did(name, "say")); o.say(name, words) }
    if (handed) o.setAgent(name, acted ? { state: "watching" } : { state: "watching", seen: true })
    if (was && handed) inSummoned.run(true, () => o.did(name, "done"))
    handed = false; asking = false
    if (s.state === "error" && s.error) o.say(name, `I stopped: ${s.error.slice(0, 300)}`)
    void pump()
  }

  /** Its session started (a fresh one past `fresh()` asks, or for another model), handed `ms`; else told to get ready,
   *  a turn that caches its prompt (a cold first ask took 8 to 20 s to its first word, a warm one 1 to 2). */
  async function begin(ms: Moment[]) {
    const c = o.chat()!, model = o.model()
    if (kept) { const old = kept.id; keep(null); void c.stop(old).catch(() => {}) }
    hear()
    const first = ms.length ? await o.text(ms) : { text: READY, images: [] }
    if (ms.length) give(ms)
    turning = true
    try {
      const s = await c.start({ ...options(model), prompt: first.text, ...(first.images.length ? { images: first.images } : {}) })
      keep({ id: s.id, model, t: Date.now(), handed: ms.length })
      const now = c.list().find((x) => x.id === s.id)
      if (now) heard(now)
    } catch (e) { turning = false; lost(ms, e as Error) }
  }

  /** Asks handed to it: its cursor thinking there till it acts. */
  function give(ms: Moment[]) {
    handed = true; acted = false; asking = true; given = ms
    inSummoned.run(true, () => o.did(o.name(), "handed", ms.map((m) => m.seq)))
  }
  function lost(ms: Moment[], e: Error) {
    handed = false; asking = false
    if (!ms.length) return
    o.setAgent(o.name(), { state: "watching" })
    o.say(o.name(), `I couldn't take that in: ${e.message}`)
  }

  /** What's waiting goes once its turn isn't running: its session started (or a fresh one) first if need be. */
  async function pump() {
    if (turning || starting || !on()) return
    const c = o.chat()!, model = o.model()
    if (!pending.length) return
    const ms = pending.splice(0)
    const s = hostedNow()
    if (!kept || kept.model !== model || kept.handed >= o.fresh()) {
      starting = begin(ms).finally(() => { starting = null; void pump() })
      return
    }
    turning = true
    give(ms)
    keep({ ...kept, handed: kept.handed + ms.length })
    try {
      const { text, images } = await o.text(ms)
      await c.send(kept.id, text, { ...options(model), ...(images.length ? { images } : {}) })
      // (resumed: its process had ended, idle a while)
      if (!s) { const now = c.list().find((x) => x.id === kept?.id); if (now) heard(now) }
    } catch (e) {
      turning = false
      // (its conversation is gone: the next ask starts another)
      if ((e as { status?: number }).status === 404) keep(null)
      lost(ms, e as Error)
    }
  }

  return {
    on,
    /** Whether it takes moment `m`: a summoned ask, point or reply to the companion. */
    takes: (m: Moment) => on() && !!m.summoned && m.for === o.name() && (m.kind === "ask" || m.kind === "point"),
    take(m: Moment) { pending.push(m); void pump() },
    /** Ready before the ask (started with the companion, its Talk key pressed): its session up, its prompt cached while
     *  they speak (one ended idle is a fresh one); an ask meanwhile waits for that turn. */
    warm() {
      if (!on() || turning || starting || (hostedNow() && kept?.model === o.model())) return
      starting = begin([]).finally(() => { starting = null; void pump() })
    },
    /** After a restart: its session's tools served again, so a call it makes now reaches them. */
    serve() { hear(); if (kept && on()) o.chat()!.serve(kept.id, options(kept.model)) },
    /** Whether its session is busy on an ask (its cursor thinking after a say that isn't its last). */
    busy: () => turning,
    asking: () => asking,
    acted() { acted = true },
    id: () => kept?.id ?? null,
    /** The asks its turn was handed last (a handoff's context). */
    last: () => given,
    /** Its act logged under its own name, for timings. */
    as: (name: string) => `${name} (summoned)`,
    async interrupt() { return !!(turning && kept && await o.chat()?.interrupt(kept.id).catch(() => false)) },
    async stop() {
      pending.length = 0
      if (kept) { const id = kept.id; keep(null); await o.chat()?.stop(id).catch(() => {}) }
      turning = false; handed = false; asking = false
    },
  }
}
