// Which machine (or the cloud, jobs_cloud) a job goes to: those that have what it needs, the most headroom first, then
// the user's order (jobs_machine). Plain functions: workers.ts gathers each one's traits (Machines' list, its capacity).

/** What a job may need of the machine it runs on, besides its repo and agent: this vault (a note, research), an OS, a
 *  desktop to show windows on, or Vaultite's desktop app running there. */
export const NEEDS = ["vault", "macos", "linux", "windows", "desktop", "app"] as const
export type Need = typeof NEEDS[number]
/** A job's needs: those, a checkout of `repo` (GitHub's owner/name or a folder's name), its agent (claude, codex) and account. */
export type Needs = { has: Need[]; repo?: string; agent?: string; account?: string
  /** Its repo says its work runs in the cloud (RULES_FILE's `cloud`). */
  cloud?: boolean }

/** A machine as placement sees it; a field it didn't say rules nothing out. `vault`: it has this vault; `app`: the
 *  desktop app runs there; `jobs` of `cap` the workers it runs now. */
export type Traits = {
  id: string; label: string; self: boolean; online: boolean; standalone: boolean
  platform?: string; vault?: boolean; display?: boolean; app?: boolean
  cores?: number; load?: number; memory?: { total: number; free: number }
  jobs?: number; cap?: number; repos?: string[]; agents?: string[]; accounts?: string[]
  /** Why it takes no jobs now, though it's on. */
  away?: string
  /** The cloud: no cap, nothing of this machine's, only GitHub repos that say they run there. */
  cloud?: boolean
}
/** The cloud's id among the machines (jobs_machine names it so). */
export const CLOUD = "cloud"

const OS: Partial<Record<Need, [string, string]>> = { macos: ["darwin", "macOS"], linux: ["linux", "Linux"], windows: ["win32", "Windows"] }
const osName = (platform: string) => Object.values(OS).find(([p]) => p === platform)?.[1] ?? platform
const lower = (s: string) => s.trim().toLowerCase().replace(/\.git$/, "")

/** Whether `t` has checkout `repo` (by GitHub's owner/name, else its folder's name), when it said which it has. */
export function hasRepo(t: Pick<Traits, "repos">, repo: string) {
  if (!t.repos) return true
  const r = lower(repo), name = r.split("/").pop()!
  return t.repos.includes(r) || t.repos.includes(name)
}

/** Why `t` can't take a job needing `n`, in a few words ("runs Linux", "hasn't site checked out"); "" when it can. */
export function lacks(t: Traits, n: Needs): string {
  if (t.away) return t.away
  if (t.cloud) {
    const local = n.has.find((x) => x !== "linux")
    if (local) return `can't have ${local === "vault" ? "this vault" : local === "app" ? "the desktop app" : local === "desktop" ? "a desktop" : OS[local]?.[1] ?? local}`
    if (!n.repo?.includes("/")) return "takes only a repo on GitHub"
    if (!n.cloud) return `isn't set up for ${n.repo} (its ${RULES_FILE} says no "cloud": true)`
  }
  for (const need of n.has) {
    const os = OS[need]
    if (os && t.platform && t.platform !== os[0]) return `runs ${osName(t.platform)}, not ${os[1]}`
    if (need === "vault" && t.vault === false) return "has another vault"
    if (need === "desktop" && t.display === false) return "has no desktop"
    if (need === "app" && t.app === false) return "has no desktop app running"
  }
  if (n.repo && !hasRepo(t, n.repo)) return `hasn't ${n.repo} checked out`
  if (n.agent && t.agents && !t.agents.includes(n.agent)) return `has no ${n.agent}`
  if (n.account && n.account !== "default" && t.accounts && !t.accounts.includes(n.account)) return `has no account ${n.account}`
  return ""
}

/** How many workers a machine takes at once when it doesn't say: a job (an agent and its builds) wants about 2 cores and 4 GB. */
export const capOf = (cores = 0, memoryMb = 0) => Math.max(1, Math.min(8, Math.floor(Math.min(cores ? cores / 2 : 8, memoryMb ? memoryMb / 4096 : 8))))

/** Room `t` has for one more worker: free (plenty), busy, or full (at its cap, out of memory, or loaded past its cores);
 *  `score` the scarcest of CPU, memory and its slots (0 to 1), and the line saying so. Unknown counts as room. */
export function headroom(t: Traits): { level: "free" | "busy" | "full"; score: number; line: string } {
  const perCore = t.cores && t.load !== undefined ? t.load / t.cores : undefined
  const cap = t.cap ?? (t.cores ? capOf(t.cores, t.memory?.total) : undefined)
  const parts = [perCore !== undefined ? 1 - perCore : 1, t.memory ? t.memory.free / 100 : 1, cap && t.jobs !== undefined ? 1 - t.jobs / cap : 1]
  const score = Math.max(0, Math.min(1, ...parts))
  const full = (cap !== undefined && (t.jobs ?? 0) >= cap) || (!!t.memory && t.memory.free < 10) || (perCore ?? 0) >= 1.5
  const line = [perCore !== undefined ? `load ${perCore.toFixed(2)} per core` : "", t.memory ? `${t.memory.free}% memory free` : "",
    cap !== undefined && t.jobs !== undefined ? `${t.jobs} of ${cap} jobs` : ""].filter(Boolean).join(", ")
  return { level: full ? "full" : score >= 0.4 ? "free" : "busy", score, line }
}

/** The machines jobs may go to, in the user's order (jobs_machine: auto, here, ids or labels): auto is the always-on ones
 *  (this one first if it is one), then this one, which closes any list. `unknown`: names that are no machine. */
