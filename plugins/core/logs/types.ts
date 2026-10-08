// What Logs keeps in the store (/api/state's `areas` and `logs`, from its plugin.ts) and the helpers other plugins build
// on (plugins that require Logs import this, like Health and Work; a plugin that only enhances Logs reads `Store["logs"]`).
import { fmtMin, isArchived, numberText, type Store } from "@vaultite"

export type Field = { key: string; label: string; type: string; unit?: string }
/** A logs area (settings of the Logs plugin, or brought by the plugin that draws it). `parent` is another area's slug. */
export type Area = {
  slug: string; name: string; icon: string; parent: string | null
  /** A colour's name (`pink`, or a plugin's: `health`). */
  tint?: string | null
  track_duration: boolean; fields: Field[]; weekly_goal: number | null; archived: boolean
  /** A link shown on its card (e.g. a gym's booking app). */
  link?: { label: string; url: string } | null
}
export type Log = {
  id: string; area: string; date: string; duration_min: number | null; title: string
  notes: string; data: Record<string, any>; source: string | null; ext_id: string | null
  /** Its file has `archived: true` (the core's, on every item: isArchived from "@vaultite"). */
  archived?: boolean
}

declare module "@vaultite" {
  interface PluginState {
    areas: Area[]
    logs: Log[]
  }
}

export const areaBySlug = (s: Store, slug: string) => s.areas.find((a) => a.slug === slug)
/** An area and its sub-areas (an area whose `parent` it is). */
export function areaSlugs(s: Store, slug: string): Set<string> {
  return new Set([slug, ...s.areas.filter((c) => c.parent === slug).map((c) => c.slug)])
}
/** An area's logs (its sub-areas' too), archived ones left out (`archived: true`, core/fileprops.ts). */
export const logsOf = (s: Store, slug: string) => { const ids = areaSlugs(s, slug); return s.logs.filter((l) => ids.has(l.area) && !isArchived(l)) }
export const between = (logs: Log[], from: string, to: string) => logs.filter((l) => l.date >= from && l.date <= to)
export const minutes = (logs: Log[]) => logs.reduce((n, l) => n + (l.duration_min || 0), 0)
export const sessionDays = (logs: Log[]) => new Set(logs.map((l) => l.date)).size

/** A list of records (a workout's exercises), or a record: left to the plugins that draw them. */
export const isRecord = (v: unknown) => typeof v === "object" && v !== null && (!Array.isArray(v) || v.some((x) => typeof x === "object"))

/** A field's value as one line: a number with its unit (minutes as 1 h 30 min), a list joined; records are none. */
export function fieldText(v: unknown, unit?: string): string {
  if (v == null || v === "" || isRecord(v)) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "number") return unit === "min" ? fmtMin(v) : `${numberText(Math.round(v * 10) / 10)}${unit ? ` ${unit}` : ""}`
  return String(v)
}
