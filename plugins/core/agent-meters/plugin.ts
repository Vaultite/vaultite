/** Agent meters: each agent's terminal's context and prompt cache (its plugin's service "agent-meters:<name>"), as the
 *  settings say to draw them, for the Terminals list (the service "terminal:meters"). */
import type { AgentMeter } from "../../../core/codingagents.ts"
import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** What a terminal's row and icon show (plugins/core/terminal/sessions.ts draws it). */
export type Meter = { context?: { tokens: number; window: number; as: "bar" | "percent" | "tokens" }; cache?: { until: number; ttl: number; as: "icon" | "bar" } }

// Asked on every list (every 2 s while watched): agents' answers are kept a few seconds.
const kept = new Map<string, { at: number; list: Promise<AgentMeter[]> }>()
function metersOf(agent: string): Promise<AgentMeter[]> {
  const fn = plugin.service(`agent-meters:${agent}`)
  if (typeof fn !== "function") return Promise.resolve([])
  const was = kept.get(agent)
  if (was && Date.now() - was.at < 3000) return was.list
  const list = Promise.resolve(fn()).then((l) => (Array.isArray(l) ? l as AgentMeter[] : []), () => [])
  kept.set(agent, { at: Date.now(), list })
  return list
}

/** The meters of the terminals these agents run in: terminal id -> Meter. */
plugin.provide("terminal:meters", async (agents: string[]): Promise<Record<string, Meter>> => {
  const set = plugin.settings()
  const cache = set.cache === "bar" || set.cache === "off" ? set.cache : "icon"
  const context = set.context === "percent" || set.context === "tokens" || set.context === "off" ? set.context : "bar"
  const out: Record<string, Meter> = {}
  if (cache === "off" && context === "off") return out
  for (const lists of await Promise.all([...new Set(agents)].map(metersOf))) {
    for (const m of lists) {
      out[m.terminal] = {
        ...(context !== "off" && m.window ? { context: { tokens: m.tokens, window: m.window, as: context } } : {}),
        ...(cache !== "off" && m.last ? { cache: { until: m.last + m.ttl * 1000, ttl: m.ttl, as: cache } } : {}),
      }
    }
  }
  return out
})
