export type ShownAt = { x: number; y: number; w?: number; h?: number }
export type Shown = { t: number; what: string; at?: ShownAt; on?: string }

export const SHOWN_KEEP = { most: 8, ms: 10 * 60_000 }

export function keepShown(list: Shown[], add: Shown[], now = Date.now()): Shown[] {
  return [...list, ...add].filter((s) => now - s.t <= SHOWN_KEEP.ms).slice(-SHOWN_KEEP.most)
}

const ago = (now: number, t: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago` }

export function shownText(list: Shown[], now: number, origin: { x: number; y: number } = { x: 0, y: 0 }): string {
  const live = list.filter((s) => now - s.t <= SHOWN_KEEP.ms)
  if (!live.length) return ""
  const where = (s: Shown) => {
    if (!s.at) return s.on ? ` at ${s.on}` : ""
    const x = Math.round(s.at.x - origin.x), y = Math.round(s.at.y - origin.y)
    return ` at ${x},${y}${s.at.w || s.at.h ? ` ${Math.round(s.at.w ?? 0)}×${Math.round(s.at.h ?? 0)}` : ""}`
  }
  return [`What you showed on their screen lately, where it landed (what they saw of you: asked what you drew or pointed at, answer from this, never that you showed nothing):`,
    ...live.map((s) => `  ${ago(now, s.t)}: ${s.what}${where(s)}`)].join("\n")
}
