// Sets of logins (a workspace's, a container's, another machine's) and moving a login between them: its cookies go there,
// signing out here once it's in (electron/web.ts moveLogins), or copied. Another machine's take only a sealed copy.
import { confirmDialog, currentWorkspace, get, notify, notifyError, post, removals, webPages, workspaceList, type WebSite } from "@vaultite"
import { askElsewhere, askSites, elsewhere, listed } from "./accounts"
import { colorOf, containerById, containers, profileIn, setSiteRule, type Container } from "./containers"
import { profile, profileFor, settings } from "./state"

/** A set of logins pages have: a workspace's (the default one without workspaces), or a container's; `machine`: in
 *  another machine's browser. */
export type Logins = { prof: string; name: string; color: string; container: string | null; machine?: { id: string; label: string } }

/** The default logins' dot: neutral, so their rows line up with containers' coloured ones. */
export const NEUTRAL = "color-mix(in srgb, var(--muted-foreground) 55%, transparent)"

/** This workspace's logins: "Workspace N" while each workspace has its own, else the default ones. */
export function ownLogins(): Logins {
  const ws = currentWorkspace()
  return { prof: profile(), name: ws && settings.get().logins !== "shared" ? `Workspace ${ws.n}` : "Default", color: NEUTRAL, container: null }
}
export const loginsOf = (c: Container): Logins => ({ prof: profileIn(c.id), name: c.name, color: colorOf(c), container: c.id })

/** Every set of logins: each workspace's (or the default), then the containers'. */
export function allLogins(): Logins[] {
  const workspaces = settings.get().logins === "shared" ? [] : workspaceList()
  return [
    ...(workspaces.length > 1 ? workspaces.map((w): Logins => ({ prof: profileFor(w.n), name: `Workspace ${w.n}`, color: NEUTRAL, container: null })) : [ownLogins()]),
    ...containers().map(loginsOf),
  ]
}

/** A set of logins as it is in another machine's browser. */
export const loginsOn = (m: { id: string; label: string }, l: Logins): Logins => ({ ...l, machine: m })
/** Its name where it may be another machine's: "M1 · Agents". */
export const nameOf = (l: Logins) => (l.machine ? `${l.machine.label} · ${l.name}` : l.name)
/** Another machine's sets of logins: each of the vault's (the same there). */
export const allLoginsOn = (m: { id: string; label: string }) => allLogins().map((l) => loginsOn(m, l))
/** A set of logins' sites as last listed, here or on its machine. */
export const sitesIn = (l: Logins) => (l.machine ? elsewhere.get()?.find((m) => m.machine === l.machine!.id)?.sets[l.prof] : listed.get().get(l.prof))
/** List the other machines' sets of logins again. */
export const refreshElsewhere = () => askElsewhere(allLogins().map((l) => l.prof))

/** A row's sites: its own and the ones its login signs in to too. */
export const sitesOf = (s: WebSite) => [s.site, ...(s.with ?? [])]
export const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "")
/** Signed in there (older builds only say who). */
export const isIn = (s: WebSite) => !!(s.signed || s.account)

/** Sites leaving a set of logins from here (signed out, moved away): gone at once, back if it fails. */
const leavingIn = new Map<string, ReturnType<typeof removals>>()
export const signingOut = (prof: string) => leavingIn.get(prof) ?? leavingIn.set(prof, removals()).get(prof)!

/** The order sites were dragged into in a set of logins; those not in it come after, pinned first, then A to Z. */
export const setOrder = (prof: string, order: string[]) => settings.set({ siteOrder: { ...settings.get().siteOrder, [prof]: order } })

const AGENT_RANK = { read: 1, act: 2 } as const
const agentRank = (l: Logins) => { const a = containerById(l.container)?.agents; return a ? AGENT_RANK[a] : 0 }

/** Ask what can't be undone before a move: replacing someone signed in there, letting agents use it, a locked
 *  container's Touch ID. Whether to go on. */
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
    if (l.machine) continue // (a container locked there says so when it's asked)
    const lc = containerById(l.container)
    if (lc?.lock && (await webPages?.engine?.("lock:unlock", l.prof, lc.name)) !== true) return false
  }
  return true
}

export type Moved = "moved" | "failed" | "cancelled"

/** Move (or copy) a row's login to another set of logins: its row folds away here at once (a move), and a site keeping
 *  its login outside cookies stays where it was. `asked`: no questions (an Undo); `quiet`: no toast (several at once). */
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
  // (a site always opened in the container it left opens where its login went)
  const pinnedIn = containerById(from.container)?.sites ?? []
  if (!copy) for (const n of names) if (pinnedIn.includes(n)) await setSiteRule(n, to.container)
  if (!opts.quiet) notify(`${copy ? "Copied" : "Moved"} ${site} to ${to.name}`, { action: { label: "Undo", run: () => copy
    ? Promise.all(names.map((n) => web.forget?.(to.prof, n))).then(() => askSites([to.prof]))
    : moveLogin(to, from, s, false, { asked: true, quiet: true }) } })
  return "moved"
}

/** A row's login copied to another machine's set of logins: sealed here for its app, which sets it and checks it's still
 *  signed in as the same account. Its row shows there at once, gone again if it fails. */
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
