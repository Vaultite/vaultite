import { Feather } from "lucide-react"
import { agentPlugin, definePlugin, type AgentSource } from "@vaultite"
import { HermesCron, HermesMemory } from "./Memory"

// Hermes draws the agent blocks (`agent: hermes`) and its session tabs with the app's agent components on GET
// /api/hermes; its memory and scheduled jobs are its own (Memory.tsx). No plan limits: no agent-limits.
const SRC: AgentSource = {
  path: "hermes", label: "Hermes", icon: Feather, tint: "var(--purple)", agent: "hermes", view: "hermes-session",
  costNote: "Cost as Hermes recorded it",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()

export default definePlugin(agentPlugin(SRC, {
  // `icon: hermes` in a file (its dashboard).
  icons: { hermes: Feather },
  blocks: { "agent-sessions": "sessions", "agent-usage": "usage", "agent-projects": "projects", "agent-models": "models", "agent-project": "project",
    "hermes-memory": (ctx) => <HermesMemory {...ctx} />, "hermes-cron": (ctx) => <HermesCron {...ctx} /> },
  // In its main home or a profile (its accounts).
  process: ["hermes"], accounts: "hermes/accounts",
  opens: { open: { id: "hermes:open", name: "Open Hermes" }, split: { id: "hermes:open-split", desktop: true, name: "Open Hermes in right split" } },
  demo: {
    daily: [1, 0, 4, 2, 6, 0, 8, 3, 5, 2], per: [1.1e6, 4, 3], cacheHit: 0.81,
    live: [{ id: "20260929_101500_a1b2c3", title: "Map tiles flicker", project: "lighthouse", status: "busy", kind: "interactive", at: [18, 1], model: "claude-sonnet-4.6", cost: 0.92, tokens: 1.4e6 }],
    projects: [
      { name: "lighthouse", root: "/lighthouse", cost: 41.3, tokens: 5.2e7, sessions: 14, active_min: 420, last: 1 },
      { name: "Telegram", cost: 3.1, tokens: 4.4e6, sessions: 22, active_min: 35, last: 90 },
    ],
    models: [{ name: "claude-sonnet-4.6", cost: 38.9, tokens: 4.6e7 }, { name: "hermes-4-405b", cost: 5.5, tokens: 1.0e7 }],
    sessions: [
      { id: "20260929_090000_d4e5f6", title: "Tide table parser", project: "lighthouse", root: "/lighthouse", at: [300, 250], cost: 2.4, tokens: 3.1e6, active_min: 32, model: "claude-sonnet-4.6" },
      { id: "20260928_190000_0a0b0c", title: "What's on tomorrow?", project: "Telegram", root: "", at: [1500, 1490], cost: 0.04, tokens: 2.2e4, active_min: 1, model: "hermes-4-405b" },
    ],
  },
  demoMore: () => ({
    "hermes/memory": { account: "default", soul: "You are a careful assistant. Keep answers short.",
      memory: ["Lighthouse's tests run with npm test.", "The map tiles cache lives in src/tiles.ts."], user: ["Prefers metric units."] },
    "hermes/cron": { account: "default", jobs: [
      { id: "a1", name: "Morning tide summary", prompt: "", schedule: "0 7 * * *", enabled: true, next: ago(-600), last: ago(840), status: "ok", error: null },
      { id: "b2", name: "Weekly cleanup", prompt: "", schedule: "every 10080m", enabled: false, next: null, last: ago(9000), status: "error", error: "Provider timeout" },
    ] },
  }),
}))
