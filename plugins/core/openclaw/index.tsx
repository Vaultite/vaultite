import { Bot } from "lucide-react"
import { agentPlugin, definePlugin, today, type AgentSource } from "@vaultite"
import { CronBlock, MemoryBlock, type Job, type Memory } from "./Workspace"

// OpenClaw draws the agent blocks (`agent: openclaw`) and its session tabs with the app's agent components on GET
// /api/openclaw; its agents are their accounts. No plan limits: no agent-limits.
const SRC: AgentSource = {
  path: "openclaw", label: "OpenClaw", icon: Bot, tint: "var(--red)", agent: "openclaw", view: "openclaw-session",
  costNote: "Cost as OpenClaw recorded it",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const memory = (): Memory => ({
  agent: "main", dir: "~/.openclaw/workspace",
  files: [{ name: "USER.md", text: "Alice Park. Prefers short answers; mornings are for deep work.", modified: ago(60 * 30) },
    { name: "MEMORY.md", text: "- Lighthouse launches in November\n- Weekly review on Fridays", modified: ago(60 * 5) }],
  notes: [{ name: "today.md", date: today(), text: "Drafted the launch checklist with Alice.", modified: ago(20) }],
})
const cron = (): Job[] => [
  { id: "brief", name: "Morning brief", description: "", enabled: true, agent: "main", schedule: "cron 0 7 * * *", task: "Summarize my day", next: ago(-9 * 60), last: ago(60 * 15), status: "ok", error: "" },
]

export default definePlugin(agentPlugin(SRC, {
  // `icon: openclaw` in a file (its dashboard).
  icons: { openclaw: Bot },
  blocks: { "agent-sessions": "sessions", "agent-usage": "usage", "agent-projects": "projects", "agent-models": "models", "agent-project": "project",
    "openclaw-memory": (ctx) => <MemoryBlock {...ctx} />, "openclaw-cron": (ctx) => <CronBlock {...ctx} /> },
  // Its TUI in a terminal tab; an agent other than main is one of its accounts.
  process: ["openclaw"], accounts: "openclaw/accounts",
  opens: { open: { id: "openclaw:open", name: "Open OpenClaw" }, split: { id: "openclaw:open-split", desktop: true, name: "Open OpenClaw in right split" } },
  demo: {
    daily: [1, 3, 2, 0, 4, 2, 5, 1, 3, 2], per: [9e5, 4, 2], cacheHit: 0.82,
    live: [{ pid: 0, id: "a1", title: "Plan the Lighthouse launch", name: "agent:main:main", project: "workspace", status: "busy", kind: "interactive", at: [90, 1], model: "claude-sonnet-5", cost: 0.92, tokens: 1.1e6 }],
    projects: [
      { name: "workspace", root: "/workspace", cost: 31.4, tokens: 3.2e7, sessions: 22, active_min: 380, last: 1 },
      { name: "lighthouse", root: "/lighthouse", cost: 12.6, tokens: 1.4e7, sessions: 4, active_min: 150, last: 60 * 5 },
    ],
    models: [{ name: "claude-sonnet-5", cost: 38.2, tokens: 4.1e7 }, { name: "gpt-5.4-mini", cost: 5.8, tokens: 5.6e6 }],
    sessions: [
      { id: "b2", title: "Morning brief", project: "workspace", root: "/workspace", at: [400, 395], cost: 0.21, tokens: 2.4e5, active_min: 3, model: "gpt-5.4-mini" },
      { id: "c3", title: "Retry failed uploads", project: "lighthouse", root: "/lighthouse", at: [600, 300], cost: 4.3, tokens: 5e6, active_min: 52, model: "claude-sonnet-5" },
    ],
  },
  demoMore: () => ({ "openclaw/memory": memory(), "openclaw/cron": cron() }),
}))
