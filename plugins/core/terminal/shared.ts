import path from "node:path"
import type { WebSocket } from "ws"
import { Plugin, runtimeDir } from "../../../core/plugins.ts"
import { backendName, limits, type Backend, type Cell, type Link } from "./backend.ts"
import { defaultShell, kindOf } from "./shells.ts"
export const plugin = new Plugin(import.meta.url)

export const scrollback = () => clamp(plugin.settings().scrollback, 100, 1_000_000, 10_000)
limits.scrollback = scrollback
export const WIN = process.platform === "win32"
export const EXITED = 4000
export const GONE = 4004
export const REFUSED = 4003
export const BLOCKED = JSON.stringify({ t: "blocked" })

export type Session = {
  id: string; backend: Backend; link: Link; clients: Set<WebSocket>; started: number
  pending: Set<WebSocket>
  opened?: string
  blocked?: boolean // macOS keeps its shell from the folder its agent runs in: its tabs say so
  queued: string
  owed: Map<WebSocket, number>
  acks: Set<WebSocket>
  cell?: Cell
  held: boolean
  stall?: ReturnType<typeof setTimeout>
}

export const sessions = new Map<string, Session>()

export const shell = () => defaultShell(String(plugin.settings().shell ?? ""))
export const sameShell = (sh: string) => (kindOf(sh) === "cmd" ? null : sh)

export const NAME = backendName(Number(process.env.PORT) || 0)
export const TMP = path.join(runtimeDir(), "vaultite-terminal")
export const UPLOADS = path.join(TMP, "uploads")
export const STATES = path.join(TMP, "states")
/** How long what was pasted into a terminal stays once its shell has ended: as long as Claude Code keeps a session to
 *  resume by default (cleanupPeriodDays), so a resumed one still finds the files it was given. */
export const UPLOADS_KEPT = 30 * 86_400_000
export const SPARE = "vauspare-"

export const TERMINAL_ID = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

export const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : dflt
}
