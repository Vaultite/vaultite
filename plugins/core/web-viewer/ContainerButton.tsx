// The container chip at the address's left: which container the tab is in (its colour and name), and a menu to move the
// tab to another, always open its site there, and add, rename, recolour or delete containers.
import type { MouseEvent } from "react"
import { Box } from "lucide-react"
import { choose, colorItems, confirmDialog, dotIcon, menuBelow, notifyError, webPages, type MenuItem } from "@vaultite"
import {
  addContainer, argOf, colorOf, containerById, containers, removeContainer, ruleFor, setSiteRule, siteOf, updateContainer,
  type Container,
} from "./containers"

/** Whether this Mac can ask for Touch ID (asked once). */
let lockable: Promise<boolean> | null = null
const canLock = () => (lockable ??= Promise.resolve(webPages?.engine?.("lock:can")).then((v) => v === true, () => false))

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

async function deleteContainer(c: Container) {
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

/** Rename, recolour, delete the tab's container. */
const editItems = (c: Container, canLock: boolean): MenuItem[] => [
  ...(canLock || c.lock ? [{ label: "Lock with Touch ID", checked: !!c.lock, run: () => void updateContainer(c.id, { lock: !c.lock }) }] : []),
  { label: "Agents", run: () => {}, items: [
    { label: "Can't use it", checked: !c.agents, run: () => void updateContainer(c.id, { agents: undefined }) },
    { label: "Can read pages", checked: c.agents === "read", run: () => void updateContainer(c.id, { agents: "read" }) },
    { label: "Can read and act", checked: c.agents === "act", run: () => void updateContainer(c.id, { agents: "act" }) },
  ] },
  { label: `Rename ${c.name}…`, run: () => askName(`Rename ${c.name}`, c.name, (name) => void updateContainer(c.id, { name })) },
  { label: "Colour", run: () => {}, items: colorItems(c.color, (color) => void updateContainer(c.id, { color })) },
  { label: `Delete ${c.name}…`, danger: true, run: () => void deleteContainer(c) },
]

/** The container menu for a tab showing `url` in `container`; `reopen` takes the tab's new arg. */
export function containerMenu(container: string | null, url: string, reopen: (arg: string) => void, canLock = false): MenuItem[] {
  const list = containers(), site = siteOf(url), rule = site ? ruleFor(url) : null
  const here = containerById(container)
  return [
    { label: "Open in", caption: true, run: () => {} },
    { label: "No container", icon: Box, checked: !here, run: () => { if (here) reopen(url) } },
    ...list.map((c) => ({ label: c.name, icon: dotIcon(colorOf(c)), checked: c.id === here?.id, run: () => { if (c.id !== here?.id) reopen(argOf(url, c.id)) } })),
    ...(site && here ? [{ label: `Always open ${site} in ${here.name}`, checked: rule === here.id, sep: true,
      run: () => void setSiteRule(site, rule === here.id ? null : here.id) }] : []),
    ...(site && !here && rule ? [{ label: `Stop opening ${site} in ${containerById(rule)?.name ?? rule}`, sep: true, run: () => void setSiteRule(site, null) }] : []),
    { label: "New container…", sep: true, run: () => newContainer((c) => reopen(argOf(url, c.id))) },
    ...(here ? editItems(here, canLock) : []),
  ]
}

/** Inside the page bar's address (a narrow bar, `@container/bar`: the dot alone). */
export function ContainerButton({ container, url, reopen }: { container: string | null; url: string; reopen: (arg: string) => void }) {
  const c = containerById(container)
  const open = (e: MouseEvent) => { const at = { currentTarget: e.currentTarget } as MouseEvent; void canLock().then((can) => menuBelow(at, containerMenu(container, url, reopen, can))) }
  if (!c) {
    return (
      <button type="button" onClick={open} aria-label="Container" aria-haspopup="menu" data-tip="Open in a container" data-web-container=""
        className="ml-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-tertiary hover:bg-foreground/[0.07] hover:text-foreground">
        <Box className="size-3.5" strokeWidth={2} />
      </button>
    )
  }
  return (
    <button type="button" onClick={open} aria-label={`Container: ${c.name}`} aria-haspopup="menu" data-web-container={c.id}
      className="ml-0.5 flex h-5.5 max-w-[120px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 text-[12px] font-medium hover:brightness-110 @max-md/bar:px-[7px]"
      style={{ color: colorOf(c), background: `color-mix(in srgb, ${colorOf(c)} 14%, transparent)` }}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(c) }} />
      <span className="min-w-0 truncate @max-md/bar:hidden">{c.name}</span>
    </button>
  )
}
