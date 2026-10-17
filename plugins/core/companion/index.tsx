import { useEffect, useSyncExternalStore } from "react"
import { Crosshair, MessageCirclePlus, MousePointer2, Power, SquareTerminal } from "lucide-react"
import { choose, cn, currentEditor, definePlugin, menuAbove, notify, notifyError, op, openView, pluginSettings, type MenuItem } from "@vaultite"
import { connect, getState, liveAgents, type Mode, sendMoment, subscribe } from "./live"
import { follow, Overlay } from "./Overlay"
import { Presence } from "./Presence"

// Companion: an always-on agent session in the app, with a cursor of its own (plugin.ts says how it's fed). editor.ts
// loads with the first note.
let loading: Promise<typeof import("./editor")> | null = null
const load = () => (loading ??= import("./editor"))
const settings = pluginSettings<{ mode?: Mode; agent?: string }>("companion")

const MODES: { mode: Mode; label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "quiet", label: "Quiet: only when asked" },
  { mode: "notice", label: "Notice: speaks up when useful" },
  { mode: "pair", label: "Pair: writes with you" },
]

async function setMode(mode: Mode) {
  await settings.set({ mode })
  if (mode === "off") return
  try {
    const r = await op<{ id: string; running: boolean }>("companion.start")
    if (!r.running) notify(`${getState().name} is starting`, { action: { label: "Show", run: () => openView(`terminal/${r.id}`) } })
  } catch (e) { notifyError(e) }
}

async function showSession() {
  const r = await op<{ session: string | null }>("companion.status")
  if (r.session) openView(`terminal/${r.session}`, { newTab: true })
  else notify(`${getState().name} isn't running`, { action: { label: "Start", run: () => void setMode(getState().mode === "off" ? "quiet" : getState().mode) } })
}

/** Ask the companion (or `agent`): about the selection (which agent, when several are around), or start an "@claude "
 *  line below the cursor to write the question on. */
function ask(agent?: string) {
  const ed = currentEditor()
  if (!ed?.path || ed.kind !== "markdown") return notify(`Open a note to ask ${getState().name}`)
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

/** The status bar's companion: its pointer in its colour (who's around shows on the note), and its menu. */
function Status() {
  const s = useSyncExternalStore(subscribe, getState)
  const a = s.agents.find((x) => x.name === s.name) ?? s.agents[0]
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

function Background() {
  useEffect(() => connect(), [])
  return <Overlay />
}

export default definePlugin({
  editor: async (ctx) => (ctx.kind === "markdown" && ctx.path ? (await load()).companionExtension(ctx) : []),
  background: () => <Background />,
  ambient: { status: { title: "Companion", sort: 25, render: () => <Status /> } },
  fileBar: { presence: { sort: 45, render: (file) => (file.path.endsWith(".md") ? <Presence file={file} /> : null) } },
  commands: [
    { id: "companion:ask", name: "Ask the companion", label: "Ask", keys: ["Mod+Shift+K"], run: () => ask(), icon: MessageCirclePlus },
    ...MODES.map((m) => ({ id: `companion:${m.mode}`, name: `Companion: ${m.label}`, when: () => getState().mode !== m.mode, run: () => void setMode(m.mode) })),
    { id: "companion:session", name: "Show the companion's session", run: () => void showSession(), icon: SquareTerminal },
  ],
  editorMenu: ({ view, path }) => (path && !view.state.selection.main.empty && getState().mode !== "off"
    ? (liveAgents().length > 1 ? liveAgents().map((a) => a.name) : [getState().name]).map((n) => ({ label: `Ask ${n} about this`, icon: MessageCirclePlus, run: () => ask(n) })) : []),
})
