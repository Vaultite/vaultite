// The fn key as ⌘J in the window: a tap starts and the next stops; held, it listens until it's let go. A key pressed with
// fn (fn+arrow, fn+F1) wasn't for dictation: what its press started is cancelled. The page's and the helper's (no Node).

export const HOLD_MS = 450
export type FnAction = "start" | "stop" | "cancel" | null

export function fnKey(hold = HOLD_MS) {
  let at = 0, started = false
  return {
    /** fn went down; `listening`: a session is under way. */
    down(now: number, listening: boolean): FnAction {
      at = now
      started = !listening
      return listening ? "stop" : "start"
    },
    /** fn came up: a hold ends its session, a tap leaves it listening. */
    up(now: number): FnAction {
      if (!started) return null
      started = false
      return now - at >= hold ? "stop" : null
    },
    /** Another key went down with fn. */
    other(): FnAction {
      if (!started) return null
      started = false
      return "cancel"
    },
  }
}

/** macOS's "Press globe key to" (AppleFnUsageType): 0 Do nothing; else it acts too on each press (input source, emoji,
 *  its dictation). Unset reads as macOS's default, which acts. */
export const fnActsToo = (usage: string | null) => usage?.trim() !== "0"
