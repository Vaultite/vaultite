export const NICKNAME_FILE = ".vaultite/vault.json"

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean)
export const folderName = (p: string) => parts(p).at(-1) ?? p

export const NICKNAME_MAX = 80
export const NICKNAME_HINT = "Shown instead of the folder's name; the folder isn't renamed"
export const nicknameText = (typed: string) => typed.replace(/\s+/g, " ").trim().slice(0, NICKNAME_MAX)
export const nicknameTyped = (typed: string, p: string) => {
  const n = nicknameText(typed)
  return n && n !== folderName(p) ? n : null
}

export const vaultName = (p: string, nickname = "") => nickname || folderName(p)

export type Named = { path: string; nickname?: string }

export function listNames(vaults: Named[]): string[] {
  const names = vaults.map((v) => vaultName(v.path, v.nickname))
  return vaults.map((v, i) => {
    const others = vaults.flatMap((o, j) => (j !== i && names[j] === names[i] ? [parts(o.path)] : []))
    if (!others.length) return names[i]
    const mine = parts(v.path), tail = (ps: string[], n: number) => ps.slice(-n).join("/")
    let n = v.nickname ? 1 : 2
    while (n < mine.length && others.some((o) => tail(o, n) === tail(mine, n))) n++
    return v.nickname ? `${names[i]} · ${tail(mine, n)}` : tail(mine, n)
  })
}
