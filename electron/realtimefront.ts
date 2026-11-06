/** The summoned companion's realtime voice (helper.ts'; plugins/core/companion/AGENTS.md): it hears the Talk key's audio
 *  and answers at once; the screen it asks the summoned session about (look_at_screen), else the pipeline answers. */
import { type Heard, sentences } from "../plugins/core/companion/screenmarks.ts"
import { chunker, speakable } from "../plugins/core/companion/spoken.ts"
import { realtimeSession, type RealtimeSession } from "./realtime.ts"
import { costOf, instructions, LOOK_TOOL, msOf, resampler, type Usage, verbatim } from "./realtimelogic.ts"

export type FrontConfig = { url: string; key: string; model: string; voice: string }
/** Where its audio plays (voice.ts' companionVoice): a stream per response, in order; stop silences all. */
export type Player = { stream: () => { pcm: (b: Buffer) => void; end: () => void }; stop: () => void }
/** A turn's numbers: ms from the key let go to its first audio (`firstMs`) and, a screen question's, to the answer's. */
export type TurnLog = { kind: "talk" | "look"; firstMs?: number; answerMs?: number; cost: number; model: string; usage: Usage[]; failed?: string }

type State = "listening" | "answering" | "looking" | "done" | "pipeline" | "failed" | "stopped"
type Turn = { pressed: number; released?: number; speech: boolean; loud: number; bytes: number; buf: Buffer[]; live: RealtimeSession | null; rs: (b: Buffer) => Buffer
  state: State; heard?: string; first?: number; answerFirst?: number; said: string; asks: Set<number>; answerAsks: Set<number>; rids: Set<string>; answerRids: Set<string>
  pieces: Map<number, string>; spoken: Map<string, { text: string; item?: string }>
  call?: { id: string; question?: string; looked: boolean; answered: boolean; timer?: ReturnType<typeof setTimeout> }
  lookedAt?: number; hold: string[]; chunks: Map<string, ReturnType<typeof chunker>>; quiet?: ReturnType<typeof setTimeout>; busy?: boolean
  ended: boolean; open: number; cost: number; usage: Usage[]; waiting?: ReturnType<typeof setTimeout> }

