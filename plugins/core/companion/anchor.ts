// Anchor: a lasting reference to a thing on screen (an ask's a3 means only that ask's list), found again by what it is
// (app, role, words, container, place in its window) after a scroll, a move or a relabel. No Node: the tests read it.
import { normWords as norm, type Rect, type Target, type Thing } from "./uimodel.ts"

/** A thing as the screen reads it now (the ui model's: Accessibility's, or the app's own page). */
export type Seen = Pick<Thing, "role" | "label" | "frame"> & Partial<Pick<Thing, "inside" | "ui" | "id">>
export type Anchor = {
  /** Its app (a bundle id, "vaultite" for the app's own window) or site (a host): elsewhere, it isn't there. */
  app?: string; site?: string
  /** Its role (the ui model's words: button, row...) and its words. */
  role?: string; label: string
  /** The labels of what it's in, nearest first. */
  inside?: string[]
  /** Vaultite's own element: found by this id first. */
  ui?: string
  /** Where it was in its window, as fractions of the window's size: the tiebreak between look-alikes. */
  at?: { x: number; y: number }
  /** A small picture of it (a vault path), for when nothing else finds it. */
  image?: string
}
export type Where = { app?: string; site?: string
  /** Its window's frame on screen now; what of it shows (a scroll area's view), when known. */
  window?: Rect; view?: Rect }
export type Refound =
  | { ok: true; seen: Seen
    /** How it was known again: the same words (`same`; `like`: the same but for numbers, "Inbox (3)"), its id in the app
     *  (`ui`), its place among its container's own (`inside`: relabelled), or its role where it was (`role`). */
    how: "same" | "like" | "ui" | "inside" | "role"
    /** Whether it shows in its window now; when not, which way to scroll to it. */
    shown: boolean; dir?: "up" | "down" | "left" | "right" }
  | { ok: false; why: "gone" | "elsewhere"; text: string }

const bare = (t: string) => norm(t.replace(/\d+/g, " "))
const roleOf = (r?: string) => norm(r ?? "")
const centre = (b: Rect) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const relOf = (b: Rect, w?: Rect) => (w && w.width > 0 && w.height > 0 ? { x: (centre(b).x - w.x) / w.width, y: (centre(b).y - w.y) / w.height } : undefined)
const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const labels = (s: Seen) => (s.inside ?? []).map((i) => i.label).filter(Boolean)

/** An anchor for element `el` as seen in `where`. */
export function anchorOf(el: Seen, where: Where = {}): Anchor {
  const at = relOf(el.frame, where.window)
  return { ...(where.app ? { app: where.app } : {}), ...(where.site ? { site: where.site } : {}), ...(el.role ? { role: el.role } : {}), label: el.label.trim(),
    ...(labels(el).length ? { inside: labels(el).slice(0, 3) } : {}), ...(el.ui ? { ui: el.ui } : {}),
    ...(at ? { at: { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 } } : {}) }
}

/** An anchor in words: `button "Share" in "Toolbar"`. */
export function anchorText(a: Anchor) {
  return `${a.role ? `${a.role} ` : ""}${JSON.stringify(a.label)}${a.inside?.[0] ? ` in ${JSON.stringify(a.inside[0])}` : ""}`
}

/** How far apart two places in a window are, as a fraction of its size (0 the same place, ~1.4 opposite corners). */
const apart = (a?: { x: number; y: number }, b?: { x: number; y: number }) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0.5)
/** How much of `a` the containers of `b` share, nearest first counting most. */
function sharedInside(a: string[] = [], b: string[] = []) {
  const bs = b.map(norm)
  return a.reduce((s, x, i) => s + (bs.includes(norm(x)) ? (i === 0 && norm(b[0] ?? "") === norm(x) ? 3 : 1) : 0), 0)
}
/** A relabelled thing this far from where it was (a fraction of its window) is still taken for it; a role alone, closer. */
const MOVED_INSIDE = 0.2, MOVED_ROLE = 0.06

