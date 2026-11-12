import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

export const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000

export const logs = { events: plugin.dayLog<unknown>("events"), perf: plugin.dayLog<unknown>("perf") }
export const append = (kind: keyof typeof logs, t: number, rows: unknown[]) => logs[kind].append(t, rows)
export const readDay = (kind: keyof typeof logs, date: string) => logs[kind].read(date)
export const prune = () => { for (const l of Object.values(logs)) l.prune(settings().keep) }

export function settings() {
  const s = plugin.loaded ? plugin.settings() : {}
  return { keep: Math.max(1, Number(s.keep_days) || 14), reads: s.reads === true }
}
