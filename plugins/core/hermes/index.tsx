import { Feather } from "lucide-react"
import {
  addDays, AgentModels, AgentProject, AgentProjects, AgentSession, AgentSessions, AgentUsageBlock, canRunAgents, definePlugin, openAgent, sessionTitle, today, type AgentSource, type AgentUsage,
} from "@vaultite"
import { HermesCron, HermesMemory } from "./Memory"

// Hermes' usage blocks and session tabs are the app's agent components (AgentUsage.tsx) on GET /api/hermes; its memory
// and scheduled jobs are its own (Memory.tsx). It has no plan limits, so there's no hermes-limits block.
const SRC: AgentSource = {
  path: "hermes", label: "Hermes", icon: Feather, tint: "var(--purple)", agent: "hermes", view: "hermes-session",
  costNote: "Cost as Hermes recorded it",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()

function mock(): AgentUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const v = [1, 0, 4, 2, 6, 0, 8, 3, 5, 2][i % 10] * (1 + i / 30)
    return { date: addDays(today(), i - 29), cost: v, tokens: Math.round(v * 1.1e6), active_min: v * 4, sessions: Math.ceil(v / 3) }
  })
  return {
    updated: ago(0), plan: null, limits: null,
    live: [
      { pid: 1, id: "20260929_101500_a1b2c3", title: "Map tiles flicker", name: "", project: "lighthouse", status: "busy", kind: "interactive", started: ago(18), since: ago(1), model: "claude-sonnet-4.6", cost: 0.92, tokens: 1.4e6 },
    ],
    days,
    projects: [
      { name: "lighthouse", root: "/lighthouse", cost: 41.3, tokens: 5.2e7, sessions: 14, active_min: 420, last: ago(1) },
      { name: "Telegram", cost: 3.1, tokens: 4.4e6, sessions: 22, active_min: 35, last: ago(90) },
    ],
    models: [{ name: "claude-sonnet-4.6", cost: 38.9, tokens: 4.6e7 }, { name: "hermes-4-405b", cost: 5.5, tokens: 1.0e7 }],
    sessions: [
      { id: "20260929_090000_d4e5f6", title: "Tide table parser", project: "lighthouse", root: "/lighthouse", first: ago(300), last: ago(250), cost: 2.4, tokens: 3.1e6, active_min: 32, model: "claude-sonnet-4.6" },
      { id: "20260928_190000_0a0b0c", title: "What's on tomorrow?", project: "Telegram", root: "", first: ago(1500), last: ago(1490), cost: 0.04, tokens: 2.2e4, active_min: 1, model: "hermes-4-405b" },
    ],
    total: { cost: 44.4, tokens: 5.62e7, unpriced: 0, cache_hit: 0.81 },
  }
}

export default definePlugin({
  // `icon: hermes` in a file (its dashboard).
  icons: { hermes: Feather },
  // Its page is the Hermes dashboard (pages/Hermes.md); `hermes` goes in a project file.
  blocks: {
    "hermes-sessions": (ctx) => <AgentSessions src={SRC} {...ctx} />,
    "hermes-usage": (ctx) => <AgentUsageBlock src={SRC} {...ctx} />,
    "hermes-projects": (ctx) => <AgentProjects src={SRC} {...ctx} />,
    "hermes-models": (ctx) => <AgentModels src={SRC} {...ctx} />,
    hermes: (ctx) => <AgentProject src={SRC} {...ctx} />,
    "hermes-memory": (ctx) => <HermesMemory {...ctx} />,
    "hermes-cron": (ctx) => <HermesCron {...ctx} />,
  },
  // A session read back (view:hermes-session/<id>): opened by clicking a session that isn't in one of the app's terminals.
  views: {
    "hermes-session": {
      icon: Feather,
      title: (id) => sessionTitle(SRC, id),
      render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} />,
    },
  },
  // Hermes in a terminal tab (the Terminal plugin runs it: the service "agent:hermes" in plugin.ts says how), in its main
  // home or a profile (its accounts).
  agents: { hermes: { label: "Hermes", icon: Feather, tint: "var(--purple)", process: ["hermes"], session: SRC.view, accounts: "hermes/accounts" } },
  commands: [
    { id: "hermes:open", name: "Open Hermes", when: canRunAgents, run: () => openAgent("hermes") },
    { id: "hermes:open-split", desktop: true, name: "Open Hermes in right split", when: canRunAgents, run: () => openAgent("hermes", { split: true }) },
  ],
  mockLive: () => ({
    hermes: mock(),
    "hermes/memory": { account: "default", soul: "You are a careful assistant. Keep answers short.",
      memory: ["Lighthouse's tests run with npm test.", "The map tiles cache lives in src/tiles.ts."], user: ["Prefers metric units."] },
    "hermes/cron": { account: "default", jobs: [
      { id: "a1", name: "Morning tide summary", prompt: "", schedule: "0 7 * * *", enabled: true, next: ago(-600), last: ago(840), status: "ok", error: null },
      { id: "b2", name: "Weekly cleanup", prompt: "", schedule: "every 10080m", enabled: false, next: null, last: ago(9000), status: "error", error: "Provider timeout" },
    ] },
  }),
})
