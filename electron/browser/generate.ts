import { z } from "zod"

const on = (by: boolean) => z.boolean().catch(by)
const within = (min: number, max: number, by: number) => z.number().catch(by).transform((n) => Math.min(max, Math.max(min, Math.round(n))))
export const GENERATE = z.object({
  kind: z.enum(["password", "passphrase"]).catch("password"),
  length: within(8, 64, 20), upper: on(true), lower: on(true), digits: on(true), symbols: on(true), clear: on(false),
  words: within(3, 12, 6), separator: z.enum(["-", ".", "_", " "]).catch("-"), capitals: on(false), number: on(false),
})
export type Generate = z.output<typeof GENERATE>

const SETS = { upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower: "abcdefghijklmnopqrstuvwxyz", digits: "0123456789", symbols: "!#$%&*+-.:=?@^_~" } as const
const ALIKE = /[0Oo1Il|5S2Z8B]/g
type Random = (a: Uint32Array<ArrayBuffer>) => void
const strong: Random = (a) => { crypto.getRandomValues(a) }

function below(n: number, random: Random) {
  const limit = Math.floor(0x1_0000_0000 / n) * n, a = new Uint32Array(1)
  for (;;) { random(a); if (a[0] < limit) return a[0] % n }
}

export function generatePassword(o: Generate, random = strong) {
  const picked = (["upper", "lower", "digits", "symbols"] as const).filter((k) => o[k])
  const sets = (picked.length ? picked : ["lower" as const]).map((k) => (o.clear ? SETS[k].replace(ALIKE, "") : SETS[k]))
  const all = sets.join("")
  for (;;) {
    let s = ""
    for (let i = 0; i < o.length; i++) s += all[below(all.length, random)]
    if (sets.every((set) => [...s].some((c) => set.includes(c)))) return s
  }
}

export function generatePassphrase(o: Generate, list: readonly string[], random = strong) {
  const words = Array.from({ length: o.words }, () => list[below(list.length, random)])
  if (o.capitals) words.forEach((w, i) => { words[i] = w[0].toUpperCase() + w.slice(1) })
  if (o.number) words[below(words.length, random)] += String(below(10, random))
  return words.join(o.separator)
}
