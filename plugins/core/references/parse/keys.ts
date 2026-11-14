import { type CslItem, type CslName, yearOf } from "../csl.ts"

const FOLDS = new Map([["ß", "ss"], ["ø", "o"], ["æ", "ae"], ["œ", "oe"], ["ł", "l"], ["đ", "d"], ["ð", "d"],
  ["þ", "th"], ["ı", "i"], ["ŋ", "n"]])

export function asciiWord(text: string): string {
  const lower = text.toLowerCase().replace(/[ßøæœłđðþıŋ]/g, (ch) => FOLDS.get(ch) ?? ch)
  return lower.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]/g, "")
}

function nameWord(n: CslName): string {
  if (n.family) return asciiWord(n.family)
  return asciiWord((n.literal ?? n.given ?? "").split(/\s+/)[0] ?? "")
}

function titleWord(title: string): string {
  for (const word of title.replace(/<[^>]*>/g, "").split(/\s+/)) {
    const ascii = asciiWord(word)
    if (ascii) return ascii
  }
  return ""
}

function suffix(n: number): string {
  let out = ""
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(97 + ((i - 1) % 26)) + out
  return out
}

export function makeKey(item: CslItem, taken: Set<string>): string {
  const first = item.author?.[0] ?? item.editor?.[0]
  const who = (first ? nameWord(first) : "") || titleWord(item.title ?? "") || "ref"
  const base = who + (yearOf(item) || "nd")
  let key = base
  for (let n = 1; taken.has(key); n++) key = base + suffix(n)
  taken.add(key)
  return key
}
