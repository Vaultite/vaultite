// Whose each web page is: a tab owns its page by the tab's id.
import { signInOf } from "../core/signin.ts"

export type Owned<W> = {
  id: number; win: W
  tab: string
  agent?: boolean
  profile: string
  holds: number
  closing: boolean
  let: number
  orphan?: number
  moving?: number
}

export const RECLAIM_MS = 8000
export const MOVE_MS = 20_000
export const KEEP = 4

export function claim<W, P extends Owned<W>>(pages: Iterable<P>, win: W, tab: string, profile: string): { reuse: P | null; end: P[] } {
  if (!tab) return { reuse: null, end: [] }
  const mine = [...pages].filter((p) => p.tab === tab && !p.closing && (p.win === win || p.moving !== undefined))
  const reuse = mine.find((p) => p.profile === profile) ?? null
  if (reuse) reuse.moving = undefined
  return { reuse, end: mine.filter((p) => p !== reuse) }
}

export function tabMoved<W>(pages: Iterable<Owned<W>>, win: W, tab: string, now: number) {
  for (const p of pages) if (tab && p.win === win && p.tab === tab && !p.closing) p.moving = now
}
export const unmoved = <W, P extends Owned<W>>(pages: Iterable<P>, now: number) =>
  [...pages].filter((p) => p.moving !== undefined && now - p.moving >= MOVE_MS)

export function letGo<W>(p: Owned<W>, now: number): boolean {
  p.holds = Math.max(0, p.holds - 1)
  if (p.holds) return false
  p.let = now
  return p.closing || (!p.tab && !p.agent)
}

export function tabGone<W, P extends Owned<W>>(pages: Iterable<P>, win: W, tab: string): P[] {
  const out: P[] = []
  for (const p of pages) {
    if (!tab || p.win !== win || p.tab !== tab) continue
    if (p.holds) p.closing = true
    else out.push(p)
  }
  return out
}

export function windowReloaded<W, P extends Owned<W>>(pages: Iterable<P>, win: W, now: number): P[] {
  const out: P[] = []
  for (const p of pages) {
    if (p.win !== win) continue
    p.holds = 0
    p.let = now
    if (p.agent && !p.closing) continue
    if (p.closing || !p.tab) out.push(p)
    else p.orphan = now
  }
  return out
}

export function unclaimed<W, P extends Owned<W>>(pages: Iterable<P>, now: number, kept: (p: P) => boolean): P[] {
  const late = [...pages].filter((p) => p.orphan !== undefined && now - p.orphan >= RECLAIM_MS)
  for (const p of late) if (kept(p)) p.orphan = undefined
  return late.filter((p) => p.orphan !== undefined)
}

export function discardable<W, P extends Owned<W>>(pages: Iterable<P>, playing: (p: P) => boolean): P[] {
  const all = [...pages]
  return [...new Set(all.map((p) => p.win))].flatMap((w) =>
    all.filter((p) => p.win === w && !p.holds && !p.closing && !p.agent && !playing(p)).sort((a, b) => b.let - a.let).slice(KEEP))
}

export const QUIET_MS = 10_000, MEDIA_QUIET_MS = 60_000

// Chromium's `audible` drops 2s into a quiet scene: a page plays from its first sound till its media pauses or ends.
export type Playback = { heard: boolean; media: boolean; quiet?: number }
export const playback = (): Playback => ({ heard: false, media: false })

export function hear(p: Playback, audible: boolean, now: number) {
  if (audible) { p.heard = true; p.quiet = undefined } else p.quiet ??= now
}

export function media(p: Playback, playing: boolean, audible: boolean) {
  p.media = playing
  p.heard = playing && (p.heard || audible)
}

// Chromium's `audible` holds 2s past the last sound.
export const LINGER_MS = 2500

// Another media playing on (YouTube's next video or ad) never drops `audible`, so no audio-state-changed comes.
export function outlasted(p: Playback, audible: boolean) {
  if (!audible || p.heard) return false
  p.heard = p.media = true
  p.quiet = undefined
  return true
}

export const quietEnds = (p: Playback) => (p.quiet === undefined ? undefined : p.quiet + (p.media ? MEDIA_QUIET_MS : QUIET_MS))

export const playing = (p: Playback, audible: boolean, now: number) => p.heard && (audible || now < (quietEnds(p) ?? 0))

export type Flow = { opened?: string; signIn?: string }

export function flowOn(f: Flow, url: string, user: boolean, site: (host: string) => string): Flow {
  if (!f.opened || url === f.opened) return f
  if (user) return {}
  const s = signInOf(url), from = hostOf(f.opened)
  return s && site(s.host) !== site(from) ? { ...f, signIn: site(s.host) } : f
}
const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return "" } }
