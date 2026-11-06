// The companion's voice apart from Electron (tools/test/vault/voice.ts): says cut in pieces as they stream, made by cloud
// voices a few ahead, played in order; one that fails (offline, dropped) hands on to the next, then this Mac's, from there.
import { type Heard, sentences } from "../plugins/core/companion/screenmarks.ts"
import { chunker, languageOf, sayable } from "../plugins/core/companion/spoken.ts"

/** A piece of an answer: its plain words, in its language (two letters). `n` counts every piece ever, so what a player
 *  says late of an older one is told apart. */
export type Piece = { n: number; text: string; language: string }
/** A cloud voice's characters, each with when it ends (seconds into the piece's audio), as made so far. */
export type Timed = { chars: string[]; ends: number[] }
/** What a cloud voice tells of a piece it makes: its audio as it comes (PCM, 16-bit mono at `RATE`), its end, or why
 *  it failed. */
export type Made = { audio: (pcm: Buffer, timed?: Timed) => void; end: () => void; fail: (why: string) => void }
/** A cloud voice (tts.ts): makes a piece, answering a cancel. */
export type Cloud = { make: (p: Piece, to: Made) => () => void }
/** Where audio goes, in order (voice.swift): a piece's PCM, or its words for this Mac's voice to say; `end` says a
 *  piece has all it gets; `stop` silences all at once. */
export type Out = { pcm: (n: number, pcm: Buffer) => void; say: (n: number, text: string, language: string) => void; end: (n: number) => void; stop: () => void }
export const RATE = 24_000
const BYTES_PER_S = RATE * 2

/** `say`: the say it's of; `at`: when it's heard (the player's), `told` its sentences heard so far, told on. */
type Slot = { p: Piece; say: string; state: "wait" | "making" | "made" | "done"; bufs: Buffer[]; fwd: number; sent: number; timed?: Timed; cancel?: () => void; timer?: ReturnType<typeof setTimeout>
  at?: number; told: number }

export type VoiceOptions = {
  out: Out
  /** The cloud voices now, the first tried first (none: this Mac's). */
  clouds: () => Cloud[]
  /** The languages the user speaks (two letters), the first the likeliest. */
  hints: () => string[]
  /** Pieces made ahead of the one playing. */
  ahead?: number
  /** A piece whose first audio hasn't come by then, or whose audio stalls that long, is the next voice's. */
  firstMs?: number
  stallMs?: number
  /** Each sentence as it's heard (a piece's start, by the player, and its characters' timing): the drawing's pen keeps
   *  to them. A piece with no timing (this Mac's voice) tells none. */
  heard?: (h: Heard & { say: string }) => void
  /** What happened, for the log and tests: a piece's first audio, a fallback and why. */
  told?: (e: { t: "audio"; n: number; ms: number } | { t: "fallback"; n: number; why: string; from: number; to: number }) => void
}

/** The voice of one answer at a time: `start` begins one (silencing the last), its says' text comes as it grows (`text`)
 *  and ends (`end`); `stop` silences it. */
