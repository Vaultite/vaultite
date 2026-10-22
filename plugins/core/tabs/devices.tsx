import { useRef, useState, type MouseEvent } from "react"
import { ArrowDownToLine, Globe, Monitor, MonitorSmartphone, Pencil, Smartphone, X } from "lucide-react"
import {
  cell, del, DEVICE, Empty, fmtAgo, List, Loading, menuBelow, notifyError, openFile, openMenu, openView, Panel, post, removals, Row, useLive,
  type MenuItem, type Store,
} from "@vaultite"
import type { Device, DeviceTab } from "./types"

// The user's devices (each app and browser, plugin.ts): which are open now, their tabs, and what can be done from here
// (close a tab there, move it here, rename or forget one). The Tabs panel shows their tabs; Devices lists them all.

export const KIND_ICON = { desktop: Monitor, phone: Smartphone, web: Globe }
export const deviceName = (d: Device) => d.label || d.name
/** How long a device that isn't open stays in the Tabs panel (Devices lists the last 30 days). */
const RECENT = 7 * 86400_000

/** Devices forgotten from here and tabs closed on another device from here: gone at once, back if it fails. */
const forgetting = removals(), closing = removals()
const tabKey = (d: Device, t: DeviceTab) => `${d.id}\0${t.to}`
/** Names given here, shown until the devices' list has them. */
const renamed = cell(new Map<string, string>())
const named = (id: string, label: string | null) => renamed.update((m) => {
  const next = new Map(m)
  if (label === null) next.delete(id); else next.set(id, label)
  return next
})

/** The devices, as GET tabs/devices says (which are open now: asked again every 15 s while shown, and when one's tabs
 *  change), else as the state has them; what's done here shows at once. */
export function useDevices(store?: Store): Device[] | null {
  const { data } = useLive<{ devices: Device[] }>("tabs/devices", undefined, (p) => p.startsWith(".vaultite/plugins/tabs/"), 15_000)
  const names = renamed.use()
  const { list } = forgetting.use(data?.devices ?? store?.tabDevices ?? null, (d) => d.id)
  const all = list?.flatMap((d) => d.tabs.map((t) => tabKey(d, t)))
  const kept = closing.use(all, (k) => k).list
  const keep = kept && all && kept.length < all.length ? new Set(kept) : null
  return list && list.map((d) => {
    const label = names.get(d.id)
    const tabs = keep ? d.tabs.filter((t) => keep.has(tabKey(d, t))) : d.tabs
    return label === undefined && !keep ? d : { ...d, tabs, ...(label === undefined ? {} : { label }) }
  })
}

/** A device's row and a device's tab's while they fold away (their `data-leaving`). */
export function useLeaving() {
  const d = forgetting.use(null, String).leaving, t = closing.use(null, String).leaving
  return { device: (x: Device) => d(x.id), tab: (x: Device, tab: DeviceTab) => t(tabKey(x, tab)) }
}

/** Whether the Tabs panel shows a device's tabs: another device's, open now or used this week. */
export const inPanel = (d: Device) => d.id !== DEVICE && d.tabs.length > 0 && (!!d.live || Date.now() - Date.parse(d.at) < RECENT)

/** Close tabs on a device that's open now (none named: all its tabs); they go at once, until its own list comes. */
export const closeOn = (d: Device, tabs?: DeviceTab[]) =>
  closing.remove((tabs ?? d.tabs).map((t) => tabKey(d, t)), () => post(`tabs/devices/${d.id}/close`, tabs ? { tabs: tabs.map((t) => t.to) } : {}),
    `Couldn't close it on ${deviceName(d)}`)

export const openHere = (t: DeviceTab) => (t.to.startsWith("file:") ? openFile(t.to.slice(5), { newTab: true }) : openView(t.to, { newTab: true }))

/** Open a tab here and close it there, as a handoff. */
export function bringHere(d: Device, t: DeviceTab) {
  openHere(t)
  void closeOn(d, [t])
}

const forget = (d: Device) => { void forgetting.remove(d.id, () => del(`tabs/devices/${d.id}`), "Couldn't forget it") }
function rename(d: Device, label: string) {
  named(d.id, label)
  post(`tabs/devices/${d.id}/label`, { label }).then(() => setTimeout(() => named(d.id, null), 15_000), (e) => { named(d.id, null); notifyError(e, "Couldn't rename it") })
}

