// What the terminal server (termd.ts) and its clients (backend.ts) say: newline JSON over a Unix socket or named pipe. A
// request is {op, re, ...}, its answer {re, ...} or {re, error}; a message unasked {t}. Types only (termd loads it too).
import type { Said } from "../osc7501.ts"

/** The protocol, in its socket's name: a server speaking another starts its own, which takes over the older one's
 *  terminals (adopt.ts) rather than leave them unseen. 1 was ptyd.ts, the keeper before this one. */
export const PROTOCOL = 2

/** How a terminal's program ended: its exit code, or the signal that ended it (0: none). `lost`: the server holding it
 *  went away first, so how it ended is unknown. */
export type Exit = { code: number; signal: number; at: number; lost?: boolean }

/** A terminal as the server holds it. `meta`: what the app keeps with it (`name`, `note`); `command`: what it was started
 *  to run; `process`: what runs in front; `clients`: connections attached; `said`: OSC 7501; `exit`: once it ended. */
export type Info = {
  id: string; pid: number; shell: string; process: string; cwd: string; command: string; created: number; activity: number; title: string
  cols: number; rows: number; clients: number; spare: boolean; meta: Record<string, string>; said: Said; exit?: Exit
  /** Held through an older server it took over (adopt.ts): that server's pid. */
  via?: number
}

/** What changed, to the connections that subscribed (`subscribe`), as {t: "event", ...Event}. */
export type Event =
  | { type: "started"; id: string; info: Info }
  | { type: "renamed"; id: string; to: string }
  | { type: "exited"; id: string; exit: Exit }
  | { type: "status"; id: string; said: Said }
  | { type: "title"; id: string; title: string }
  | { type: "meta"; id: string; meta: Record<string, string> }
  | { type: "size"; id: string; cols: number; rows: number }
  | { type: "clients"; id: string; clients: number }

/** A capture's form: plain text (wrapped lines joined), the terminal's own sequences (colors, the cursor: replayed, it
 *  draws the screen again), or HTML. */
export type CaptureFormat = "text" | "vt" | "html"
export type Capture = { text: string; cols: number; rows: number; cursor: { x: number; y: number }; alternate: boolean
  /** The cursor's line (an agent's input): all of it, what's drawn plainly, and what's dim or grey (a suggested reply). */
  input?: { line: string; typed: string; suggested: string } }
