import {
  addDays, AgentModels, AgentProject, AgentProjects, AgentSession, AgentSessions, AgentUsageBlock, canRunAgents, definePlugin, openAgent, sessionTitle, today, type AgentSource, type AgentUsage,
} from "@vaultite"
import { OpenCodeIcon } from "./OpenCodeIcon"

// OpenCode's blocks and session tabs are the app's agent components (AgentUsage.tsx) on GET /api/opencode. It has no
// plan limits, so there's no opencode-limits block.
const SRC: AgentSource = {
  path: "opencode", label: "OpenCode", icon: OpenCodeIcon, tint: "var(--blue)", agent: "opencode", view: "opencode-session",
  costNote: "Cost as OpenCode recorded it",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()

function mock(): AgentUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const v = [0, 2, 5, 1, 7, 0, 9, 3, 4, 6][i % 10] * (1 + i / 30)
    return { date: addDays(today(), i - 29), cost: v, tokens: Math.round(v * 1.2e6), active_min: v * 5, sessions: Math.ceil(v / 4) }
  })
  return {
    updated: ago(0), plan: null, limits: null,
    live: [
      { pid: 1, id: "ses_a", title: "Retry failed uploads", name: "", project: "lighthouse", status: "busy", kind: "interactive", started: ago(25), since: ago(1), model: "Claude Sonnet 5", cost: 1.84, tokens: 2.3e6 },
    ],
    days,
    projects: [
      { name: "lighthouse", root: "/lighthouse", cost: 58.2, tokens: 7.1e7, sessions: 18, active_min: 610, last: ago(1) },
      { name: "blog", root: "/blog", cost: 6.4, tokens: 9.2e6, sessions: 3, active_min: 70, last: ago(60 * 26) },
    ],
    models: [{ name: "Claude Sonnet 5", cost: 52.1, tokens: 5.9e7 }, { name: "Big Pickle", cost: 0, tokens: 1.3e7 }, { name: "GPT-5.4", cost: 12.5, tokens: 8.2e6 }],
    sessions: [
      { id: "ses_b", title: "Dark mode for settings", project: "lighthouse", root: "/lighthouse", first: ago(300), last: ago(240), cost: 3.1, tokens: 4e6, active_min: 41, model: "Claude Sonnet 5" },
      { id: "ses_c", title: "New post layout", project: "blog", root: "/blog", first: ago(1600), last: ago(1560), cost: 0, tokens: 1.1e6, active_min: 14, model: "Big Pickle" },
    ],
    total: { cost: 64.6, tokens: 8.03e7, unpriced: 0, cache_hit: 0.88 },
  }
}

export default definePlugin({
  icon: OpenCodeIcon,
  // `icon: opencode` in a file (its dashboard).
  icons: { opencode: OpenCodeIcon },
  // Its page is the OpenCode dashboard (pages/OpenCode.md); `opencode` goes in a project file.
  blocks: {
    "opencode-sessions": (ctx) => <AgentSessions src={SRC} {...ctx} />,
    "opencode-usage": (ctx) => <AgentUsageBlock src={SRC} {...ctx} />,
    "opencode-projects": (ctx) => <AgentProjects src={SRC} {...ctx} />,
    "opencode-models": (ctx) => <AgentModels src={SRC} {...ctx} />,
    opencode: (ctx) => <AgentProject src={SRC} {...ctx} />,
  },
  // A session read back (view:opencode-session/<id>): opened by clicking a session that isn't in one of the app's terminals.
  views: {
    "opencode-session": {
      icon: OpenCodeIcon,
      title: (id) => sessionTitle(SRC, id),
      render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} />,
    },
  },
  // OpenCode in a terminal tab (the Terminal plugin runs it: the service "agent:opencode" in plugin.ts says how). npm's
  // package (Homebrew's too) runs it as bin/opencode.exe, which is what tmux names the pane.
  agents: { opencode: { label: "OpenCode", icon: OpenCodeIcon, tint: "var(--blue)", process: ["opencode", "opencode.exe"], session: SRC.view } },
  commands: [
    { id: "opencode:open", name: "Open OpenCode", when: canRunAgents, run: () => openAgent("opencode") },
    { id: "opencode:open-split", desktop: true, name: "Open OpenCode in right split", when: canRunAgents, run: () => openAgent("opencode", { split: true }) },
  ],
  mockLive: () => ({ opencode: mock() }),
})
