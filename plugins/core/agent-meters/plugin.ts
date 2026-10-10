/** Agent meters: each agent's terminal's context and prompt cache (from its plugin's service "agent-meters:<name>",
 *  which Terminal asks), as the settings say to draw them, for the Terminals list (the service "terminal:meters"). */
import type { AgentMeter } from "../../../core/codingagents.ts"
import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** What a terminal's row and icon show (plugins/core/terminal/sessions.ts draws it). */
export type Meter = { context?: { tokens: number; window: number; as: "bar" | "percent" | "tokens" }; cache?: { until: number; ttl: number; as: "icon" | "bar" } }

/** These agents' sessions' meters, drawn as the settings say: terminal id -> Meter. */
plugin.provide("terminal:meters", (list: AgentMeter[]): Record<string, Meter> => {
  const set = plugin.settings()
  const cache = set.cache === "bar" || set.cache === "off" ? set.cache : "icon"
  const context = set.context === "percent" || set.context === "tokens" || set.context === "off" ? set.context : "bar"
  const out: Record<string, Meter> = {}
  if (cache === "off" && context === "off") return out
  for (const m of list) {
    out[m.terminal] = {
      ...(context !== "off" && m.window ? { context: { tokens: m.tokens ?? 0, window: m.window, as: context } } : {}),
      ...(cache !== "off" && m.last && m.ttl ? { cache: { until: m.last + m.ttl * 1000, ttl: m.ttl, as: cache } } : {}),
    }
  }
  return out
})
