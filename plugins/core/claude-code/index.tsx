import {
  addDays, AgentLimits, AgentLimitsChip, AgentModels, AgentProject, AgentProjects, AgentSession, AgentSessions, AgentUsageBlock, canRunAgents,
  choosePlace, definePlugin, getStore, openAgent, openFile, pageOf, sessionTitle, today, type AgentSource, type AgentUsage,
} from "@vaultite"
import { ClaudeIcon } from "./ClaudeIcon"

// Claude Code's blocks and session tabs are the app's agent components (AgentUsage.tsx) on GET /api/claude-code.
const SRC: AgentSource = {
  path: "claude-code", label: "Claude Code", speaker: "Claude", icon: ClaudeIcon, tint: "var(--orange)", agent: "claude", view: "claude-session",
  noLimits: "No limits yet. They come from Claude Code, signed in on this machine, or else its status line or the Claude app.",
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const later = (min: number) => new Date(Date.now() + min * 60000).toISOString()

function mock(): AgentUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const v = [0, 3, 8, 12, 5, 0, 18, 22, 9, 14][i % 10] * (1 + i / 30)
    return { date: addDays(today(), i - 29), cost: v, tokens: Math.round(v * 1.6e6), active_min: v * 6, sessions: Math.ceil(v / 5) }
  })
  return {
    updated: ago(0), plan: { name: "Max 5x", monthly: 100 },
    limits: { source: "status line", observed: ago(2), windows: [
      { id: "session", label: "Current session", minutes: 300, used: 38, resets_at: later(130) },
      { id: "week", label: "This week", minutes: 10080, used: 61, resets_at: later(60 * 52) },
    ] },
    live: [
      { pid: 1, id: "a", title: "Dark mode for the settings page", name: "", project: "demo-app", status: "busy", kind: "interactive", started: ago(40), since: ago(3), model: "Opus 5.5", cost: 4.12, tokens: 5.2e6 },
      { pid: 2, id: "b", title: "Fix the flaky upload test", name: "", project: "api", status: "idle", kind: "interactive", started: ago(90), since: ago(12), model: "Sonnet 5", cost: 0.86, tokens: 1.1e6 },
    ],
    days,
    projects: [
      { name: "demo-app", root: "/demo-app", cost: 142.5, tokens: 2.1e8, sessions: 31, active_min: 1260, last: ago(3) },
      { name: "api", root: "/api", cost: 64.2, tokens: 9.8e7, sessions: 14, active_min: 540, last: ago(12) },
      { name: "blog", root: "/blog", cost: 12.9, tokens: 1.7e7, sessions: 4, active_min: 95, last: ago(60 * 30) },
    ],
    models: [{ name: "Opus 5.5", cost: 170.1, tokens: 2.6e8 }, { name: "Sonnet 5", cost: 49.5, tokens: 6.4e7 }],
    sessions: [
      { id: "c", title: "Release notes for 0.4", project: "demo-app", root: "/demo-app", first: ago(300), last: ago(200), cost: 2.4, tokens: 3e6, active_min: 34, model: "Opus 5.5" },
      { id: "d", title: "Rate limit the webhook route", project: "api", root: "/api", first: ago(1500), last: ago(1400), cost: 5.1, tokens: 6e6, active_min: 58, model: "Opus 5.5" },
      { id: "e", title: "New post layout", project: "blog", root: "/blog", first: ago(1800), last: ago(1790), cost: 1.2, tokens: 1.4e6, active_min: 12, model: "Sonnet 5" },
    ],
    total: { cost: 219.6, tokens: 3.24e8, unpriced: 0, cache_hit: 0.96 },
  }
}

export default definePlugin({
  // `icon: claude` in a file (the Claude dashboard), and Terminal's Claude Code sessions.
  icons: { claude: ClaudeIcon },
  ambient: { limits: { title: "Claude limits", sort: 40, render: () => <AgentLimitsChip src={SRC} open={() => { const p = pageOf(getStore(), "claude-code", "Claude"); if (p) openFile(p.path) }} /> } },
  // Its page is the Claude dashboard (pages/Claude.md); `claude` goes in a project file.
  blocks: {
    "claude-limits": (ctx) => <AgentLimits src={SRC} {...ctx} />,
    "claude-sessions": (ctx) => <AgentSessions src={SRC} {...ctx} />,
    "claude-usage": (ctx) => <AgentUsageBlock src={SRC} {...ctx} />,
    "claude-projects": (ctx) => <AgentProjects src={SRC} {...ctx} />,
    "claude-models": (ctx) => <AgentModels src={SRC} {...ctx} />,
    claude: (ctx) => <AgentProject src={SRC} {...ctx} />,
  },
  // A session read back (view:claude-session/<id>, <id>@<machine> for another machine's): opened by clicking a session
  // that isn't in one of the app's terminals.
  views: {
    "claude-session": {
      icon: ClaudeIcon,
      title: (id) => sessionTitle(SRC, id),
      render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} />,
    },
  },
  // Claude Code in a terminal tab (the Terminal plugin runs it: the service "agent:claude" in plugin.ts says how).
  // Its accounts (config folders: plugin.ts) are offered when choosing where to open it.
  agents: { claude: { label: "Claude Code", icon: ClaudeIcon, tint: "var(--orange)", process: ["claude"], session: SRC.view, accounts: "claude-code/accounts" } },
  commands: [
    { id: "terminal:claude", name: "Open Claude Code", when: canRunAgents, run: () => openAgent("claude"), icon: ClaudeIcon },
    { id: "terminal:claude-where", name: "Open Claude Code in an account or on a machine…", when: canRunAgents, run: () => void choosePlace({ agent: "claude" }) },
    { id: "terminal:claude-split", desktop: true, name: "Open Claude Code in right split", when: canRunAgents, run: () => openAgent("claude", { split: true }) },
  ],
  mockLive: () => ({ "claude-code": mock() }),
})
