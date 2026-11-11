// What an agent's cursor shows, from what it's doing: one rule for every state, so none hides behind a hover. The
// window's and the screen's alike (web/src/screen.tsx): Node-free.

/** Its flag's mark: dots while it works on something (or has words waiting), a wave while it listens, a tick when it let
 *  a moment pass. */
export type Mark = "dots" | "wave" | "tick" | null
export type Shown = {
  /** Its name flag is up (else it fades to the bare arrow). */
  flag: boolean
  mark: Mark
  /** What it's doing in words, by its name: when looked at (hovered, open), starting or asking. */
  words: string | null
  /** Why it let a moment pass, in its words (by the tick), a while longer than its name. */
  why: string
  /** The arrow bobs, thinking. */
  bob: boolean
  /** Only watching a while: the arrow dims. */
  dim: boolean
}

/** What an agent is doing, as its cursor shows it. */
export type CursorState = "watching" | "reading" | "thinking" | "writing" | "starting" | "away" | "listening"
export const STATUS: Record<CursorState, string> = { watching: "idle", reading: "reading", thinking: "thinking", writing: "writing", starting: "starting", away: "away", listening: "listening" }

/** What agent `a`'s cursor shows. `held`: words waiting for the user's pause; `typed`: typing an edit in; `age`: since it
 *  last acted (0 under 3 s, 3 past 8 s); `looked`: hovered, open, dragged or fanned out. */
export function presence(a: { state: CursorState; asks?: unknown; seen?: boolean; why?: string }, o: { bubble?: boolean; held?: boolean; typed?: boolean; age: 0 | 1 | 2 | 3; looked?: boolean }): Shown {
  const s = a.state
  const busy = s === "reading" || s === "thinking" || s === "starting"
  const seen = s === "watching" && !!a.seen
  const mark: Mark = a.asks ? null : busy || o.held ? "dots" : s === "listening" ? "wave" : seen ? "tick" : null
  const why = seen && a.why && (o.age < 3 || o.looked) ? a.why : ""
  const flag = !!a.asks || mark === "dots" || mark === "wave" || s === "writing" || !!o.typed || !!o.bubble || o.age === 0 || !!why || !!o.looked
  return {
    flag, mark, why,
    words: a.asks ? "needs you" : o.looked || s === "starting" ? STATUS[s] : null,
    bob: s === "thinking",
    dim: s === "watching" && !o.bubble && !o.held && !o.typed && !a.asks && o.age >= 2 && !o.looked,
  }
}
