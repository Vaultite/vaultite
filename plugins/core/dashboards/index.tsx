import { LayoutDashboard } from "lucide-react"
import { definePlugin } from "@vaultite"
import { Dashboard, onlyText } from "./Dashboard"
import { EditGrid } from "./EditGrid"

// Dashboards: a `type: dashboard` file is a page of blocks, read and edited as the same grid (its text edited in
// place between them). Off, it's a Markdown file with its blocks one under another.

export default definePlugin({
  files: {
    types: ["dashboard"], icon: LayoutDashboard,
    page: { render: (ctx) => <Dashboard ctx={ctx} />, narrow: (ctx) => onlyText(ctx.body),
      editGrid: (cards, edit, ctx) => <EditGrid cards={cards} edit={edit} ctx={ctx} /> },
  },
  // What a dashboard looks like: People's, with made-up data.
  preview: "people",
})
