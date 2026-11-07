/** The realtime voice's first sound for a Talk key's ask (helper.ts'; plugins/core/companion/AGENTS.md): small talk it
 *  answers alone; for the screen two words, the summoned answer (asked at once, as the pipeline asks) said after them. */
import { realtimeSession, type RealtimeSession } from "./realtime.ts"
import { costOf, instructions, LOOK_TOOL, msOf, resampler, type Usage } from "./realtimelogic.ts"

export type FrontConfig = { url: string; key: string; model: string; voice: string }
/** Where its audio plays (voice.ts' companionVoice): a stream per response, in order; `yield`, an answer said after it
 *  cuts it short (at a pause, past `grace` s of it); stop silences all. */
export type Player = { stream: () => { pcm: (b: Buffer) => void; end: () => void; yield?: (grace?: number) => void }; stop: () => void }
/** A turn's numbers: ms from the key let go to its first audio, what its part cost. */
export type TurnLog = { kind: "talk" | "look"; firstMs?: number; said?: string; cost: number; model: string; usage: Usage[]; failed?: string }
/** Whose a press's answer is: `talk`, it answered alone (what it said); `look`, two words, the summoned answer after
 *  them; `pipeline`, it couldn't (its socket failed, no word in time): the summoned answer alone. */
export type Route = { to: "talk"; heard: string; said: string } | { to: "look" } | { to: "pipeline"; why: string }

type State = "listening" | "answering" | "done" | "pipeline" | "stopped"
type Turn<O> = { owner: O; pressed: number; released?: number; speech: boolean; loud: number; bytes: number; buf: Buffer[]; live: RealtimeSession | null; rs: (b: Buffer) => Buffer
  state: State; heard?: string; first?: number; said: string; rid?: string; routed?: Route["to"]; call?: string
  /** It answered alone, its words waiting for dictation's (their side of the box) before it says so. */
  talked?: boolean
  stream?: ReturnType<Player["stream"]>; cost: number; usage: Usage[]; waiting?: ReturnType<typeof setTimeout> }

/** How much of its few words may still play once the answer after them is ready, before they're cut at a pause (s). */
const GRACE = 0.25

