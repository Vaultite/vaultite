import { Bot, LayoutGrid } from "lucide-react"
import { definePlugin, isMac, isPopout, vaultSidebars } from "@vaultite"
import { AllTabs, WorkspaceSettings } from "./later"
import { Background, Workspaces } from "./Numbers"
import { newCodeWorkspace } from "./preset"
import { ALL_TABS, current, currentTab, cycle, host, lit, moveTab, openElsewhere, patch, showAllTabs, slots, SLOTS, switchTo, used } from "./state"

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
    { key: "place", label: "Where the workspace's terminals open", description: "a machine, each agent's account" },
    { key: "pins", label: "Workspace's pinned pages" },
    { key: "panels", label: "Workspace's panels", description: "the sidebars of this workspace" },
  ],
  header: { numbers: { title: "Workspaces", view: ALL_TABS, render: (ctx) => <Workspaces {...ctx} /> } },
  background: (ctx) => (isPopout() ? null : <Background {...ctx} />),
  views: {
    [ALL_TABS]: { icon: LayoutGrid, wide: true, title: () => "Workspaces", render: ({ store }) => <AllTabs store={store} /> },
  },
  commands: [
    ...SLOTS.map((n) => ({ id: `workspace:${n}`, name: `Switch to workspace ${n}`, keys: [isMac ? `Ctrl+${n}` : `Alt+${n}`], run: () => switchTo(n) })),
    { id: "workspace:all-tabs", name: "Show workspaces", keys: [isMac ? "Ctrl+0" : "Alt+0"], icon: LayoutGrid, run: showAllTabs },
    { id: "workspace:new-code", name: "New Code workspace", words: "coding agents sessions", run: newCodeWorkspace, icon: Bot },
    { id: "workspace:next", name: "Switch to next workspace", when: () => used().length > 1, run: () => cycle(1) },
    { id: "workspace:previous", name: "Switch to previous workspace", when: () => used().length > 1, run: () => cycle(-1) },
    ...SLOTS.map((n) => ({ id: `workspace:move-tab-${n}`, name: `Move current tab to workspace ${n}`, when: () => lit() !== n && !!currentTab(),
      run: () => { const t = currentTab(); if (t) void moveTab(t, n) } })),
  ],
})
