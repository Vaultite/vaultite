import { useEffect, useSyncExternalStore } from "react"
import { Crosshair, MessageCirclePlus, MessageSquarePlus, MessagesSquare, MousePointer2, Power, SquareTerminal } from "lucide-react"
import { choose, cn, currentEditor, definePlugin, menuAbove, notify, op, share, useFocusedFile, type MenuItem } from "@vaultite"
import { askDrawing, watchCanvases } from "./canvas"
import { ConversationsIcon, ConversationsPanel, ConversationsView } from "./Conversations"
import { connect, getState, liveAgents, type Note, sendMoment, setGuest, startComment, subscribe, viewOf } from "./live"
import { follow, Overlay } from "./Overlay"
import { Presence } from "./Presence"
import { MODES, setMode, showSession } from "./session"
import { offerThreads } from "./threads"

// Companion: an always-on agent session in the app, with a cursor of its own (plugin.ts says how it's fed). editor.ts
// loads with the first note.
let loading: Promise<typeof import("./editor")> | null = null
const load = () => (loading ??= import("./editor"))

/** Ask the companion (or `agent`): about the selection (which agent, when several are around), or start an "@claude "
 *  line below the cursor to write the question on. In a drawing, about what's selected there. */
function ask(agent?: string) {
  const ed = currentEditor()
  if (!ed?.path || ed.kind !== "markdown") return void (askDrawing(agent) || notify(`Open a note to ask ${getState().name}`))
  const v = ed.view, sel = v.state.selection.main, path = ed.path
  if (!sel.empty) {
    const send = (to: string) => sendMoment({ kind: "ask", agent: to, path, line: v.state.doc.lineAt(sel.from).number, text: "(look at the selection)", selection: v.state.sliceDoc(sel.from, sel.to) })
    const live = liveAgents()
    if (agent || live.length < 2) return send(agent ?? getState().name)
    return choose({ title: "Ask an agent", placeholder: "Ask who?", items: live.map((a) => ({ id: a.name, label: a.name, detail: a.name === getState().name ? "companion" : undefined })), onPick: (c) => send(c.id) })
  }
  const line = v.state.doc.lineAt(sel.head), mention = `@${getState().name.toLowerCase()} `
  const at = line.text.trim() ? line.to : line.from, insert = line.text.trim() ? `\n${mention}` : mention
  v.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: "input" })
  v.focus()
}

setGuest(share)

/** Comment on the selection, or on the caret's line: a card in the margin to write it in. A guest who may only read can't. */
const comments = () => !share || share.role !== "read"
function addComment() {
  const ed = currentEditor()
  if (!ed?.path || ed.kind !== "markdown") return void notify("Open a note to comment on it")
  const v = ed.view, sel = v.state.selection.main, find = v.state.sliceDoc(sel.from, sel.to).trim().slice(0, 200)
  startComment({ path: ed.path, line: v.state.doc.lineAt(sel.from).number, ...(find ? { find } : {}) })
}
const COMMENT = { id: "companion:comment", name: "Add comment", label: "Comment", keys: ["Mod+Alt+M"], run: addComment, icon: MessageSquarePlus }

/** The status bar's companion: its pointer in its colour (who's around shows on the note), and its menu. */
function Status() {
  const s = useSyncExternalStore(subscribe, getState)
  const a = s.agents.find((x) => x.name.toLowerCase() === s.name.toLowerCase())
  const tint = s.mode === "off" ? undefined : `var(--${a?.tint ?? "orange"})`
  const word = s.mode === "off" ? "off" : !a || a.state === "away" ? "asleep" : a.state === "watching" ? null : a.state
  const items = (): MenuItem[] => [
    ...MODES.map((m) => ({ label: m.label, checked: s.mode === m.mode, run: () => void setMode(m.mode) })),
    ...(s.mode === "off" ? [] : liveAgents()).filter((x) => x.path).map((x, i) => ({ label: `Go to ${x.name}`, icon: Crosshair, run: () => follow(x), sep: i === 0 })),
    { label: `Ask ${s.name}`, icon: MessageCirclePlus, run: () => ask(), sep: true },
    { label: "Show its session", icon: SquareTerminal, run: () => void showSession() },
    { label: "Restart its session", icon: Power, run: () => void op("companion.stop").then(() => setMode(s.mode === "off" ? "quiet" : s.mode)) },
  ]
  return (
    <button type="button" onClick={(e) => menuAbove(e, items())} aria-label={`${s.name}, companion`} data-tip={`${s.name}, companion${word ? `: ${word}` : ""}`} data-tip-side="top"
      data-companion-status className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06]">
      <MousePointer2 className={cn("size-3.5", a?.state === "thinking" && "animate-pulse")} strokeWidth={2.25} style={tint ? { color: tint, fill: tint } : undefined} />
    </button>
  )
}

const isThread = (n: Note) => n.kind === "comment" || n.kind === "suggestion"

/** The Conversations panel shown when threads come: a note with some opened, an agent commenting on one on screen. */
function useOffer() {
  const { path } = useFocusedFile()
  useEffect(() => { if (path && getState().mode !== "off" && getState().notes.some((n) => n.path === path && isThread(n))) offerThreads() }, [path])
  useEffect(() => {
    let known = new Set<string>()
    return subscribe(() => {
      const s = getState()
      const fresh = s.mode !== "off" && s.notes.some((n) => isThread(n) && !known.has(n.id) && !!n.path && !!viewOf(n.path))
      known = new Set(s.notes.map((n) => n.id))
      if (fresh) offerThreads()
    })
  }, [])
}

function Background() {
  useEffect(() => connect(), [])
  useEffect(() => watchCanvases(), [])
  useOffer()
  return <Overlay />
}

// (a shared folder's guest gets the threads and nothing of the agents)
export default definePlugin({
  editor: async (ctx) => (ctx.kind === "markdown" && ctx.path ? (await load()).companionExtension(ctx) : []),
  background: () => <Background />,
  ambient: share ? undefined : { status: { title: "Companion", sort: 25, render: () => <Status /> } },
  fileBar: share ? undefined : { presence: { title: "Who's here", sort: 45, render: (file) => (file.path.endsWith(".md") ? <Presence file={file} /> : null) } },
  // (its key is threads.ts' PANEL)
  sidebar: { conversations: { title: "Conversations", sort: 20, side: "right", view: "conversations", names: ["comments", "threads"], flyout: { icon: ConversationsIcon, width: 320 },
    render: (ctx) => <ConversationsPanel {...ctx} /> } },
  views: { conversations: { icon: MessagesSquare, title: () => "Conversations", render: () => <ConversationsView /> } },
  commands: share ? (comments() ? [COMMENT] : []) : [
    { id: "companion:ask", name: "Ask the companion", label: "Ask", keys: ["Mod+Shift+K"], run: () => ask(), icon: MessageCirclePlus },
    COMMENT,
    ...MODES.map((m) => ({ id: `companion:${m.mode}`, name: `Companion: ${m.label}`, when: () => getState().mode !== m.mode, run: () => void setMode(m.mode) })),
    { id: "companion:session", name: "Show the companion's session", run: () => void showSession(), icon: SquareTerminal },
  ],
  editorMenu: ({ view, path }) => [
    ...(path && !share && !view.state.selection.main.empty && getState().mode !== "off"
      ? (liveAgents().length > 1 ? liveAgents().map((a) => a.name) : [getState().name]).map((n) => ({ label: `Ask ${n} about this`, icon: MessageCirclePlus, run: () => ask(n) })) : []),
    ...(path && comments() ? [{ label: "Add comment", icon: MessageSquarePlus, run: addComment }] : []),
  ],
})
