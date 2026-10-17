// What shortcodes are and how a typed one is matched: `:fire:` is GitHub's emoji names (gemoji), `:LiCalendar:` a Lucide
// icon written as Obsidian's Iconize writes it (Li + its PascalCase name), so the file reads the same there.

export type Emoji = { emoji: string; names: string[]; tags: string[] }
export type Found = { kind: "emoji"; name: string; emoji: string } | { kind: "icon"; name: string; pascal: string }

/** An icon in the text: group 1 is Lucide's component name ("CalendarDays"). */
export const ICON_CODE = /:Li([A-Z][A-Za-z0-9]*):/g
export const iconCode = (pascal: string) => `:Li${pascal}:`
/** Lucide's component name as its own ("CalendarDays" -> "calendar-days", "ArrowUp01" -> "arrow-up-01"). */
export const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-zA-Z])(\d)/g, "$1-$2").toLowerCase()

/** A shortcode being typed: a ":" not after a word, a time or a URL's "//", then two or more characters. */
export const TYPING = /(?<![\p{L}\p{N}_:/]):[\p{L}\p{N}_+-]{2,}$/u
/** A whole emoji code just closed (`:fire:`): group 1 is its name. */
export const CLOSED = /(?<![\p{L}\p{N}_:/]):([a-z0-9_+-]+):$/u

/** What's typed after ":" read as what to look for: `icon-…` or `Li…` (Iconize's) only icons, else both. */
export function queryOf(typed: string): { q: string; only?: "icon" } {
  const icon = /^icon(?:-(.*))?$/i.exec(typed) ?? /^Li([A-Z].*)$/.exec(typed)
  if (icon) return { q: kebab(icon[1] ?? ""), only: "icon" }
  return { q: typed.toLowerCase() }
}

/** How well a name matches (lower is better): the name itself, its start, a word's start in it, anywhere; null: not. */
function rank(name: string, q: string): number | null {
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  const i = name.indexOf(q)
  if (i > 0 && /[-_]/.test(name[i - 1])) return 2
  if (i > 0 || name.replace(/[-_]/g, "").includes(q.replace(/[-_]/g, ""))) return 3
  return null
}

type Scored = { found: Found; rank: number; recent: number; order: number }
/** Recently used ones that match by name come first, then by how well, then the shorter. */
const better = (a: Scored, b: Scored) => {
  const ra = a.recent >= 0 && a.rank <= 2 ? 0 : 1, rb = b.recent >= 0 && b.rank <= 2 ? 0 : 1
  return ra - rb || a.rank - b.rank || (ra ? 0 : a.recent - b.recent) || a.found.name.length - b.found.name.length || a.order - b.order
}

/** The matches for `typed` (what follows ":"): emoji, then icons (Lucide's component names), each at most `limit`.
 *  `recent`: picked lately, latest first (`recentKey`: the emoji itself, `icon:calendar`). */
export function matches(typed: string, emoji: Emoji[] | null, icons: string[] | null, recent: string[], limit = 30): Found[] {
  const { q, only } = queryOf(typed)
  const recentOf = (key: string) => recent.indexOf(key)
  const out: Found[] = []
  if (emoji && only !== "icon") {
    const got: Scored[] = []
    emoji.forEach((e, order) => {
      let best: { name: string; rank: number } | null = null
      for (const name of e.names) { const r = rank(name, q); if (r !== null && (!best || r < best.rank)) best = { name, rank: r } }
      if (!best && q.length >= 3 && e.tags.some((t) => t.startsWith(q))) best = { name: e.names[0], rank: 4 }
      if (best) got.push({ found: { kind: "emoji", name: best.name, emoji: e.emoji }, rank: best.rank, recent: recentOf(e.emoji), order })
    })
    out.push(...got.sort(better).slice(0, limit).map((s) => s.found))
  }
  if (icons) {
    const got: Scored[] = []
    icons.forEach((pascal, order) => {
      const name = kebab(pascal), r = rank(name, q)
      if (r !== null) got.push({ found: { kind: "icon", name, pascal }, rank: r, recent: recentOf(`icon:${name}`), order })
    })
    out.push(...got.sort(better).slice(0, only === "icon" ? limit : Math.ceil(limit / 3)).map((s) => s.found))
  }
  return out
}

/** The key a pick is remembered by among the recent ones. */
export const recentKey = (f: Found) => (f.kind === "emoji" ? f.emoji : `icon:${f.name}`)
/** `recent` with `key` first, at most `max`. */
export const remember = (recent: string[], key: string, max = 24) => [key, ...recent.filter((k) => k !== key)].slice(0, max)
