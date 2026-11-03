// How a plugin draws the sessions it drives (exports.chat's, with the tools it serves: the companion's): a view of its own
// in their tab, the chat a click away, and the messages it sends them. Plugins that require claude-code set it as they load.
import type { ComponentType } from "react"
import type { Entry } from "./chatlog"

/** A chat session, live, as its tab has it. */
export type ChatLive = { ready: boolean; found: boolean; title: string; entries: Entry[]; start: number; earlier: () => Promise<void>
  s: { state: "starting" | "working" | "waiting" | "idle" | "error"; at: number; error?: string } | null }
export type Driven = {
  /** The session's tab instead of its chat; `chat` shows the chat. */
  View?: ComponentType<{ id: string; c: ChatLive; chat: () => void }>
  /** What its view is called, on the chat's button back to it. */
  name?: string
  /** Its sessions' tab title, till Claude Code names one. */
  title?: string
  /** A message it sent the session, in the chat. */
  Message?: ComponentType<{ text: string }>
}

const drawn = new Map<string, Driven>()
/** Plugin `by` (exports.chat's `by`) draws its sessions so. */
export const drawDriven = (by: string, d: Driven) => { drawn.set(by, d) }
export const drivenOf = (by: string) => (by ? drawn.get(by) ?? null : null)
