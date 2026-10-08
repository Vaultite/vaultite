import { LayoutGrid } from "lucide-react"
import { definePlugin, isMac, isPopout, vaultSidebars } from "@vaultite"
import { Background, Workspaces } from "./Numbers"
import { WorkspaceSettings } from "./Settings"
import { current, currentTab, cycle, host, lit, moveTab, openElsewhere, patch, slots, SLOTS, switchTo, used } from "./state"

// Workspaces, like a tiling window manager's: up to five desks (tabs, panels, pins, per-desk state), the current one
// per device. Devices on one follow each other live and save only what they share, so a change received never echoes.

export default definePlugin({
  icon: LayoutGrid,
  // The sidebars are the current workspace's own, else sidebars.json's (what new ones start with).
  sidebarSetup: {
    get: () => {
      const n = current()
      return n ? slots()?.[n - 1]?.sidebars ?? vaultSidebars() : null
    },
    set: (next) => { const n = current(); if (n) patch(n, { sidebars: next }) },
  },
  // A terminal open in another workspace too keeps its shell when its tab here closes.
  openElsewhere,
  workspace: host,
  // Its settings sheet: the current workspace's name, and whether its pins and panels are its own.
  settingsPanel: () => <WorkspaceSettings />,
  settingsSearch: [
    { key: "name", label: "Workspace name", description: "shown in the sidebar's switcher" },
    { key: "pins", label: "Workspace's pinned pages" },
    { key: "panels", label: "Workspace's panels", description: "the sidebars of this workspace" },
  ],
  header: { numbers: { render: (ctx) => <Workspaces {...ctx} /> } },
  // (a pop-out window's tabs are its own, not the workspace's: core/workspace.ts POPOUT)
  background: (ctx) => (isPopout() ? null : <Background {...ctx} />),
  commands: [
    // Off a Mac ⌃ is the app's Mod, and Mod+1–9 go to tabs: ⌥ there.
    ...SLOTS.map((n) => ({ id: `workspace:${n}`, name: `Switch to workspace ${n}`, keys: [isMac ? `Ctrl+${n}` : `Alt+${n}`], run: () => switchTo(n) })),
    { id: "workspace:next", name: "Switch to next workspace", when: () => used().length > 1, run: () => cycle(1) },
    { id: "workspace:previous", name: "Switch to previous workspace", when: () => used().length > 1, run: () => cycle(-1) },
    // What dragging a tab onto another workspace's row does, from the keyboard.
    ...SLOTS.map((n) => ({ id: `workspace:move-tab-${n}`, name: `Move current tab to workspace ${n}`, when: () => lit() !== n && !!currentTab(),
      run: () => { const t = currentTab(); if (t) void moveTab(t, n) } })),
  ],
})
