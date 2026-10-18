// Its sessions from the app: the mode, showing one, stopping one, a fresh one. The status bar's menu and each cursor's.
import { Power, RotateCcw, SquareTerminal } from "lucide-react"
import { capitalize, notify, notifyError, op, openView, pluginSettings, type MenuItem } from "@vaultite"
import { type Agent, getState, type Mode } from "./live"

const settings = pluginSettings<{ mode?: Mode; agent?: string }>("companion")

export const MODES: { mode: Mode; label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "quiet", label: "Quiet: only when asked" },
  { mode: "notice", label: "Notice: speaks up when useful" },
  { mode: "pair", label: "Pair: writes with you" },
]

const main = (name: string) => name.toLowerCase() === getState().name.toLowerCase()
const as = (name: string) => (main(name) ? {} : { as: name })

export async function setMode(mode: Mode) {
  await settings.set({ mode })
  if (mode === "off") return
  try {
    const r = await op<{ id: string; running: boolean }>("companion.start")
    if (!r.running) notify(`${getState().name} is starting`, { action: { label: "Show", run: () => openView(`terminal/${r.id}`) } })
  } catch (e) { notifyError(e) }
}

async function start(name: string) {
  try { await op("companion.start", as(name)) } catch (e) { notifyError(e) }
}

/** Agent `name`'s terminal (the companion's by default), in a new tab. */
export async function showSession(name = getState().name) {
  const r = await op<{ sessions: { name: string; id: string }[] }>("companion.status")
  const s = r.sessions.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (s) openView(`terminal/${s.id}`, { newTab: true })
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

/** An agent's cursor's menu (right-click, a held finger on its name, … in its box). */
export function agentMenu(a: Agent): MenuItem[] {
  const how = [a.model && capitalize(a.model), a.effort && `${a.effort} effort`].filter(Boolean).join(" · ")
  const modes = main(a.name) ? MODES.filter((m) => m.mode !== "off") : []
  return [
    ...(how ? [{ label: how, caption: true, run: () => {} }] : []),
    { label: "Show its session", icon: SquareTerminal, run: () => void showSession(a.name) },
    ...modes.map((m, i) => ({ label: m.label, checked: getState().mode === m.mode, run: () => void setMode(m.mode), sep: i === 0 })),
    { label: "Start fresh", icon: RotateCcw, run: () => void fresh(a.name), disabled: a.state === "starting", sep: true },
    { label: "Stop", icon: Power, danger: true, run: () => void stop(a.name) },
  ]
}
