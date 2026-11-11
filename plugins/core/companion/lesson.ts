// A lesson (what teach by showing watched: core/desktop/teach.ts) made a tour or a skill to play again; a draft until
// it has played through once. No Node: the tests read it.
import { anchorOf, type Seen } from "../../../core/desktop/anchor.ts"
import { parseStep, stepLine, type Tour, tourText } from "./tour.ts"
import { type Act, type As, type El, keptValue, teachCommand } from "../../../core/desktop/teach.ts"
import { fileTitle, localDay, localTime } from "../../../core/desktop/names.ts"
import type { Rect } from "../../../core/desktop/uimodel.ts"

export type Lesson = { from: number; to: number; acts: Act[]
  /** What they called it as they began ("watch me add a deploy key": "add a deploy key"), or asked for. */
  about?: string; as?: As }

// ---------- their words as the tour's

const ING: Record<string, string> = { clicking: "click", typing: "type", going: "go", opening: "open", selecting: "select", choosing: "choose", pressing: "press",
  adding: "add", picking: "pick", scrolling: "scroll", entering: "enter", pasting: "paste", writing: "write", hitting: "hit", putting: "put", turning: "turn",
  checking: "check", changing: "change", setting: "set", making: "make", saving: "save", tapping: "tap", giving: "give", filling: "fill", looking: "look" }
/** What they said as they did it, said back to whoever plays it: "So now I'm clicking on my settings" -> "Now click on your
 *  settings." */