export function voice(o: VoiceOptions) {
  const ahead = o.ahead ?? 3, firstMs = o.firstMs ?? 2500, stallMs = o.stallMs ?? 3000
  /** `tier`: the cloud voice this answer is at (past the last: this Mac's). */
  let slots: Slot[] = [], head = 0, tier = 0, language: string | null = null, asked = "", n = 0, on = false
  const local = () => tier >= o.clouds().length
  let says = new Map<string, ReturnType<typeof chunker>>()

  function add(text: string, say: string) {
    language ??= languageOf(`${asked} ${text}`, o.hints())
    slots.push({ p: { n: ++n, text: sayable(text, language), language }, say, state: "wait", bufs: [], fwd: 0, sent: 0, told: 0 })
    drain()
  }

  /** What's at the head goes out in order: a made piece's audio, or this Mac's voice for one no cloud made; then the
   *  next few are made ahead. */
  function drain() {
    while (head < slots.length) {
      const s = slots[head]
      for (; s.fwd < s.bufs.length; s.fwd++) { o.out.pcm(s.p.n, s.bufs[s.fwd]); s.sent += s.bufs[s.fwd].length }
      if (s.state === "made") { o.out.end(s.p.n); s.state = "done"; head++; continue }
      if (s.state === "wait" && local()) {
        if (s.p.text) o.out.say(s.p.n, s.p.text, s.p.language)
        o.out.end(s.p.n)
        s.state = "done"; head++
        continue
      }
      break
    }
    if (local()) return
    let making = slots.filter((s) => s.state === "making").length
    for (let i = head; i < slots.length && making < ahead; i++) if (slots[i].state === "wait") { make(slots[i]); making++ }
  }

  function make(s: Slot) {
    const cloud = o.clouds()[tier]
    if (!cloud) return
    s.state = "making"
    const t0 = Date.now()
    const watch = (ms: number, why: string) => { clearTimeout(s.timer); s.timer = setTimeout(() => fail(s, why), ms) }
    watch(firstMs, "its first audio was late")
    const live = () => slots.includes(s) && s.state === "making"
    s.cancel = cloud.make(s.p, {
      audio(pcm, timed) {
        if (!live()) return
        if (!s.bufs.length) o.told?.({ t: "audio", n: s.p.n, ms: Date.now() - t0 })
        s.bufs.push(pcm)
        if (timed) s.timed = timed
        watch(stallMs, "its audio stalled")
        if (slots[head] === s) drain()
        tell(s)
      },
      end() { if (!live()) return; clearTimeout(s.timer); s.state = "made"; drain(); tell(s) },
      fail(why) { if (live()) fail(s, why) },
    })
  }

  /** A cloud failed a piece: it and every piece not made yet go to the next voice, each on from where its audio got
   *  (what's played of it stays: the next says the rest, from the next word). */
  function fail(s: Slot, why: string) {
    if (!slots.includes(s)) return
    tier++
    o.told?.({ t: "fallback", n: s.p.n, why, from: s.sent, to: tier })
    for (const x of slots) if (x.state === "making") {
      clearTimeout(x.timer); x.cancel?.()
      x.p = { ...x.p, text: resume(x) }
      // (its timing starts again with the next voice, its start long told: its sentences aren't told on)
      Object.assign(x, { state: x.p.text ? "wait" : "made", bufs: [], fwd: 0, sent: 0, timed: undefined, told: x.at === undefined ? 0 : Infinity })
    }
    drain()
  }

  /** A piece's words still to say: past the characters its audio sent so far has said, from the next word. */
  function resume(s: Slot) {
    if (!s.sent) return s.p.text
    const said = s.sent / BYTES_PER_S, t = s.timed
    if (!t?.ends.length) return s.p.text
    let k = 0
    while (k < t.ends.length && t.ends[k] <= said) k++
    if (k >= t.chars.length) return ""
    // (its characters as the voice had them: found in the text, on from the next word)
    const spoken = t.chars.slice(0, k).join("")
    const at = Math.min(s.p.text.length, spoken.length), rest = s.p.text.slice(at)
    const from = at === 0 || /\s/.test(s.p.text[at - 1]) ? 0 : rest.search(/\s/)
    return from < 0 ? "" : rest.slice(from).trim()
  }

  /** A piece's sentences told as heard, once it's playing and their characters are timed (its last, once it's all made). */
  function tell(s: Slot) {
    const t = s.timed
    if (!o.heard || s.at === undefined || !t?.ends.length || s.told === Infinity) return
    let from = 0
    const ss = sentences(s.p.text)
    for (let j = 0; j < ss.length; j++) {
      const a = s.p.text.indexOf(ss[j], from)
      if (a < 0) return
      const b = Math.min(a + ss[j].length, t.chars.length)
      from = a + ss[j].length
      if (j < s.told) continue
      if (t.ends.length < b || (b >= t.chars.length && s.state === "making")) return
      const start = a > 0 ? t.ends[Math.min(a, t.ends.length) - 1] : 0, end = t.ends[b - 1]
      o.heard({ say: s.say, text: ss[j], at: Math.round(s.at + start * 1000), dur: Math.max(0, Math.round((end - start) * 1000)) })
      s.told = j + 1
    }
  }

  function silence() {
    for (const s of slots) { clearTimeout(s.timer); if (s.state === "making") s.cancel?.() }
    if (slots.length || on) o.out.stop()
    slots = []; head = 0; says = new Map(); on = false
  }

  return {
    /** A new answer to an ask in `asked` words, or in `lang` when that's known: what was speaking stops. */
    start(words = "", lang?: string) { silence(); asked = words; language = lang || null; tier = 0; on = true },
    /** Say `id`'s text so far (its whole text each time). */
    text(id: string, whole: string) {
      if (!on) return
      let c = says.get(id)
      if (!c) { c = chunker(); says.set(id, c) }
      for (const piece of c.feed(whole)) add(piece, id)
    },
    /** Say `id`'s last words are in (no id: every say's). */
    end(id?: string) {
      if (!on) return
      for (const [k, c] of says) if (!id || k === id) { const rest = c.flush(); if (rest) add(rest, k) }
    },
    /** Piece `n` is heard from `at` (the player's clock, ms): its sentences are told as heard. */
    played(n: number, at: number) { const s = slots.find((x) => x.p.n === n); if (s && s.at === undefined) { s.at = at; tell(s) } },
    /** Silence at once: what's playing and what's to come. */
    stop: silence,
    /** Whether an answer is being spoken (some of it still to come or to play). */
    on: () => on,
    /** Whether pieces of it are still to go out to the player (made or being made). */
    ahead: () => head < slots.length,
    /** The pieces so far, for tests. */
    pieces: () => slots.map((s) => ({ ...s.p, state: s.state })),
  }
}
export type Voice = ReturnType<typeof voice>
