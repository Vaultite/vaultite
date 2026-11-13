import { EyeOff, MessageCircle, MessageSquare, Power, RotateCcw, SquareTerminal, Undo2 } from "lucide-react"
import { notify, notifyError, op, openView, pluginSettings, type MenuItem } from "@vaultite"
import { type Agent, canUndoEdit, foldable, getState, howText, type Mode, undoEdit } from "./live"

const settings = pluginSettings<{ mode?: Mode; agent?: string }>("companion")

export const MODES: { mode: Mode; label: string; short: string; note: string }[] = [
  { mode: "off", label: "Off", short: "Off", note: "Sees nothing, and asks don't reach it" },
  { mode: "quiet", label: "Quiet: only when asked", short: "Quiet", note: "Sees only what you ask it" },
  { mode: "pair", label: "Pair: with you as you write", short: "Pair", note: "Sees what you write, answers what's meant for it, and may write in your notes" },
]

export const modeItem = (off = false): MenuItem => ({
  label: "Mode", run: () => {},
  segments: { value: getState().mode, options: MODES.filter((m) => off || m.mode !== "off").map((m) => ({ value: m.mode, label: m.short, note: m.note })), pick: (v) => { const m = MODES.find((x) => x.mode === v); if (m) void setMode(m.mode) } },
})

const main = (name: string) => name.toLowerCase() === getState().name.toLowerCase()
const sessionView = (id: string) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? `claude-session/${id}` : `terminal/${id}`)
const as = (name: string) => (main(name) ? {} : { as: name })

export async function setMode(mode: Mode) {
  await settings.set({ mode })
  if (mode === "off") return
  try {
    const r = await op<{ id: string; running: boolean }>("companion.start")
    if (!r.running) notify(`${getState().name} is starting`, { action: { label: "Show", run: () => openView(sessionView(r.id)) } })
  } catch (e) { notifyError(e) }
}

async function start(name: string) {
  const a = main(name) ? undefined : getState().agents.find((x) => x.name.toLowerCase() === name.toLowerCase())
  try { await op("companion.start", { ...as(name), ...(a?.runs ? { agent: a.runs } : {}), ...(a?.model ? { model: a.model } : {}), ...(a?.effort ? { effort: a.effort } : {}) }) } catch (e) { notifyError(e) }
}

export async function showSession(name = getState().name) {
  const r = await op<{ sessions: { name: string; id: string }[]; summoned: { id: string | null } | null; moments: { kind: string; summoned?: boolean }[] }>("companion.status")
  const s = r.sessions.find((x) => x.name.toLowerCase() === name.toLowerCase())
  const asked = r.moments.findLast((m) => m.kind === "ask" || m.kind === "point"), quick = main(name) ? r.summoned?.id : null
  if (quick && (!s || asked?.summoned)) openView(sessionView(quick), { newTab: true })
  else if (s) openView(sessionView(s.id), { newTab: true })
  else notify(`${name} isn't running`, { action: { label: "Start", run: () => void (main(name) ? setMode(getState().mode === "off" ? "quiet" : getState().mode) : start(name)) } })
}

async function stop(name: string) {
  try {
    await op("companion.stop", as(name))
    notify(`${name} stopped`, { action: { label: "Start", run: () => void start(name) } })
  } catch (e) { notifyError(e) }
}

async function fresh(name: string) {
  try {
    await op("companion.fresh", as(name))
    notify(`${name} hands over to a fresh session once it's free`)
  } catch (e) { notifyError(e) }
}

export const followItems = (name: string): MenuItem[] => getState().follows.filter((f) => f.agent === name).map((f, i) => ({
  label: `Stop following ${f.title || f.ui || f.pane || f.group}`, icon: EyeOff, sep: i === 0,
  run: () => void op("companion.unfollow", { id: f.id }).catch((e) => notifyError(e, "Couldn't stop following it")) }))

export function agentMenu(a: Agent): MenuItem[] {
  const how = howText(a), fold = foldable(a)
  return [
    ...(fold ? [{ label: "Fold its answer into a bubble", icon: MessageCircle, run: fold }] : []),
    ...(main(a.name) ? [{ ...modeItem(), sep: !!fold }] : []),
    ...(how ? [{ label: how, caption: true, run: () => {}, sep: main(a.name) }] : []),
    { label: "Show its session", icon: (a.runs ?? "").split("_")[0] === "claude" ? MessageSquare : SquareTerminal, run: () => void showSession(a.name), sep: main(a.name) && !how },
    ...(canUndoEdit(a.name) ? [{ label: "Undo its last edit", icon: Undo2, run: () => void undoEdit(a.name) }] : []),
    ...followItems(a.name),
    { label: "Start fresh", icon: RotateCcw, run: () => void fresh(a.name), disabled: a.state === "starting", sep: true },
    { label: "Stop", icon: Power, danger: true, run: () => void stop(a.name) },
  ]
}
