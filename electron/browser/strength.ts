import { ZxcvbnFactory } from "@zxcvbn-ts/core"
import { adjacencyGraphs, dictionary as common } from "@zxcvbn-ts/language-common"
import { dictionary as english } from "@zxcvbn-ts/language-en"

export const EFF_WORDS: readonly string[] = common["diceware-common"]

const READ = 128
const zxcvbn = new ZxcvbnFactory({ dictionary: { ...common, ...english }, graphs: adjacencyGraphs, maxLength: READ })
const KINDS: [RegExp, number][] = [[/[a-z]/, 26], [/[A-Z]/, 26], [/\d/, 10], [/[ -/:-@[-`{-~]/, 33], [/[^ -~]/, 100]]
const perChar = (s: string) => Math.log2(KINDS.reduce((n, [has, size]) => n + (has.test(s) ? size : 0), 0) || 1)

/** zxcvbn counts a stretch it knows nothing of as 10 guesses a character, and takes a short word in it along. */
function outsideWords(stretch: string, per: number) {
  let bits = 0
  for (const part of stretch.match(/\p{L}+|\P{L}+/gu) ?? []) {
    const whole = part.length * per, known = part.length > 3 ? zxcvbn.check(part) : null
    bits += known && known.sequence.every((m) => m.pattern !== "bruteforce") ? Math.min(whole, Math.log2(known.guesses)) : whole
  }
  return bits
}

const WORD_SET = new Set(EFF_WORDS), PER_WORD = Math.log2(EFF_WORDS.length)
function phraseBits(password: string): number | null {
  const parts = password.split(/[-._ ]/).map((w) => /^(\p{L}+)(\d?)$/u.exec(w)), words = parts.map((m) => m?.[1] ?? "")
  if (parts.length < 3 || !words.every((w) => WORD_SET.has(w.toLowerCase()))) return null
  return parts.length * PER_WORD + (parts.some((m) => m?.[2]) ? Math.log2(10 * parts.length) : 0) + (words.some((w) => /\p{Lu}/u.test(w)) ? 1 : 0)
}

export function bitsOf(password: string): number {
  if (!password) return 0
  const read = password.slice(0, READ), phrase = phraseBits(read), per = perChar(read)
  return phrase ?? zxcvbn.check(read).sequence.reduce((n, m) => n + (m.pattern === "bruteforce" ? outsideWords(m.token, per) : Math.log2(Math.max(1, m.guesses))), 0)
}
