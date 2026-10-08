import type { MouseEvent } from "react"
import { ArrowUpRight, Monitor, Server, SquareTerminal } from "lucide-react"
import {
  canRunAgents, definePlugin, Empty, fetchMachines, List, Loading, menuBelow, openMenu, openPlace, openTerminal, openView, Panel, panelMenu, places,
  SidebarHeading, SidebarRow,
  useMachines, type Machine, type MenuItem, type SearchDoc, type SidebarCtx,
} from "@vaultite"

// Machines: your other computers running Vaultite, each with whether it answers and what it runs; a click opens a
// terminal, an agent or its app there.

const dot = (m: Machine) => (m.online ? "var(--green)" : "var(--gray)")
const about = (m: Machine) => m.online
  ? [m.self && "This one", m.host, m.platform === "darwin" ? "macOS" : m.platform === "linux" ? "Linux" : m.platform,
    m.version && `Vaultite ${m.version}${m.commit ? ` (${m.commit})` : ""}`].filter(Boolean).join(" · ")
  : `Offline${m.error ? `: ${m.error}` : ""}`

/** A machine's menu: a terminal or an agent there, and its app in the browser. */
const hasTerminal = (m: Machine) => canRunAgents() && m.online && (m.self || !!m.plugins?.includes("terminal"))

async function machineItems(m: Machine): Promise<MenuItem[]> {
  const terminal = hasTerminal(m)
  const here = terminal ? (await places()).filter((p) => p.machine === (m.self ? "" : m.id) && p.agent) : []
  return [
    ...(terminal ? [{ label: "New terminal", icon: SquareTerminal, run: () => openTerminal({ machine: m.self ? "" : m.id }) }] : []),
    ...here.map((p, i) => ({ label: `New ${[p.agent!.label, p.profileLabel].filter(Boolean).join(" · ")}`, icon: p.agent!.icon, sep: i === 0, run: () => openPlace(p) })),
    ...(!m.self ? [{ label: "Open its app", icon: ArrowUpRight, sep: terminal, run: () => window.open(m.url, "_blank", "noopener") }] : []),
  ]
}

async function machineMenu(e: MouseEvent, m: Machine) {
  const at = { clientX: e.clientX, clientY: e.clientY, currentTarget: e.currentTarget } as MouseEvent
  const items = await machineItems(m)
  if (items.length) menuBelow(at, items)
}

/** Right-click: the machine's items at the pointer, then the sidebar panel's own (`panel`), under a line. */
function machineContextMenu(e: MouseEvent, m: Machine, panel?: string) {
  e.preventDefault(); e.stopPropagation()
  const at = { x: e.clientX, y: e.clientY }
  void machineItems(m).then((items) => {
    const rest = panel ? panelMenu(panel).map((it, i) => (i || !items.length ? it : { ...it, sep: true })) : []
    openMenu(at, [...items, ...rest])
  })
}

function MachineRow({ m }: { m: Machine }) {
  return (
    <button type="button" onClick={(e) => void machineMenu(e, m)} onContextMenu={(e) => machineContextMenu(e, m)} data-machine={m.id}
      className="relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]">
      <span className="size-2 shrink-0 rounded-full" style={{ background: dot(m) }} data-tip={m.online ? "Online" : "Offline"} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[20px]">{m.label}</div>
        <div className="truncate text-[13px] text-muted-foreground">{about(m)}</div>
      </div>
    </button>
  )
}

const NONE = "No machines yet. Each server on your tailnet adds itself (with Tailscale on); or list them in .vaultite/plugins/machines/data.json."

function MachinesBlock() {
  const list = useMachines()
  return (
    <Panel title="Machines" icon={Server} tint="var(--machines)">
      {!list ? <Loading /> : !list.length ? <Empty>{NONE}</Empty> : (
        <List>{list.map((m) => <MachineRow key={m.id} m={m} />)}</List>
      )}
    </Panel>
  )
}

function MachinesPanel({ open, panel }: SidebarCtx) {
  const list = useMachines()
  const rows = (list ?? []).map((m) => (
    <SidebarRow key={m.id} icon={m.platform === "linux" ? Server : Monitor} tint={m.online ? "var(--machines)" : undefined} label={m.label} open={open}
      tip={`${m.label}: ${about(m)}`} data-machine={m.id}
      onClick={(e) => void machineMenu(e, m)} onContextMenu={(e) => machineContextMenu(e, m, panel)}>
      {open && !m.online && <span className="mr-1 text-[11px] text-tertiary">offline</span>}
    </SidebarRow>
  ))
  if (!open) return rows.length ? <div className="flex flex-col gap-px">{rows}</div> : null
  return (
    <div className="flex shrink-0 flex-col" data-machines-panel>
      <SidebarHeading title="Machines" open={open} />
      <div className="flex flex-col gap-px">
        {rows}
        {list && !list.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No machines yet</p>}
      </div>
    </div>
  )
}

function MachinesView() {
  return <div className="pt-2 pb-10"><MachinesBlock /></div>
}

const mock: Machine[] = [
  { id: "studio", label: "Studio", url: "https://studio.example.ts.net:8447", online: true, self: true, host: "studio", platform: "darwin", version: "0.1.0", commit: "1a2b3c4", plugins: ["terminal"] },
  { id: "laptop", label: "Laptop", url: "https://laptop.example.ts.net:8447", online: true, self: false, host: "laptop", platform: "darwin", version: "0.1.0", commit: "1a2b3c4", plugins: ["terminal"] },
  { id: "box", label: "Box", url: "https://box.example.ts.net:8447", online: false, self: false, error: "no answer" },
]

/** The machines in the quick switcher and the search tab: picking one opens a terminal there (its app when it has no
 *  terminal for you, the Machines tab when it's offline). Asked for again each time one opens. */
let found: Machine[] = []
function machineDocs(): SearchDoc[] {
  return found.map((m) => {
    const terminal = hasTerminal(m)
    return {
      id: `machine-${m.id}`, title: m.label, kind: "Machine", icon: m.platform === "linux" ? Server : Monitor, tint: m.online ? "var(--machines)" : "var(--muted-foreground)",
      meta: `Machine · ${!m.online ? "offline" : terminal ? "opens a terminal there" : m.self ? "this one" : "opens its app"}`,
      run: () => (terminal ? openTerminal({ machine: m.self ? "" : m.id }) : m.online && !m.self ? void window.open(m.url, "_blank", "noopener") : openView("machines", { newTab: true })),
      text: [m.host, m.self && "this one"].filter(Boolean).join(" "), recent: 0, weight: 5,
    }
  })
}

export default definePlugin({
  blocks: { machines: () => <MachinesBlock /> },
  searchLive: {
    docs: machineDocs,
    subscribe: (changed) => {
      let on = true
      void fetchMachines().then((list) => { if (on) { found = list; changed() } })
      return () => { on = false }
    },
  },
  sidebar: { machines: { title: "Machines", heading: false, sort: 32, hidden: true, view: "machines", render: (ctx) => <MachinesPanel {...ctx} /> } },
  views: { machines: { icon: Server, title: () => "Machines", render: () => <MachinesView /> } },
  commands: [{ id: "machines:open-tab", name: "Open machines in a tab", run: () => openView("machines", { newTab: true }) }],
  mockLive: () => ({ machines: mock }),
  preview: () => <MachinesBlock />,
})
