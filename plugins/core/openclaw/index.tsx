import { Bot } from "lucide-react"
import {
  addDays, AgentModels, AgentProject, AgentProjects, AgentSession, AgentSessions, AgentUsageBlock, canRunAgents, definePlugin, openAgent, sessionTitle, today, type AgentSource, type AgentUsage,
} from "@vaultite"
import { CronBlock, MemoryBlock, type Job, type Memory } from "./Workspace"

// OpenClaw's usage blocks and session tabs are the app's agent components (AgentUsage.tsx) on GET /api/openclaw; its
// agents are their accounts. It has no plan limits, so there's no openclaw-limits block.
const SRC: AgentSource = {
  path: "openclaw", label: "OpenClaw", icon: Bot, tint: "var(--red)", agent: "openclaw", view: "openclaw-session",
  costNote: "Cost as OpenClaw recorded it",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()

function mock(): AgentUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const v = [1, 3, 2, 0, 4, 2, 5, 1, 3, 2][i % 10] * (1 + i / 30)
    return { date: addDays(today(), i - 29), cost: v, tokens: Math.round(v * 9e5), active_min: v * 4, sessions: Math.ceil(v / 2) }
  })
  return {
    updated: ago(0), plan: null, limits: null,
    live: [
      { pid: 0, id: "a1", title: "Plan the Lighthouse launch", name: "agent:main:main", project: "workspace", status: "busy", kind: "interactive", started: ago(90), since: ago(1), model: "claude-sonnet-5", cost: 0.92, tokens: 1.1e6 },
    ],
    days,
    projects: [
      { name: "workspace", root: "/workspace", cost: 31.4, tokens: 3.2e7, sessions: 22, active_min: 380, last: ago(1) },
      { name: "lighthouse", root: "/lighthouse", cost: 12.6, tokens: 1.4e7, sessions: 4, active_min: 150, last: ago(60 * 5) },
    ],
    models: [{ name: "claude-sonnet-5", cost: 38.2, tokens: 4.1e7 }, { name: "gpt-5.4-mini", cost: 5.8, tokens: 5.6e6 }],
    sessions: [
      { id: "b2", title: "Morning brief", project: "workspace", root: "/workspace", first: ago(400), last: ago(395), cost: 0.21, tokens: 2.4e5, active_min: 3, model: "gpt-5.4-mini" },
      { id: "c3", title: "Retry failed uploads", project: "lighthouse", root: "/lighthouse", first: ago(600), last: ago(300), cost: 4.3, tokens: 5e6, active_min: 52, model: "claude-sonnet-5" },
    ],
    total: { cost: 44.0, tokens: 4.67e7, unpriced: 0, cache_hit: 0.82 },
  }
}

const memory = (): Memory => ({
  agent: "main", dir: "~/.openclaw/workspace",
  files: [{ name: "USER.md", text: "Alice Park. Prefers short answers; mornings are for deep work.", modified: ago(60 * 30) },
    { name: "MEMORY.md", text: "- Lighthouse launches in November\n- Weekly review on Fridays", modified: ago(60 * 5) }],
  notes: [{ name: "today.md", date: today(), text: "Drafted the launch checklist with Alice.", modified: ago(20) }],
})
const cron = (): Job[] => [
  { id: "brief", name: "Morning brief", description: "", enabled: true, agent: "main", schedule: "cron 0 7 * * *", task: "Summarize my day", next: new Date(Date.now() + 9 * 3600000).toISOString(), last: ago(60 * 15), status: "ok", error: "" },
]

export default definePlugin({
  icon: Bot,
  // `icon: openclaw` in a file (its dashboard).
  icons: { openclaw: Bot },
  // Its page is the OpenClaw dashboard (pages/OpenClaw.md); `openclaw` goes in a project file.
  blocks: {
    "openclaw-sessions": (ctx) => <AgentSessions src={SRC} {...ctx} />,
    "openclaw-usage": (ctx) => <AgentUsageBlock src={SRC} {...ctx} />,
    "openclaw-projects": (ctx) => <AgentProjects src={SRC} {...ctx} />,
    "openclaw-models": (ctx) => <AgentModels src={SRC} {...ctx} />,
    openclaw: (ctx) => <AgentProject src={SRC} {...ctx} />,
    "openclaw-memory": (ctx) => <MemoryBlock {...ctx} />,
    "openclaw-cron": (ctx) => <CronBlock {...ctx} />,
  },
  // A session read back (view:openclaw-session/<transcript id>), with "Resume in terminal".
  views: {
    "openclaw-session": {
      icon: Bot,
      title: (id) => sessionTitle(SRC, id),
      render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} />,
    },
  },
  // OpenClaw's TUI in a terminal tab (the service "agent:openclaw" in plugin.ts says how); an agent other than main is
  // one of its accounts.
  agents: { openclaw: { label: "OpenClaw", icon: Bot, tint: "var(--red)", process: ["openclaw"], session: SRC.view, accounts: "openclaw/accounts" } },
  commands: [
    { id: "openclaw:open", name: "Open OpenClaw", when: canRunAgents, run: () => openAgent("openclaw") },
    { id: "openclaw:open-split", desktop: true, name: "Open OpenClaw in right split", when: canRunAgents, run: () => openAgent("openclaw", { split: true }) },
  ],
  mockLive: () => ({ openclaw: mock(), "openclaw/memory": memory(), "openclaw/cron": cron() }),
})