export function yours(text: string) {
  let s = text.trim().replace(/\s+/g, " ").replace(/^(?:(?:ok(?:ay)?|so|um+|uh+|erm|and|alright|all right|well)[,.]?\s+)+/i, "")
  const when = /^(now|then|next|first|here|after that|and then)[,]?\s+/i.exec(s)
  if (when) s = s.slice(when[0].length)
  s = s.replace(/^(?:i'm going to|i'm gonna|i am going to|i'll|i will|i want to|i need to|i just|i|we'll|we're going to|we|let's|let me|you'll|you want to|you need to|you just|you)\s+/i, "")
    .replace(/^(?:i'm|i am|we're|you're)\s+(\w+ing)\b/i, (_m, v: string) => ING[v.toLowerCase()] ?? v)
  s = s.replace(/^(\w+ing)\b/i, (v) => ING[v.toLowerCase()] ?? v)
  s = s.replace(/\bI'm\b/gi, "you're").replace(/\bI've\b/gi, "you've").replace(/\bI'll\b/gi, "you'll").replace(/\bI\b/g, "you")
    .replace(/\bmy\b/gi, "your").replace(/\bmine\b/gi, "yours").replace(/\bmyself\b/gi, "yourself").replace(/\bour\b/gi, "your").replace(/\bwe\b/gi, "you")
  if (when && !/^(here|first)$/i.test(when[1])) s = `${when[1].replace(/^and then$/i, "then")} ${s}`
  else if (when && /^first$/i.test(when[1])) s = `first, ${s}`
  s = s.trim()
  if (!s) return ""
  return `${s[0].toUpperCase()}${s.slice(1)}${/[.!?…:]$/.test(s) ? "" : "."}`
}

// ---------- the steps

/** Words that say what's where (a walkthrough's), not what to do. */
const EXPLAINS = /\b(this is|here's|here is|these are|that's where|this shows|shows you|you can|you'll see|you will see|where you|which is|it tells|it says|lets you)\b/i

/** A thing's words as a tag finds them: one line, no quotes. */
const wordsOf = (el?: { label: string }) => (el?.label ?? "").replace(/\s+/g, " ").replace(/["“”]/g, "'").trim().slice(0, 80)
type Built = { at: number; end: number; kind: "click" | "key" | "field"; text: string; said: string[]; after: string[]; el?: El; window?: Rect; app?: string; value?: string; key?: string }
const sameEl = (a?: El, b?: El) => !!a && !!b && a.label === b.label && a.role === b.role
const KEY_NAMES: Record<string, string> = { cmd: "Command", ctrl: "Control", alt: "Option", opt: "Option", shift: "Shift", enter: "Return", return: "Return", tab: "Tab", esc: "Escape", space: "Space", delete: "Delete" }
const keyWords = (k: string) => k.split("+").map((p) => KEY_NAMES[p.toLowerCase()] ?? p.toUpperCase()).join(" ")

/** The lesson's acts as steps: a click on its thing (with the typing into it, its last value), a shortcut (Return
 *  after typing ends that step), the app changing said in the next; Tab, scrolls and private apps left out. */
export function stepsOf(l: Lesson): { steps: Built[]; apps: { app: string; name: string }[]; intro: string[]; unnamed: number } {
  const acts = [...l.acts].sort((a, b) => a.t - b.t)
  const out: Built[] = [], apps: { app: string; name: string }[] = []
  let app: { app: string; name: string } | null = null, priv = false, unnamed = 0, changed = false
  for (const a of acts) {
    if (a.kind === "app") {
      priv = !!a.private
      if (priv || !a.app) continue
      if (app?.app !== a.app) { const now: { app: string; name: string } = { app: a.app, name: a.name }; changed = !!app; app = now; if (!apps.some((x) => x.app === now.app)) apps.push(now) }
      continue
    }
    if (priv || a.kind === "said") continue
    const prev = out.at(-1), inApp = changed && app ? `In ${app.name}, ` : ""
    if (a.kind === "click") {
      const el = a.el && wordsOf(a.el) ? a.el : undefined
      // (a second click on the same thing at once: a double click, one step)
      if (prev?.kind === "click" && sameEl(prev.el, el) && a.t - prev.at < 600) continue
      if (!el) { unnamed++; continue }
      out.push({ at: a.t, end: a.t, kind: "click", text: inApp, said: [], after: [], el, window: a.window, app: app?.app }); changed = false
      continue
    }
    if (a.kind === "field") {
      if (!wordsOf(a.el)) { unnamed++; continue }
      const value = keptValue(a.value)
      // (typing into what was just clicked: that step types; more typing in it: its last value)
      if ((prev?.kind === "click" || prev?.kind === "field") && sameEl(prev.el, a.el)) { Object.assign(prev, { kind: "field", value, end: a.t, window: a.window ?? prev.window }); continue }
      out.push({ at: a.t, end: a.t, kind: "field", text: inApp, said: [], after: [], el: a.el, value, window: a.window, app: app?.app }); changed = false
      continue
    }
    const key = a.key.toLowerCase()
    if (key === "tab") continue
    if (prev && (prev.kind === "field" || prev.kind === "click") && !prev.key && (key === "enter" || key === "return") && a.t - prev.at < 20_000) { prev.key = "enter"; prev.end = a.t; continue }
    out.push({ at: a.t, end: a.t, kind: "key", text: inApp, said: [], after: [], key, app: app?.app }); changed = false
  }
  // (their words: each with the step it came just before (said as they went to do it), else the one just done)
  const said = acts.filter((a): a is Extract<Act, { kind: "said" }> => a.kind === "said" && !teachCommand(a.text, true) && !teachCommand(a.text, false)).map((a) => ({ t: a.t, text: a.text.trim() })).filter((s) => s.text)
  const intro: string[] = []
  for (const s of said) {
    const during = out.find((b) => s.t >= b.at && s.t <= b.end), next = out.find((b) => b.at >= s.t - 400), before = out.findLast((b) => b.at < s.t - 400)
    // (what's where is said once it shows: the step before; what to do, as they go to do it: the next)
    if (during) during.said.push(s.text)
    else if (EXPLAINS.test(s.text) && before && s.t - before.at < 20_000) before.after.push(s.text)
    else if (next && next.at - s.t <= 9000) next.said.push(s.text)
    else if (before) before.after.push(s.text)
    else intro.push(s.text)
  }
  return { steps: out, apps, intro, unnamed }
}

/** A step's own words when they said none: what it does, plainly. */
function doneWords(b: Built) {
  const w = wordsOf(b.el)
  if (b.kind === "key") return `Press ${keyWords(b.key ?? "")}.`
  if (b.kind === "field") return `${b.value && b.value.length <= 24 ? `Type "${b.value}" in ${w}` : `Fill in ${w}`}${b.key ? ", then press Return" : ""}.`
  const role = b.el?.role.toLowerCase() ?? ""
  return /^tab/.test(role) ? `Go to the ${w} tab.` : /^link/.test(role) ? `Open ${w}.` : /^(menuitem|menu item|option)/.test(role) ? `Choose ${w}.` : /^(checkbox|switch|toggle)/.test(role) ? `Turn ${w} on or off.` : `Click ${w}.`
}
const cap = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s)

/** The lesson as a tour: each step their words (else what it does), a mark on its thing and what it does, its things'
 *  roles and containers kept as anchors so they're found again after the screen changed. */
export function lessonTour(l: Lesson, title: string): { tour: Tour; unnamed: number } {
  const { steps, apps, intro, unnamed } = stepsOf(l)
  const anchors: Tour["anchors"] = {}
  const lines = steps.map((b) => {
    const w = wordsOf(b.el), words = [b.said.map(yours).filter(Boolean).join(" ") || doneWords(b), ...b.after.map(yours).filter(Boolean)].join(" ")
    const text = `${b.text}${b.text ? words.replace(/^./, (c) => c.toLowerCase()) : cap(words)}`
    if (b.el && w) {
      const { label: _l, app: _a, site: _s, ...rest } = anchorOf({ ...b.el, label: w } as Seen, { window: b.window })
      if (Object.keys(rest).length && !anchors[w]) anchors[w] = rest
    }
    const tag = b.kind === "click" && w ? ` [ring ${JSON.stringify(w)}]` : b.kind === "field" && w ? ` [point ${JSON.stringify(w)}]` : ""
    const does = b.kind === "click" ? [`click ${JSON.stringify(w)}`]
      : b.kind === "field" ? (b.value ? [`type "${b.value}" in ${JSON.stringify(w)}`] : [])
      : [`press ${b.key}`]
    if (b.key && b.kind !== "key") does.push("press enter")
    // (a field it couldn't read, a password's: they type it themselves, in every mode)
    const wait = b.kind === "field" && !b.value ? ` (wait: type ${JSON.stringify(w)})` : ""
    return `${text.replace(/[.!?…:]?$/, (e) => e || ".")}${tag}${wait}${does.length ? ` (do: ${does.join("; ")})` : ""}`
  })
  const first = intro.map(yours).filter(Boolean).join(" ")
  const all = [...(first ? [first] : []), ...lines]
  return { tour: { title, app: apps.map((a) => a.app), site: [], steps: all.map((x, i) => parseStep(i + 1, x)), anchors }, unnamed }
}

// ---------- what it becomes

/** A tour (a walkthrough: they explained what's where) or a skill (a procedure an agent should run): what they asked
 *  for, else what their words were like. */
export function kindFor(l: Lesson): As {
  if (l.as) return l.as
  const words = [l.about ?? "", ...l.acts.flatMap((a) => (a.kind === "said" ? [a.text] : []))]
  if (words.some((w) => /\b(skill|automate|for me|run it|do it yourself)\b/i.test(w))) return "skill"
  if (words.some((w) => /\b(tour|walkthrough|walk-through|for others|show people)\b/i.test(w))) return "tour"
  const said = words.slice(1).filter((w) => w.trim() && !teachCommand(w, true) && !teachCommand(w, false))
  return said.length >= 2 && said.filter((w) => EXPLAINS.test(w)).length * 2 >= said.length ? "tour" : "skill"
}

/** Its title: what they called it ("how to add a deploy key": "Add a deploy key"), else where it was and when. */
export function lessonTitle(l: Lesson, appName = "", at = l.from) {
  const a = fileTitle((l.about ?? "").replace(/^(?:(?:how|the way) (?:to|i|you|we)(?: do| can)?|what i do to|to)\s+/i, "").replace(/^(?:this|it|that)$/i, "").replace(/[.!?,;:]+$/, ""), 10_000)
  if (a.split(" ").length >= 2) return cap(a.slice(0, 80).trim())
  return `${appName || "Steps"} lesson ${localDay(at)} ${localTime(at, ".")}`
}
/** A skill's folder name: its title in kebab case. */
export const skillName = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "lesson"

/** The tour's file: a draft (`status: draft`) till it has played through once. */
export const lessonTourText = (t: Tour, at: number) => tourText(t, { status: "draft", taught: localDay(at) })

/** The skill's SKILL.md: what it does and how to run it, its steps a tour the companion plays (do mode) on their
 *  screen, a draft till it has run through once. */
export function lessonSkillText(t: Tour, o: { name: string; at: number; appNames: string[] }) {
  const where = o.appNames.length ? ` in ${o.appNames.join(" and ")}` : ""
  const what = t.title.replace(/^./, (c) => c.toLowerCase())
  const fm = tourText(t, { name: o.name, description: `${t.title}${where}, on the user's screen as they showed it. Use when asked to ${what}.`, origin: "ai", status: "draft", taught: localDay(o.at) }).split("\n---\n")[0]
  const path = `.agents/skills/${o.name}/SKILL.md`
  return `${fm}\n---\n\n# ${t.title}\n\nThe user showed this once (watch me, ${localDay(o.at)}${where}). It runs on their screen, where they see each step:\n\n` +
    `    vau companion tour ${path} --mode do --wait\n\n` +
    `Each step finds its thing again by what it is (its words, role and what it's in), so it survives a moved or renamed\n` +
    `button; a step whose thing isn't found comes to the companion to do. What it types is what they typed then: change a\n` +
    `step's \`type "…"\` for another value. A draft (\`status: draft\`) until it has run to the end once.\n\n## Steps\n` +
    `${t.steps.map((s, i) => stepLine(s, i + 1)).join("\n")}\n`
}

/** A draft that played through: `status: draft` gone, when it worked kept. Null: not a draft. */
export function promoted(text: string, at: number): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!m || !/^status:\s*["']?draft["']?\s*$/m.test(m[1])) return null
  const fm = m[1].split("\n").filter((l) => !/^status:\s*["']?draft["']?\s*$/.test(l) && !/^tested:/.test(l))
  return `---\n${[...fm, `tested: ${localDay(at)}`].join("\n")}\n---${text.slice(m[0].length)}`
}
/** Whether a play counts as working: to the end, every step found (none handed to the model). */
export const playedThrough = (r: { ended: string; steps: { how: string }[] }) => r.ended === "done" && r.steps.length > 0 && r.steps.every((s) => s.how === "played")
