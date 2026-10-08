import { Tags } from "lucide-react"
import { definePlugin, openView } from "@vaultite"
import { PropertiesPanel, PropertiesView } from "./Properties"
import { Chips, ChipsSettings } from "./Chips"
import "./types"

// All properties: every frontmatter key with its count and type, renamed or retyped everywhere; keys
// pinned to headers are chips (Chips.tsx).
export default definePlugin({
  sidebar: { properties: { title: "All properties", heading: false, sort: 52, hidden: true, view: "properties", flyout: { icon: Tags }, render: (ctx) => <PropertiesPanel {...ctx} /> } },
  views: { properties: { icon: Tags, title: () => "All properties", render: ({ store }) => <PropertiesView store={store} /> } },
  fileBar: { chips: { sort: 40, render: (file) => <Chips file={file} place={file.place} /> } },
  status: { chips: { sort: 40, render: (file) => <Chips file={file} place="status" /> } },
  settingsPanel: ({ store }) => <ChipsSettings store={store} />,
  settingsSearch: [
    { label: "Properties in files' headers", description: "chips to set a property from, and in the status bar" },
    { key: "only", label: "Only on", description: "kinds of file the header's properties show on" },
  ],
  commands: [{ id: "properties:open-tab", name: "Open all properties in a tab", run: () => openView("properties", { newTab: true }) }],
})
