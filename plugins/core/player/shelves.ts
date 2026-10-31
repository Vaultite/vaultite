// What's waiting to be watched, listened to or read: the inbox's results, by what they hold. Shared by the block's two
// sides (no Node, no React).

export type Shelf = "watch" | "listen" | "read"
/** Where you stopped in a file: seconds in, its length, when (ms), whether it's finished, and its bookmarks. */
export type Place = { t: number; d?: number; at: number; done?: boolean; marks?: Mark[] }
/** A bookmark: seconds in, and what you noted there. */
export type Mark = { t: number; note?: string }
export type Chapter = { t: number; title: string }

export const VIDEO = /\.(mp4|m4v|mov|webm|ogv)$/i
export const AUDIO = /\.(mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac)$/i

/** The first audio or video a note embeds (`![[talk.mp4]]`), as written. */
export function mediaIn(body: string): string | null {
  for (const m of body.matchAll(/!\[\[([^\]|#]+)[^\]]*\]\]/g)) if (VIDEO.test(m[1]) || AUDIO.test(m[1])) return m[1].trim()
  return null
}

/** Its shelf: a video to watch, audio to listen to (a voice note isn't), a page from the web to read; null for the rest. */
export function shelfOf(r: { body?: string; source?: string; from?: string }): { shelf: Shelf; media: string | null } | null {
  const media = mediaIn(r.body ?? "")
  if (media) return /^voice$/i.test(r.from ?? "") ? null : { shelf: VIDEO.test(media) ? "watch" : "listen", media }
  return /^https?:\/\//.test(r.source ?? "") ? { shelf: "read", media: null } : null
}

/** "12 min left", "1 h 5 min", "done". */
export function leftText(p: Place | undefined, d?: number) {
  const len = p?.d ?? d
  if (p?.done) return "done"
  const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`)
  if (len && p && p.t > 5) return `${mins(len - p.t)} left`
  return len ? mins(len) : ""
}
