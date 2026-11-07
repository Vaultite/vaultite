// Every coding agent on every machine in one list (the Agents panel): each plugin's `agentRuns` hook (terminals,
// chats, cloud sessions), asked only while a list shows, merged and put in the panel's order (agentorder.ts).
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import type { AgentRun } from "@/core/define"
import { orderRuns } from "@/core/agentorder"
import { active } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"

type Use = () => AgentRun[] | null
/** One plugin's hook, run in a component of its own so plugins coming and going never change a component's hooks. */
const Feed = memo(function Feed({ id, use, report }: { id: string; use: Use; report: (id: string, runs: AgentRun[] | null | undefined) => void }) {
  const runs = use()
  useEffect(() => report(id, runs), [id, runs, report])
  useEffect(() => () => report(id, undefined), [id, report])
  return null
})

/** Every agent the plugins that are on know of, in order, and whether some haven't said yet (`loading`). `feeds` must be
 *  drawn (it draws nothing): it's what asks. Off (`on` false), nothing is asked. */
export function useAgentRuns(on = true): { runs: AgentRun[]; loading: boolean; feeds: ReactNode } {
  const { disabled } = usePrefs()
  const plugins = useMemo(() => active(disabled).filter((p) => p.agentRuns), [disabled])
  const [got, setGot] = useState<Record<string, AgentRun[] | null | undefined>>({})
  const report = useCallback((id: string, runs: AgentRun[] | null | undefined) => setGot((g) => (g[id] === runs ? g : { ...g, [id]: runs })), [])
  const runs = useMemo(() => orderRuns(plugins.flatMap((p) => got[p.id] ?? [])), [plugins, got])
  const loading = on && plugins.some((p) => got[p.id] == null)
  const feeds = on ? plugins.map((p) => <Feed key={p.id} id={p.id} use={p.agentRuns!} report={report} />) : null
  return { runs: on ? runs : [], loading, feeds }
}
