// The Agents panel's cloud sessions: Claude Code on the web's and Remote Control's, as the Cloud panel lists them
// (every shown account's, the recent ones). Only the desktop app reads them.
import { useMemo, useSyncExternalStore } from "react"
import type { AgentRun } from "@vaultite"
import { accountOf, cloudListed, getCloud, hasCloud, openSession, repoName, repoOf, settings, shownAccounts, statusOf, subscribeCloud } from "./cloud"
import { sessionMenu } from "./CloudPanel"
import { agentTint } from "../../../core/agenttint.ts"

export function useCloudRuns(): AgentRun[] | null {
  const s = useSyncExternalStore(subscribeCloud, getCloud)
  const { read, hidden } = settings.use()
  return useMemo(() => {
    if (!hasCloud() || read !== true) return []
    const shown = shownAccounts(s, hidden)
    const list = s.sessions.filter((c) => !c.account || shown.some((a) => a.id === c.account) || !s.accounts.some((a) => a.id === c.account))
    return cloudListed(list).listed.map((c): AgentRun => {
      const st = statusOf(c), repo = repoOf(c)?.repo, account = s.accounts.length > 1 ? accountOf(s, c)?.label : undefined
      return {
        ...(account ? { account } : {}), ...(repo ? { project: repoName(repo) } : {}),
        id: `cloud:${c.id}`, kind: "cloud", title: c.title, step: c.summary,
        // (ready for review is at rest with something to look at: an unread answer's dot, not Needs you)
        state: st === "needs" ? "needs" : st === "working" ? "working" : "done", unread: c.unread || st === "review",
        where: c.remote ? "Remote Control" : "Cloud", agent: "Claude Code", tint: `var(--${agentTint(c.id)})`, at: c.updated,
        open: (newTab) => openSession(c, newTab), menu: () => sessionMenu(c, false),
      }
    })
  }, [s, read, hidden])
}
