// What an automatic update's restart waits on (updates.ts restartIfSafe). No Electron: tools/test_update.ts runs it.

/** The user away this long (from the whole computer, not just this app) before the app restarts by itself. */
export const AWAY_S = 10 * 60

export type RestartState = {
  /** Another machine's window is open: it can't say whether a restart loses anything. */
  othersOpen: boolean
  /** The app's pages (windows and pop-outs), and how many said a restart would lose nothing now. */
  pages: number
  safe: number
  /** Seconds since the user last touched the computer. */
  idle: number
  /** Why the browser is busy (agents at work), or null. */
  busy: string | null
}

/** Why the restart waits now, or null: it may restart. */
export function restartWaitsOn(s: RestartState): string | null {
  if (s.othersOpen) return "another machine's window is open"
  if (!s.pages) return "no window is open"
  if (s.safe < s.pages) return "a window would lose something (unsaved, under way, or in use)"
  if (s.idle < AWAY_S) return "the user is at the computer"
  return s.busy
}
