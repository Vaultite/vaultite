// The container chip at the address's left: which container the tab is in, or what's typed will open in (its colour and
// name), and a menu to choose another or always open its site there. A container's own options (containerItems) are in Sites.
import { useEffect, useState, type MouseEvent } from "react"
import { ArrowDown, ArrowUp, Bot, Box, Fingerprint, KeyRound, Pencil, Pin, PinOff, Plus, Settings2, Trash2 } from "lucide-react"
import { choose, colorItems, confirmDialog, currentWorkspace, dotIcon, menuBelow, notify, notifyError, plural, webPages, type MenuItem, type WebSite } from "@vaultite"
import { accountIn, askSites, keep, listed } from "./accounts"
import { allLogins, andList, isIn, loginsOf, moveLogin, sitesOf } from "./loginsets"
import { siteOf } from "./address"
import { passwordsForAgents } from "./agentlogins"
import {
  addContainer, colorOf, containerById, containers, moveContainer, profileIn, removeContainer, ruleFor, setSiteRule, updateContainer,
  type Container,
} from "./containers"

/** Whether this Mac can ask for Touch ID (asked once). */
let lockable: Promise<boolean> | null = null, lockKnown = false
const canLock = () => (lockable ??= Promise.resolve(webPages?.engine?.("lock:can")).then((v) => (lockKnown = v === true), () => false))
export const canLockNow = () => { void canLock(); return lockKnown }
export function useCanLock() {
  const [can, set] = useState(lockKnown)
  useEffect(() => { void canLock().then(set) }, [])
  return can
}

/** Ask for a name (a new container's, or a new name for one). */
function askName(title: string, current: string, done: (name: string) => void) {
  choose({
    title, placeholder: "Name", items: [],
    empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Type a name{current ? ` for ${current}` : ""}.</p>,
    other: (typed) => (typed.trim() ? { id: typed.trim(), label: current ? `Rename to “${typed.trim()}”` : `New container “${typed.trim()}”` } : null),
    onPick: (it) => done(it.id),
  })
}

export function newContainer(then?: (c: Container) => void) {
  askName("New container", "", (name) => { const c = addContainer(name); then?.(c) })
}

/** Delete a container: one signed in somewhere asks first whether its logins move to another set of logins, so you stay
 *  signed in; it's deleted only once they're all there. */
async function deleteContainer(c: Container) {
  const prof = profileIn(c.id)
  const sites = await (webPages?.sites?.(prof).then((s) => keep(prof, s), () => null) ?? null) ?? listed.get().get(prof) ?? []
  const signed = sites.filter(isIn), to = allLogins().filter((l) => l.prof !== prof)
  if (!signed.length || !webPages?.move || !to.length) return confirmDelete(c)
  const them = signed.length > 1 ? "them" : "it"
  const who = (s: WebSite) => (s.account ? `${s.site} (${s.account})` : s.site)
  choose({
    title: `Delete ${c.name}`, placeholder: "Move to…",
    heading: `${c.name} is signed in to ${andList(signed.map(who))}. Move ${them} before it's deleted?`,
    items: [
      ...to.map((l) => ({ id: l.prof, label: `Move ${them} to ${l.name}`, icon: dotIcon(l.color) })),
      { id: "", label: `Delete ${them} with ${c.name}`, icon: Trash2 },
    ],
    onPick: (it) => {
      const target = to.find((l) => l.prof === it.id)
      if (!target) return void confirmDelete(c)
      void (async () => {
        const left: string[] = []
        for (const s of signed) if (await moveLogin(loginsOf(c), target, s, false, { quiet: true }) !== "moved") left.push(sitesOf(s)[0])
        if (left.length) return notify(`${c.name} is kept: ${andList(left)} didn't move`, { kind: "error" })
        await removeContainer(c.id)
        await webPages?.engine?.("containers:clear", prof)
        notify(`Moved ${plural(signed.length, "login")} to ${target.name} and deleted ${c.name}`)
      })().catch((e) => notifyError(e, "Couldn't delete the container"))
    },
  })
}

async function confirmDelete(c: Container) {
  const ok = await confirmDialog({
    title: `Delete ${c.name}?`,
    body: `Its logins go: the cookies and what sites keep in the browser in ${c.name} are deleted. Its open tabs stay, in no container once reopened.`,
    confirm: "Delete", danger: true,
  })
  if (!ok) return
  try {
    await removeContainer(c.id)
    await webPages?.engine?.("containers:clear", `c-${c.id}`)
  } catch (e) { notifyError(e, "Couldn't delete the container") }
}

const AGENTS: { v: Container["agents"]; label: string; says: string }[] = [
  { v: undefined, label: "None", says: "" },
  { v: "read", label: "Read pages", says: "Agents can read pages" },
  { v: "act", label: "Read and act", says: "Agents can read and act" },
]
/** What agents may do in `c`'s pages, said for a row ("" when nothing). */
export const agentsSay = (c: Container) => AGENTS.find((a) => a.v === c.agents)?.says ?? ""