export function realtimeFront<O>(o: {
  /** The session's key and settings; null: the pipeline answers (no key, or voice_front is pipeline). */
  config: () => Promise<FrontConfig | null>
  name: () => string
  /** The languages the user speaks (two letters, likeliest first). */
  languages?: () => string[]
  /** Names and words they use (dictation's dictionary and the vault's), for hearing them right. */
  words?: () => string[]
  player: Player
  /** A press's route, told once (see Route), to the press it's for. */
  route: (owner: O, r: Route) => void
  log?: (owner: O, t: TurnLog) => void
  /** Said once when it pauses (the account can't pay, or its key is refused: the pipeline answers meanwhile); `paused`
   *  told each change of it, null when it's back. */
  notice?: (account: "quota" | "auth", why: string) => void
  paused?: (p: { account: "quota" | "auth"; why: string; until: number } | null) => void
  /** How long it pauses then, before it tries again (in the background, once). */
  pauseMs?: number
  /** How long the session stays open unused. */
  idleMs?: number
  /** How long after the key is let go its first words, and its route, may take before the pipeline answers instead. */
  firstMs?: number; routeMs?: number
}) {
  const now = () => Date.now()
  const IDLE = o.idleMs ?? 10 * 60_000, FIRST = o.firstMs ?? 4000, ROUTE = o.routeMs ?? 8000
  let cfg: FrontConfig | null | undefined, cfgAt = 0, cfgLoading: Promise<void> | null = null
  let s: RealtimeSession | null = null, sKey = "", turns = 0
  let turn: Turn<O> | null = null, idle: ReturnType<typeof setTimeout> | null = null
  /** Paused till then: the account can't pay, so no press tries it (told once); then one try in the background. */
  let pausedUntil = 0, toldPause = false, retry: ReturnType<typeof setTimeout> | null = null
  const paused = () => now() < pausedUntil
  const PAUSE = o.pauseMs ?? 10 * 60_000
  /** The talk so far, theirs and its (the summoned session's answers too), for the summoned session's asks. */
  const talk: string[] = []
  const said = (who: "they" | "you", x: string) => { if (x.trim()) talk.push(`${who}: ${x.trim()}`); talk.splice(0, Math.max(0, talk.length - 8)) }
  /** What's queued to the player, by item: when it starts and how long it is (for a truncate at barge-in). */
  let playEnd = 0
  const items = new Map<string, { start: number; ms: number }>()

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
    const me: RealtimeSession = realtimeSession({ ...cfg, instructions: instructions(o.name(), o.languages?.() ?? [], o.words?.() ?? []), tools: [LOOK_TOOL] }, {
      began: (rid) => { const t = turn; if (t?.state === "answering" && !t.rid) t.rid = rid },
      audio: (b, rid, item) => heardAudio(b, rid, item),
      said: (d, rid) => { const t = turn; if (t?.rid === rid) t.said += d },
      call: (c) => called(c),
      done: (d) => { if (d.account) pause(d.account, d.error ?? "refused"); responded(d) },
      error: (e) => { if (me !== s) return; if (e.account) pause(e.account, e.message); if (e.fatal) s = null; errored(e.message) },
    })
    s = me
    return me
  }

  /** The press's route, once; its few words give way to the answer after them. */
  function routeTo(t: Turn<O>, r: Route) {
    if (t.routed || t !== turn) return
    t.routed = r.to
    if (r.to === "look") t.stream?.yield?.(GRACE)
    o.route(t.owner, r)
  }

  function heardAudio(b: Buffer, rid: string, item: string) {
    const t = turn
    if (!t || t.rid !== rid || t.state !== "answering") return
    const at = now()
    if (!t.first) { t.first = at; clearTimeout(t.waiting) }
    if (!t.stream) { t.stream = o.player.stream(); if (t.routed === "look") t.stream.yield?.(GRACE) }
    t.stream.pcm(b)
    const ms = msOf(b.length)
    let it = items.get(item)
    if (!it) { it = { start: Math.max(at, playEnd), ms: 0 }; items.set(item, it) }
    it.ms += ms
    playEnd = Math.max(playEnd, at) + ms
  }

  /** It looks at the screen: what it said is the few words, the answer the summoned session's. */
  function called(c: { id: string; name: string; args: string; rid: string }) {
    const t = turn
    if (!t || t.rid !== c.rid || c.name !== LOOK_TOOL.name || t.state !== "answering") return
    t.call = c.id
    routeTo(t, { to: "look" })
  }

  function responded(d: { id: string; status: string; usage?: Usage; error?: string }) {
    const t = turn
    if (!t || t.rid !== d.id) return
    if (d.usage) { t.usage.push(d.usage); t.cost += costOf(cfg?.model ?? "", d.usage) }
    t.stream?.end()
    if (t.state !== "answering") return
    if (d.status !== "completed" && !t.first) return fail(t, d.error ?? d.status)
    // (its call answered at once: the summoned session's words are said in the pipeline's voice, and told it after)
    if (t.call) s?.output(t.call, JSON.stringify({ answer: "(you're looking: the answer is said for you)" }))
    if (!t.routed && d.status !== "completed") routeTo(t, { to: "pipeline", why: d.error ?? d.status })
    else if (!t.routed) {
      t.talked = true
      if (t.heard !== undefined) talked(t)
      // (dictation's words never came: its side of the box is empty)
      else setTimeout(() => { if (turn === t && !t.routed) { t.heard = ""; talked(t) } }, 1500).unref?.()
    }
    finish(t)
  }
  function talked(t: Turn<O>) {
    said("they", t.heard ?? "")
    said("you", t.said)
    routeTo(t, { to: "talk", heard: t.heard ?? "", said: t.said.trim() })
  }

  /** The account can't pay: no try for a while, said once, then one try in the background. */
  function pause(account: "quota" | "auth", why: string) {
    pausedUntil = now() + PAUSE
    // (a turn waiting on it hands its ask back now, not at its timeout)
    const t = turn
    if (t && !t.first && (t.state === "answering" || (t.state === "listening" && t.released))) fail(t, why)
    if (!toldPause) { toldPause = true; o.notice?.(account, why) }
    o.paused?.({ account, why, until: pausedUntil })
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
    const end = (account: "quota" | "auth" | undefined, why = "") => {
      if (over) return
      over = true
      p.close()
      if (account) return pause(account, why)
      pausedUntil = 0; toldPause = false
      o.paused?.(null)
    }
    const p = realtimeSession({ ...cfg, instructions: "Answer with one word.", tools: [] }, {
      done: (d) => end(d.account, d.error), error: (e) => end(e.account, e.message),
    })
    p.respond({ output_modalities: ["text"], conversation: "none", max_output_tokens: 16, instructions: "Say OK." })
  }

  /** Its socket or response failed: before its route, the pipeline's voice has the answer; after, what it said stands. */
  function errored(message: string) {
    const t = turn
    if (t && (t.state === "answering" || (t.state === "listening" && t.released))) fail(t, message)
  }

  function fail(t: Turn<O>, why: string) {
    if (t.state === "pipeline" || t.state === "stopped" || t.state === "done") return
    t.state = "pipeline"
    clearTimeout(t.waiting)
    if (!t.routed) s?.cancel()
    // (what it began saying ends where it is: an open stream would hold up what plays after it)
    t.stream?.end()
    rest()
    console.warn(`realtime: ${why}${t.routed ? "" : "; the pipeline answers"}`)
    o.log?.(t.owner, { kind: t.routed === "look" ? "look" : "talk", cost: t.cost, model: cfg?.model ?? "", usage: t.usage, failed: why })
    routeTo(t, { to: "pipeline", why })
  }

  function finish(t: Turn<O>) {
    t.state = "done"
    clearTimeout(t.waiting)
    if (t.routed === "look" && t.heard) said("they", t.heard)
    const r = t.released ?? t.pressed
    o.log?.(t.owner, { kind: t.routed === "look" ? "look" : "talk", ...(t.first ? { firstMs: t.first - r } : {}), said: t.said.trim(), cost: t.cost, model: cfg?.model ?? "", usage: t.usage })
    rest()
  }
  function rest() {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => { if (!turn || !["listening", "answering"].includes(turn.state)) { s?.close(); s = null } }, IDLE)
    idle.unref?.()
  }

  /** What's playing and to come stops; the model told how much of it was heard. */
  function hush() {
    const t = turn
    if (s) {
      s.cancel()
      const at = now()
      for (const [item, it] of items) if (at - it.start < it.ms) s.truncate(item, Math.max(0, at - it.start))
    }
    t?.stream?.end()
    items.clear(); playEnd = 0
    o.player.stop()
    if (t && (t.state === "answering" || t.state === "listening")) { clearTimeout(t.waiting); t.state = "stopped" }
    if (s) rest()
  }

  return {
    /** Whether it may answer (its key and settings not known yet: maybe). */
    available: () => cfg !== null && !paused(),
    /** The Talk key pressed: the key read, the session opened while they speak. */
    warm() { void refresh().then(() => { if (cfg) session() }) },
    /** A turn begins (the Talk key held over the screen), for `owner` (the press): what was playing stops (barge-in). */
    press(owner: O) {
      hush()
      if (idle) clearTimeout(idle)
      const t: Turn<O> = { owner, pressed: now(), speech: false, loud: 0, bytes: 0, buf: [], live: null, rs: resampler(), state: "listening", said: "", cost: 0, usage: [] }
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
      if (!t.speech || msOf(t.bytes) < 250 || paused()) { t.state = "pipeline"; rest(); return }
      void refresh().then(() => {
        if (turn !== t || t.state !== "listening") return
        const live = t.live?.alive() && !paused() ? t.live : cfg ? session() : null
        if (!live) return fail(t, "no session")
        if (t.live !== live) { live.clear(); for (const b of t.buf.splice(0)) live.append(b); t.live = live }
        t.state = "answering"
        turns++
        if (where) live.note(where)
        live.commit()
        live.respond()
        t.waiting = setTimeout(() => { if (turn === t && !t.first) errored(`no answer in ${FIRST / 1000} s`) }, FIRST)
        setTimeout(() => { if (turn === t && !t.routed) errored(`no route in ${ROUTE / 1000} s`) }, ROUTE).unref?.()
      })
    },
    /** Dictation's words for `owner`'s press: `false`, the pipeline's alone; `held`, its first sound is this front's, the
     *  summoned answer waiting for its route; `through`, routed `look` already; `done`, it answered alone (told now). */
    heard(owner: O, text: string): false | "held" | "through" | "done" {
      const t = turn
      if (!t || t.owner !== owner || t.state === "stopped" || t.routed === "pipeline" || (t.state === "listening" && !t.released)) return false
      if (t.talked && !t.routed) { t.heard = text; talked(t); return "done" }
      if (t.routed === "talk") return "done"
      if (!text.trim() || t.state === "pipeline") return false
      t.heard = text
      if (t.state === "done" && t.routed === "look") said("they", text)
      return t.routed === "look" ? "through" : "held"
    },
    /** The summoned session's answer to `owner`'s look, whole: told to its conversation, so what follows knows it. */
    answer(owner: O, text: string) {
      const t = turn
      if (!t || t.owner !== owner || t.routed !== "look" || !text.trim()) return
      said("you", text)
      s?.note(`(What you answered after looking at the screen: ${JSON.stringify(text.trim().slice(0, 600))})`)
    },
    /** The talk so far (theirs and its), for the summoned session's ask. */
    talk: () => [...talk],
    /** Silence (Esc, a new ask): what it says stops, the turn over. */
    stop: () => hush(),
    /** Whether it's speaking or about to (its cursor shows it speaking). */
    speaking: () => !!turn && (turn.state === "answering" || turn.state === "done") && playEnd > now(),
    close() { hush(); s?.close(); s = null; turn = null; if (idle) clearTimeout(idle); if (retry) clearTimeout(retry) },
  }
}
export type RealtimeFront<O = unknown> = ReturnType<typeof realtimeFront<O>>
