import path from "node:path"
import type { WebSocket } from "ws"
import { Plugin, runtimeDir } from "../../../core/plugins.ts"
import { backendName, limits, type Backend, type Cell, type Link } from "./backend.ts"
import { defaultShell, kindOf } from "./shells.ts"
export const plugin = new Plugin(import.meta.url)

/** Lines of history every terminal keeps, whatever its backend (the setting `scrollback`): the page's and the terminal
 *  server's, all given back to a page that comes back. */
export const scrollback = () => clamp(plugin.settings().scrollback, 100, 1_000_000, 10_000)
limits.scrollback = scrollback
// A shell ends only when its tab closes (idle, its last one), or it's ended on purpose: never for having been left alone.
export const WIN = process.platform === "win32"
export const EXITED = 4000 // close code: the shell ended (the client doesn't reconnect)
export const GONE = 4004 // close code: ?attach=1 and the agent's session is gone (the client offers a new one)
export const REFUSED = 4003 // close code: this request may not have a shell (the client shows why)
export const BLOCKED = JSON.stringify({ t: "blocked" })

/** A shell this server shows: its backend's link to it, and the pages' sockets on it. */
export type Session = {
  id: string; backend: Backend; link: Link; clients: Set<WebSocket>; started: number
  pending: Set<WebSocket> // sockets waiting for their picture (they get no output before it: it's in it)
  opened?: string // how its start went, for its first tab's span: "spare 12ms", "new 95ms"
  blocked?: boolean // macOS keeps its shell from the folder its agent runs in: its tabs say so
  queued: string // output not sent yet: what one read of the backend brought, sent as one message (flush)
  owed: Map<WebSocket, number> // bytes sent to each page and not yet drawn, as far as it tells (Terminal.tsx's acks)
  acks: Set<WebSocket> // the pages that tell (an older one doesn't: never waited for)
  cell?: Cell // a cell's size in device pixels, as the last device to size it sent it
  held: boolean // its output held for the pages to catch up (pace)
  stall?: ReturnType<typeof setTimeout> // while held: a page that draws nothing in STALL stops setting the pace
}

export const sessions = new Map<string, Session>()

/** The shell new terminals start (shells.ts): the setting's, else the login shell (PowerShell on Windows). */
export const shell = () => defaultShell(String(plugin.settings().shell ?? ""))
/** Its program's name inside a ready shell's key: a ready shell of another kind can't run an agent's line. */
export const sameShell = (sh: string) => (kindOf(sh) === "cmd" ? null : sh)

export const NAME = backendName(Number(process.env.PORT) || 0)
export const TMP = path.join(runtimeDir(), "vaultite-terminal")
export const UPLOADS = path.join(TMP, "uploads")
export const STATES = path.join(TMP, "states")
/** How long what was pasted into a terminal stays once its shell has ended: as long as Claude Code keeps a session to
 *  resume by default (cleanupPeriodDays), so a resumed one still finds the files it was given. */
export const UPLOADS_KEPT = 30 * 86_400_000
export const SPARE = "vauspare-" // a shell kept ready (start.ts)

export const TERMINAL_ID = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

export const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : dflt
}