export function orderOf(setting: unknown, all: Pick<Traits, "id" | "label" | "self" | "standalone">[]) {
  const words = (Array.isArray(setting) ? setting.map(String) : String(setting ?? "").split(/[,\s]+/)).map((w) => w.trim().toLowerCase()).filter(Boolean)
  const self = all.find((m) => m.self), ids: string[] = [], unknown: string[] = []
  const add = (id?: string) => { if (id && !ids.includes(id)) ids.push(id) }
  for (const w of words.length ? words : ["auto"]) {
    // (auto: the always-on machines, then the cloud, then this one)
    if (w === "auto") { if (self?.standalone) add(self.id); for (const m of all) if (m.standalone && !m.self) add(m.id); if (all.some((m) => m.id === CLOUD)) add(CLOUD) }
    else if (w === "here") add(self?.id)
    else { const m = all.find((x) => x.id === w || x.label.toLowerCase() === w); if (m) add(m.id); else unknown.push(w) }
  }
  add(self?.id)
  return { ids, unknown, auto: !words.length || words.includes("auto") }
}

const LEVEL = { free: 0, busy: 1, full: 2 }
/** One machine a job may go to, and why it ranks where it does. */
export type Ranked = { t: Traits; why: string }
/** Where a job needing `n` goes, best first: the machines in the user's order that are on and have what it needs, by
 *  headroom (free, busy, full), then that order, then room. `left`: why each other can't ("Studio is off"). */
export function place(all: Traits[], n: Needs, setting: unknown): { ranked: Ranked[]; left: string[] } {
  const order = orderOf(setting, all), left: string[] = order.unknown.map((w) => `${w} (jobs_machine) is no machine`)
  const fits: Traits[] = []
  for (const id of order.ids) {
    const t = all.find((m) => m.id === id)!
    const why = !t.online ? "is off" : lacks(t, n)
    if (why) left.push(`${t.label} ${why}`)
    else fits.push(t)
  }
  for (const t of all) if (!order.ids.includes(t.id) && !t.self) left.push(`${t.label} ${!t.online ? "is off" : order.auto ? "isn't always on (jobs_machine names it to use it)" : "isn't in jobs_machine"}`)
  const room = new Map(fits.map((t) => [t.id, headroom(t)]))
  // (auto with the cloud: the always-on machines with room first, then the cloud, then the rest)
  const cloudy = order.auto && fits.some((t) => t.cloud)
  const group = (t: Traits) => (!cloudy ? 0 : t.cloud ? 1 : t.standalone && room.get(t.id)!.level !== "full" ? 0 : 2)
  const ranked = [...fits].sort((a, b) => group(a) - group(b) || LEVEL[room.get(a.id)!.level] - LEVEL[room.get(b.id)!.level] || order.ids.indexOf(a.id) - order.ids.indexOf(b.id) || room.get(b.id)!.score - room.get(a.id)!.score)
  return { ranked: ranked.map((t, i) => ({ t, why: whyOf(t, room.get(t.id)!, ranked.slice(i + 1).map((x) => room.get(x.id)!), ranked.slice(0, i), order.auto) })), left }
}

/** Why `t` ranks where it does: always on, its headroom against the next one's, or first in the user's order. */
function whyOf(t: Traits, r: ReturnType<typeof headroom>, after: ReturnType<typeof headroom>[], before: Traits[], auto: boolean) {
  const roomier = after.some((x) => LEVEL[x.level] > LEVEL[r.level])
  const reasons = [t.cloud ? "a cloud session of its own" : "", t.standalone && !before.length ? "always on" : "", roomier ? "the most headroom" : "", !roomier && after.length && !auto && !before.length ? "first in jobs_machine" : "",
    r.level !== "free" ? r.level : ""].filter(Boolean)
  return [...reasons, r.line].filter(Boolean).join(", ")
}

/** A repo's own word on its work (`.vaultite-jobs.json`): `{"needs": [{"when": "<a regular expression>", "needs":
 *  ["macos"]}], "cloud": true}`, a rule without `when` for all of it; `cloud`: it runs in a cloud session. */
export type RepoRule = { when?: string; needs: Need[] }
export const RULES_FILE = ".vaultite-jobs.json"
export function rulesIn(text: string): RepoRule[] {
  let o: unknown
  try { o = JSON.parse(text) } catch { return [] }
  const list = o && typeof o === "object" && Array.isArray((o as { needs?: unknown }).needs) ? (o as { needs: unknown[] }).needs : []
  return list.flatMap((r) => {
    const x = r && typeof r === "object" ? r as { when?: unknown; needs?: unknown } : null
    const needs = Array.isArray(x?.needs) ? x.needs.map((v) => String(v).toLowerCase()).filter((v): v is Need => (NEEDS as readonly string[]).includes(v)) : []
    if (!needs.length) return []
    const when = typeof x?.when === "string" && x.when.trim() ? x.when.trim() : undefined
    if (when) try { new RegExp(when, "i") } catch { return [] }
    return [{ ...(when ? { when } : {}), needs }]
  })
}
/** Whether a repo's rules file says its work runs in the cloud. */
export const cloudIn = (text: string) => { try { return (JSON.parse(text) as { cloud?: unknown })?.cloud === true } catch { return false } }
/** What a repo's rules say work described by `words` (its task, their ask) needs. */
export const rulesNeed = (rules: RepoRule[], words: string): Need[] =>
  [...new Set(rules.filter((r) => !r.when || new RegExp(r.when, "i").test(words)).flatMap((r) => r.needs))]
