// The Agents panel (AgentsPanel.tsx), in a new vault's right sidebar; an older setup gets it offered once the first
// agent runs in a terminal (the terminal plugin's index.tsx).
import { Bot } from "lucide-react"
import { definePlugin, Panel } from "@vaultite"
import { AgentsPanel, AgentsView } from "./AgentsPanel"

function Preview() {
  return (
    <Panel title="Agents" icon={Bot} tint="var(--orange)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Every coding agent on every machine in one quiet list: the ones that need you first, then the ones working, then
        the ones done, a small dot saying which. The ones finished a while ago fold away, and a click opens one where it
        lives: its terminal or its chat.
      </p>
    </Panel>
  )
}

export default definePlugin({
  views: { agents: { icon: Bot, title: () => "Agents", render: () => <AgentsView /> } },
  sidebar: { agents: { title: "Agents", names: ["agents", "sessions", "coding agents", "where agents run"], heading: false, side: "right", sort: 29, view: "agents",
    render: (ctx) => <AgentsPanel open={ctx.open} tab={ctx.tab} /> } },
  preview: () => <Preview />,
})
