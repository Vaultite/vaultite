import { agentPlugin, definePlugin, type AgentSource } from "@vaultite"
import { OpenCodeIcon } from "./OpenCodeIcon"

// OpenCode draws the agent blocks (`agent: opencode`) and its session tabs with the app's agent components on GET
// /api/opencode (pages/OpenCode.md). No plan limits: no agent-limits.
const SRC: AgentSource = {
  path: "opencode", label: "OpenCode", icon: OpenCodeIcon, tint: "var(--blue)", agent: "opencode", view: "opencode-session",
  costNote: "Cost as OpenCode recorded it",
}

export default definePlugin(agentPlugin(SRC, {
  // `icon: opencode` in a file (its dashboard).
  icons: { opencode: OpenCodeIcon },
  blocks: { "agent-sessions": "sessions", "agent-usage": "usage", "agent-projects": "projects", "agent-models": "models", "agent-project": "project" },
  // (npm's package, Homebrew's too, runs it as bin/opencode.exe: what tmux names the pane)
  process: ["opencode", "opencode.exe"],
  opens: { open: { id: "opencode:open", name: "Open OpenCode" }, split: { id: "opencode:open-split", desktop: true, name: "Open OpenCode in right split" } },
  demo: {
    daily: [0, 2, 5, 1, 7, 0, 9, 3, 4, 6], per: [1.2e6, 5, 4], cacheHit: 0.88,
    live: [{ id: "ses_a", title: "Retry failed uploads", project: "lighthouse", status: "busy", kind: "interactive", at: [25, 1], model: "Claude Sonnet 5", cost: 1.84, tokens: 2.3e6 }],
    projects: [
      { name: "lighthouse", root: "/lighthouse", cost: 58.2, tokens: 7.1e7, sessions: 18, active_min: 610, last: 1 },
      { name: "blog", root: "/blog", cost: 6.4, tokens: 9.2e6, sessions: 3, active_min: 70, last: 60 * 26 },
    ],
    models: [{ name: "Claude Sonnet 5", cost: 52.1, tokens: 5.9e7 }, { name: "Big Pickle", cost: 0, tokens: 1.3e7 }, { name: "GPT-5.4", cost: 12.5, tokens: 8.2e6 }],
    sessions: [
      { id: "ses_b", title: "Dark mode for settings", project: "lighthouse", root: "/lighthouse", at: [300, 240], cost: 3.1, tokens: 4e6, active_min: 41, model: "Claude Sonnet 5" },
      { id: "ses_c", title: "New post layout", project: "blog", root: "/blog", at: [1600, 1560], cost: 0, tokens: 1.1e6, active_min: 14, model: "Big Pickle" },
    ],
  },
}))
