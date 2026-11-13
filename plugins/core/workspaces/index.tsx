import { definePlugin, isMac, isPopout, vaultSidebars } from "@vaultite"
import { Background, Workspaces } from "./Numbers"
import { WorkspaceSettings } from "./Settings"
import { current, currentTab, cycle, host, lit, moveTab, openElsewhere, patch, slots, SLOTS, switchTo, used } from "./state"

export default definePlugin({
  sidebarSetup: {
    get: () => {
      const n = current()
      return n ? slots()?.[n - 1]?.sidebars ?? vaultSidebars() : null
    },
    set: (next) => { const n = current(); if (n) patch(n, { sidebars: next }) },
  },
  openElsewhere,
  workspace: host,
  settingsPanel: () => <WorkspaceSettings />,
  settingsSearch: [
    { key: "name", label: "Workspace name", description: "shown in the sidebar's switcher" },
    { key: "icon", label: "Workspace icon", description: "shown for its number" },
    { key: "tint", label: "Workspace colour", description: "the sidebars take a little of it" },
    { key: "container", label: "Workspace container", description: "where its web pages open" },
    { key: "pins", label: "Workspace's pinned pages" },
    { key: "panels", label: "Workspace's panels", description: "the sidebars of this workspace" },
  ],
  header: { numbers: { render: (ctx) => <Workspaces {...ctx} /> } },
  background: (ctx) => (isPopout() ? null : <Background {...ctx} />),
  commands: [
    ...SLOTS.map((n) => ({ id: `workspace:${n}`, name: `Switch to workspace ${n}`, keys: [isMac ? `Ctrl+${n}` : `Alt+${n}`], run: () => switchTo(n) })),
    { id: "workspace:next", name: "Switch to next workspace", when: () => used().length > 1, run: () => cycle(1) },
    { id: "workspace:previous", name: "Switch to previous workspace", when: () => used().length > 1, run: () => cycle(-1) },
    ...SLOTS.map((n) => ({ id: `workspace:move-tab-${n}`, name: `Move current tab to workspace ${n}`, when: () => lit() !== n && !!currentTab(),
      run: () => { const t = currentTab(); if (t) void moveTab(t, n) } })),
  ],
})
