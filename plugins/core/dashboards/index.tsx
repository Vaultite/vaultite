import { LayoutDashboard } from "lucide-react"
import { definePlugin } from "@vaultite"
import { Dashboard, narrow } from "./Dashboard"
import { EditGrid } from "./EditGrid"

export default definePlugin({
  files: {
    types: ["dashboard"], icon: LayoutDashboard,
    page: { render: (ctx) => <Dashboard ctx={ctx} />, narrow: (ctx) => narrow(ctx.body, ctx.disabled),
      editGrid: (cards, edit, ctx) => <EditGrid cards={cards} edit={edit} ctx={ctx} /> },
  },
  preview: "people",
})
