// Ordered places plugins fill and the user arranges (sidebar panels, new tab sections): one key list, where one left
// out is hidden. Pure functions, no Node: both sides use them.

/** What a key needs to be in a default list: its `sort` and whether it's `hidden` until shown. */
export type SlotInfo = { key: string; sort?: number; hidden?: boolean }

/** The list where nothing's saved: every key not marked `hidden`, by `sort` (then the order given). */
export function defaultOrder(items: SlotInfo[]): string[] {
  const shown = items.map((p, i) => ({ ...p, i })).filter((p) => !p.hidden)
  shown.sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.i - b.i)
  return shown.map((p) => p.key)
}

/** Strings only, each once (its first place), read leniently. */
export function keyList(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))] : []
}

/** `key` put before `before` (null, or an anchor that isn't there: at the end), out of its old place first. */
export function placeKey(list: string[], key: string, before: string | null): string[] {
  const out = list.filter((k) => k !== key)
  const at = before ? out.indexOf(before) : -1
  out.splice(at < 0 ? out.length : at, 0, key)
  return out
}

/** What `key` goes before when it's moved to `where` in `list` (shown at the end if it isn't there): a position from 1,
 *  up, down, top (first) or bottom (last). null: the end; undefined: `where` isn't one of those. */
export function anchorFor(list: string[], key: string, where: string | number): string | null | undefined {
  const w = String(where).toLowerCase().trim()
  const rest = list.filter((k) => k !== key)
  const from = list.includes(key) ? list.indexOf(key) : rest.length
  const to = w === "top" || w === "first" ? 0 : w === "bottom" || w === "last" ? rest.length : w === "up" ? from - 1
    : w === "down" ? from + 1 : /^\d+$/.test(w) ? Number(w) - 1 : NaN
  if (!Number.isInteger(to)) return undefined
  return rest[Math.max(0, to)] ?? null
}
