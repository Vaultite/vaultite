// The realtime voice front's reckoning (realtime.ts, realtimefront.ts), apart from Electron so it's tested alone
// (tools/test/vault/realtime.ts): the mic's audio made 24 kHz, what the model is told, what an ask costs.

/** OpenAI Realtime's PCM: 16-bit mono, little-endian, 24 kHz, in and out (voice.swift plays the same). */
export const RT_RATE = 24_000
/** The microphone's (dictation.swift's tap). */
export const MIC_RATE = 16_000

/** A stream of 16-bit PCM at `from` Hz made `to` Hz, chunk by chunk (linear: speech needs no more), its phase kept
 *  across chunks so their joins don't click. */
export function resampler(from = MIC_RATE, to = RT_RATE) {
  const step = from / to
  // (pos is in this chunk's samples; -1 is the chunk before's last one)
  let pos = 0, last = 0
  return (b: Buffer): Buffer => {
    const n = Math.floor(b.length / 2)
    if (!n) return Buffer.alloc(0)
    const at = (i: number) => (i < 0 ? last : b.readInt16LE(i * 2))
    const out: number[] = []
    for (; pos <= n - 1; pos += step) {
      const i = Math.floor(pos), f = pos - i
      out.push(f ? Math.round(at(i) * (1 - f) + at(i + 1) * f) : at(i))
    }
    pos -= n
    last = at(n - 1)
    const o = Buffer.alloc(out.length * 2)
    out.forEach((v, i) => o.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2))
    return o
  }
}

/** Milliseconds of 16-bit mono PCM at `rate`. */
export const msOf = (bytes: number, rate = RT_RATE) => (bytes / 2 / rate) * 1000

/** The model's one tool: a round on the higher model with the screen. */
export const LOOK_TOOL = {
  type: "function",
  name: "look_at_screen",
  description: "Look at the user's screen: what's under their pointer, the window, what they drew. Call it for anything about what they see, point at or work on (this, here, that button, this page, my email, what's open), and for anything you'd have to look up or do. It answers in a few seconds with the words to say.",
  parameters: { type: "object", properties: { question: { type: "string", description: "what they asked, in their words and language" } }, required: ["question"] },
} as const

/** What the realtime model is told, the same every session (its cached input stays warm). */
export function instructions(name: string) {
  return `You're ${name || "the companion"}, the user's companion on their Mac: they hold a key, speak to you, and let go; you answer out loud at once, by their pointer.
You can't see their screen. Anything about what's on it (this, here, that, this page, this button, my email, what's open, what they drew) or anything you'd have to look up, read or do: say a few natural words first, like "Let me look" or "Deixa eu ver", then call look_at_screen with their question. Never guess or describe what's on screen yourself.
Small talk, a quick fact, a word's meaning, a sum, how are you: answer yourself, no tool.
When look_at_screen returns, its answer is what you say: word for word, nothing added or left out.
Talk like a friend beside them: the answer first, one or two short sentences with contractions, about 25 words unless they ask for more. No lists, symbols, ids, or long numbers read out.
They speak English and Brazilian Portuguese, often mixed: answer in the language they spoke last.`
}

/** A response's instructions when it's to say `text` as it is (the higher model's answer, a piece at a time). */
export const verbatim = (text: string) => `Say exactly this, in its own language, word for word, and nothing else, as a natural spoken reply: ${JSON.stringify(text)}`

/** OpenAI's list prices for gpt-realtime-2.1 and its mini, USD per million tokens (developers.openai.com, 2026-11). */
export const PRICES: Record<string, { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }> = {
  "gpt-realtime-mini": { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
  "gpt-realtime": { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
}
export const priceOf = (model: string) => PRICES[/mini/.test(model) ? "gpt-realtime-mini" : "gpt-realtime"]

/** A response's usage (response.done's `usage`). */
export type Usage = { input_tokens?: number; output_tokens?: number
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } }
  output_token_details?: { text_tokens?: number; audio_tokens?: number } }
/** What a response cost, in USD. */
export function costOf(model: string, u: Usage | undefined) {
  if (!u) return 0
  const p = priceOf(model), i = u.input_token_details ?? {}, o = u.output_token_details ?? {}, c = i.cached_tokens_details ?? {}
  const cachedText = c.text_tokens ?? 0, cachedAudio = c.audio_tokens ?? 0
  const text = Math.max(0, (i.text_tokens ?? 0) - cachedText), audio = Math.max(0, (i.audio_tokens ?? 0) - cachedAudio)
  return (text * p.textIn + cachedText * p.textCached + audio * p.audioIn + cachedAudio * p.audioCached + (o.text_tokens ?? 0) * p.textOut + (o.audio_tokens ?? 0) * p.audioOut) / 1e6
}