/** A device's own items (its row's menu, its heading's in the Tabs panel). `renaming`: shows its name as a field. */
export function deviceItems(d: Device, renaming: () => void, { manage = false } = {}): MenuItem[] {
  const here = d.id === DEVICE
  return [
    ...(d.live && !here && d.tabs.length ? [{ label: "Close all its tabs", icon: X, run: () => void closeOn(d) }] : []),
    { label: "Rename…", icon: Pencil, run: renaming },
    ...(manage ? [{ label: "Show all devices", icon: MonitorSmartphone, run: () => openView("devices", { newTab: true }) }] : []),
    ...(!here ? [{ label: "Forget this device", run: () => forget(d), sep: true }] : []),
  ]
}

/** A tab of another device's: open it here (a click), bring it here, or close it there. */
export function tabItems(d: Device, t: DeviceTab): MenuItem[] {
  return [
    { label: "Open here", run: () => openHere(t) },
    ...(d.live ? [
      { label: "Move here", icon: ArrowDownToLine, run: () => bringHere(d, t) },
      { label: `Close on ${deviceName(d)}`, icon: X, run: () => void closeOn(d, [t]) },
    ] : []),
  ]
}

/** A device's name as a field (Enter keeps it, Escape doesn't; empty: its own name again). */
export function DeviceNameField({ d, done, className }: { d: Device; done: () => void; className?: string }) {
  const [v, setV] = useState(deviceName(d))
  const over = useRef(false)
  const commit = (keep: boolean) => {
    if (over.current) return
    over.current = true
    if (keep && v.trim() !== deviceName(d)) rename(d, v.trim() === d.name ? "" : v.trim())
    done()
  }
  return (
    <input autoFocus value={v} placeholder={d.name} spellCheck={false} aria-label="Device name" data-no-drag
      onFocus={(e) => e.currentTarget.select()} onChange={(e) => setV(e.target.value)} onBlur={() => commit(true)}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") { e.preventDefault(); commit(true) }
        if (e.key === "Escape") { e.preventDefault(); commit(false) }
      }}
      className={className ?? "min-w-0 flex-1 rounded-[4px] bg-card px-1 text-foreground outline-none placeholder:text-tertiary"} />
  )
}

/** Open now (a green dot), else nothing: when it was used is said beside it. */
export const LiveDot = ({ d }: { d: Device }) =>
  d.live ? <span className="block size-1.5 shrink-0 rounded-full" style={{ background: "var(--green)" }} data-tip={d.windows && d.windows > 1 ? `Open now in ${d.windows} windows` : "Open now"} /> : null

function when(d: Device) {
  if (d.live) return d.windows && d.windows > 1 ? `Open now in ${d.windows} windows` : "Open now"
  return `Used ${fmtAgo(d.at)}`
}

function DeviceRow({ d, leaving }: { d: Device; leaving?: "" }) {
  const [renaming, setRenaming] = useState(false)
  const Icon = KIND_ICON[d.kind]
  const items = () => deviceItems(d, () => setRenaming(true))
  const meta = [d.id === DEVICE && "This device", when(d), `${d.tabs.length} ${d.tabs.length === 1 ? "tab" : "tabs"}`, d.label && d.name].filter(Boolean).join(" · ")
  return (
    <Row data-device-row={d.id} data-leaving={leaving}
      lead={<span className="relative grid size-5 shrink-0 place-items-center text-muted-foreground"><Icon className="size-4" strokeWidth={2} />
        {d.live && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-[var(--card)]" style={{ background: "var(--green)" }} />}</span>}
      title={renaming ? <DeviceNameField d={d} done={() => setRenaming(false)} /> : deviceName(d)} meta={meta}
      onOpen={renaming ? undefined : (e: MouseEvent<HTMLElement>) => menuBelow(e, items())}
      onContextMenu={(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, items()) }} />
  )
}

/** Every device that used this vault in the last 30 days, open ones first. */
export function DevicesPanel({ store }: { store?: Store }) {
  const list = useDevices(store)
  const { device: leaving } = useLeaving()
  return (
    <Panel title="Devices" icon={MonitorSmartphone} tint="var(--machines)">
      {!list ? <Loading /> : !list.length ? <Empty>No devices yet. Each app and browser you open Vaultite in shows here.</Empty> : (
        <List>{list.map((d) => <DeviceRow key={d.id} d={d} leaving={leaving(d)} />)}</List>
      )}
    </Panel>
  )
}