/** Anchor `a` among `now` (what the screen reads now, in `where`). */
export function refind(a: Anchor, now: readonly Seen[], where: Where = {}): Refound {
  if ((a.app && where.app && norm(a.app) !== norm(where.app)) || (a.site && where.site && !siteIs(where.site, a.site)))
    return { ok: false, why: "elsewhere", text: `${anchorText(a)} is in ${a.site ?? a.app}, not here` }
  const rel = (s: Seen) => relOf(s.frame, where.window)
  const role = roleOf(a.role)
  const pick = (cands: Seen[], how: Exclude<Refound, { ok: false }>["how"]): Refound | null => {
    if (!cands.length) return null
    const score = (s: Seen) => (role && roleOf(s.role) === role ? 2 : 0) + sharedInside(a.inside, labels(s)) - apart(a.at, rel(s))
    const best = [...cands].sort((x, y) => score(y) - score(x))[0]
    return { ok: true, seen: best, how, ...shownIn(best.frame, where) }
  }
  // (Vaultite's own: its id says it, whatever it says now)
  if (a.ui) { const r = pick(now.filter((s) => s.ui === a.ui), "ui"); if (r) return r }
  const want = norm(a.label), roleOk = (s: Seen) => !role || !s.role || roleOf(s.role) === role
  // (the same words in another container, far from where it was, are another thing: two Share buttons)
  const fits = (s: Seen) => !a.inside?.length || !labels(s).length || sharedInside(a.inside, labels(s)) > 0 || apart(a.at, rel(s)) <= MOVED_INSIDE
  const r = pick(now.filter((s) => norm(s.label) === want && roleOk(s) && fits(s)), "same") ?? (want ? pick(now.filter((s) => norm(s.label) === want && fits(s)), "same") : null)
    ?? (bare(a.label) ? pick(now.filter((s) => bare(s.label) === bare(a.label) && roleOk(s) && fits(s)), "like") : null)
  if (r) return r
  // (its words changed: the same role in the same container, about where it was, or the only one of its kind there)
  if (role && a.inside?.[0]) {
    const box = norm(a.inside[0]), mates = now.filter((s) => roleOf(s.role) === role && norm(labels(s)[0] ?? "") === box)
    const close = mates.filter((s) => apart(a.at, rel(s)) <= MOVED_INSIDE)
    const r2 = pick(close.length ? close : mates.length === 1 ? mates : [], "inside")
    if (r2) return r2
  }
  if (role && a.at) { const r3 = pick(now.filter((s) => roleOf(s.role) === role && apart(a.at, rel(s)) <= MOVED_ROLE), "role"); if (r3) return r3 }
  return { ok: false, why: "gone", text: `nothing on screen is ${anchorText(a)} now` }
}

/** Whether a frame shows in its window's view, and if not which way it is. */
export function shownIn(f: Rect, where: Where): { shown: boolean; dir?: "up" | "down" | "left" | "right" } {
  const v = where.view ?? where.window
  if (!v || meets(f, v)) return { shown: true }
  const c = centre(f)
  const dir = c.y > v.y + v.height ? "down" : c.y < v.y ? "up" : c.x > v.x + v.width ? "right" : "left"
  return { shown: false, dir }
}

/** The ui model's target for an anchor: what its resolver finds it by first. */
export const targetOf = (a: Anchor): Target => (a.ui ? { ui: a.ui } : { ...(a.role ? { role: a.role } : {}), name: a.label, ...(a.inside?.[0] ? { inside: a.inside[0] } : {}) })

/** A host is a site's, or one of its subdomains'. */
export const siteIs = (host: string, site: string) => { const h = host.toLowerCase(), s = site.toLowerCase(); return h === s || h.endsWith(`.${s}`) }

/** Anchors kept by name (the companion's `k1`, `k2`: what it pointed at), the newest last, at most `most`. */
export function keepAnchor(list: readonly { id: string; anchor: Anchor; t: number }[], anchor: Anchor, t: number, most = 12) {
  const same = list.find((x) => JSON.stringify(x.anchor) === JSON.stringify(anchor))
  if (same) return [...list.filter((x) => x !== same), { ...same, t }]
  const n = list.reduce((m, x) => Math.max(m, Number(x.id.slice(1)) || 0), 0) + 1
  return [...list, { id: `k${n}`, anchor, t }].slice(-most)
}
