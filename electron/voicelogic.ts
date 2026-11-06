// The companion's voice apart from Electron (tools/test/vault/voice.ts): says cut in pieces as they stream, made by a cloud
// voice a few ahead, played in order; what the cloud can't make (no key, offline, dropped) this Mac says, from there on.
import { chunker, languageOf } from "../plugins/core/companion/spoken.ts"

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

type Slot = { p: Piece; state: "wait" | "making" | "made" | "failed" | "done"; bufs: Buffer[]; fwd: number; sent: number; timed?: Timed; cancel?: () => void; timer?: ReturnType<typeof setTimeout> }

export type VoiceOptions = {
  out: Out
  /** The cloud voice now (null: none, this Mac's). */
  cloud: () => Cloud | null
  /** The languages the user speaks (two letters), the first the likeliest. */
  hints: () => string[]
  /** Pieces made ahead of the one playing. */
  ahead?: number
  /** A piece whose first audio hasn't come by then, or whose audio stalls that long, is this Mac's. */
  firstMs?: number
  stallMs?: number
  /** What happened, for the log and tests: a piece's first audio, a fallback and why. */
  told?: (e: { t: "audio"; n: number; ms: number } | { t: "fallback"; n: number; why: string; from: number }) => void
}

/** The voice of one answer at a time: `start` begins one (silencing the last), its says' text comes as it grows (`text`)
 *  and ends (`end`); `stop` silences it. */
export function voice(o: VoiceOptions) {
  const ahead = o.ahead ?? 3, firstMs = o.firstMs ?? 2500, stallMs = o.stallMs ?? 3000
  let slots: Slot[] = [], head = 0, local = false, language: string | null = null, asked = "", n = 0, on = false
  let says = new Map<string, ReturnType<typeof chunker>>()

  function add(text: string) {
    language ??= languageOf(`${asked} ${text}`, o.hints())
    slots.push({ p: { n: ++n, text, language }, state: "wait", bufs: [], fwd: 0, sent: 0 })
    if (!local && !o.cloud()) local = true
    drain()
  }

  /** What's at the head goes out in order: a made piece's audio, or this Mac's voice for one the cloud didn't make;
   *  then the next few are made ahead. */
  function drain() {
    while (head < slots.length) {
      const s = slots[head]
      for (; s.fwd < s.bufs.length; s.fwd++) { o.out.pcm(s.p.n, s.bufs[s.fwd]); s.sent += s.bufs[s.fwd].length }
      if (s.state === "made") { o.out.end(s.p.n); s.state = "done"; head++; continue }
      if (s.state === "failed" || (s.state === "wait" && local)) {
        const rest = resume(s)
        if (rest) o.out.say(s.p.n, rest, s.p.language)
        o.out.end(s.p.n)
        s.state = "done"; head++
        continue
      }
      break
    }
    if (local) return
    let making = slots.filter((s) => s.state === "making").length
    for (let i = head; i < slots.length && making < ahead; i++) if (slots[i].state === "wait") { make(slots[i]); making++ }
  }

  function make(s: Slot) {
    const cloud = o.cloud()
    if (!cloud) return fail(s, "no cloud voice")
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
      },
      end() { if (!live()) return; clearTimeout(s.timer); s.state = "made"; drain() },
      fail(why) { if (live()) fail(s, why) },
    })
  }

  /** The cloud failed a piece: it and every piece not made yet are this Mac's, on from where its audio got. */
  function fail(s: Slot, why: string) {
    if (!slots.includes(s)) return
    local = true
    for (const x of slots) if (x.state === "making" || x === s) { clearTimeout(x.timer); if (x.state === "making") x.cancel?.(); x.state = "failed" }
    o.told?.({ t: "fallback", n: s.p.n, why, from: s.sent })
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

  function silence() {
    for (const s of slots) { clearTimeout(s.timer); if (s.state === "making") s.cancel?.() }
    if (slots.length || on) o.out.stop()
    slots = []; head = 0; says = new Map(); on = false
  }

  return {
    /** A new answer to an ask in `asked` words (its language's best hint): what was speaking stops. */
    start(words = "") { silence(); asked = words; language = null; local = false; on = true },
    /** Say `id`'s text so far (its whole text each time). */
    text(id: string, whole: string) {
      if (!on) return
      let c = says.get(id)
      if (!c) { c = chunker(); says.set(id, c) }
      for (const piece of c.feed(whole)) add(piece)
    },
    /** Say `id`'s last words are in (no id: every say's). */
    end(id?: string) {
      if (!on) return
      for (const [k, c] of says) if (!id || k === id) { const rest = c.flush(); if (rest) add(rest) }
    },
    /** Silence at once: what's playing and what's to come. */
    stop: silence,
    /** Whether an answer is being spoken (some of it still to come or to play). */
    on: () => on,
    /** The pieces so far, for tests. */
    pieces: () => slots.map((s) => ({ ...s.p, state: s.state })),
  }
}
export type Voice = ReturnType<typeof voice>
