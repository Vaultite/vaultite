// Tours: a recorded companion answer played step by step without the model, each target found fresh (anchors) as its
// step comes, the model asked only when one isn't. No Node.
import { type Anchor, anchorOf, type Seen } from "./anchor.ts"
import { type Condition, conditionText, parseCondition, type Watched } from "./condition.ts"
import { parseTags, type Spot, type Tag } from "./tags.ts"
import type { Rect } from "./uimodel.ts"

export type Mode = "show" | "guide" | "do"
export const MODES: readonly Mode[] = ["show", "guide", "do"]
/** Something a step does itself, in do mode: at the thing saying `text`, or (typing, pressing) where the keys go. */
export type Do = { action: "click" | "type" | "press" | "scroll"; text?: string; value?: string; key?: string; dir?: "up" | "down" }
export type Step = { n: number; text: string; said: string; tags: Tag[]; wait?: Condition; do?: Do[]
  /** A picture of its first target before a change (a job's proof): laid over it and flipped with how it is now. */
  before?: string
  /** Marks of `companion draw` it shows with its words (a card, a sketch: `(draw: [...])`), cleared as the next step comes. */
  draw?: Record<string, unknown>[] }
export type Tour = { title: string; app: string[]; site: string[]; steps: Step[]
  /** What they say to have it played, wherever they are ("what's new?"): matched whole, so it's never their real question. */
  ask?: string[]
  /** The job it's the proof of (its change shown, `companion job-show`). */
  job?: string
  /** What its targets are beyond their words (role, container, place), by their words: found again by these. */
  anchors: Record<string, Partial<Anchor>> }

const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean)
const host = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")

/** `(do: click "Send"; type "hello")` as its steps; throws saying what's wrong. */
export function parseDo(src: string): Do[] {
  return src.split(/\s*;\s*/).filter((s) => s.trim()).map((s) => {
    const m = /^\s*(\w+)\s*(.*)$/.exec(s)!, verb = m[1].toLowerCase(), rest = m[2].trim()
    const quoted = [...rest.matchAll(/"([^"]*)"|“([^”]*)”/g)].map((x) => (x[1] ?? x[2]).trim())
    if (verb === "click") { if (!quoted[0]) throw new Error(`do: click needs the words of what to click, quoted: click "Send"`); return { action: "click", text: quoted[0] } }
    if (verb === "type") {
      if (!quoted[0]) throw new Error(`do: type needs the words to type, quoted: type "hello" (in "Message")`)
      return { action: "type", value: quoted[0], ...(quoted[1] ? { text: quoted[1] } : {}) }
    }
    if (verb === "press") { if (!rest) throw new Error("do: press needs a key: press enter, press cmd+s"); return { action: "press", key: rest.replace(/^"|"$/g, "") } }
    if (verb === "scroll") return { action: "scroll", dir: /\bup\b/i.test(rest) ? "up" : "down", ...(quoted[0] ? { text: quoted[0] } : {}) }
    throw new Error(`no do "${verb}": click "…", type "…" (in "…"), press <key>, scroll up|down`)
  })
}
export const doText = (d: Do) => d.action === "click" ? `click ${JSON.stringify(d.text)}` : d.action === "type" ? `type ${JSON.stringify(d.value)}${d.text ? ` in ${JSON.stringify(d.text)}` : ""}`
  : d.action === "press" ? `press ${d.key}` : `scroll ${d.dir ?? "down"}${d.text ? ` ${JSON.stringify(d.text)}` : ""}`

