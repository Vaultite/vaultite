// About how many tokens Claude reads for a text, without its tokenizer: pieces a tokenizer keeps together, each costing
// what such a piece usually does. Rough by design: prose near chars/4, code nearer chars/3.

const PIECE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{M}]+|\p{N}+|[ \t]+|\n+|[\p{P}\p{S}]+|[^]/gu

/** Past this, a text is estimated from evenly spaced samples, scaled up: a 16 MB note's takes milliseconds, not seconds. */
const SAMPLE_PAST = 1 << 20, SAMPLES = 64, SAMPLE = 8192

export function estimateTokens(text: string): number {
  if (text.length <= SAMPLE_PAST) return Math.round(count(text))
  const step = text.length / SAMPLES
  let n = 0
  for (let i = 0; i < SAMPLES; i++) n += count(text.slice(Math.floor(i * step), Math.floor(i * step) + SAMPLE))
  return Math.round(n * text.length / (SAMPLES * SAMPLE))
}

function count(text: string): number {
  let n = 0
  for (const [p] of text.matchAll(PIECE)) {
    const c = p.charCodeAt(0), len = p.length
    if (/^[A-Za-z]+$/.test(p)) n += 1 + Math.floor((len - 1) / 7)
    else if (/^[\p{L}\p{M}]+$/u.test(p)) n += len === 1 && c >= 0x2e80 ? 1.2 : Math.ceil(len / 3)
    else if (/^\p{N}+$/u.test(p)) n += Math.ceil(len / 3)
    else if (c === 32 || c === 9) n += len === 1 ? 0 : Math.ceil(len / 8)
    else if (c === 10) n += Math.ceil(len / 2)
    else if (/^[\x21-\x7e]+$/.test(p)) n += Math.ceil(len / 2)
    else n += len // emoji and other symbols: a token or more each
  }
  return n
}

/** "~840 tokens", "~1.2k tokens", "~35k tokens", "~1.4M tokens". */
export function tokenText(n: number): string {
  const short = n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : n < 999_500 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`
  return `~${short} token${n === 1 ? "" : "s"}`
}