export function realtimeFront(o: {
  /** The session's key and settings; null: the pipeline answers (no key, or voice_front is pipeline). */
  config: () => Promise<FrontConfig | null>
  name: () => string
  player: Player
  /** The screen round: the helper sends the ask (the user's words, the talk so far) to the summoned session. */
  look: (q: { question: string; talk: string[] }) => void
  /** A turn it answered alone: what they said and it said, for their box. */
  answered: (r: { heard: string; said: string }) => void
  /** This turn goes the pipeline's way after all (its socket failed): the ask with dictation's words. */
  fallback: (heard: string) => void
  /** Its cursor: thinking while the screen round runs; done when the turn is over. */
  state: (s: "thinking" | "done") => void
  log?: (t: TurnLog) => void
  /** Said once when it pauses, the account's credits gone (the pipeline answers meanwhile). */
  notice?: (why: string) => void
  /** How long it pauses then, before it tries again (in the background, once). */
  pauseMs?: number
  /** Each sentence of the higher model's answer as it's heard (its marks keep to it: helper.ts voiceHeardLine). */
  heard?: (h: Heard) => void
  /** How long the session stays open unused; how long a screen round may take; how long a tool call waits for the
   *  user's words from dictation. */
  idleMs?: number; lookMs?: number; heardMs?: number
  /** How long after the key is let go its first words may take before the pipeline answers instead. */
  firstMs?: number
}) {
  const now = () => Date.now()
  const IDLE = o.idleMs ?? 10 * 60_000, LOOK = o.lookMs ?? 30_000, HEARD = o.heardMs ?? 1200, FIRST = o.firstMs ?? 4000
  let cfg: FrontConfig | null | undefined, cfgAt = 0, cfgLoading: Promise<void> | null = null
  let s: RealtimeSession | null = null, sKey = "", turns = 0
  let turn: Turn | null = null, idle: ReturnType<typeof setTimeout> | null = null
  /** Paused till then: the account can't pay, so no press tries it (told once); then one try in the background. */
  let pausedUntil = 0, toldPause = false, retry: ReturnType<typeof setTimeout> | null = null
  const paused = () => now() < pausedUntil
  const PAUSE = o.pauseMs ?? 10 * 60_000
  const talk: string[] = []
  /** What's queued to the player, by item: when it starts and how long it is (for a truncate at barge-in). */
  let playEnd = 0
  const items = new Map<string, { start: number; ms: number }>()
  const streams = new Map<string, ReturnType<Player["stream"]>>()
  const owner = new Map<string, Turn>()

  function refresh() {
    if (cfg !== undefined && now() - cfgAt < 60_000) return Promise.resolve()
    cfgLoading ??= o.config().then((c) => { cfg = c; cfgAt = now() }, () => { cfg = null; cfgAt = now() }).finally(() => { cfgLoading = null })
    return cfgLoading
  }

  /** Its session, opened (or again, for another key, model or voice; or a fresh one after many turns). */
  function session(): RealtimeSession | null {
    if (!cfg || paused()) return null
    const k = JSON.stringify(cfg)
    if (s && s.alive() && sKey === k && turns < 20) return s
    s?.close()
    turns = 0
    sKey = k
    const me: RealtimeSession = realtimeSession({ ...cfg, instructions: instructions(o.name()), tools: [LOOK_TOOL] }, {
      began: (rid, n) => {
        const t = turn
        if (!t || !t.asks.has(n)) return
        t.rids.add(rid); owner.set(rid, t)
        if (t.answerAsks.has(n)) { t.answerRids.add(rid); t.spoken.set(rid, { text: t.pieces.get(n) ?? "" }) }
      },
      audio: (b, rid, item) => heardAudio(b, rid, item),
      said: (d, rid) => { const t = owner.get(rid); if (t && !t.answerRids.has(rid)) t.said += d },
      call: (c) => called(c),
      done: (d) => { if (d.quota) pause(d.error ?? "no credits"); responded(d) },
      error: (e) => { if (me !== s) return; if (e.quota) pause(e.message); if (e.fatal) s = null; errored(e.message, e.fatal) },
    })
    s = me
    return me
  }

  function heardAudio(b: Buffer, rid: string, item: string) {
    const t = owner.get(rid)
    if (!t || t !== turn || t.state === "stopped" || t.state === "failed") return
    const at = now()
    if (!t.first) { t.first = at; clearTimeout(t.waiting) }
    if (t.answerRids.has(rid)) t.answerFirst ??= at
    let st = streams.get(rid)
    if (!st) { st = o.player.stream(); streams.set(rid, st) }
    st.pcm(b)
    const sp = t.spoken.get(rid)
    if (sp) sp.item ??= item
    const ms = msOf(b.length)
    let it = items.get(item)
    if (!it) { it = { start: Math.max(at, playEnd), ms: 0 }; items.set(item, it) }
    it.ms += ms
    playEnd = Math.max(playEnd, at) + ms
  }

  function called(c: { id: string; name: string; args: string; rid: string }) {
    const t = owner.get(c.rid)
    if (!t || t !== turn || c.name !== LOOK_TOOL.name || (t.state !== "answering" && t.state !== "looking")) return
    if (!t.call) {
      t.call = { id: c.id, looked: false, answered: false }
      t.state = "looking"
      o.state("thinking")
      // (dictation's words are the question; they're a moment behind at most)
      t.call.timer = setTimeout(() => look(t, true), HEARD)
    }
    if (c.args) { try { t.call.question = String(JSON.parse(c.args).question ?? "") } catch { /* as heard */ } }
    look(t)
  }
  /** The screen round sent, once the user's words are here (or waited for long enough). */
  function look(t: Turn, late = false) {
    const c = t.call
    if (!c || c.looked || t !== turn || t.state !== "looking") return
    // (dictation's words first, else the tool's question, else either once waited for)
    if (!late && (t.heard === undefined || (!t.heard.trim() && c.question === undefined))) return
    const question = t.heard?.trim() || c.question?.trim() || "(not heard: what they said last)"
    clearTimeout(c.timer)
    c.looked = true
    t.lookedAt = now()
    o.look({ question, talk: [...talk] })
    c.timer = setTimeout(() => {
      if (turn !== t || c.answered || t.state !== "looking") return
      c.answered = true
      t.ended = true
      s?.output(c.id, JSON.stringify({ error: "the look took too long" }))
      ask(t, null)
    }, LOOK)
  }

  /** A response made by the turn (null: its own words, after a tool's output; else to say `text` as it is). */
  function ask(t: Turn, text: string | null) {
    const live = s
    if (!live) return
    const n = live.respond(text === null ? {} : { instructions: verbatim(text), tool_choice: "none" })
    if (text) t.pieces.set(n, text)
    t.asks.add(n)
    t.answerAsks.add(n)
    t.open++
  }

  function responded(d: { id: string; status: string; usage?: Usage; error?: string }) {
    const t = owner.get(d.id)
    streams.get(d.id)?.end()
    streams.delete(d.id)
    if (!t) return
    if (d.usage) { t.usage.push(d.usage); t.cost += costOf(cfg?.model ?? "", d.usage) }
    if (t.answerRids.has(d.id)) { t.open--; told(t, d.id) }
    if (t !== turn) return
    if (d.status === "failed" || d.status === "incomplete") { if (!t.first) return fail(t, d.error ?? d.status) }
    if (t.state === "answering" && d.status === "completed") return finish(t)
    if (t.state === "looking" && t.ended && t.open <= 0 && t.call?.answered) finish(t)
  }

  /** An answer's piece made whole: its sentences, when they're heard and for how long (its audio's place in the queue). */
  function told(t: Turn, rid: string) {
    const sp = t.spoken.get(rid), it = sp?.item ? items.get(sp.item) : undefined
    if (!sp?.text || !it || t !== turn || t.state === "stopped") return
    const parts = sentences(sp.text), chars = parts.reduce((n, x) => n + x.length, 0) || 1
    let at = it.start
    for (const x of parts) { const dur = (it.ms * x.length) / chars; o.heard?.({ text: x, at: Math.round(at), dur: Math.round(dur) }); at += dur }
  }

  /** The account can't pay: no try for a while, said once, then one try in the background. */
  function pause(why: string) {
    pausedUntil = now() + PAUSE
    if (!toldPause) { toldPause = true; o.notice?.(why) }
    const was = s
    s = null
    queueMicrotask(() => was?.close())
    if (retry) clearTimeout(retry)
    retry = setTimeout(probe, PAUSE)
    retry.unref?.()
  }
  /** A word asked of it in text, outside the conversation: paid for, it's back; refused again, paused again. */
  function probe() {
    retry = null
    if (!cfg) return
    let over = false
    const end = (quota: boolean, why = "") => {
      if (over) return
      over = true
      p.close()
      if (quota) return pause(why)
      pausedUntil = 0; toldPause = false
    }
    const p = realtimeSession({ ...cfg, instructions: "Answer with one word.", tools: [] }, {
      done: (d) => end(!!d.quota, d.error), error: (e) => end(!!e.quota, e.message),
    })
    p.respond({ output_modalities: ["text"], conversation: "none", max_output_tokens: 16, instructions: "Say OK." })
  }

  function errored(message: string, fatal: boolean) {
    const t = turn
    if (!t) return
    // (before it said anything: the pipeline has the turn; after, what's left of it is the pipeline's voice)
    if ((t.state === "answering" || (t.state === "listening" && t.released)) && !t.first) return fail(t, message)
    if (t.state === "looking" && (fatal || !t.call?.answered)) fail(t, message)
  }

  function fail(t: Turn, why: string) {
    if (t.state === "failed" || t.state === "pipeline" || t.state === "stopped") return
    const looked = !!t.call?.looked
    t.state = "failed"
    clearTimeout(t.waiting)
    if (t.call) clearTimeout(t.call.timer)
    s?.cancel()
    console.warn(`realtime: ${why}; the pipeline answers`)
    o.log?.({ kind: t.call ? "look" : "talk", cost: t.cost, model: cfg?.model ?? "", usage: t.usage, failed: why })
    // (the screen round already went: its answer is said by the pipeline's voice, as `owns` now says no)
    if (!looked && t.heard !== undefined) o.fallback(t.heard)
  }

  function finish(t: Turn) {
    t.state = "done"
    if (t.call) clearTimeout(t.call.timer)
    if (t.heard?.trim()) talk.push(`they: ${t.heard.trim()}`)
    if (t.said.trim()) talk.push(`you: ${t.said.trim()}`)
    talk.splice(0, Math.max(0, talk.length - 8))
    if (!t.call) o.answered({ heard: t.heard ?? "", said: t.said.trim() })
    o.state("done")
    const r = t.released ?? t.pressed
    o.log?.({ kind: t.call ? "look" : "talk", ...(t.first ? { firstMs: t.first - r } : {}), ...(t.answerFirst ? { answerMs: t.answerFirst - r } : {}), cost: t.cost, model: cfg?.model ?? "", usage: t.usage })
    rest()
  }
  function rest() {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => { if (!turn || turn.state === "done" || turn.state === "stopped") { s?.close(); s = null } }, IDLE)
    idle.unref?.()
  }

  /** What's playing and to come stops; the model told how much of it was heard. */
  function hush(why: string) {
    const t = turn
    if (s) {
      s.cancel()
      const at = now()
      for (const [item, it] of items) if (at - it.start < it.ms) s.truncate(item, Math.max(0, at - it.start))
    }
    items.clear(); streams.clear(); playEnd = 0
    o.player.stop()
    if (t && (t.state === "answering" || t.state === "looking")) {
      if (t.call && !t.call.answered) { clearTimeout(t.call.timer); t.call.answered = true; s?.output(t.call.id, JSON.stringify({ error: why })) }
      t.state = "stopped"
    }
  }

  /** The higher model's say `id` as written so far: said in pieces, the first once it has a few words. */
  function sayText(id: string, whole: string) {
    const t = turn
    if (!t || t.state !== "looking" || !t.call?.looked || t.ended) return
    let c = t.chunks.get(id)
    if (!c) {
      // (a new say: the one before is whole)
      for (const k of t.chunks.keys()) sayEnd(k)
      c = chunker()
      t.chunks.set(id, c)
    }
    t.hold.push(...c.feed(speakable(whole)))
    give(t, false)
    // (its words stopped coming a while: that say is whole)
    clearTimeout(t.quiet)
    t.quiet = setTimeout(() => { if (turn === t) sayEnd(id) }, 1500)
  }
  /** Say `id` whole (none: the higher model's turn is over). */
  function sayEnd(id?: string) {
    const t = turn
    if (!t || t.state !== "looking" || !t.call?.looked || t.ended) return
    for (const [k, c] of t.chunks) if (id === undefined || k === id) { const rest = c.flush(); if (rest) t.hold.push(rest) }
    if (id !== undefined) return give(t, true)
    clearTimeout(t.quiet)
    t.ended = true
    give(t, true)
    // (it only drew, or said nothing: the call closed without words)
    if (!t.call.answered) { t.call.answered = true; clearTimeout(t.call.timer); s?.output(t.call.id, JSON.stringify({ answer: "", shown: "on screen" })) }
    if (t.open <= 0) finish(t)
  }
  function give(t: Turn, final: boolean) {
    const c = t.call
    if (!c || !s) return
    if (!c.answered) {
      const words = t.hold.join(" ").trim()
      if (!words || (!final && words.split(/\s+/).length < 4)) return
      t.hold = []
      clearTimeout(c.timer)
      c.answered = true
      s.output(c.id, JSON.stringify({ answer: words }))
      return ask(t, words)
    }
    for (const p of t.hold.splice(0)) if (p.trim()) ask(t, p)
  }

  return {
    /** Whether it may answer (its key and settings not known yet: maybe). */
    available: () => cfg !== null && !paused(),
    /** The Talk key pressed: the key read, the session opened while they speak. */
    warm() { void refresh().then(() => { if (cfg) session() }) },
    /** A turn begins (the Talk key held over the screen): what was playing stops (barge-in). */
    press() {
      hush("they spoke again")
      if (idle) clearTimeout(idle)
      const t: Turn = { pressed: now(), speech: false, loud: 0, bytes: 0, buf: [], live: null, rs: resampler(), state: "listening", said: "", asks: new Set(), answerAsks: new Set(),
        rids: new Set(), answerRids: new Set(), pieces: new Map(), spoken: new Map(), hold: [], chunks: new Map(), ended: false, open: 0, cost: 0, usage: [] }
      turn = t
      void refresh().then(() => {
        if (turn !== t || t.state !== "listening") return
        const live = session()
        if (!live) return
        live.clear()
        for (const b of t.buf.splice(0)) live.append(b)
        t.live = live
      })
    },
    /** The mic's audio, 16 kHz pcm16 (dictation's tap). */
    audio(b: Buffer) {
      const t = turn
      if (!t || t.state !== "listening" || t.released) return
      // (speech of its own reckoning too: dictation's may come late, its recognizer still connecting)
      let sum = 0
      for (let i = 0; i + 1 < b.length; i += 2) { const v = b.readInt16LE(i); sum += v * v }
      if (b.length >= 2 && Math.sqrt(sum / (b.length / 2)) > 700) t.loud += msOf(b.length, 16_000)
      if (t.loud >= 200) t.speech = true
      const x = t.rs(b)
      t.bytes += x.length
      if (t.live) t.live.append(x); else t.buf.push(x)
    },
    /** Dictation heard speech in this turn (not only silence or a click). */
    speech() { if (turn?.state === "listening") turn.speech = true },
    /** The key let go: it answers now (`where`: the app and window, said to it as words). */
    release(where?: string) {
      const t = turn
      if (!t || t.state !== "listening" || t.released) return
      t.released = now()
      if (!t.speech || msOf(t.bytes) < 250 || paused()) { t.state = "pipeline"; return }
      void refresh().then(() => {
        if (turn !== t || t.state !== "listening") return
        const live = t.live?.alive() && !paused() ? t.live : cfg ? session() : null
        if (!live) { t.state = "pipeline"; if (t.heard !== undefined) o.fallback(t.heard); return }
        if (t.live !== live) { live.clear(); for (const b of t.buf.splice(0)) live.append(b); t.live = live }
        t.state = "answering"
        turns++
        if (where) live.note(where)
        live.commit()
        t.asks.add(live.respond())
        t.waiting = setTimeout(() => { if (turn === t && !t.first) errored(`no answer in ${FIRST / 1000} s`, false) }, FIRST)
      })
    },
    /** Dictation's words for the turn, once settled: whether this front has the turn (else the pipeline does). */
    heard(text: string) {
      const t = turn
      if (!t || t.state === "pipeline" || t.state === "failed" || (t.state === "listening" && !t.released)) return false
      t.heard = text
      look(t)
      return true
    },
    /** Whether a say answering an ask made at `t` (its `answers.t`) is this front's to speak. */
    owns: (t: number) => !!turn && turn.state === "looking" && !!turn.lookedAt && t >= turn.lookedAt - 50,
    /** The higher model's say as it's written; `end`: one say whole (no id: its turn is over). */
    text: sayText,
    end: sayEnd,
    /** The companion's state (the server's): busy on the screen round, then done with it, which ends its answer. */
    agent(state: string) {
      const t = turn
      if (!t || t.state !== "looking" || !t.call?.looked) return
      if (state === "thinking" || state === "reading" || state === "writing" || state === "starting") t.busy = true
      else if ((state === "watching" || state === "away") && (t.busy || t.chunks.size)) sayEnd()
    },
    /** Silence (Esc, moving on, a new ask): what it says stops, the turn over. */
    stop: () => hush("they stopped you"),
    /** Whether it's speaking or about to (its cursor shows it speaking). */
    speaking: () => !!turn && (turn.state === "answering" || turn.state === "looking" || turn.state === "done") && playEnd > now(),
    close() { hush("closed"); s?.close(); s = null; turn = null; if (idle) clearTimeout(idle); if (retry) clearTimeout(retry) },
  }
}
export type RealtimeFront = ReturnType<typeof realtimeFront>