const NOTE = /\(\s*(wait|do|before|draw)\s*:\s*((?:[^()"“”]|"[^"]*"|“[^”]*”)*)\)/gi
/** One step's line (its number gone): its words and tags, its wait and its do. */
export function parseStep(n: number, line: string): Step {
  let wait: Condition | undefined, does: Do[] | undefined, before: string | undefined, draw: Record<string, unknown>[] | undefined
  const text = line.replace(NOTE, (_m, k: string, body: string) => {
    if (k.toLowerCase() === "wait") wait = parseCondition(body)
    else if (k.toLowerCase() === "draw") draw = [...(draw ?? []), ...parseDraw(body)]
    else if (k.toLowerCase() === "before") before = body.trim().replace(/^["“]|["”]$/g, "").trim() || undefined
    else does = [...(does ?? []), ...parseDo(body)]
    return ""
  }).replace(/\s{2,}/g, " ").trim()
  const { said, tags } = parseTags(text)
  if (before && !tags.length) throw new Error("before: needs a tag on the thing it was a picture of ([ring \"Save\"])")
  return { n, text, said, tags, ...(wait ? { wait } : {}), ...(does ? { do: does } : {}), ...(before ? { before } : {}), ...(draw ? { draw } : {}) }
}
/** `(draw: {"type": "image", "src": "screenshot"})`: one mark of companion draw's, or a list of them. */
function parseDraw(src: string): Record<string, unknown>[] {
  let v: unknown
  try { v = JSON.parse(src) } catch { throw new Error(`draw: marks as companion draw takes them, in JSON ({"type": "image", "src": "screenshot"}), not ${src.trim().slice(0, 60)}`) }
  const marks = Array.isArray(v) ? v : [v]
  if (!marks.length || marks.some((m) => !m || typeof m !== "object" || Array.isArray(m) || typeof (m as { type?: unknown }).type !== "string")) throw new Error("draw: each mark is an object with its type")
  return marks as Record<string, unknown>[]
}
/** Words as an ask is matched against a tour's ask phrases: lower case, without punctuation, "hey Claude", "please". */
export const askWords = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  .replace(/^(?:(?:hey|ok|okay|so|um|uh|claude|companion|please|can you|could you)\s+)+/, "").replace(/(?:\s+(?:please|claude|then))+$/, "").trim()
/** The tour `ask` (what they said) is for: one whose ask phrase it is, said whole. */
export const tourAsked = <T extends Pick<Tour, "ask">>(tours: readonly T[], ask: string) => {
  const w = askWords(ask)
  return w ? tours.find((t) => (t.ask ?? []).some((a) => askWords(a) === w)) ?? null : null
}

/** A tour's file (type: tour): its app bundle ids or sites, its steps the body's numbered list (a step's later lines
 *  indented under it). Problems found, each said. */
export function parseTour(fm: Record<string, unknown>, body: string, stem: string): [Tour, string[]] {
  const problems: string[] = [], steps: Step[] = []
  let cur: { n: number; lines: string[] } | null = null
  const flush = () => {
    if (!cur) return
    try { steps.push(parseStep(steps.length + 1, cur.lines.join(" "))) } catch (e) { problems.push(`step ${cur.n}: ${(e as Error).message}`) }
    cur = null
  }
  for (const raw of body.split("\n")) {
    const m = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(raw)
    if (m) { flush(); cur = { n: Number(m[1]), lines: [m[2]] }; continue }
    if (cur && /^\s+\S/.test(raw)) { cur.lines.push(raw.trim()); continue }
    flush()
  }
  flush()
  const app = list(fm.app), site = list(fm.site).map(host)
  const anchors: Tour["anchors"] = {}
  if (fm.anchors && typeof fm.anchors === "object" && !Array.isArray(fm.anchors)) {
    for (const [k, v] of Object.entries(fm.anchors as Record<string, unknown>)) if (v && typeof v === "object") anchors[k] = v as Partial<Anchor>
  }
  if (!steps.length && !problems.length) problems.push("a tour's steps are a numbered list: 1. Your chats are down the left [frame \"Chats\"].")
  const job = typeof fm.job === "string" && fm.job.trim() ? fm.job.trim() : ""
  return [{ title: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : stem, app, site, ...(list(fm.ask).length ? { ask: list(fm.ask) } : {}), steps, anchors, ...(job ? { job } : {}) }, problems]
}

/** A step's line in a tour's file: `n. words [tags] (wait: …) (do: …)`. */
export const stepLine = (s: Step, n: number) => `${n}. ${[s.text, s.wait ? `(wait: ${conditionText(s.wait)})` : "", s.do?.length ? `(do: ${s.do.map(doText).join("; ")})` : "",
  s.before ? `(before: ${JSON.stringify(s.before)})` : "", s.draw ? `(draw: ${JSON.stringify(s.draw.length === 1 ? s.draw[0] : s.draw)})` : ""].filter(Boolean).join(" ")}`
/** A tour as its file says it (`extra`: more frontmatter, first). */
export function tourText(t: Tour, extra: Record<string, string> = {}) {
  const yaml = (v: unknown) => JSON.stringify(v)
  const plain = (v: string) => (/^[\w./@ -]+$/.test(v) && !/^\s|\s$|: /.test(v) ? v : yaml(v))
  const fm = ["---", ...Object.entries(extra).map(([k, v]) => `${k}: ${plain(v)}`), "type: tour", ...(t.job ? [`job: ${t.job}`] : []), ...(t.app.length ? [`app: ${t.app.length === 1 ? t.app[0] : yaml(t.app)}`] : []), ...(t.site.length ? [`site: ${t.site.length === 1 ? t.site[0] : yaml(t.site)}`] : []), ...(t.ask?.length ? [`ask: ${yaml(t.ask)}`] : [])]
  const anchors = Object.entries(t.anchors).filter(([, a]) => Object.keys(a).length)
  if (anchors.length) fm.push("anchors:", ...anchors.map(([k, a]) => `  ${yaml(k)}: ${yaml(a)}`))
  fm.push("---")
  return `${fm.join("\n")}\n${t.steps.map((s, i) => stepLine(s, i + 1)).join("\n")}\n`
}

/** The elements an ask came with (a3: its words, role and place), and where it was. */
export type Context = { near?: (Seen & { id: string })[]; app?: string; site?: string; window?: Rect }
/** "Save that as a tour": a companion answer (its words with their tags) as a tour, a step a sentence that points;
 *  its ids (a3) become the words of what they were, with what else tells them apart kept in `anchors`. */
export function tourFromAnswer(text: string, title: string, ctx: Context = {}): Tour {
  const anchors: Tour["anchors"] = {}
  // (an id in a tag, with or without words: the thing's own words, quoted, its anchor kept)
  const fixed = text.replace(/\[(\s*[a-z]+)([^\]]*)\]/gi, (all, kind: string, args: string) => {
    let out = args
    for (const m of args.matchAll(/(?<![\w"])(a\d+)(?![\w"])/g)) {
      const e = ctx.near?.find((x) => x.id === m[1])
      if (!e?.label) continue
      const { label: _l, app: _a, site: _s, ...rest } = anchorOf(e, { window: ctx.window })
      if (Object.keys(rest).length) anchors[e.label] = rest
      const words = /"[^"]*"/.test(out) ? "" : JSON.stringify(e.label)
      out = out.replace(m[1], words)
    }
    return out === args ? all : `[${kind}${out.replace(/\s{2,}/g, " ").replace(/\s+$/, "")}]`
  })
  // (sentences: one that points starts a step; one that doesn't joins the step before it, or the first)
  const parts = fixed.replace(/\s+/g, " ").trim().match(/[^.!?…]+(?:[.!?…]+|$)(?:\s*\[[^\]]*\])*/g) ?? []
  const groups: string[] = []
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (/\[\s*[a-z]+[\s\]]/i.test(p) || !groups.length) groups.push(p)
    else groups[groups.length - 1] += ` ${p}`
  }
  const steps = groups.map((g, i) => parseStep(i + 1, g))
  return { title, app: ctx.app && !ctx.site ? [ctx.app] : [], site: ctx.site ? [ctx.site] : [], steps, anchors }
}

