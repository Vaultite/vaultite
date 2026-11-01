// About how many tokens Claude reads for a text, without its tokenizer: pieces a tokenizer keeps together, each costing
// what such a piece usually does. Rough by design: prose near chars/4, code nearer chars/3.

const PIECE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{M}]+|\p{N}+|[ \t]+|\n+|[\p{P}\p{S}]+|[^]/gu

/** Past this, a text is estimated from evenly spaced samples, scaled up: a 16 MB note's takes milliseconds, not seconds. */
const SAMPLE_PAST = 1 << 20, SAMPLES = 64, SAMPLE = 8192

export function estimateTokens(text: string): number {
  const was = last
  last = new Map()
  if (text.length <= SAMPLE_PAST) return Math.round(byLines(text, was) / 5)
  const step = text.length / SAMPLES
  let n = 0
  for (let i = 0; i < SAMPLES; i++) n += byLines(text.slice(Math.floor(i * step), Math.floor(i * step) + SAMPLE), was)
  return Math.round(n / 5 * text.length / (SAMPLES * SAMPLE))
}

/** The last text's lines' counts: a note counted again as it's typed counts only the lines that changed. */
let last = new Map<string, number>()
/** A text's count, line by line: a run of newlines ends a piece, so the lines' counts add up to the whole's. */
function byLines(text: string, was: Map<string, number>): number {
  let n = 0
  for (let a = 0; a < text.length;) {
    let b = text.indexOf("\n", a)
    if (b < 0) b = text.length
    else while (text.charCodeAt(b) === 10) b++
    const line = text.slice(a, b)
    let c = last.get(line) ?? was.get(line)
    if (c === undefined) c = count(line)
    last.set(line, c)
    n += c
    a = b
  }
  return n
}

/** In fifths of a token (whole numbers: a sum doesn't depend on how it's split). */
function count(text: string): number {
  let n = 0
  for (const [p] of text.matchAll(PIECE)) {
    const c = p.charCodeAt(0), len = p.length
    if (/^[A-Za-z]+$/.test(p)) n += 5 * (1 + Math.floor((len - 1) / 7))
    else if (/^[\p{L}\p{M}]+$/u.test(p)) n += len === 1 && c >= 0x2e80 ? 6 : 5 * Math.ceil(len / 3)
    else if (/^\p{N}+$/u.test(p)) n += 5 * Math.ceil(len / 3)
    else if (c === 32 || c === 9) n += len === 1 ? 0 : 5 * Math.ceil(len / 8)
    else if (c === 10) n += 5 * Math.ceil(len / 2)
    else if (/^[\x21-\x7e]+$/.test(p)) n += 5 * Math.ceil(len / 2)
    else n += 5 * len // emoji and other symbols: a token or more each
  }
  return n
}

/** "840", "1.2k", "35k", "1.4M". */
export const shortTokens = (n: number) => n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  : n < 999_500 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`

/** "~840 tokens", "~1.2k tokens", "~35k tokens", "~1.4M tokens". */
export const tokenText = (n: number) => `~${shortTokens(n)} token${n === 1 ? "" : "s"}`
