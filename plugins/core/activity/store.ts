import { Plugin } from "../../../core/plugins.ts"
import { ActivityRow, MinuteRow } from "./rows.ts"

export const plugin = new Plugin(import.meta.url)

export const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000

export const logs = { events: plugin.dayLog("events", ActivityRow), perf: plugin.dayLog("perf", MinuteRow) }
export const prune = () => { for (const l of Object.values(logs)) l.prune(settings().keep) }

export function settings() {
  const s = plugin.loaded ? plugin.settings() : {}
  return { keep: Math.max(1, Number(s.keep_days) || 14), reads: s.reads === true }
}