/** A container's own options: its name, colour, Touch ID, what agents may do, its place and deleting it. */
export const containerItems = (c: Container, canLock: boolean): MenuItem[] => {
  const list = containers(), i = list.findIndex((x) => x.id === c.id)
  return [
  { label: "Rename…", icon: Pencil, run: () => askName(`Rename ${c.name}`, c.name, (name) => void updateContainer(c.id, { name })) },
  { label: "Colour", icon: dotIcon(colorOf(c)), run: () => {}, items: colorItems(c.color, (color) => void updateContainer(c.id, { color })) },
  ...(canLock || c.lock ? [{ label: "Lock with Touch ID", icon: Fingerprint, checked: !!c.lock, keep: true, run: () => void updateContainer(c.id, { lock: !c.lock }) }] : []),
  { label: "Agent access", icon: Bot, hint: AGENTS.find((a) => a.v === c.agents)?.label, run: () => {},
    items: AGENTS.map((a) => ({ label: a.label, checked: c.agents === a.v, run: () => void updateContainer(c.id, { agents: a.v }) })) },
  // (this Mac's, for every container agents act in: the logins agents ask the app to fill)
  ...(c.agents === "act" ? [{ label: "Passwords for agents…", icon: KeyRound, run: () => void passwordsForAgents() }] : []),
  ...(i > 0 ? [{ label: "Move up", icon: ArrowUp, sep: true, run: () => void moveContainer(c.id, list[i - 1].id) }] : []),
  ...(i >= 0 && i < list.length - 1 ? [{ label: "Move down", icon: ArrowDown, sep: i === 0, run: () => void moveContainer(c.id, list[i + 2]?.id ?? null) }] : []),
  { label: `Delete ${c.name}…`, icon: Trash2, danger: true, sep: true, run: () => void deleteContainer(c) },
  ]
}
/** The container menu for `url` (the page's, or an address being typed) opening in `container`: `pick` takes the one
 *  chosen. Only choosing: a container's own options are in Sites (`manage`). Each names who's signed in to the site there. */
export function containerMenu(container: string | null, url: string, pick: (id: string | null) => void, manage: () => void): MenuItem[] {
  const list = containers(), site = siteOf(url), rule = site ? ruleFor(url) : null
  const here = containerById(container)
  const who = (id: string | null) => (site && accountIn(profileIn(id), site)) || undefined
  return [
    { label: "Open in", caption: true, run: () => {} },
    // (none is the workspace's own logins, which a workspace with a container of its own can still have)
    { label: currentWorkspace() ? "No container (workspace logins)" : "No container", icon: Box, checked: !here, hint: who(null), run: () => { if (here) pick(null) } },
    ...list.map((c) => ({ label: c.name, icon: dotIcon(colorOf(c)), checked: c.id === here?.id, hint: who(c.id), run: () => { if (c.id !== here?.id) pick(c.id) } })),
    ...(site && here ? [{ label: `Always open ${site} here`, icon: Pin, checked: rule === here.id, sep: true,
      run: () => void setSiteRule(site, rule === here.id ? null : here.id) }] : []),
    ...(site && !here && rule ? [{ label: `Stop opening ${site} in ${containerById(rule)?.name ?? rule}`, icon: PinOff, sep: true, run: () => void setSiteRule(site, null) }] : []),
    { label: "New container…", icon: Plus, sep: true, run: () => newContainer((c) => pick(c.id)) },
    { label: "Manage containers…", icon: Settings2, run: manage },
  ]
}

/** Inside the page bar's address (a narrow bar, `@container/bar`: the dot alone): where the page is, or where what's
 *  typed will open, `why` saying why when it isn't plain (a site's rule, the workspace's container). */
export function ContainerButton({ container, url, why, pick, manage }: { container: string | null; url: string; why: string; pick: (id: string | null) => void; manage: () => void }) {
  const c = containerById(container)
  const open = (e: MouseEvent) => menuBelow(e, containerMenu(container, url, pick, manage))
  // (who's signed in where, asked as the pointer comes: the menu names them as it opens)
  const ask = () => askSites([profileIn(null), ...containers().map((x) => profileIn(x.id))])
  if (!c) {
    return (
      <button type="button" onClick={open} onPointerEnter={ask} onFocus={ask} aria-label="Container" aria-haspopup="menu" data-tip={why || "Open in a container"} data-web-container=""
        className="ml-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-tertiary hover:bg-foreground/[0.07] hover:text-foreground">
        <Box className="size-3.5" strokeWidth={2} />
      </button>
    )
  }
  return (
    <button type="button" onClick={open} onPointerEnter={ask} onFocus={ask} aria-label={`Container: ${c.name}`} aria-haspopup="menu" data-web-container={c.id}
      data-tip={why || undefined} data-web-container-why={why || undefined}
      className="ml-0.5 flex h-5.5 max-w-[120px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 text-[12px] font-medium hover:brightness-110 @max-md/bar:px-[7px]"
      style={{ color: colorOf(c), background: `color-mix(in srgb, ${colorOf(c)} 14%, transparent)` }}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(c) }} />
      <span className="min-w-0 truncate @max-md/bar:hidden">{c.name}</span>
    </button>
  )
}
