import {
  addDays, AgentLimits, AgentModels, AgentProject, AgentProjects, AgentSession, AgentSessions, AgentUsageBlock, canRunAgents,
  definePlugin, openAgent, sessionTitle, today, type AgentSource, type AgentUsage,
} from "@vaultite"
import { CursorIcon } from "./CursorIcon"

// Cursor's blocks and chat tabs are the app's agent components (AgentUsage.tsx) on GET /api/cursor.
const SRC: AgentSource = {
  path: "cursor", label: "Cursor", icon: CursorIcon, tint: "var(--purple)", agent: "cursor", view: "cursor-session",
  noLimits: "No usage yet. It comes from Cursor's dashboard, with Cursor.app signed in on this machine and reading it allowed in Cursor's settings.",
  costNote: "Estimated at list prices, as Cursor meters it against the plan",
  consent: { setting: "account", ask: "Read your Cursor plan usage from your account?",
    detail: "With Cursor.app's sign-in on this machine, Vaultite asks cursor.com for the plan's usage every few minutes. The sign-in goes only to Cursor; nothing is kept. Chats are read from this Mac either way." },
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const later = (min: number) => new Date(Date.now() + min * 60000).toISOString()

function mock(): AgentUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const v = [0, 2, 5, 9, 3, 0, 11, 14, 6, 8][i % 10] * (1 + i / 30) * 0.4
    return { date: addDays(today(), i - 29), cost: v, tokens: Math.round(v * 2.2e6), active_min: v * 9, sessions: Math.ceil(v / 2) }
  })
  return {
    updated: ago(0), plan: { name: "Pro", monthly: 20 },
    limits: { source: "Cursor dashboard", observed: ago(3), windows: [
      { id: "month", label: "Included usage", minutes: 43200, used: 46, resets_at: later(60 * 24 * 12) },
      { id: "grok-bot", label: "Grok Bot, this week", minutes: 10080, used: 12, resets_at: later(60 * 70) },
    ] },
    live: [
      { pid: 1, id: "a", title: "Search results page", name: "", project: "demo-app", status: "busy", kind: "CLI", started: ago(25), since: ago(0), model: "Claude 4.5 Sonnet", cost: 1.64, tokens: 3.1e6 },
      { pid: 2, id: "b", title: "Explain the cache layer", name: "", project: "api", status: "idle", kind: "IDE", started: ago(70), since: ago(6), model: "Auto", cost: 0.31, tokens: 6.2e5 },
    ],
    days,
    projects: [
      { name: "demo-app", root: "/demo-app", cost: 38.2, tokens: 8.4e7, sessions: 22, active_min: 640, last: ago(0) },
      { name: "api", root: "/api", cost: 17.5, tokens: 3.9e7, sessions: 9, active_min: 260, last: ago(6) },
      { name: "Grok Bot", cost: 6.1, tokens: 1.2e7, sessions: 5, active_min: 40, last: ago(60 * 20) },
    ],
    models: [{ name: "Claude 4.5 Sonnet", cost: 41.9, tokens: 7.7e7 }, { name: "Auto", cost: 13.8, tokens: 4.6e7 }, { name: "Grok Bot", cost: 6.1, tokens: 1.2e7 }],
    sessions: [
      { id: "c", title: "Pagination for the orders list", project: "demo-app", root: "/demo-app", first: ago(300), last: ago(240), cost: 2.1, tokens: 4.4e6, active_min: 31, model: "Claude 4.5 Sonnet" },
      { id: "d", title: "Retry failed webhooks", project: "api", root: "/api", first: ago(1500), last: ago(1420), cost: 3.4, tokens: 7e6, active_min: 44, model: "Auto" },
      { id: "e", title: "Dark mode tokens", project: "demo-app", root: "/demo-app", first: ago(2900), last: ago(2880), cost: 0.7, tokens: 1.5e6, active_min: 9, model: "GPT-5" },
    ],
    total: { cost: 61.8, tokens: 1.35e8, unpriced: 0, cache_hit: 0.88 },
  }
}

export default definePlugin({
  // `icon: cursor` in a file (its dashboard).
  icons: { cursor: CursorIcon },
  // Its page is the Cursor dashboard (pages/Cursor.md); `cursor` goes in a project file.
  blocks: {
    "cursor-limits": (ctx) => <AgentLimits src={SRC} {...ctx} />,
    "cursor-sessions": (ctx) => <AgentSessions src={SRC} {...ctx} />,
    "cursor-usage": (ctx) => <AgentUsageBlock src={SRC} {...ctx} />,
    "cursor-projects": (ctx) => <AgentProjects src={SRC} {...ctx} />,
    "cursor-models": (ctx) => <AgentModels src={SRC} {...ctx} />,
    cursor: (ctx) => <AgentProject src={SRC} {...ctx} />,
  },
  // A chat read back (view:cursor-session/<id>): opened by clicking a chat that isn't in one of the app's terminals.
  views: {
    "cursor-session": {
      icon: CursorIcon,
      title: (id) => sessionTitle(SRC, id),
      render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} />,
    },
  },
  // Cursor's CLI in a terminal tab (the Terminal plugin runs it: the service "agent:cursor" in plugin.ts says how).
  agents: { cursor: { label: "Cursor", icon: CursorIcon, tint: "var(--purple)", process: ["agent", "cursor-agent"], session: SRC.view } },
  commands: [
    { id: "terminal:cursor", name: "Open Cursor agent", when: canRunAgents, run: () => openAgent("cursor") },
    { id: "terminal:cursor-split", desktop: true, name: "Open Cursor agent in right split", when: canRunAgents, run: () => openAgent("cursor", { split: true }) },
  ],
  mockLive: () => ({ cursor: mock() }),
})
