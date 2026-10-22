import { useRef, useState, type MouseEvent } from "react"
import { ArrowDownToLine, Globe, Monitor, MonitorSmartphone, Pencil, Smartphone, X } from "lucide-react"
import {
  cell, del, DEVICE, Empty, fmtAgo, List, Loading, menuBelow, notifyError, openFile, openMenu, openView, Panel, post, Row, useLive,
  type MenuItem, type Store,
} from "@vaultite"
import type { Device, DeviceTab } from "./types"

// The user's devices (each app and browser, plugin.ts): which are open now, their tabs, and what can be done from here
// (close a tab there, move it here, rename or forget one). The Tabs panel shows their tabs; Devices lists them all.

export const KIND_ICON = { desktop: Monitor, phone: Smartphone, web: Globe }
export const deviceName = (d: Device) => d.label || d.name
/** How long a device that isn't open stays in the Tabs panel (Devices lists the last 30 days). */
const RECENT = 7 * 86400_000

/** The devices, as GET tabs/devices says (which are open now: asked again every 15 s while shown, and when one's tabs
 *  change), else as the state has them. */
export function useDevices(store?: Store): Device[] | null {
  const { data } = useLive<{ devices: Device[] }>("tabs/devices", undefined, (p) => p.startsWith(".vaultite/plugins/tabs/"), 15_000)
  const gone = closing.use()
  const list = data?.devices ?? store?.tabDevices ?? null
  return list && (gone.size ? list.map((d) => ({ ...d, tabs: d.tabs.filter((t) => !gone.has(`${d.id}\0${t.to}`)) })) : list)
}

/** Whether the Tabs panel shows a device's tabs: another device's, open now or used this week. */
export const inPanel = (d: Device) => d.id !== DEVICE && d.tabs.length > 0 && (!!d.live || Date.now() - Date.parse(d.at) < RECENT)

/** Tabs closed on another device from here, hidden until its own list comes (or the close fails). */
const closing = cell(new Set<string>())
const hide = (keys: string[], on: boolean) => closing.update((s) => {
  const next = new Set(s)
  for (const k of keys) { if (on) next.add(k); else next.delete(k) }
  return next
})

/** Close tabs on a device that's open now (none named: all its tabs). */
export function closeOn(d: Device, tabs?: DeviceTab[]) {
  const keys = (tabs ?? d.tabs).map((t) => `${d.id}\0${t.to}`)
  hide(keys, true)
  post(`tabs/devices/${d.id}/close`, tabs ? { tabs: tabs.map((t) => t.to) } : {})
    .catch((e) => { hide(keys, false); notifyError(e, `Couldn't close it on ${deviceName(d)}`) })
    .finally(() => setTimeout(() => hide(keys, false), 15_000))
}

export const openHere = (t: DeviceTab) => (t.to.startsWith("file:") ? openFile(t.to.slice(5), { newTab: true }) : openView(t.to, { newTab: true }))

/** Open a tab here and close it there, as a handoff. */
export function bringHere(d: Device, t: DeviceTab) {
  openHere(t)
  closeOn(d, [t])
}

const forget = (d: Device) => { del(`tabs/devices/${d.id}`).catch((e) => notifyError(e, "Couldn't forget it")) }
const rename = (d: Device, label: string) => { post(`tabs/devices/${d.id}/label`, { label }).catch((e) => notifyError(e, "Couldn't rename it")) }

/** A device's own items (its row's menu, its heading's in the Tabs panel). `renaming`: shows its name as a field. */
export function deviceItems(d: Device, renaming: () => void, { manage = false } = {}): MenuItem[] {
  const here = d.id === DEVICE
  return [
    ...(d.live && !here && d.tabs.length ? [{ label: "Close all its tabs", icon: X, run: () => closeOn(d) }] : []),
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
      { label: `Close on ${deviceName(d)}`, icon: X, run: () => closeOn(d, [t]) },
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

function DeviceRow({ d }: { d: Device }) {
  const [renaming, setRenaming] = useState(false)
  const Icon = KIND_ICON[d.kind]
  const items = () => deviceItems(d, () => setRenaming(true))
  const meta = [d.id === DEVICE && "This device", when(d), `${d.tabs.length} ${d.tabs.length === 1 ? "tab" : "tabs"}`, d.label && d.name].filter(Boolean).join(" · ")
  return (
    <Row data-device-row={d.id}
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
  return (
    <Panel title="Devices" icon={MonitorSmartphone} tint="var(--machines)">
      {!list ? <Loading /> : !list.length ? <Empty>No devices yet. Each app and browser you open Vaultite in shows here.</Empty> : (
        <List>{list.map((d) => <DeviceRow key={d.id} d={d} />)}</List>
      )}
    </Panel>
  )
}
