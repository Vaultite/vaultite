import { agentPlugin, definePlugin, type AgentSource } from "@vaultite"
import { OpenAIIcon } from "./OpenAIIcon"

// Codex draws the agent blocks (`agent: codex`) and its session tabs with the app's agent components (AgentUsage.tsx) on
// GET /api/codex; its page is the Codex dashboard (pages/Codex.md).
const SRC: AgentSource = {
  path: "codex", label: "Codex", icon: OpenAIIcon, tint: "var(--green)", agent: "codex", view: "codex-session",
  noLimits: "No limits yet. They come from ChatGPT through the codex CLI, or from Codex's last session on this machine.",
}

export default definePlugin(agentPlugin(SRC, {
  // `icon: openai` in a file (its dashboard).
  icons: { openai: OpenAIIcon },
  blocks: { "agent-limits": "limits", "agent-sessions": "sessions", "agent-usage": "usage", "agent-projects": "projects", "agent-models": "models", "agent-project": "project" },
  process: ["codex"],
  opens: { open: { id: "codex:open", name: "Open Codex" }, split: { id: "codex:open-split", desktop: true, name: "Open Codex in right split" } },
  demo: {
    plan: { name: "Plus", monthly: 20 },
    limits: { source: "ChatGPT account", observed: 1, windows: [["primary", "Current session", 300, 24, 170], ["secondary", "This week", 10080, 41, 60 * 70]] },
    daily: [2, 0, 6, 9, 3, 0, 12, 15, 5, 8], per: [2.4e6, 5, 4], cacheHit: 0.82,
    live: [{ id: "a", title: "Add a search box to the docs", project: "demo-app", status: "busy", kind: "interactive", at: [25, 2], model: "GPT-6.1 Sol", cost: 1.84, tokens: 3.1e6 }],
    projects: [
      { name: "demo-app", root: "/demo-app", cost: 61.2, tokens: 1.1e8, sessions: 22, active_min: 640, last: 2 },
      { name: "api", root: "/api", cost: 23.5, tokens: 4.2e7, sessions: 9, active_min: 210, last: 60 * 20 },
    ],
    models: [{ name: "GPT-6.1 Sol", cost: 70.4, tokens: 1.3e8 }, { name: "GPT-5.6 Luna", cost: 14.3, tokens: 2.2e7 }],
    sessions: [
      { id: "c", title: "Fix the date parsing in the importer", project: "api", root: "/api", at: [300, 250], cost: 1.1, tokens: 2e6, active_min: 18, model: "GPT-6.1 Sol" },
      { id: "d", title: "Tidy the settings page", project: "demo-app", root: "/demo-app", at: [1500, 1400], cost: 2.3, tokens: 4e6, active_min: 31, model: "GPT-6.1 Sol" },
    ],
  },
}))
