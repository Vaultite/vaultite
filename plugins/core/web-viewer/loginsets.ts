import { confirmDialog, currentWorkspace, get, notify, notifyError, post, removals, webPages, workspaceList, type WebSite } from "@vaultite"
import { askElsewhere, askSites, elsewhere, listed } from "./accounts"
import { colorOf, containerById, containers, profileIn, setSiteRule, type Container } from "./containers"
import { profile, profileFor, settings } from "./state"

export type Logins = { prof: string; name: string; color: string; container: string | null; machine?: { id: string; label: string } }

export const NEUTRAL = "color-mix(in srgb, var(--muted-foreground) 55%, transparent)"

export function ownLogins(): Logins {
  const ws = currentWorkspace()
  return { prof: profile(), name: ws && settings.get().logins !== "shared" ? `Workspace ${ws.n}` : "Default", color: NEUTRAL, container: null }
}
export const loginsOf = (c: Container): Logins => ({ prof: profileIn(c.id), name: c.name, color: colorOf(c), container: c.id })

export function allLogins(): Logins[] {
  const workspaces = settings.get().logins === "shared" ? [] : workspaceList()
  return [
    ...(workspaces.length > 1 ? workspaces.map((w): Logins => ({ prof: profileFor(w.n), name: `Workspace ${w.n}`, color: NEUTRAL, container: null })) : [ownLogins()]),
    ...containers().map(loginsOf),
  ]
}

export const loginsOn = (m: { id: string; label: string }, l: Logins): Logins => ({ ...l, machine: m })
export const nameOf = (l: Logins) => (l.machine ? `${l.machine.label} · ${l.name}` : l.name)
export const allLoginsOn = (m: { id: string; label: string }) => allLogins().map((l) => loginsOn(m, l))
export const sitesIn = (l: Logins) => (l.machine ? elsewhere.get()?.find((m) => m.machine === l.machine!.id)?.sets[l.prof] : listed.get().get(l.prof))
export const refreshElsewhere = () => askElsewhere(allLogins().map((l) => l.prof))

export const sitesOf = (s: WebSite) => [s.site, ...(s.with ?? [])]
export const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "")
export const isIn = (s: WebSite) => !!(s.signed || s.account)

const leavingIn = new Map<string, ReturnType<typeof removals>>()
export const signingOut = (prof: string) => leavingIn.get(prof) ?? leavingIn.set(prof, removals()).get(prof)!

export const setOrder = (prof: string, order: string[]) => settings.set({ siteOrder: { ...settings.get().siteOrder, [prof]: order } })

const AGENT_RANK = { read: 1, act: 2 } as const
const agentRank = (l: Logins) => { const a = containerById(l.container)?.agents; return a ? AGENT_RANK[a] : 0 }

async function mayMove(from: Logins, to: Logins, s: WebSite, copy: boolean) {
  const names = sitesOf(s), site = names[0], verb = copy ? "Copy" : "Move"
  const there = sitesIn(to)?.find((x) => isIn(x) && sitesOf(x).some((n) => names.includes(n)))
  if (there && !(there.account && there.account === s.account)) {
    const ok = await confirmDialog({
      title: `Replace ${there.account || "the login"} in ${nameOf(to)}?`,
      body: `${nameOf(to)} is signed in to ${site}${there.account ? ` as ${there.account}` : ""}. ${s.account || "This login"} takes its place, and that one is signed out there.`,
      confirm: "Replace", danger: true,
    })
    if (!ok) return false
  }
  const c = containerById(to.container)
  if (c?.agents && agentRank(to) > agentRank(from)) {
    const ok = await confirmDialog({
      title: `Let agents use ${site}?`,
      body: `Agents can ${c.agents === "act" ? "read and act in" : "read"} ${nameOf(to)}'s pages: they'll be signed in to ${site}${s.account ? ` as ${s.account}` : ""} there.`,
      confirm: verb,
    })
    if (!ok) return false
  }
  for (const l of [from, to]) {
    if (l.machine) continue
    const lc = containerById(l.container)
    if (lc?.lock && (await webPages?.engine?.("lock:unlock", l.prof, lc.name)) !== true) return false
  }
  return true
}

export type Moved = "moved" | "failed" | "cancelled"

export async function moveLogin(from: Logins, to: Logins, s: WebSite, copy: boolean, opts: { asked?: boolean; quiet?: boolean } = {}): Promise<Moved> {
  if (to.machine) return copyThere(from, to, s, opts)
  const web = webPages
  if (!web?.move || from.prof === to.prof) return "cancelled"
  if (!opts.asked && !(await mayMove(from, to, s, copy))) return "cancelled"
  const names = sitesOf(s), site = names[0]
  let ok = false
  const write = async () => {
    ok = (await web.move!(from.prof, to.prof, names, copy)).ok
    askSites([from.prof, to.prof])
  }
  const failed = `Couldn't ${copy ? "copy" : "move"} ${site}`
  if (copy) { try { await write() } catch (e) { notifyError(e, failed); return "failed" } }
  else if (!(await signingOut(from.prof).remove(s.site, write, failed))) return "failed"
  if (!ok) {
    signingOut(from.prof).back([s.site])
    notify(`${site} didn't stay signed in in ${to.name}: it keeps its login outside cookies. Sign in to it there instead.`, { kind: "error" })
    return "failed"
  }
  const pinnedIn = containerById(from.container)?.sites ?? []
  if (!copy) for (const n of names) if (pinnedIn.includes(n)) await setSiteRule(n, to.container)
  if (!opts.quiet) notify(`${copy ? "Copied" : "Moved"} ${site} to ${to.name}`, { action: { label: "Undo", run: () => copy
    ? Promise.all(names.map((n) => web.forget?.(to.prof, n))).then(() => askSites([to.prof]))
    : moveLogin(to, from, s, false, { asked: true, quiet: true }) } })
  return "moved"
}

async function copyThere(from: Logins, to: Logins, s: WebSite, opts: { asked?: boolean; quiet?: boolean }): Promise<Moved> {
  const web = webPages, m = to.machine!
  if (!web?.seal || from.machine) return "cancelled"
  if (!opts.asked && !(await mayMove(from, to, s, true))) return "cancelled"
  const names = sitesOf(s), site = names[0]
  const before = elsewhere.get()
  const shown = (sets: Record<string, WebSite[]>) => ({ ...sets, [to.prof]: [s, ...(sets[to.prof] ?? []).filter((x) => !sitesOf(x).some((n) => names.includes(n)))] })
  elsewhere.set((before ?? []).map((x) => (x.machine === m.id ? { ...x, sets: shown(x.sets) } : x)))
  let ok = false
  try {
    const { key } = await get<{ key: string }>(`web-viewer/logins/key?machine=${encodeURIComponent(m.id)}`)
    const sealed = await web.seal(from.prof, names, to.prof, key)
    ok = (await post<{ ok: boolean }>("web-viewer/logins/take", { machine: m.id, to: to.prof, sealed })).ok
  } catch (e) {
    elsewhere.set(before)
    notifyError(e, `Couldn't copy ${site} to ${nameOf(to)}`)
    return "failed"
  }
  if (!ok) elsewhere.set(before)
  void refreshElsewhere()
  if (!ok) {
    notify(`${site} didn't stay signed in in ${nameOf(to)}: it keeps its login outside cookies. Sign in to it there instead.`, { kind: "error" })
    return "failed"
  }
  if (!opts.quiet) notify(`Copied ${site} to ${nameOf(to)}`)
  return "moved"
}