// ---------- the player

/** Where a target is now: its place on screen (screen points), whether it shows, how it was found. */
export type Aim = { ok: true; at: Rect; shown: boolean; dir?: "up" | "down" | "left" | "right"; how: string } | { ok: false; why: string }
export type Fx = {
  /** Find the thing an anchor describes, now. */
  aim: (a: Anchor) => Promise<Aim>
  /** Say a step's words, its tags at the places found (by tag, in order; null: not aimed, as a pixel or a pane). */
  show: (step: Step, at: (Aim | null)[]) => Promise<void>
  /** The player's own few words ("Scroll down a bit"). */
  say: (text: string) => Promise<void>
  wait: (c: Condition, signal?: AbortSignal) => Promise<Watched>
  act: (d: Do, at: Aim | null) => Promise<{ ok: boolean; why?: string }>
  /** Ask the model to play this step, its targets `missing` not found: whether it did. */
  fallback: (step: Step, missing: string[]) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  /** A shown step's marks again, its targets moved (null: off screen or gone now); none: they stay where shown. */
  follow?: (step: Step, at: (Aim | null)[]) => Promise<void> | void
}
export type Played = { n: number; how: "played" | "model" | "lost" | "stopped"; ms: number; waited?: Watched; why?: string }
export type Result = { ended: "done" | "stopped" | "lost"; steps: Played[] }

/** The anchor a tag's spot stands for in tour `t` (its words, with what the tour knows of them), or null (a pixel, a
 *  pane: nothing to find). An ask's id can't be: it meant something only then. */
export function anchorFor(t: Pick<Tour, "anchors" | "app" | "site">, s: Spot): Anchor | "lost" | null {
  if ("find" in s) return { ...(t.anchors[s.find] ?? {}), label: s.find }
  if ("ui" in s) return { label: s.ui, ui: s.ui, app: "vaultite" }
  if ("ax" in s) return "lost"
  return null
}

