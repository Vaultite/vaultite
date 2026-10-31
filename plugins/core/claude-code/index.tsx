import { AgentLimitsChip, agentPlugin, choosePlace, definePlugin, getStore, notifyError, op, openFile, openView, pageOf, sessionTitle, type AgentSource } from "@vaultite"
import { ClaudeIcon } from "./ClaudeIcon"
import { chatTitle, ChatView, NEW } from "./ChatTab"

// Claude Code draws the agent blocks (`agent: claude-code`) with the app's agent components (AgentUsage.tsx) on GET
// /api/claude-code, and its sessions' tabs as chats (Chat.tsx); its page is the Claude dashboard (pages/Claude.md).
const SRC: AgentSource = {
  path: "claude-code", label: "Claude Code", speaker: "Claude", icon: ClaudeIcon, tint: "var(--orange)", agent: "claude", view: "claude-session",
  noLimits: "No limits yet. They come from Claude Code, signed in on this machine, or else its status line or the Claude app.",
}

export default definePlugin(agentPlugin(SRC, {
  // `icon: claude` in a file (the Claude dashboard), and Terminal's Claude Code sessions.
  icons: { claude: ClaudeIcon },
  ambient: { limits: { title: "Claude limits", sort: 40, render: () => <AgentLimitsChip src={SRC} open={() => { const p = pageOf(getStore(), "claude-code", "Claude"); if (p) openFile(p.path) }} /> } },
  blocks: { "agent-limits": "limits", "agent-sessions": "sessions", "agent-usage": "usage", "agent-projects": "projects", "agent-models": "models", "agent-project": "project" },
  // Its accounts (config folders: plugin.ts) are offered when choosing where to open it.
  process: ["claude"], accounts: "claude-code/accounts",
  opens: { open: { id: "terminal:claude", name: "Open Claude Code" }, split: { id: "terminal:claude-split", desktop: true, name: "Open Claude Code in right split" } },
  // A session's tab is its chat (`new` until it starts), drawn edge to edge with its own composer.
  sessionView: { full: true, argState: true, title: (id) => chatTitle(id, sessionTitle(SRC, id)),
    render: ({ arg, setArg }) => <ChatView id={arg} setArg={setArg} /> },
  // A question about a file (a live answer's follow-up): a new chat with it.
  ask: (question, file) => void askChat(question, file),
  commands: [
    { id: "claude-code:chat", name: "New Claude Code chat", words: "new", icon: ClaudeIcon, run: () => newChat() },
    { id: "terminal:claude-where", name: "Open Claude Code in an account or on a machine…", run: () => void chooseWhere() },
  ],
  demo: {
    plan: { name: "Max 5x", monthly: 100 },
    limits: { source: "status line", observed: 2, windows: [["session", "Current session", 300, 38, 130], ["week", "This week", 10080, 61, 60 * 52]] },
    daily: [0, 3, 8, 12, 5, 0, 18, 22, 9, 14], per: [1.6e6, 6, 5], cacheHit: 0.96,
    live: [
      { id: "a", title: "Dark mode for the settings page", project: "demo-app", status: "busy", kind: "interactive", at: [40, 3], model: "Opus 5.5", cost: 4.12, tokens: 5.2e6 },
      { id: "b", title: "Fix the flaky upload test", project: "api", status: "idle", kind: "interactive", at: [90, 12], model: "Sonnet 5", cost: 0.86, tokens: 1.1e6 },
    ],
    projects: [
      { name: "demo-app", root: "/demo-app", cost: 142.5, tokens: 2.1e8, sessions: 31, active_min: 1260, last: 3 },
      { name: "api", root: "/api", cost: 64.2, tokens: 9.8e7, sessions: 14, active_min: 540, last: 12 },
      { name: "blog", root: "/blog", cost: 12.9, tokens: 1.7e7, sessions: 4, active_min: 95, last: 60 * 30 },
    ],
    models: [{ name: "Opus 5.5", cost: 170.1, tokens: 2.6e8 }, { name: "Sonnet 5", cost: 49.5, tokens: 6.4e7 }],
    sessions: [
      { id: "c", title: "Release notes for 0.4", project: "demo-app", root: "/demo-app", at: [300, 200], cost: 2.4, tokens: 3e6, active_min: 34, model: "Opus 5.5" },
      { id: "d", title: "Rate limit the webhook route", project: "api", root: "/api", at: [1500, 1400], cost: 5.1, tokens: 6e6, active_min: 58, model: "Opus 5.5" },
      { id: "e", title: "New post layout", project: "blog", root: "/blog", at: [1800, 1790], cost: 1.2, tokens: 1.4e6, active_min: 12, model: "Sonnet 5" },
    ],
  },
}))

/** A new chat, in a new tab. */
const newChat = () => openView(`${SRC.view}/${NEW}`, { newTab: true })

/** Where to open Claude Code: a chat in the app, then each terminal place (an account, a machine). */
const chooseWhere = () => choosePlace({ agent: "claude", first: [{ label: "Claude Code chat", detail: "In the app", icon: ClaudeIcon, run: newChat }] })

async function askChat(question: string, file?: string) {
  try {
    const { id } = await op<{ id: string }>("claude-code.chat-start", { prompt: file ? `${question}\n\n(About \`${file}\` in the vault.)` : question })
    openView(`${SRC.view}/${id}`, { newTab: true })
  } catch (e) { notifyError(e, "Couldn't ask Claude") }
}
