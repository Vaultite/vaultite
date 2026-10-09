import { lazy, Suspense, useEffect, useSyncExternalStore } from "react"
import { Bot, FileText, LogOut, Server, SquareTerminal, SquareX } from "lucide-react"
import { agentOfTerminal, AmbientButton, chooseDefaultPlace, choosePlace, definePlugin, getTabLayout, Group, isMac, isViewOpen, Loading, onTabLayoutChange, openTerminal, openView,
  PageHeader, Panel, SettingRow, useLive, viewsChanged } from "@vaultite"
import { agentIn, current, endForGood, getSessions, labelOf, sessionById, stateClass, subscribeSessions, tabClosed, tintOf, waiting } from "./sessions"
import { about, SessionList, Sessions, useSessions } from "./SessionsPanel"
import { TerminalsView } from "./TerminalsView"

// xterm.js is its own chunk: loaded when a terminal tab opens, or ahead of it once the app is idle on a computer (the
// first terminal then doesn't wait for ~0.5 MB of script; phones, which rarely open one, load it when they do).
let chunk: Promise<typeof import("./Terminal")> | null = null
const preload = () => (chunk ??= import("./Terminal"))
const TerminalView = lazy(preload)

function Preview() {
  return (
    <Panel title="Terminal" icon={SquareTerminal} tint="var(--gray)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        A shell in a tab, started in the vault's folder: run a coding agent (Claude Code, Codex, OpenCode, Cursor) on your
        notes without leaving the app. Open one from the command palette or the Terminals panel, in a new tab or in a split
        on the right. Reloading, or the server restarting, keeps the shell running, with its history. Closing its tab ends a shell at its prompt, but whatever runs in one (an agent, a server) keeps running in the Terminals panel until you end it there; typing exit closes the tab. Pasted screenshots
        reach the shell as files.
      </p>
      <pre className="mt-3 rounded-[8px] bg-background px-3 py-2 font-mono text-[12px] leading-[17px]">
        <span className="text-[var(--green)]">vault</span> % claude{"\n"}
        <span className="text-muted-foreground">Welcome to Claude Code</span>
      </pre>
    </Panel>
  )
}

/** While a terminal tab is open, follow the sessions list so tabs show each session's name, colour and state; on a
 *  computer, also preload xterm.js's chunk once idle. */
function SessionNames() {
  const layout = useSyncExternalStore(onTabLayoutChange, getTabLayout)
  const any = JSON.stringify(layout.root).includes('"view:terminal/')
  useEffect(() => (any ? subscribeSessions(viewsChanged) : undefined), [any])
  useEffect(() => {
    if (matchMedia("(pointer: coarse)").matches) return
    const load = () => void preload().catch(() => { chunk = null })
    if (typeof requestIdleCallback !== "function") { const t = setTimeout(load, 2000); return () => clearTimeout(t) }
    const t = requestIdleCallback(load, { timeout: 5000 })
    return () => cancelIdleCallback(t)
  }, [])
  return null
}

const openTab = (to: string) => openView(to, { newTab: !isViewOpen(to) })

/** The status bar's agents at work and waiting on the user: a click goes to the first one waiting, else Terminals. */
function AgentsAtWork() {
  const list = useSessions().list ?? []
  const working = list.filter((s) => agentIn(s) && s.state === "working"), asking = list.filter((s) => waiting(s))
  if (!working.length && !asking.length) return null
  const tip = [working.length && `${working.length} working`, asking.length && `${asking.length} waiting for you`].filter(Boolean).join(", ")
  return <AmbientButton icon={Bot} text={asking.length ? `${working.length} · ${asking.length} waiting` : working.length} tip={`Agents: ${tip}`}
    tint={asking.length ? "var(--yellow)" : undefined} onClick={() => openTab(asking.length ? `view:terminal/${asking[0].id}` : "view:terminals")} />
}

/** What a coding agent started in a terminal here is told, word for word (GET /api/terminals/instructions). */
function Instructions() {
  const { data, error } = useLive<{ text: string }>("terminals/instructions")
  return (
    <div data-terminal-instructions>
      <PageHeader title="What agents are told" subtitle={"A coding agent started in a terminal here gets this added to its instructions, when it takes added " +
        "instructions. The plugins' lines come from the plugins that are on; the vault's rules, .vaultite/AGENTS.md, have them too."} />
      {data ? <pre className="rounded-[8px] bg-muted px-4 py-3 font-mono text-[13px] leading-[19px] whitespace-pre-wrap select-text">{data.text}</pre>
        : <Loading error={error && "Couldn't read them."} />}
    </div>
  )
}

const showInstructions = () => openTab("view:terminal-instructions")

