import { Bot } from "lucide-react"
import { definePlugin } from "@vaultite"
import { AgentsPanel, AgentsView } from "./AgentsPanel"


export default definePlugin({
  views: { agents: { icon: Bot, title: () => "Agents", render: () => <AgentsView /> } },
  sidebar: { agents: { title: "Agents", names: ["agents", "sessions", "coding agents", "where agents run"], heading: false, side: "right", sort: 29, view: "agents",
    render: (ctx) => <AgentsPanel open={ctx.open} tab={ctx.tab} /> } },
})
