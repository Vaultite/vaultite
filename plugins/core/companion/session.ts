// Its sessions from the app: the mode, showing one, stopping one, a fresh one. The status bar's menu and each cursor's.
import { MessageSquare, Power, RotateCcw, SquareTerminal } from "lucide-react"
import { notify, notifyError, op, openView, pluginSettings, type MenuItem } from "@vaultite"
import { type Agent, getState, howText, type Mode } from "./live"

const settings = pluginSettings<{ mode?: Mode; agent?: string }>("companion")

/** `note`: what it sees in that mode, under the menus' choice of it. */
export const MODES: { mode: Mode; label: string; short: string; note: string }[] = [
  { mode: "off", label: "Off", short: "Off", note: "Sees nothing, and asks don't reach it" },
  { mode: "quiet", label: "Quiet: only when asked", short: "Quiet", note: "Sees only what you ask it" },
  { mode: "notice", label: "Notice: speaks up when useful", short: "Notice", note: "Also sees what you write when you pause, and speaks up when it helps" },
  { mode: "pair", label: "Pair: writes with you", short: "Pair", note: "Also sees what you write, and may write in your notes" },
]

/** The mode as a menu's segmented row; `off`: Off among them (the status bar's, where the companion is switched off;
 *  an agent's menu has Stop). */
export const modeItem = (off = false): MenuItem => ({
  label: "Mode", run: () => {},
  segments: { value: getState().mode, options: MODES.filter((m) => off || m.mode !== "off").map((m) => ({ value: m.mode, label: m.short, note: m.note })), pick: (v) => void setMode(v as Mode) },
})

const main = (name: string) => name.toLowerCase() === getState().name.toLowerCase()
/** Where a session shows: a Claude Code one (its id a UUID) in a chat tab, another in its terminal. */
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

/** Start agent `name` again: another as it ran (Start @name's picks), the companion as set. */
async function start(name: string) {
  const a = main(name) ? undefined : getState().agents.find((x) => x.name.toLowerCase() === name.toLowerCase())
  try { await op("companion.start", { ...as(name), ...(a?.runs ? { agent: a.runs } : {}), ...(a?.model ? { model: a.model } : {}), ...(a?.effort ? { effort: a.effort } : {}) }) } catch (e) { notifyError(e) }
}

/** Agent `name`'s session (the companion's by default), in a new tab: its chat, or its terminal. */
export async function showSession(name = getState().name) {
  const r = await op<{ sessions: { name: string; id: string }[] }>("companion.status")
  const s = r.sessions.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (s) openView(sessionView(s.id), { newTab: true })
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

/** An agent's menu: its cursor's (right-click, a held finger on its name, … in its box) and its face's. */
export function agentMenu(a: Agent): MenuItem[] {
  const how = howText(a)
  return [
    ...(main(a.name) ? [modeItem()] : []),
    ...(how ? [{ label: how, caption: true, run: () => {}, sep: main(a.name) }] : []),
    { label: "Show its session", icon: (a.runs ?? "").split("_")[0] === "claude" ? MessageSquare : SquareTerminal, run: () => void showSession(a.name), sep: main(a.name) && !how },
    { label: "Start fresh", icon: RotateCcw, run: () => void fresh(a.name), disabled: a.state === "starting", sep: true },
    { label: "Stop", icon: Power, danger: true, run: () => void stop(a.name) },
  ]
}
