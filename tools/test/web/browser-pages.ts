import { check } from "../lib.ts"

// ---------- Browser: a tab owns its page (electron/webpages.ts) ----------
const wp = await import("../../../electron/webpages.ts")
type P = { id: number; win: string; tab: string; profile: string; holds: number; closing: boolean; let: number; orphan?: number; moving?: number; agent?: boolean }
let n = 0
const page = (tab: string, o: Partial<P> = {}): P => ({ id: ++n, win: "w", tab, profile: "", holds: 1, closing: false, let: 0, ...o })
const a = page("t1"), b = page("t2")
check("pages: a tab shown again gets its own page, never another tab's at the same address",
  wp.claim([a, b], "w", "t1", "").reuse === a && wp.claim([a, b], "w", "t3", "").reuse === null && wp.claim([a, b], "w2", "t1", "").reuse === null)
const moved = wp.claim([a], "w", "t1", "c-work")
check("pages: a tab moved to another container gets a new page, its old one ends", moved.reuse === null && moved.end[0] === a, moved)
check("pages: no tab (a glance) never reuses one", wp.claim([page("")], "w", "", "").reuse === null)
const c = page("t1")
c.holds = 2
check("pages: let go of by a view while another still shows it, it stays shown", !wp.letGo(c, 5) && c.holds === 1)
check("pages: hidden with its tab in the background, it's kept", !wp.letGo(c, 6) && c.holds === 0 && c.let === 6)
check("pages: a glance's ends when let go of", wp.letGo(page(""), 1))
const shown = page("t4"), hidden = page("t5", { holds: 0 })
check("pages: a background tab closing ends its page at once", wp.tabGone([shown, hidden], "w", "t5")[0] === hidden)
check("pages: a shown tab closing ends its page as it's let go of", !wp.tabGone([shown], "w", "t4").length && shown.closing && wp.letGo(shown, 1)
  && wp.claim([shown], "w", "t4", "").reuse === null)
const r1 = page("t6"), r2 = page(""), r3 = page("t7", { closing: true })
const ended = wp.windowReloaded([r1, r2, r3], "w", 1000)
check("pages: a window reloading: tabs' pages wait to be taken back, the rest end", ended.length === 2 && r1.orphan === 1000 && r1.holds === 0, ended)
check("pages: one not taken back in time ends", !wp.unclaimed([r1], 1000 + wp.RECLAIM_MS - 1, () => false).length && wp.unclaimed([r1], 1000 + wp.RECLAIM_MS, () => false)[0] === r1)
const r4 = page("t10")
wp.windowReloaded([r4], "w", 1000)
check("pages: …but an agent's, in a tab in the background, waits on for its tab (its work and its ask go on)",
  !wp.unclaimed([r4], 1000 + wp.RECLAIM_MS, (p) => p === r4).length && r4.orphan === undefined && wp.claim([r4], "w", "t10", "").reuse === r4)
const m1 = page("t8", { holds: 0 }), m2 = page("t8", { win: "w2", holds: 0 })
wp.tabMoved([m1], "w", "t8", 1000)
check("pages: a tab moved to another window takes its page there, live", m1.moving === 1000 && wp.claim([m1], "w2", "t8", "").reuse === m1 && m1.moving === undefined)
check("pages: …another window's tab of that id doesn't, unless it moved", wp.claim([m2], "w", "t8", "").reuse === null)
wp.tabMoved([m1], "w", "t8", 2000)
check("pages: one moved and never taken ends", !wp.unmoved([m1], 2000 + wp.MOVE_MS - 1).length && wp.unmoved([m1], 2000 + wp.MOVE_MS)[0] === m1)
const mine = page("", { agent: true, holds: 0 })
check("pages: an agent's in the background stays through a window reload, never orphaned", !wp.windowReloaded([mine], "w", 1000).length && mine.orphan === undefined)
mine.holds = 1
check("pages: an agent's peeked and let go of stays; opened as a tab, it's that tab's", !wp.letGo(mine, 2) && (mine.tab = "t9", mine.agent = false, wp.claim([mine], "w", "t9", "").reuse === mine))
const bg = Array.from({ length: wp.KEEP + 3 }, (_, i) => page(`b${i}`, { holds: 0, let: i }))
const out = wp.discardable([...bg, page("x"), page("", { agent: true, holds: 0, let: -1 })], (p: P) => p.tab === "b0")
check("pages: short of memory, the longest in the background are discarded, never shown or playing ones",
  out.map((p: P) => p.tab).join() === "b2,b1", out.map((p: P) => p.tab))

// A page's sound as its tab shows it: through a quiet scene till its media pauses.
const v = wp.playback()
wp.media(v, true, false)
check("sound: media playing before any sound isn't playing (a silent autoplay)", !wp.playing(v, false, 0))
wp.hear(v, true, 1000)
wp.hear(v, false, 2000)
check("sound: a video in a quiet scene still plays, past a minute's silence not (a muted hero video after a ping)",
  wp.playing(v, false, 2000 + wp.QUIET_MS * 3) && !wp.playing(v, false, 2000 + wp.MEDIA_QUIET_MS))
wp.media(v, false, true)
check("sound: its pause ends it at once, though Chromium's audible lingers", !wp.playing(v, true, 2100))
wp.media(v, true, true)
check("sound: playing again while audible plays at once (an ad, then the video)", wp.playing(v, true, 3000))
const two = wp.playback()
wp.media(two, true, false)
wp.hear(two, true, 0)
wp.media(two, false, true)
check("sound: one of two media paused while the other plays on comes back past the linger (audible never dropped)",
  !wp.playing(two, true, 100) && wp.outlasted(two, true) && wp.playing(two, true, wp.LINGER_MS) && two.media)
const gone = wp.playback()
wp.hear(gone, true, 0)
wp.media(gone, false, true)
check("sound: a pause whose sound faded with the linger stays ended", !wp.outlasted(gone, false) && !wp.playing(gone, false, wp.LINGER_MS))
const g = wp.playback()
wp.hear(g, true, 0)
wp.hear(g, false, 1000)
check("sound: without media (a game) a quiet stretch still plays, then ends",
  wp.playing(g, false, 1000 + wp.QUIET_MS - 1) && !wp.playing(g, false, 1000 + wp.QUIET_MS))
wp.hear(g, true, 20_000)
check("sound: a new sound ends its quiet stretch", wp.playing(g, true, 20_000) && g.quiet === undefined)
