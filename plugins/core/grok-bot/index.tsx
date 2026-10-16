import { agentPlugin, definePlugin, type AgentSource } from "@vaultite"
import { GrokBotIcon } from "./GrokBotIcon"

// Grok Bot draws the agent blocks (`agent: grok-bot`) and its conversation tabs with the app's agent components on GET
// /api/grok-bot (pages/Grok Bot.md). It runs in the cloud: nothing open here, nothing for Terminal to run.
const SRC: AgentSource = {
  path: "grok-bot", label: "Grok Bot", icon: GrokBotIcon, tint: "var(--teal)", agent: "grok-bot", view: "grok-bot-session",
  noLimits: "No week yet. It comes from Cursor's dashboard, with Cursor.app signed in on this machine, on a plan with Grok Bot.",
  costNote: "Estimated at list prices, as Cursor meters it",
  cloud: "What was said stays in Grok Bot: Cursor's dashboard says only when it worked, with which model and what it was worth.",
  consent: { setting: "account", ask: "Read Grok Bot's usage from your Cursor account?",
    detail: "With Cursor.app's sign-in on this machine, Vaultite asks cursor.com for Grok Bot's week and requests every few minutes. The sign-in goes only to Cursor; nothing is kept." },
}

export default definePlugin(agentPlugin(SRC, {
  // `icon: grok-bot` in a file (its dashboard).
  icons: { "grok-bot": GrokBotIcon },
  blocks: { "agent-limits": "limits", "agent-sessions": "sessions", "agent-usage": "usage", "agent-models": "models" },
  demo: {
    limits: { source: "Cursor dashboard", observed: 3, windows: [["week", "This week", 10080, 12, 60 * 70]] },
    daily: [0.4, 0, 0.9, 1.2, 0.3, 0.6, 1.5, 0, 0.8, 1.1], per: [1.8e6, 6, 0.6], cacheHit: 0.81,
    live: [],
    projects: [{ name: "Grok Bot", cost: 6.1, tokens: 1.2e7, sessions: 9, active_min: 40, last: 60 * 2 }],
    models: [{ name: "Grok Bot", cost: 5.4, tokens: 1.05e7 }, { name: "Grok Bot automation", cost: 0.7, tokens: 1.5e6 }],
    sessions: [
      { id: "c0", title: "Conversation 7f3a91c2", project: "", root: "", at: [180, 120], cost: 0.9, tokens: 1.7e6, active_min: 14, model: "Grok Bot" },
      { id: "c1", title: "Conversation 2b8e04d1", project: "", root: "", at: [900, 860], cost: 1.3, tokens: 2.6e6, active_min: 22, model: "Grok Bot" },
      { id: "c2", title: "Conversation e51c6f0a", project: "", root: "", at: [2400, 2390], cost: 0.2, tokens: 4e5, active_min: 3, model: "Grok Bot automation" },
    ],
  },
}))
