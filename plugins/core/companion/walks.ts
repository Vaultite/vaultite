// A QA walk's rules (the desktop app's walk.ts runs one, walkops.ts sends it): the words that start, scratch and end it,
// its sentences, where the pointer rested as each was said, and the project each item is in. No Node: the tests read it.
import { type Anchor, anchorText } from "./anchor.ts"
import type { Rect, Thing } from "./uimodel.ts"

export type Point = { x: number; y: number }
/** What was where they pointed (the ask's place): the app (bundle id), its name, the window's title, an address, a note
 *  and its line in Vaultite, what Accessibility has under the pointer; the start of the window's text, for an address. */
export type WalkPlace = { app?: string; appName?: string; vaultite?: boolean; title?: string; url?: string; path?: string; line?: number; ui?: string; under?: string; screen?: string }
/** One thing they said on the walk: its words, when (ms since 1970), where the pointer rested, what was there; its frame
 *  and clip (the helper's files) when the screen could be kept. */
export type WalkItem = { n: number; said: string; from: number; to: number; at: Point; place: WalkPlace; anchor?: Anchor
  frame?: string; clip?: string; clipMs?: number }
export type Walk = { since: number; items: WalkItem[]; clips: boolean }

const LEAD = String.raw`^(?:(?:ok(?:ay)?|hey|so|now|please|and|alright|all right|right|well)[,.!]?\s+)*`
const QA = String.raw`(?:qa|q\.?\s?a\.?|q\s?&\s?a|q and a|cue a|queue a)`
const re = (body: string, whole: boolean) => new RegExp(`${LEAD}(?:${body})${whole ? String.raw`[\s,.!?]*$` : String.raw`(?=$|[\s,.!?:;])[\s,.!?:;]*`}`, "i")
const START = re(String.raw`(?:(?:can|could|would) you\s+|let's\s+|let us\s+|i want to\s+|i'd like to\s+|time (?:for|to)\s+)?(?:(?:start|begin|do|go on|take|run)(?: doing)?\s+)?(?:a |the |another |a new )?${QA}[\s-]+walk(?:through)?(?: time| mode)?`, false)
const WALK = String.raw`(?:the |this |our )?(?:${QA} )?walk(?:ing|through)?`
const DONE = re(String.raw`(?:(?:i'm|i am|we're|we are|all) )?(?:done|finished|through)(?: (?:with )?${WALK}| for (?:now|today))?|(?:that's|that is) (?:it|all) (?:for (?:${WALK}|now|today))|(?:end|stop|finish|wrap up|close) ${WALK}|${WALK} (?:is )?(?:done|over|finished)|send (?:it|them|the items|${WALK})`, true)
const SCRATCH = re(String.raw`(?:scratch|scrap|strike|delete|drop|undo|forget|remove|cancel) (?:that|this|the last (?:one|item|thing))(?: one)?|never ?mind(?: that)?|not that one`, true)
const CANCEL = re(String.raw`(?:cancel|abandon|discard|throw away|forget|drop) ${WALK}`, true)

/** What their words ask of a walk: start one (the rest is its first item), scratch the last item, done, or cancel;
 *  while one is on, only a whole sentence is a command ("done is greyed out" is an item). Null: words like any. */
export function walkCommand(text: string, walking: boolean): { do: "start" | "done" | "scratch" | "cancel"; rest: string } | null {
  const t = text.trim().replace(/\s+/g, " ")
  if (!walking) {
    const m = START.exec(t)
    return m ? { do: "start", rest: t.slice(m[0].length).trim() } : null
  }
  if (CANCEL.test(t)) return { do: "cancel", rest: "" }
  if (SCRATCH.test(t)) return { do: "scratch", rest: "" }
  if (DONE.test(t)) return { do: "done", rest: "" }
  return null
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
/** A sentence this short ("This button.") waits for the next: together they're one thing said. */
export const LEAST_WORDS = 4
/** Whole sentences out of what was heard so far, the rest kept for more (`end`: they paused, so it all goes). A short
 *  one joins the next, unless it's a command. */
export function sentences(text: string, end = false, walking = true): { done: string[]; rest: string } {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  const done: string[] = []
  let held = ""
  parts.forEach((p, i) => {
    const whole = /[.!?]$/.test(p) || (end && i === parts.length - 1), s = held ? `${held} ${p}` : p
    if (!whole) { held = s; return }
    if (walkCommand(p, walking)) { if (held) done.push(held); done.push(p); held = ""; return }
    if (words(s) < LEAST_WORDS && !(end && i === parts.length - 1)) { held = s; return }
    done.push(s)
    held = ""
  })
  return { done, rest: held }
}

/** Where the pointer rested most from `from` to `to` (its samples come as it moves: each holds till the next), the
 *  middle of the stretch it spent longest within a few points of; null with no samples. */
export function dwellAt(ps: { t: number; x: number; y: number }[], from: number, to: number, near = 30): Point | null {
  const before = ps.filter((p) => p.t <= from).at(-1), inside = ps.filter((p) => p.t > from && p.t <= to)
  const s = [...(before ? [{ ...before, t: from }] : []), ...inside].map((p, i, all) => ({ ...p, w: Math.max(0, (all[i + 1]?.t ?? to) - p.t) }))
  if (!s.length) return null
  let best: typeof s = [], most = -1
  for (const a of s) {
    const c = s.filter((b) => Math.hypot(a.x - b.x, a.y - b.y) <= near), w = c.reduce((n, b) => n + b.w, 0)
    if (w > most) { most = w; best = c }
  }
  const total = best.reduce((n, b) => n + b.w, 0) || best.length
  const avg = (k: "x" | "y") => Math.round(best.reduce((n, b) => n + b[k] * (b.w || (total === best.length ? 1 : 0)), 0) / total)
  return { x: avg("x"), y: avg("y") }
}

const holds = (r: Rect, p: Point) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height
/** The thing the pointer is on: the smallest named one whose frame holds the point (a button before its toolbar). */
export function thingAt<T extends Pick<Thing, "label" | "frame">>(things: T[], p: Point): T | null {
  const on = things.filter((t) => t.label.trim() && holds(t.frame, p))
  return on.sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0] ?? null
}

