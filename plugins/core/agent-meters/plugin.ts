import type { AgentMeter } from "../../../core/agents.ts"
import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** What a terminal's row and icon show. */
export type Meter = { context?: { tokens: number; window: number; as: "bar" | "percent" | "tokens" }; cache?: { until: number; ttl: number; as: "icon" | "bar" } }

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
