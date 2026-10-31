import { useEffect, useLayoutEffect, useSyncExternalStore } from "react"
import { Crosshair, MessageCirclePlus, MessageSquarePlus, MessagesSquare, Power, SquareTerminal } from "lucide-react"
import { cn, currentEditor, definePlugin, menuAbove, notify, op, share, useFocusedFile, type MenuItem } from "@vaultite"
import { askDrawing, watchCanvases } from "./canvas"
import { ConversationsIcon, ConversationsPanel, ConversationsView } from "./Conversations"
import { bump, connect, getState, liveAgents, type Note, setGuest, startComment, subscribe, viewOf } from "./live"
import { Arrow, follow, Overlay } from "./Overlay"
import { Presence } from "./Presence"
import { modeItem, MODES, setMode, showSession } from "./session"
import { offerThreads } from "./threads"

// Companion: an always-on agent session in the app, with a cursor of its own (plugin.ts says how it's fed). editor.ts
// loads with the first note.
let loading: Promise<typeof import("./editor")> | null = null
const load = () => (loading ??= import("./editor"))

/** Ask the companion (or `agent`): a comment by the selection (else the caret's line) that starts with its @name, so
 *  the answer comes in that thread and nothing is written in the note. In a drawing, about what's selected there. */
function ask(agent?: string) {
  const ed = currentEditor()
  if (!ed?.path || ed.kind !== "markdown") return void (askDrawing(agent) || notify(`Open a note to ask ${getState().name}`))
  const v = ed.view, sel = v.state.selection.main, picked = v.state.sliceDoc(sel.from, sel.to)
  const line = v.state.doc.lineAt(sel.from), find = (picked.trim() || line.text.trim()).slice(0, 200)
  startComment({ path: ed.path, line: line.number, ...(find ? { find } : {}), text: `@${(agent ?? getState().name).toLowerCase()} `, ...(picked.trim() ? { selection: picked } : {}) })
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

/** The status bar's companion: where its agents rest, an arrow each in its colour (the main one, then up to two more at
 *  work), which their cursors glide out of to where their attention is and back into (Overlay's home); and its menu. */
function Status() {
  const s = useSyncExternalStore(subscribe, getState)
  const a = s.agents.find((x) => x.name.toLowerCase() === s.name.toLowerCase())
  const tint = s.mode === "off" ? undefined : `var(--${a?.tint ?? "orange"})`
  const word = s.mode === "off" ? "off" : !a || a.state === "away" ? "asleep" : a.state === "watching" ? null : a.state
  const others = s.mode === "off" ? [] : liveAgents().filter((x) => x.name !== a?.name).slice(0, HOMES - 1)
  const arrows = [{ name: a?.name ?? s.name, tint, busy: a?.state === "thinking" }, ...others.map((x) => ({ name: x.name, tint: `var(--${x.tint})`, busy: x.state === "thinking" }))]
  // (the cursors find their homes as these come and go)
  const homes = arrows.map((x) => x.name).join()
  useLayoutEffect(() => bump(), [homes])
  const items = (): MenuItem[] => [
    modeItem(true),
    ...(s.mode === "off" ? [] : liveAgents()).filter((x) => x.path).map((x, i) => ({ label: `Go to ${x.name}`, icon: Crosshair, run: () => follow(x), sep: i === 0 })),
    { label: `Ask ${s.name}`, icon: MessageCirclePlus, run: () => ask(), sep: true },
    { label: "Show its session", icon: SquareTerminal, run: () => void showSession() },
    { label: "Restart its session", icon: Power, run: () => void op("companion.stop").then(() => setMode(s.mode === "off" ? "quiet" : s.mode)) },
  ]
  const tip = [`${s.name}, companion${word ? `: ${word}` : ""}`, ...others.map((x) => `${x.name}: ${x.state === "watching" ? "idle" : x.state}`)].join(", ")
  return (
    <button type="button" onClick={(e) => menuAbove(e, items())} aria-label={`${s.name}, companion`} data-tip={tip} data-tip-side="top"
      data-companion-status className="relative size-6 shrink-0 cursor-pointer rounded-[5px] hover:bg-foreground/[0.06]">
      {arrows.map((x, i) => (
        <Arrow key={x.name} data-companion-home={x.name} tint={x.tint} size={16} className={cn("absolute top-[4px]", x.busy && "animate-pulse")}
          style={{ left: 4 + (i - (arrows.length - 1) / 2) * 5, zIndex: arrows.length - i }} />
      ))}
    </button>
  )
}
/** How many agents rest in the status bar's companion, side by side (more rest in the window's corner). */
const HOMES = 3

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
  ambient: share ? undefined : { status: { title: "Companion", sort: 25, left: true, render: () => <Status /> } },
  fileBar: { presence: { title: "Who's here", sort: 45, render: (file) => (file.path.endsWith(".md") ? <Presence file={file} /> : null) } },
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