/** How long a target that isn't there is looked for before the model is asked (a page loading). */
const COMING_MS = 5000
/** How long a target that's off screen is waited for to come into view (scrolled to). */
const INTO_VIEW_MS = 30_000
/** A step's wait in this mode: guide waits for what do would have done (a click he makes), do does what guide waits
 *  for (his click it makes); show waits for nothing. */
export function plan(step: Step, mode: Mode): { wait?: Condition; does: Do[] } {
  if (mode === "show") return { does: [] }
  const does = step.do ?? []
  if (mode === "do") {
    const clicks = step.wait?.any.length === 1 ? step.wait.any[0].filter((c) => c.kind === "click" && c.text) : []
    const rest = step.wait?.any.length === 1 ? step.wait.any[0].filter((c) => !(c.kind === "click" && c.text)) : null
    if (clicks.length && rest) {
      const left = rest.length ? { ...step.wait!, any: [rest], source: "" } : undefined
      if (left) left.source = conditionText(left)
      return { does: [...does, ...clicks.map((c) => ({ action: "click" as const, text: (c as { text: string }).text }))], ...(left ? { wait: left } : {}) }
    }
    return { does, ...(step.wait ? { wait: step.wait } : {}) }
  }
  // (guide: what the step would do, he does)
  if (!does.length) return { does: [], ...(step.wait ? { wait: step.wait } : {}) }
  const theirs = does.map((d) => (d.action === "click" ? `click ${JSON.stringify(d.text)}` : d.action === "type" ? `type${d.text ? ` ${JSON.stringify(d.text)}` : ""}` : "changed"))
  return { does: [], wait: step.wait ?? parseCondition(theirs.join(" and ")) }
}

/** Play tour `t` in `mode`: each step's targets found fresh, said with its marks, then its do and its wait. A target
 *  that's off screen is waited for (he scrolls; do mode scrolls); one not found goes to the model, else the tour stops. */
export async function play(t: Tour, mode: Mode, fx: Fx, signal?: AbortSignal, from = 1): Promise<Result> {
  const out: Played[] = []
  for (const step of t.steps.filter((s) => s.n >= from)) {
    let unfollow = () => {}
    try {
      const t0 = Date.now()
      if (signal?.aborted) return { ended: "stopped", steps: out }
      const { wait, does } = plan(step, mode)
      // (a step with no words that does a click still shows where)
      const own = [...(step.do ?? []), ...does], tags = step.tags.length || !own.some((d) => d.text) ? step.tags : own.filter((d, i) => d.text && own.findIndex((x) => x.text === d.text) === i).map((d): Tag => ({ kind: "point", at: { find: d.text! }, offset: 0 }))
      const spots = tags.flatMap((g) => [g.at, ...(g.to ? [g.to] : [])])
      const missingIn = (a: (Aim | null)[]) => spots.flatMap((s, i) => (a[i] && !a[i]!.ok ? [labelOf(s)] : []))
      let aims = await aimAll(t, spots, fx), missing = missingIn(aims)
      // (a thing not there yet, the page still coming after the step before: looked for again a few seconds first)
      for (let waited = 0; missing.length && waited < COMING_MS && !signal?.aborted; waited += 500) {
        await fx.sleep(500)
        aims = await aimAll(t, spots, fx)
        missing = missingIn(aims)
      }
      let how: Played["how"] = "played"
      if (missing.length) {
        if (!(await fx.fallback(step, missing).catch(() => false))) { out.push({ n: step.n, how: "lost", ms: Date.now() - t0, why: `not found: ${missing.join(", ")}` }); return { ended: "lost", steps: out } }
        how = "model"
      } else {
        const hidden = aims.find((a): a is Extract<Aim, { ok: true }> => !!a?.ok && !a.shown)
        if (hidden) {
          const got = await intoView(t, spots, hidden.dir ?? "down", mode, fx, signal)
          if (!got) { out.push({ n: step.n, how: signal?.aborted ? "stopped" : "lost", ms: Date.now() - t0, why: "it didn't come into view" }); return { ended: signal?.aborted ? "stopped" : "lost", steps: out } }
          aims.splice(0, aims.length, ...got)
        }
        await fx.show({ ...step, tags }, pairUp(tags, aims))
        unfollow = following(t, { ...step, tags }, spots, aims, fx, signal)
        // (time to read it, or hear it, before the next step's words replace it; a wait's step waits for them instead)
        if (!wait && !signal?.aborted) await fx.sleep(Math.max(readMs(step.said), step.before ? FLIP_MS : 0))
      }
      for (const d of does) {
        if (signal?.aborted) return { ended: "stopped", steps: [...out, { n: step.n, how: "stopped", ms: Date.now() - t0 }] }
        const a = d.text ? anchorFor(t, { find: d.text }) : null
        const at = a && a !== "lost" ? await fx.aim(a) : null
        if (at && !at.ok) { out.push({ n: step.n, how: "lost", ms: Date.now() - t0, why: `${doText(d)}: ${at.why}` }); return { ended: "lost", steps: out } }
        const r = await fx.act(d, at)
        if (!r.ok) { out.push({ n: step.n, how: "lost", ms: Date.now() - t0, why: `${doText(d)}: ${r.why ?? "it didn't work"}` }); return { ended: "lost", steps: out } }
      }
      const waited = wait ? await fx.wait(wait, signal) : undefined
      if (waited?.why === "stopped") { out.push({ n: step.n, how: "stopped", ms: Date.now() - t0, waited }); return { ended: "stopped", steps: out } }
      out.push({ n: step.n, how, ms: Date.now() - t0, ...(waited ? { waited } : {}) })
    } finally { unfollow() }
  }
  return { ended: "done", steps: out }
}