export default definePlugin({
  // view:terminal/<session id>: that session's shell, kept across reloads. Agent ids run the agent, and @<machine> ids
  // are another machine's.
  views: {
    terminal: {
      // The session's own name, colour and state, as its row in the Terminals panel and the rail show them (an agent's
      // session name, a running program); until the server has said, what it was opened as.
      icon: SquareTerminal,
      iconFor: (arg) => { const s = sessionById(arg); return (s ? agentIn(s) : agentOfTerminal(arg))?.icon ?? SquareTerminal },
      title: (arg) => {
        const s = sessionById(arg), label = s ? labelOf(s) : agentOfTerminal(arg)?.label ?? "Terminal"
        const on = s?.machineLabel ?? (arg.includes("@") ? arg.slice(arg.indexOf("@") + 1) : "")
        return on ? `${label} · ${on}` : label
      },
      iconClass: (arg) => { const s = sessionById(arg); return s ? stateClass(s) : undefined },
      iconTint: (arg) => { const s = sessionById(arg); return s ? tintOf(s) : agentOfTerminal(arg)?.tint },
      iconBadge: (arg) => { const s = sessionById(arg); return !!s && waiting(s) },
      full: true,
      // Links, pages and other views open beside a terminal, never in its tab.
      keepsTab: true,
      // Its last tab closed: an idle shell ends, one running something keeps running (sessions.ts: tabClosed). Ending
      // for good is the Terminals panel's x, the tab's End session, or the command.
      onClose: (arg) => tabClosed(arg || "main"),
      tabMenu: (arg) => [{ label: "End session", icon: SquareX, danger: true, run: () => void endForGood(arg || "main") }],
      render: ({ arg, focused, close }) => (
        <Suspense fallback={null}>
          <TerminalView key={arg} id={arg || "main"} focused={focused} close={close} />
        </Suspense>
      ),
    },
    // The sidebar's Terminals panel as a tab (drag its heading onto a pane, or the command).
    terminals: { icon: SquareTerminal, title: () => "Terminals", render: () => <TerminalsView /> },
    "terminal-instructions": { icon: FileText, title: () => "What agents are told", render: () => <Instructions /> },
  },
  settingsPanel: () => (
    <Group>
      <SettingRow label="What agents are told" sub="Added to a coding agent's instructions when it starts in a terminal here" onClick={showInstructions} />
    </Group>
  ),
  // Its text size, apart from the app's zoom (⌘+scroll over a terminal, the commands, Settings > Appearance).
  textSizes: { terminal: { label: "Terminal", sub: "Terminals' text: more or fewer columns" } },
  background: () => <SessionNames />,
  commands: [
    // New ones open where the workspace says (chooseDefaultPlace); ⌃` is always this machine, the way out when that one's away.
    { id: "terminal:open", name: "Open terminal", run: () => void openTerminal(), icon: SquareTerminal },
    { id: "terminal:open-here", name: "Open terminal on this machine", keys: ["Ctrl+`"], run: () => void openTerminal({ machine: "" }), icon: SquareTerminal },
    { id: "terminal:open-split", desktop: true, name: "Open terminal in right split", run: () => void openTerminal({ split: true }) },
    { id: "terminal:open-where", name: "Open a terminal or an agent on a machine…", run: () => void choosePlace(), icon: Server },
    { id: "terminal:home", name: "Choose where new terminals and agents open in this workspace…", run: () => void chooseDefaultPlace(), icon: Server },
    { id: "terminal:open-list", name: "Open terminals in a tab", run: () => openTab("view:terminals") },
    { id: "terminal:instructions", name: "Show what agents in terminals are told", run: showInstructions, icon: FileText },
    { id: "terminal:end", name: "End terminal session", when: () => !!current(), run: () => { const c = current(); if (c) void endForGood(c.id) }, icon: SquareX },
    // Out of the shell without a mouse (Vim's ⌃\ ⌃N), so the app's keys work again. Off a Mac ⌃ is the app's ⌘ and ⌃\
    // toggles the sidebar, so no default there.
    { id: "terminal:leave", name: "Leave the terminal", keys: isMac ? ["Ctrl+\\ Ctrl+N"] : undefined,
      when: () => !!document.activeElement?.matches(".xterm-helper-textarea"), run: () => (document.activeElement as HTMLElement | null)?.blur(), icon: LogOut },
  ],
  // Every running shell (other machines' too) in the quick switcher and the search tab: by its name, its agent, what
  // it runs and its machine; picking one goes to its tab (or opens one).
  searchLive: {
    subscribe: subscribeSessions,
    docs: () => (getSessions().list ?? []).map((s) => {
      const a = agentIn(s)
      const label = labelOf(s, a)
      return {
        id: `terminal-${s.id}`, title: label, kind: "Terminal", icon: a?.icon ?? SquareTerminal, tint: tintOf(s, a) ?? "var(--muted-foreground)",
        meta: [a && label !== a.label && a.label, about(s, a)].filter(Boolean).join(" · "),
        to: `view:terminal/${s.id}`, text: [a?.label, s.process, s.machineLabel].filter(Boolean).join(" "), recent: s.started, weight: 7,
      }
    }),
  },
  // Every running shell in the sidebar, live.
  ambient: { agents: { title: "Agents at work", sort: 20, render: () => <AgentsAtWork /> } },
  sidebar: { sessions: { title: "Terminals", names: ["terminals", "terminal", "shells"], heading: false, sort: 30, view: "terminals", render: (ctx) => <Sessions {...ctx} /> } },
  // The running terminals and agents on a blank tab's page, when the user shows it (right-click a blank tab, Sections).
  newTab: { sessions: { title: "Terminals", sort: 5, hidden: true, render: () => <SessionList /> } },
  preview: () => <Preview />,
})
