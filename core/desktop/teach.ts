// Teach by showing, as the desktop app watches it (electron/teach.ts): the words that start and end it, what it keeps of
// what the user did (the timeline's clicks, keys and fields, each on the thing it acted on). No Node: the tests read it.
import type { Inside, Rect } from "./uimodel.ts"
import { ACTS, type Happened } from "./screentimeline.ts"

/** A thing acted on, as the timeline keeps it (the ui model's role, words, frame and what it's in). */
export type El = { role: string; label: string; frame: Rect; inside?: Inside[] }
/** What a lesson is made of: the timeline's events of those kinds (others are left out). */
export type Act = { t: number } & (
  | { kind: "click"; x: number; y: number; el?: El; under?: string; window?: Rect }
  | { kind: "key"; key: string }
  | { kind: "field"; el: El; value: string; window?: Rect }
  | { kind: "app"; app: string; name: string; title?: string; private?: boolean }
  | { kind: "said"; text: string })
export type As = "tour" | "skill"
export const isAct = (e: Happened): e is Extract<Happened, { kind: Act["kind"] }> => ACTS.has(e.kind)

// ---------- their words

const LEAD = String.raw`^(?:(?:ok(?:ay)?|hey|so|now|alright|all right|right|well|and)[,.!]?\s+)*`
const re = (body: string, whole = true) => new RegExp(`${LEAD}(?:${body})${whole ? String.raw`[\s,.!?]*$` : String.raw`(?=$|[\s,.!?:;])[\s,.!?:;]*`}`, "i")
const START = re(String.raw`watch me|watch (?:this|how i do (?:it|this|that))|let me (?:show|teach) you(?: how)?|i(?:'ll| will|'m going to| am going to) (?:show|teach) you(?: how)?|learn (?:this|how i do (?:it|this))`, false)
const DONE = re(String.raw`(?:(?:i'm|i am|we're|all) )?(?:done|finished)|(?:that's|that is) (?:it|all|how(?: you do it| it's done| i do it)?)|and that's it|there you go|got it\??|(?:stop|end) (?:watching|recording)`)
const CANCEL = re(String.raw`(?:cancel|forget|scrap|never ?mind)(?: (?:that|it|this|the lesson|watching))?|stop watching(?: me)?,? (?:forget|never ?mind) it`)
const KIND = String.raw`(?:a |an |into a |as a )?(skill|tour|walkthrough|walk-through)`
const LAST = String.raw`(?:make|turn|save|keep)\s+(?:what i (?:just )?(?:did|showed you|did there)|that|this|what you (?:just )?saw|the last (?:bit|thing|few steps))\s+(?:into |as )?${KIND}(?:\s+(?:called|named)\s+(.+?))?`
const FROM_LAST = re(LAST)

/** What their words ask of teaching: start watching (the rest says what it's about), done, cancel, or make what they
 *  just did a skill or a tour. While watching, only a whole sentence is a command ("done is greyed out" is narration). */
export function teachCommand(text: string, watching: boolean): { do: "start" | "done" | "cancel" | "last"; rest: string; as?: As } | null {
  const t = text.trim().replace(/\s+/g, " ")
  const last = FROM_LAST.exec(t)
  if (last) return { do: "last", rest: (last[2] ?? "").replace(/[.!?]+$/, "").trim(), as: /^(tour|walk)/i.test(last[1]) ? "tour" : "skill" }
  if (watching) {
    if (CANCEL.test(t)) return { do: "cancel", rest: "" }
    if (DONE.test(t)) return { do: "done", rest: "" }
    return null
  }
  const m = START.exec(t)
  return m ? { do: "start", rest: t.slice(m[0].length).trim() } : null
}

// ---------- what it keeps

/** What looks like a key or a password (a long run with no spaces mixing letters and digits, a known token's start):
 *  never kept, so a lesson never writes one into the vault; they type it themselves when it plays. */
export function secretLike(v: string) {
  const t = v.trim()
  return /^(sk-|sk_|pk_|ghp_|gho_|github_pat_|xox[abp]-|AKIA|AIza|ya29\.|eyJ)/.test(t) || /-----BEGIN [A-Z ]*PRIVATE KEY/.test(t) ||
    (/^\S{20,}$/.test(t) && /[a-z]/i.test(t) && /\d/.test(t) && !/^https?:\/\//.test(t) && !/@/.test(t))
}
/** A field's value as a step types it: one line, its quotes plain, at most 500 characters; a secret's left out. */
export const keptValue = (v: string) => (secretLike(v) ? "" : v.replace(/\s*\n\s*/g, " ").replace(/"/g, "'").slice(0, 500))
const CLICKABLE = /^(button|link|tab|menuitem|menu item|checkbox|radio|switch|option|row|cell|treeitem|listitem|combobox|popupbutton|pop up button|disclosure|toggle)/i
/** The thing a click was on, out of those around it: the smallest that acts and holds the point, else the smallest named. */
export function clickedThing<T extends { role: string; label: string; frame: Rect }>(things: T[], p: { x: number; y: number }): T | null {
  const holds = (r: Rect) => p.x >= r.x - 1 && p.y >= r.y - 1 && p.x <= r.x + r.width + 1 && p.y <= r.y + r.height + 1
  const on = things.filter((t) => t.label.trim() && holds(t.frame)).sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)
  return on.find((t) => CLICKABLE.test(t.role)) ?? on[0] ?? null
}

/** "What I just did": the timeline's acts back from the last one to a pause of `gap` with nothing done (what came
 *  before was something else), with the app in front then and their words from just before. */
export function recentStretch(acts: Act[], gap = 60_000): Act[] {
  const all = [...acts].sort((a, b) => a.t - b.t), doing = all.filter((a) => a.kind === "click" || a.kind === "key" || a.kind === "field")
  if (!doing.length) return []
  let from = doing.at(-1)!.t
  for (let i = doing.length - 2; i >= 0 && from - doing[i].t < gap; i--) from = doing[i].t
  const app = all.findLast((a) => a.kind === "app" && a.t <= from)
  return [...(app ? [app] : []), ...all.filter((a) => a !== app && a.t >= from - 4000)]
}
