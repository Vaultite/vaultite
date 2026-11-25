import { localDate } from "../../../core/plugins.ts"
import { nicknameAt } from "../../../core/nickname.ts"
import { vaultName } from "../../../core/vaultname.ts"
import { type Exchange, exchanges, inVault } from "./conversation.ts"
import { plugin } from "./self.ts"
import { ownName } from "./settings.ts"
import { log, acts } from "./state.ts"

const nicknames = new Map<string, string>()
export async function learnNicknames() {
  await Promise.all(plugin.otherLocalDirs().map(async ({ vault }) => { const n = await nicknameAt(vault); if (n !== null) nicknames.set(vault, n) }))
}

export function talkInOtherVaults(day: string): Exchange[] {
  return plugin.otherLocalDirs().flatMap(({ dir, vault }) => {
    const ms = log.readIn(dir, day), as = ms.findLast((m) => m.summoned && m.for)?.for ?? ownName()
    return inVault(exchanges(ms, acts.readIn(dir, day), [], as), vaultName(vault, nicknames.get(vault)))
  })
}

const DAY_MS = 86_400_000
export function talkElsewhere(since: number, t: number): Exchange[] {
  const from = Math.max(since, t - DAY_MS)
  return [...new Set([localDate(from), localDate(t)])].flatMap(talkInOtherVaults).filter((e) => e.t > from && e.t < t).sort((a, b) => a.t - b.t)
}
