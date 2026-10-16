import { agentPlugin, definePlugin, type AgentSource } from "@vaultite"
import { CursorIcon } from "./CursorIcon"

// Cursor draws the agent blocks (`agent: cursor`) and its chat tabs with the app's agent components (AgentUsage.tsx) on
// GET /api/cursor; its page is the Cursor dashboard (pages/Cursor.md). Terminal runs its CLI.
const SRC: AgentSource = {
  path: "cursor", label: "Cursor", icon: CursorIcon, tint: "var(--purple)", agent: "cursor", view: "cursor-session",
  noLimits: "No usage yet. It comes from Cursor's dashboard, with Cursor.app signed in on this machine and reading it allowed in Cursor's settings.",
  costNote: "Estimated at list prices, as Cursor meters it against the plan",
  consent: { setting: "account", ask: "Read your Cursor plan usage from your account?",
    detail: "With Cursor.app's sign-in on this machine, Vaultite asks cursor.com for the plan's usage every few minutes. The sign-in goes only to Cursor; nothing is kept. Chats are read from this Mac either way." },
}

export default definePlugin(agentPlugin(SRC, {
  // `icon: cursor` in a file (its dashboard).
  icons: { cursor: CursorIcon },
  blocks: { "agent-limits": "limits", "agent-sessions": "sessions", "agent-usage": "usage", "agent-projects": "projects", "agent-models": "models", "agent-project": "project" },
  process: ["agent", "cursor-agent"],
  opens: { open: { id: "terminal:cursor", name: "Open Cursor agent" }, split: { id: "terminal:cursor-split", desktop: true, name: "Open Cursor agent in right split" } },
  demo: {
    plan: { name: "Pro", monthly: 20 },
    limits: { source: "Cursor dashboard", observed: 3, windows: [["month", "Included usage", 43200, 46, 60 * 24 * 12]] },
    daily: [0, 0.8, 2, 3.6, 1.2, 0, 4.4, 5.6, 2.4, 3.2], per: [2.2e6, 9, 2], cacheHit: 0.88,
    live: [
      { id: "a", title: "Search results page", project: "demo-app", status: "busy", kind: "CLI", at: [25, 0], model: "Claude 4.5 Sonnet", cost: 1.64, tokens: 3.1e6 },
      { id: "b", title: "Explain the cache layer", project: "api", status: "idle", kind: "IDE", at: [70, 6], model: "Auto", cost: 0.31, tokens: 6.2e5 },
    ],
    projects: [
      { name: "demo-app", root: "/demo-app", cost: 38.2, tokens: 8.4e7, sessions: 22, active_min: 640, last: 0 },
      { name: "api", root: "/api", cost: 17.5, tokens: 3.9e7, sessions: 9, active_min: 260, last: 6 },
    ],
    models: [{ name: "Claude 4.5 Sonnet", cost: 41.9, tokens: 7.7e7 }, { name: "Auto", cost: 13.8, tokens: 4.6e7 }],
    sessions: [
      { id: "c", title: "Pagination for the orders list", project: "demo-app", root: "/demo-app", at: [300, 240], cost: 2.1, tokens: 4.4e6, active_min: 31, model: "Claude 4.5 Sonnet" },
      { id: "d", title: "Retry failed webhooks", project: "api", root: "/api", at: [1500, 1420], cost: 3.4, tokens: 7e6, active_min: 44, model: "Auto" },
      { id: "e", title: "Dark mode tokens", project: "demo-app", root: "/demo-app", at: [2900, 2880], cost: 0.7, tokens: 1.5e6, active_min: 9, model: "GPT-5" },
    ],
  },
}))
