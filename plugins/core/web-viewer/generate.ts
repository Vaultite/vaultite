// New passwords for the Passwords page: random from the kinds of characters asked for, each kind in it at least once.
// No DOM or plugin API, so tools/test_web.ts runs it as it is.

export type GenOptions = { length: number; letters: boolean; digits: boolean; symbols: boolean }
export const GEN_DEFAULTS: GenOptions = { length: 20, letters: true, digits: true, symbols: true }

const SETS = {
  letters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!#$%&*+-.:=?@^_~",
} as const

type Random = (a: Uint32Array<ArrayBuffer>) => void

/** A random index below `n`, every one as likely: draws past the last whole multiple of `n` are drawn again. */
function below(n: number, random: Random) {
  const limit = Math.floor(0x1_0000_0000 / n) * n, a = new Uint32Array(1)
  for (;;) { random(a); if (a[0] < limit) return a[0] % n }
}

/** A password of `length` (8 to 64) from the kinds turned on (letters alone when none is); drawn again till it has
 *  each kind, which keeps every such password as likely as any other. */
export function generatePassword(o: GenOptions, random: Random = (a) => { crypto.getRandomValues(a) }) {
  const kinds = (["letters", "digits", "symbols"] as const).filter((k) => o[k])
  const sets = (kinds.length ? kinds : ["letters" as const]).map((k) => SETS[k])
  const all = sets.join(""), length = Math.min(64, Math.max(8, Math.round(o.length) || GEN_DEFAULTS.length))
  for (;;) {
    let s = ""
    for (let i = 0; i < length; i++) s += all[below(all.length, random)]
    if (sets.every((set) => [...s].some((c) => set.includes(c)))) return s
  }
}