/** How long a step with a before stays up: its picture over the thing, then how it is now, twice. */
export const FLIP_MS = 6000
/** How long a step's words stay up with nothing to wait for. */
export const readMs = (said: string) => Math.min(7000, 1200 + said.length * 50)
/** How often a shown step's targets are looked for again, and how far one moves (points) before its marks follow. */
const FOLLOW_MS = 700, MOVED = 6
const moved = (a: Aim | null, b: Aim | null) => {
  if (!a || !b) return false
  if (a.ok !== b.ok) return true
  if (!a.ok || !b.ok) return false
  return a.shown !== b.shown || (["x", "y", "width", "height"] as const).some((k) => Math.abs(a.at[k] - b.at[k]) > MOVED)
}
/** While `step` shows: its targets looked for again, its marks following them (fx.follow) when one moves, hides or
 *  comes back. Answers its stop. */
export function following(t: Tour, step: Step, spots: Spot[], first: (Aim | null)[], fx: Fx, signal?: AbortSignal) {
  if (!fx.follow || !first.some(Boolean)) return () => {}
  let on = true, last = first
  void (async () => {
    while (on && !signal?.aborted) {
      await fx.sleep(FOLLOW_MS)
      if (!on || signal?.aborted) return
      const now = await aimAll(t, spots, fx)
      if (!on || !now.some((a, i) => moved(last[i] ?? null, a))) continue
      last = now
      await fx.follow!(step, pairUp(step.tags, now.map((a) => (a?.ok && a.shown ? a : null))))
    }
  })().catch(() => {})
  return () => { on = false }
}

const labelOf = (s: Spot) => ("find" in s ? s.find : "ui" in s ? s.ui : "ax" in s ? s.ax : JSON.stringify(s))
async function aimAll(t: Tour, spots: Spot[], fx: Fx): Promise<(Aim | null)[]> {
  return Promise.all(spots.map(async (s) => {
    const a = anchorFor(t, s)
    if (a === "lost") return { ok: false as const, why: "an ask's id means nothing later: name it by its words" }
    return a ? fx.aim(a).catch((e) => ({ ok: false as const, why: (e as Error).message })) : null
  }))
}
/** Each tag's aim and its arrow's end (aims come a spot each, a tag's `to` after its `at`). */
function pairUp(tags: Tag[], aims: (Aim | null)[]) {
  const out: (Aim | null)[] = []
  let i = 0
  for (const g of tags) { out.push(aims[i++] ?? null); if (g.to) out.push(aims[i++] ?? null) }
  return out
}
/** Wait for every target to show: asked to scroll (do mode scrolls itself), looked for again every half second. */
async function intoView(t: Tour, spots: Spot[], dir: "up" | "down" | "left" | "right", mode: Mode, fx: Fx, signal?: AbortSignal) {
  const v = dir === "up" || dir === "down" ? dir : "down"
  if (mode === "do") await fx.act({ action: "scroll", dir: v }, null)
  else await fx.say(`It's further ${dir}: scroll ${dir} a bit.`)
  const t0 = Date.now()
  while (Date.now() - t0 < INTO_VIEW_MS && !signal?.aborted) {
    await fx.sleep(500)
    const aims = await aimAll(t, spots, fx)
    if (aims.every((a) => !a || (a.ok && a.shown))) return aims
    if (mode === "do") await fx.act({ action: "scroll", dir: v }, null)
  }
  return null
}
