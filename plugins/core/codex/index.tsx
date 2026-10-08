import {
  addDays, AgentLimits, AgentModels, AgentProject, AgentProjects, AgentSession, AgentSessions, AgentUsageBlock, canRunAgents, definePlugin,
  openAgent, sessionTitle, today, type AgentSource, type AgentUsage,
} from "@vaultite"
import { OpenAIIcon } from "./OpenAIIcon"

// Codex's blocks and session tabs are the app's agent components (AgentUsage.tsx) on GET /api/codex.
const SRC: AgentSource = {
  path: "codex", label: "Codex", icon: OpenAIIcon, tint: "var(--green)", agent: "codex", view: "codex-session",
  noLimits: "No limits yet. They come from ChatGPT through the codex CLI, or from Codex's last session on this machine.",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const later = (min: number) => new Date(Date.now() + min * 60000).toISOString()

function mock(): AgentUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const v = [2, 0, 6, 9, 3, 0, 12, 15, 5, 8][i % 10] * (1 + i / 30)
    return { date: addDays(today(), i - 29), cost: v, tokens: Math.round(v * 2.4e6), active_min: v * 5, sessions: Math.ceil(v / 4) }
  })
  return {
    updated: ago(0), plan: { name: "Plus", monthly: 20 },
    limits: { source: "ChatGPT account", observed: ago(1), windows: [
      { id: "primary", label: "Current session", minutes: 300, used: 24, resets_at: later(170) },
      { id: "secondary", label: "This week", minutes: 10080, used: 41, resets_at: later(60 * 70) },
    ] },
    live: [
      { pid: 1, id: "a", title: "Add a search box to the docs", name: "", project: "demo-app", status: "busy", kind: "interactive", started: ago(25), since: ago(2), model: "GPT-6.1 Sol", cost: 1.84, tokens: 3.1e6 },
    ],
    days,
    projects: [
      { name: "demo-app", root: "/demo-app", cost: 61.2, tokens: 1.1e8, sessions: 22, active_min: 640, last: ago(2) },
      { name: "api", root: "/api", cost: 23.5, tokens: 4.2e7, sessions: 9, active_min: 210, last: ago(60 * 20) },
    ],
    models: [{ name: "GPT-6.1 Sol", cost: 70.4, tokens: 1.3e8 }, { name: "GPT-5.6 Luna", cost: 14.3, tokens: 2.2e7 }],
    sessions: [
      { id: "c", title: "Fix the date parsing in the importer", project: "api", root: "/api", first: ago(300), last: ago(250), cost: 1.1, tokens: 2e6, active_min: 18, model: "GPT-6.1 Sol" },
      { id: "d", title: "Tidy the settings page", project: "demo-app", root: "/demo-app", first: ago(1500), last: ago(1400), cost: 2.3, tokens: 4e6, active_min: 31, model: "GPT-6.1 Sol" },
    ],
    total: { cost: 84.7, tokens: 1.52e8, unpriced: 0, cache_hit: 0.82 },
  }
}

export default definePlugin({
  icon: OpenAIIcon,
  // `icon: openai` in a file (its dashboard).
  icons: { openai: OpenAIIcon },
  // Its page is the Codex dashboard (pages/Codex.md); `codex` goes in a project file.
  blocks: {
    "codex-limits": (ctx) => <AgentLimits src={SRC} {...ctx} />,
    "codex-sessions": (ctx) => <AgentSessions src={SRC} {...ctx} />,
    "codex-usage": (ctx) => <AgentUsageBlock src={SRC} {...ctx} />,
    "codex-projects": (ctx) => <AgentProjects src={SRC} {...ctx} />,
    "codex-models": (ctx) => <AgentModels src={SRC} {...ctx} />,
    codex: (ctx) => <AgentProject src={SRC} {...ctx} />,
  },
  // A session read back (view:codex-session/<id>): opened by clicking a session that isn't in one of the app's terminals.
  views: {
    "codex-session": {
      icon: OpenAIIcon,
      title: (id) => sessionTitle(SRC, id),
      render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} />,
    },
  },
  // Codex in a terminal tab (the Terminal plugin runs it: the service "agent:codex" in plugin.ts says how).
  agents: { codex: { label: "Codex", icon: OpenAIIcon, tint: "var(--green)", process: ["codex"], session: SRC.view } },
  commands: [
    { id: "codex:open", name: "Open Codex", when: canRunAgents, run: () => openAgent("codex") },
    { id: "codex:open-split", desktop: true, name: "Open Codex in right split", when: canRunAgents, run: () => openAgent("codex", { split: true }) },
  ],
  mockLive: () => ({ codex: mock() }),
})
