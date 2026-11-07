// The Agents panel (AgentsPanel.tsx), in a new vault's right sidebar; an older setup gets it offered once the first
// agent runs in a terminal (the terminal plugin's index.tsx).
import type { ReactNode } from "react"
import { Bot } from "lucide-react"
import { definePlugin, Panel, useAi } from "@vaultite"
import { AgentsPanel, AgentsView } from "./AgentsPanel"

function Preview() {
  return (
    <Panel title="Agents" icon={Bot} tint="var(--orange)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Every coding agent on every machine in one list: the ones that need you first, then the ones working, then the ones
        done. A terminal, a chat bubble or a cloud says how each runs, and a click opens it where it lives: its terminal or
        its chat.
      </p>
    </Panel>
  )
}

/** Nothing with AI off. */
function Gate({ children }: { children: ReactNode }) {
  return useAi() ? <>{children}</> : null
}

export default definePlugin({
  views: { agents: { icon: Bot, title: () => "Agents", render: () => <AgentsView /> } },
  sidebar: { agents: { title: "Agents", names: ["agents", "sessions", "coding agents", "where agents run"], heading: false, side: "right", sort: 29, view: "agents",
    render: (ctx) => <Gate><AgentsPanel open={ctx.open} tab={ctx.tab} /></Gate> } },
  preview: () => <Preview />,
})
