// Whose each web page is (electron/web.ts keeps the pages, this decides): a tab owns its page by the tab's id, so a
// tab shown again gets the same page and closing it ends it. No Electron here, so tools/test_web.ts runs it on Node.

export type Owned<W> = {
  id: number; win: W
  /** The id of the tab it's for ("": none, a glance in a sheet: it ends when let go of). */
  tab: string
  /** An agent's, in the background: no tab, kept till the agent closes it or the user opens it as a tab (`tab` set). */
  agent?: boolean
  profile: string
  /** How many views show it now (a tab drawn again before the last let go); 0: its tab is in the background. */
  holds: number
  /** Its tab closed: it ends once no view holds it. */
  closing: boolean
  /** When it was last let go of (ms): under memory pressure, the longest in the background go first. */
  let: number
  /** When its window reloaded (ms): its tab takes it back within RECLAIM_MS, or it ends. */
  orphan?: number
  /** When its tab moved to another window (ms): the tab takes it there within MOVE_MS, or it ends. */
  moving?: number
}

/** How long a reloaded window's tabs have to take their pages back. */
export const RECLAIM_MS = 8000
/** How long a tab moved to another window has to take its page there (that window may be loading). */
export const MOVE_MS = 20_000
/** Background tabs' pages each window keeps even when the Mac runs short of memory (the most recently shown). */
export const KEEP = 4

/** Showing `tab` in `win`: the page it has (`reuse`, null: make one; one in another window when the tab moved here),
 *  and its pages to end first (in other logins: the tab moved to another container). */
export function claim<W, P extends Owned<W>>(pages: Iterable<P>, win: W, tab: string, profile: string): { reuse: P | null; end: P[] } {
  if (!tab) return { reuse: null, end: [] }
  const mine = [...pages].filter((p) => p.tab === tab && !p.closing && (p.win === win || p.moving !== undefined))
  const reuse = mine.find((p) => p.profile === profile) ?? null
  if (reuse) reuse.moving = undefined
  return { reuse, end: mine.filter((p) => p !== reuse) }
}

/** `tab` left `win` for another window: its pages wait there to be claimed (`unmoved` ends them after). */
export function tabMoved<W>(pages: Iterable<Owned<W>>, win: W, tab: string, now: number) {
  for (const p of pages) if (tab && p.win === win && p.tab === tab && !p.closing) p.moving = now
}
/** Pages whose moved tab didn't take them in time. */
export const unmoved = <W, P extends Owned<W>>(pages: Iterable<P>, now: number) =>
  [...pages].filter((p) => p.moving !== undefined && now - p.moving >= MOVE_MS)

/** A view let go of `p` (its tab hidden or gone): whether it ends now. */
export function letGo<W>(p: Owned<W>, now: number): boolean {
  p.holds = Math.max(0, p.holds - 1)
  if (p.holds) return false
  p.let = now
  return p.closing || (!p.tab && !p.agent)
}

/** `tab` left `win` (closed, or moved to another window): its pages to end now. One a view still holds ends when let go of. */
export function tabGone<W, P extends Owned<W>>(pages: Iterable<P>, win: W, tab: string): P[] {
  const out: P[] = []
  for (const p of pages) {
    if (!tab || p.win !== win || p.tab !== tab) continue
    if (p.holds) p.closing = true
    else out.push(p)
  }
  return out
}

/** `win` loaded its page again: every view of its pages is gone. Its tabs' pages wait to be taken back (`unclaimed`),
 *  agents' in the background stay; the rest, returned, end now. */
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

/** Pages a reloaded window's tabs didn't take back in time. */
export const unclaimed = <W, P extends Owned<W>>(pages: Iterable<P>, now: number) =>
  [...pages].filter((p) => p.orphan !== undefined && now - p.orphan >= RECLAIM_MS)

/** Under memory pressure, background tabs' pages to discard (Chrome's way: the tab stays, its page loads again when
 *  shown): past each window's KEEP most recently shown, never one playing sound. */
export function discardable<W, P extends Owned<W>>(pages: Iterable<P>, playing: (p: P) => boolean): P[] {
  const all = [...pages]
  return [...new Set(all.map((p) => p.win))].flatMap((w) =>
    all.filter((p) => p.win === w && !p.holds && !p.closing && !p.agent && !playing(p)).sort((a, b) => b.let - a.let).slice(KEEP))
}

/** How long a silent page still counts as playing: sound without media (a game's Web Audio) has no pause to end it;
 *  with media, a long quiet scene, but not a muted hero video looping after one ping. */
export const QUIET_MS = 10_000, MEDIA_QUIET_MS = 60_000

/** A page playing sound as its tab shows it: from its first sound till its media pauses or ends, not only while sound
 *  comes out (Chromium's audible drops 2s into a quiet scene). `quiet`: silent since (ms). */
export type Playback = { heard: boolean; media: boolean; quiet?: number }
export const playback = (): Playback => ({ heard: false, media: false })

/** Sound started or stopped coming out (audio-state-changed). */
export function hear(p: Playback, audible: boolean, now: number) {
  if (audible) { p.heard = true; p.quiet = undefined } else p.quiet ??= now
}

/** Its media started, or paused or ended: that ends it at once, though Chromium's audible lingers 2s after. */
export function media(p: Playback, playing: boolean, audible: boolean) {
  p.media = playing
  p.heard = playing && (p.heard || audible)
}

/** When its quiet stretch ends it, if it's in one (ms). */
export const quietEnds = (p: Playback) => (p.quiet === undefined ? undefined : p.quiet + (p.media ? MEDIA_QUIET_MS : QUIET_MS))

export const playing = (p: Playback, audible: boolean, now: number) => p.heard && (audible || now < (quietEnds(p) ?? 0))
