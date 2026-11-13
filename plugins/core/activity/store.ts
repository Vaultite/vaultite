import { Plugin } from "../../../core/plugins.ts"
import type { ActivityEvent, Minute } from "./model.ts"

export const plugin = new Plugin(import.meta.url)

export const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000

export const logs = { events: plugin.dayLog<ActivityEvent>("events"), perf: plugin.dayLog<Minute>("perf") }
export const prune = () => { for (const l of Object.values(logs)) l.prune(settings().keep) }

export function settings() {
  const s = plugin.loaded ? plugin.settings() : {}
  return { keep: Math.max(1, Number(s.keep_days) || 14), reads: s.reads === true }
}
