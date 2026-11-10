// When agents' browsing holds a restart (agent.ts' busy, engine.ts' engineBusy): a call under way always; a recent action
// for as long as what restarts would cost the agent. No Electron: tools/test_web.ts runs it.

/** How long after an agent's last action a restart waits. The server's costs it nothing it keeps (its tabs, asks, logins
 *  and steps are the app's, and vau sends a call the restart cut again); the app's reloads its pages. */
export const QUIET_AFTER = { server: 60_000, app: 10 * 60_000 } as const

const span = (ms: number) => (ms < 60_000 ? `${ms / 1000} s` : ms === 60_000 ? "minute" : `${ms / 60_000} minutes`)

/** Why a restart of `of` waits on agents now, or null: `inFlight` calls running, the last action at `lastStep`. */
export function agentBusy(of: "app" | "server", s: { inFlight: number; lastStep: number; now: number }): string | null {
  if (s.inFlight) return "an agent's call is under way"
  return s.now - s.lastStep < QUIET_AFTER[of] ? `an agent acted in a page in the last ${span(QUIET_AFTER[of])}` : null
}
