import { useEffect, useSyncExternalStore } from "react"
import { Crosshair, MessageCirclePlus, MousePointer2, Power, SquareTerminal } from "lucide-react"
import { choose, currentEditor, definePlugin, menuAbove, notify, notifyError, op, openView, pluginSettings, type MenuItem } from "@vaultite"
import { type Agent, connect, getState, liveAgents, type Mode, sendMoment, subscribe } from "./live"
import { follow, Overlay } from "./Overlay"

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

const STATUS: Record<string, string> = { watching: "idle", reading: "reading", thinking: "thinking", writing: "writing" }
const AVATARS = 4

/** The status bar's presence row, as a shared doc's: each agent around in its colour (a click goes where it is), then
 *  the companion's menu. */
function Status() {
  const s = useSyncExternalStore(subscribe, getState)
  const a = s.agents.find((x) => x.name === s.name) ?? s.agents[0]
  const tint = s.mode === "off" ? undefined : `var(--${a?.tint ?? "orange"})`
  const word = s.mode === "off" ? "off" : !a || a.state === "away" ? "asleep" : a.state === "watching" ? null : a.state
  const live = s.mode === "off" ? [] : liveAgents()
  const shown = live.length > AVATARS ? live.slice(0, AVATARS - 1) : live, rest = live.slice(shown.length)
  const where = (x: Agent) => `${x.name}: ${STATUS[x.state] ?? x.state}${x.path ? `, in ${x.path.split("/").pop()!.replace(/\.md$/, "")}` : ""}`
  const goTo = (x: Agent): MenuItem => ({ label: `Go to ${x.name}`, icon: Crosshair, hint: STATUS[x.state], run: () => follow(x) })
  const items = (): MenuItem[] => [
    ...MODES.map((m) => ({ label: m.label, checked: s.mode === m.mode, run: () => void setMode(m.mode) })),
    ...live.filter((x) => x.path).map((x, i) => ({ ...goTo(x), sep: i === 0 })),
    { label: `Ask ${s.name}`, icon: MessageCirclePlus, run: () => ask(), sep: true },
    { label: "Show its session", icon: SquareTerminal, run: () => void showSession() },
    { label: "Restart its session", icon: Power, run: () => void op("companion.stop").then(() => setMode(s.mode === "off" ? "quiet" : s.mode)) },
  ]
  return (
    <div className="flex h-6 shrink-0 items-center" data-companion-presence>
      {shown.length > 0 && (
        <div className="flex items-center pl-1 [&>*+*]:-ml-1">
          {shown.map((x) => (
            <button key={x.name} type="button" aria-label={`Go to ${x.name}`} data-tip={where(x)} data-tip-side="top" data-agent={x.name} data-state={x.state} onClick={() => follow(x)}
              className="relative grid size-[18px] cursor-pointer place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-background transition-transform hover:z-10 hover:scale-110"
              style={{ background: `var(--${x.tint})` }}>
              {x.name.charAt(0).toUpperCase()}
              {(x.state === "thinking" || x.state === "reading" || x.state === "writing") && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-white ring-1 ring-background" />}
            </button>
          ))}
          {rest.length > 0 && (
            <button type="button" aria-label={`${rest.length} more agents`} data-tip={rest.map(where).join(", ")} data-tip-side="top" onClick={(e) => menuAbove(e, rest.map(goTo))}
              className="grid h-[18px] min-w-[18px] cursor-pointer place-items-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-background">+{rest.length}</button>
          )}
        </div>
      )}
      <button type="button" onClick={(e) => menuAbove(e, items())} aria-label={`${s.name}, companion`} data-tip={`${s.name}, companion${word ? `: ${word}` : ""}`} data-tip-side="top"
        className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 hover:bg-foreground/[0.06] hover:text-foreground">
        <MousePointer2 className="size-3.5" strokeWidth={2.25} style={tint ? { color: tint, fill: tint } : undefined} />
        {/* (with faces on the row, only what isn't seen there) */}
        {(!shown.length || word) && <span className="max-w-56 min-w-0 truncate">{shown.length ? word : `${s.name}${word ? `, ${word}` : ""}`}</span>}
      </button>
    </div>
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
  commands: [
    { id: "companion:ask", name: "Ask the companion", label: "Ask", keys: ["Mod+Shift+K"], run: () => ask(), icon: MessageCirclePlus },
    ...MODES.map((m) => ({ id: `companion:${m.mode}`, name: `Companion: ${m.label}`, when: () => getState().mode !== m.mode, run: () => void setMode(m.mode) })),
    { id: "companion:session", name: "Show the companion's session", run: () => void showSession(), icon: SquareTerminal },
  ],
  editorMenu: ({ view, path }) => (path && !view.state.selection.main.empty && getState().mode !== "off"
    ? (liveAgents().length > 1 ? liveAgents().map((a) => a.name) : [getState().name]).map((n) => ({ label: `Ask ${n} about this`, icon: MessageCirclePlus, run: () => ask(n) })) : []),
})