// ---------- which project each item is in

/** A project note (type: project): its name, its GitHub repo (owner/name), its folder, the sites its links go to. */
export type Project = { name: string; note: string; repo?: string; path?: string; hosts: string[] }
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "")
/** An address's host as a project's links name it: with its port unless it's the scheme's own. */
export function hostOf(u: string): string {
  try {
    const url = new URL(/^[a-z][\w+.-]*:\/\//i.test(u) ? u : `https://${u}`)
    return bareHost(url.host)
  } catch { return "" }
}
/** A project note's frontmatter as a Project (null when it names nothing to work in). */
export function projectOf(note: string, name: string, fm: Record<string, unknown>): Project | null {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const links = Array.isArray(fm.links) ? fm.links.map((l) => (l && typeof l === "object" ? str((l as Record<string, unknown>).url) : str(l))) : []
  const hosts = [...links, str(fm.url), str(fm.site), str(fm.preview)].filter(Boolean).map(hostOf).filter((h) => h && h !== "github.com")
  const repo = str(fm.repo).replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
  return repo || str(fm.path) || hosts.length ? { name, note, ...(repo ? { repo } : {}), ...(str(fm.path) ? { path: str(fm.path) } : {}), hosts: [...new Set(hosts)] } : null
}
const nameWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const ADDRESS = /\b(?:https?:\/\/)?((?:[\w-]+\.)+[a-z]{2,}(?::\d{2,5})?|localhost(?::\d{2,5})?)(?=[/\s"'<>)]|$)/gi
/** The project an item is in: the site its address (or its title, or the top of its window's text) goes to, else the
 *  app it's in by name ("Vaultite Main" is Vaultite's). Null: none says (a preview or an editor's may still, where.ts). */
export function projectFor(p: WalkPlace, projects: Project[]): Project | null {
  const byHost = (text: string) => {
    for (const m of text.matchAll(ADDRESS)) {
      const h = bareHost(m[1]), hit = projects.find((x) => x.hosts.includes(h)) ?? projects.find((x) => x.hosts.some((ph) => !ph.includes(":") && ph === h.replace(/:\d+$/, "")))
      if (hit) return hit
    }
    return null
  }
  const site = (p.url && byHost(p.url)) || (p.title && byHost(p.title))
  if (site) return site
  const app = nameWords(p.vaultite ? "Vaultite" : p.appName || ""), bundle = (p.app ?? "").toLowerCase()
  const named = projects.filter((x) => { const n = nameWords(x.name); return !!n && ((!!app && ` ${app} `.startsWith(` ${n} `)) || bundle.split(".").includes(n.replace(/ /g, ""))) })
  if (named.length) return named.sort((a, b) => b.name.length - a.name.length)[0]
  return (p.screen && byHost(p.screen.slice(0, 3000))) || null
}

// ---------- what a job is told

const where = (p: WalkPlace) => {
  const app = p.vaultite ? "Vaultite" : p.appName || p.app || ""
  return [app, p.title && p.title !== app ? `"${p.title}"` : "", p.url, p.path ? `the note ${p.path}${p.line ? `, line ${p.line}` : ""}` : ""].filter(Boolean).join(", ")
}
/** An item as a worker reads it: their words, where, what the pointer was on, its frame and clip where it runs. */
export function itemLines(it: WalkItem, n: number, file: (f: string) => string) {
  const on = it.anchor ? anchorText(it.anchor) : it.place.under ? it.place.under : ""
  return [`${n}. ${JSON.stringify(it.said)}`,
    where(it.place) ? `   Where: ${where(it.place)}` : "",
    on ? `   Pointing at: ${on} (screen ${it.at.x},${it.at.y})` : `   Pointing at: screen ${it.at.x},${it.at.y}`,
    it.frame ? `   Frame: ${file(it.frame)}` : "",
    it.clip ? `   Clip (${((it.clipMs ?? 0) / 1000).toFixed(1)} s, as they said it): ${file(it.clip)}` : ""].filter(Boolean)
}
/** A group's job: what the walk was, then each item. */
export function walkJobText(label: string, items: WalkItem[], at: number, note: string, file: (f: string) => string, clips: boolean) {
  const when = new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
  return [`The user did a QA walk through ${label} (${when}): they went around it talking, and each item below is one thing they said, with what their pointer was on as they said it${clips ? " and a frame of their screen then (read it first; the clip has the seconds around it)" : ""}.`,
    `Work through them here: fix each one that's clear, one commit per fix, and keep a short list of the ones you need them for (a decision, something you can't reproduce) instead of guessing. At the end, say which you fixed and which wait for them.`,
    "", ...items.flatMap((it, i) => [...itemLines(it, i + 1, file), ""]),
    `The whole walk is in their vault: ${note}`].join("\n")
}

/** A walk's count: "3 items". */
export const countText = (n: number) => (n === 1 ? "1 item" : `${n} items`)

/** The walk on the island by the notch (electron/walk.ts): on and listening, paused (they're talking to the companion,
 *  dictating, or it speaks), sending, or a line for a moment once it's over (`told`). `note`: a word for a moment. */
export type WalkScene = { state: "on" | "paused" | "sending" | "told"; count: number; since: number; clips: boolean; note?: string
  /** A lesson (electron/teach.ts: "watch me"), in the walk's place: its steps, Done makes it, × forgets it. */
  of?: "lesson" }
