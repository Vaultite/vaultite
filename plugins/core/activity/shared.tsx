// What the Activity plugin's blocks, panel and view share: polling its routes, how each kind of actor looks, times and
// durations in words, and going to an agent's terminal.
import { useEffect, useState, type ComponentType } from "react"
import type { LucideIcon } from "lucide-react"
import { Bot, Code, HardDrive, Terminal, User } from "lucide-react"
import { dateText, get, isViewOpen, notify, numberText, openView, useAgents, useLive } from "@vaultite"
import type { Actor, ActorKind } from "./model"

/** A route of this plugin, polled every `every` ms while the page is visible (mockLive in previews, so nothing is
 *  fetched there). The same answer redraws nothing. */
export function usePoll<T>(path: string, every = 4000) {
  const first = useLive<T>(path)
  // In a preview useLive answers at once (no loading); in the app its first answer is on its way.
  const [preview] = useState(() => !first.loading)
  const [polled, setPolled] = useState<{ path: string; json: string; data: T } | null>(null)
  useEffect(() => {
    if (preview) return
    let on = true, busy = false
    const load = () => {
      if (busy || document.hidden) return
      busy = true
      get<T>(path).then((d) => {
        if (!on) return
        const json = JSON.stringify(d)
        setPolled((p) => (p && p.path === path && p.json === json ? p : { path, json, data: d }))
      }, () => { /* the next one may answer */ }).finally(() => { busy = false })
    }
    const id = setInterval(load, every)
    const back = () => { if (!document.hidden) load() }
    document.addEventListener("visibilitychange", back)
    return () => { on = false; clearInterval(id); document.removeEventListener("visibilitychange", back) }
  }, [path, every, preview])
  const data = polled?.path === path ? polled.data : first.data
  return { data, error: data ? null : first.error, preview }
}

type Look = { icon: LucideIcon | ComponentType<{ className?: string; strokeWidth?: number }>; tint: string }
const KINDS: Record<ActorKind, Look & { label: string }> = {
  you: { icon: User, tint: "var(--blue)", label: "You" },
  agent: { icon: Bot, tint: "var(--orange)", label: "Agents" },
  cli: { icon: Terminal, tint: "var(--teal)", label: "CLI" },
  script: { icon: Code, tint: "var(--purple)", label: "Scripts" },
  disk: { icon: HardDrive, tint: "var(--gray)", label: "On disk" },
}
export const kindLabel = (k: ActorKind) => KINDS[k]?.label ?? k

/** How an actor looks: its kind's icon and colour; a coding agent the app knows (Claude Code, Codex...) its own. */
export function useLook() {
  const agents = useAgents()
  return (a: Pick<Actor, "kind" | "name">): Look => {
    if (a.kind === "agent") {
      const n = a.name.toLowerCase()
      const ag = agents.find((x) => x.label.toLowerCase() === n || x.name === n)
      if (ag) return { icon: ag.icon, tint: ag.tint ?? KINDS.agent.tint }
    }
    return KINDS[a.kind] ?? KINDS.script
  }
}

/** Who, in a few words: "You on the phone", "Claude Code · Fix the tabs". */
export function whoOf(a: Actor) {
  if (a.kind === "you") return a.device && a.device !== "web" ? `You, ${a.device === "desktop" ? "desktop app" : a.device}` : "You"
  return a.session ? `${a.name} · ${a.session}` : a.name
}

// ---------- times and sizes

const pad = (n: number) => String(n).padStart(2, "0")
export const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const clock = (t: number) => dateText(new Date(t), { hour: "numeric", minute: "2-digit" })
export const stamp = (t: number) => dateText(new Date(t), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })
/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
/** The same, short, for a one-line row: "now", "5m", "3h", "2d". */
export function agoShort(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 45) return "now"
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}
export const ms = (v: number | undefined) => (v === undefined ? "–" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)} s`)
export const mb = (v: number) => (v < 1024 ? `${Math.round(v)} MB` : `${(v / 1024).toFixed(1)} GB`)
export function uptime(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
  return `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`
}
export const count = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : numberText(n))

// ---------- an agent's terminal

/** Whether the server still runs this terminal (the Terminal plugin's socket lists them; 1.5 s at most). */
function terminalRuns(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    let sock: WebSocket
    try { sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminals`) } catch { return resolve(false) }
    const done = (v: boolean) => { clearTimeout(timer); try { sock.close() } catch { /* closed */ } resolve(v) }
    const timer = setTimeout(() => done(false), 1500)
    sock.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data)
        if (m.t === "sessions" && Array.isArray(m.list)) done(m.list.some((s: { id?: string }) => s.id === id))
      } catch { /* not ours */ }
    }
    sock.onerror = () => done(false)
  })
}

/** Go to the app's terminal an agent ran in, if it still runs (opening an ended one would start a new shell there). */
export async function openTerminal(id: string) {
  const to = `terminal/${id}`
  if (isViewOpen(to)) return openView(to)
  if (await terminalRuns(id)) return openView(to, { newTab: true })
  notify("That terminal has ended")
}
