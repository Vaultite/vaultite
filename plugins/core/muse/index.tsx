import { AgentSession, definePlugin, type AgentSource } from "@vaultite"
import { type Dreams, type Feed, MuseBlock, MuseDreams, MuseFeed, MuseMemory, MuseRuns, MuseSetup, type Memory, type Overview, type Run } from "./Blocks"
import { MuseIcon } from "./marks"

// A run read back is the app's session view (AgentSession.tsx) on GET /api/muse/session/<machine>:<run>; it runs on
// its own machine, so there's no resuming it in a terminal here.
const SRC: AgentSource = { path: "muse", label: "Muse", icon: MuseIcon, tint: "var(--blue)", agent: "muse", view: "muse-session", resume: false }

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const overview = (): Overview => ({
  machine: "lighthouse-vm", label: "Lighthouse VM", home: "/home/agent", name: "Wren",
  files: [{ name: "IDENTITY.md", text: "- **Name:** Wren", modified: ago(60 * 24), unfilled: ["Vibe"] }, { name: "USER.md", text: "- **Name:** Alice Park", modified: ago(90), unfilled: ["Timezone"] }],
  connectors: [{ name: "google_calendar", status: "connected" }, { name: "notion", status: "available" }],
  jobs: [{ id: "heartbeat", enabled: true, archived: false, mode: "heartbeat", schedule: "every 30m", task: "Run the heartbeat checklist.", by: "system" }],
  objectives: [{ id: "memory", outcome: "improved", at: ago(300) }], counts: { runs: 24, dreams: 6, notes: 9 },
})
const runs = (): { total: number; runs: Run[] } => ({ total: 24, runs: [
  { id: "a1", kind: "Conversation", title: "Plan the Lighthouse launch", first: ago(40), last: ago(30), items: 18, tools: 4, model: "", tokens: 42000 },
  { id: "b2", kind: "Feed", title: "Work this hour's beat.", first: ago(90), last: ago(85), items: 30, tools: 9, model: "", tokens: 81000 },
] })
const memory = (): Memory => ({ facts: ["Alice is launching Lighthouse in November."], modified: ago(60), people: 2, notes: 9,
  days: [{ date: "2026-10-10", modified: ago(60), facts: [{ kind: "fact", confidence: "high", text: "Alice prefers short answers.", quote: "keep it short", at: "09:10 UTC" }], notes: [] }],
  bank: [{ name: "world", items: ["Lighthouse is a small studio."], modified: ago(600) }] })
const dreams = (): Dreams => ({ total: 6, synthesis: { text: "Alice tests before trusting.", modified: ago(500) },
  dreams: [{ date: "2026-10-10", text: "A quiet day: one question about the launch, answered in two lines.", modified: ago(500), path: "/home/agent/dreams/2026-10-10.md" }] })
const feed = (): Feed => ({ slots: 3, stories: [{ title: "A new open model for code", text: "It runs on a laptop.", links: [{ url: "https://example.com/model", note: "" }], beat: "web", date: "2026-10-10", part: "midday", path: "" }] })

export default definePlugin({
  // `icon: muse` in a file (its dashboard).
  icons: { muse: MuseIcon },
  // Its page is the Muse dashboard (pages/Muse.md).
  blocks: {
    muse: (ctx) => <MuseBlock {...ctx} />,
    "muse-runs": (ctx) => <MuseRuns {...ctx} />,
    "muse-memory": (ctx) => <MuseMemory {...ctx} />,
    "muse-dreams": (ctx) => <MuseDreams {...ctx} />,
    "muse-feed": (ctx) => <MuseFeed {...ctx} />,
    "muse-setup": (ctx) => <MuseSetup {...ctx} />,
  },
  views: {
    "muse-session": { icon: MuseIcon, title: () => "Muse run", pinAs: (arg) => arg || null, render: ({ arg }) => <AgentSession key={arg} src={SRC} id={arg} /> },
  },
  mockLive: () => ({ muse: overview(), "muse/runs": runs(), "muse/memory": memory(), "muse/dreams": dreams(), "muse/feed": feed() }),
})
