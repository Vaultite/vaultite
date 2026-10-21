// Whose each web page is (electron/web.ts keeps the pages, this decides): a tab owns its page by the tab's id, so a
// tab shown again gets the same page and closing it ends it. No Electron here, so tools/test_web.ts runs it on Node.

export type Owned<W> = {
  id: number; win: W
  /** The id of the tab it's for ("": none, a glance in a sheet: it ends when let go of). */
  tab: string
  profile: string
  /** How many views show it now (a tab drawn again before the last let go); 0: its tab is in the background. */
  holds: number
  /** Its tab closed: it ends once no view holds it. */
  closing: boolean
  /** When it was last let go of (ms): under memory pressure, the longest in the background go first. */
  let: number
  /** When its window reloaded (ms): its tab takes it back within RECLAIM_MS, or it ends. */
  orphan?: number
}

/** How long a reloaded window's tabs have to take their pages back. */
export const RECLAIM_MS = 8000
/** Background tabs' pages each window keeps even when the Mac runs short of memory (the most recently shown). */
export const KEEP = 4

/** Showing `tab` in `win`: the page it has (`reuse`, null: make one), and its pages to end first (in other logins: the
 *  tab moved to another container). */
export function claim<W, P extends Owned<W>>(pages: Iterable<P>, win: W, tab: string, profile: string): { reuse: P | null; end: P[] } {
  if (!tab) return { reuse: null, end: [] }
  const mine = [...pages].filter((p) => p.win === win && p.tab === tab && !p.closing)
  const reuse = mine.find((p) => p.profile === profile) ?? null
  return { reuse, end: mine.filter((p) => p !== reuse) }
}

/** A view let go of `p` (its tab hidden or gone): whether it ends now. */
export function letGo<W>(p: Owned<W>, now: number): boolean {
  p.holds = Math.max(0, p.holds - 1)
  if (p.holds) return false
  p.let = now
  return p.closing || !p.tab
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

/** `win` loaded its page again: every view of its pages is gone. Its tabs' pages wait to be taken back (`unclaimed`);
 *  the rest, returned, end now. */
export function windowReloaded<W, P extends Owned<W>>(pages: Iterable<P>, win: W, now: number): P[] {
  const out: P[] = []
  for (const p of pages) {
    if (p.win !== win) continue
    p.holds = 0
    p.let = now
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
export function discardable<W, P extends Owned<W>>(pages: Iterable<P>, audible: (p: P) => boolean): P[] {
  const all = [...pages]
  return [...new Set(all.map((p) => p.win))].flatMap((w) =>
    all.filter((p) => p.win === w && !p.holds && !p.closing && !audible(p)).sort((a, b) => b.let - a.let).slice(KEEP))
}
