import { type Anchor, anchorOf, type Seen } from "../../../core/desktop/anchor.ts"
import { type Condition, conditionText, parseCondition, type Watched } from "./condition.ts"
import { parseTags, type Spot, type Tag } from "./tags.ts"
import type { Rect } from "../../../core/desktop/uimodel.ts"
import { z } from "zod"
import { messageOf } from "./errors.ts"

export type Mode = "show" | "guide" | "do"
export const MODES: readonly Mode[] = ["show", "guide", "do"]
export type Do = { action: "click" | "type" | "press" | "scroll"; text?: string; value?: string; key?: string; dir?: "up" | "down" }
export type Step = { n: number; text: string; said: string; tags: Tag[]; wait?: Condition; do?: Do[]
  before?: string
  after?: string
  draw?: DrawMark[] }
export type Tour = { title: string; app: string[]; site: string[]; steps: Step[]
  ask?: string[]
  job?: string
  open?: string
  video?: string; times?: number[]
  anchors: Record<string, Partial<Anchor>> }

export type Frontmatter = { readonly [key: string]: unknown }
const DrawMark = z.record(z.string(), z.unknown()).and(z.object({ type: z.string() }))
export type DrawMark = z.infer<typeof DrawMark>
const AnchorFields = z.object({ app: z.string(), site: z.string(), role: z.string(), label: z.string(), inside: z.array(z.string()), ui: z.string(),
  at: z.object({ x: z.number(), y: z.number() }), image: z.string() }).partial()
const SavedAnchor = z.record(z.string(), z.unknown()).and(AnchorFields)
const Words = z.union([z.array(z.unknown()).transform((a) => a.map(String)), z.string().transform((s) => s.split(","))]).catch([])
  .transform((a) => a.map((x) => x.trim()).filter(Boolean))
const Text = z.string().trim().catch("")
const Front = z.object({ title: Text, job: Text, open: Text, video: Text, app: Words, site: Words, ask: Words,
  times: z.array(z.unknown()).catch([]), anchors: z.record(z.string(), z.unknown()).catch({}) })
const host = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")

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

const NOTE = /\(\s*(wait|do|before|after|draw)\s*:\s*((?:[^()"“”]|"[^"]*"|“[^”]*”)*)\)/gi
export function parseStep(n: number, line: string): Step {
  let wait: Condition | undefined, does: Do[] | undefined, before: string | undefined, after: string | undefined, draw: DrawMark[] | undefined
  const text = line.replace(NOTE, (_m, k: string, body: string) => {
    if (k.toLowerCase() === "wait") wait = parseCondition(body)
    else if (k.toLowerCase() === "draw") draw = [...(draw ?? []), ...parseDraw(body)]
    else if (k.toLowerCase() === "before") before = body.trim().replace(/^["“]|["”]$/g, "").trim() || undefined
    else if (k.toLowerCase() === "after") after = body.trim().replace(/^["“]|["”]$/g, "").trim() || undefined
    else does = [...(does ?? []), ...parseDo(body)]
    return ""
  }).replace(/\s{2,}/g, " ").trim()
  const { said, tags } = parseTags(text)
  if (before && !after && !tags.length) throw new Error("before: needs a tag on the thing it was a picture of ([ring \"Save\"]), or an (after: <png>) beside it")
  return { n, text, said, tags, ...(wait ? { wait } : {}), ...(does ? { do: does } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}), ...(draw ? { draw } : {}) }
}
function parseDraw(src: string): DrawMark[] {
  let v: unknown
  try { v = JSON.parse(src) } catch { throw new Error(`draw: marks as companion draw takes them, in JSON ({"type": "image", "src": "screenshot"}), not ${src.trim().slice(0, 60)}`) }
  const marks = z.array(DrawMark).min(1).safeParse(Array.isArray(v) ? v : [v])
  if (!marks.success) throw new Error("draw: each mark is an object with its type")
  return marks.data
}
export const askWords = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  .replace(/^(?:(?:hey|ok|okay|so|um|uh|claude|companion|please|can you|could you)\s+)+/, "").replace(/(?:\s+(?:please|claude|then))+$/, "").trim()
export const tourAsked = <T extends Pick<Tour, "ask">>(tours: readonly T[], ask: string) => {
  const w = askWords(ask)
  return w ? tours.find((t) => (t.ask ?? []).some((a) => askWords(a) === w)) ?? null : null
}

export function parseTour(frontmatter: Frontmatter, body: string, stem: string): [Tour, string[]] {
  const problems: string[] = [], steps: Step[] = []
  let cur: { n: number; lines: string[] } | null = null
  const flush = () => {
    if (!cur) return
    try { steps.push(parseStep(steps.length + 1, cur.lines.join(" "))) } catch (e) { problems.push(`step ${cur.n}: ${messageOf(e)}`) }
    cur = null
  }
  for (const raw of body.split("\n")) {
    const m = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(raw)
    if (m) { flush(); cur = { n: Number(m[1]), lines: [m[2]] }; continue }
    if (cur && /^\s+\S/.test(raw)) { cur.lines.push(raw.trim()); continue }
    flush()
  }
  flush()
  const fm = Front.parse(frontmatter), app = fm.app, site = fm.site.map(host)
  const anchors: Tour["anchors"] = {}
  for (const [k, v] of Object.entries(fm.anchors)) { const a = SavedAnchor.safeParse(v); if (a.success) anchors[k] = a.data }
  if (!steps.length && !problems.length) problems.push("a tour's steps are a numbered list: 1. Your chats are down the left [frame \"Chats\"].")
  const { job, open, video } = fm, times = fm.times.map(Number).filter((x) => Number.isFinite(x) && x >= 0)
  return [{ title: fm.title || stem, app, site, ...(fm.ask.length ? { ask: fm.ask } : {}), steps, anchors, ...(job ? { job } : {}), ...(open ? { open } : {}),
    ...(video ? { video, ...(times.length ? { times } : {}) } : {}) }, problems]
}

const NATIVE = /\b(?:menu ?bar(?:'s)?(?: menu| icon| item)?|tray|notch|dynamic island|notification(?: center)?s?|dock(?: icon| menu)?|status item|system settings|(?:app|native|mac'?s?) menu)\b/i
export const nativeSteps = (t: Pick<Tour, "steps" | "app" | "site">) => (t.site.length || (t.app.length && !t.app.includes("vaultite")) ? []
  : t.steps.filter((s) => NATIVE.test(s.said) || s.tags.some((g) => NATIVE.test(JSON.stringify(g)))).map((s) => s.n))

export const stepLine = (s: Step, n: number) => `${n}. ${[s.text, s.wait ? `(wait: ${conditionText(s.wait)})` : "", s.do?.length ? `(do: ${s.do.map(doText).join("; ")})` : "",
  s.before ? `(before: ${JSON.stringify(s.before)})` : "", s.after ? `(after: ${JSON.stringify(s.after)})` : "", s.draw ? `(draw: ${JSON.stringify(s.draw.length === 1 ? s.draw[0] : s.draw)})` : ""].filter(Boolean).join(" ")}`
export function tourText(t: Tour, extra: Record<string, string> = {}) {
  const yaml = (v: unknown) => JSON.stringify(v)
  const plain = (v: string) => (/^[\w./@ -]+$/.test(v) && !/^\s|\s$|: /.test(v) ? v : yaml(v))
  const fm = ["---", ...Object.entries(extra).map(([k, v]) => `${k}: ${plain(v)}`), "type: tour", ...(t.job ? [`job: ${t.job}`] : []), ...(t.open ? [`open: ${plain(t.open)}`] : []), ...(t.app.length ? [`app: ${t.app.length === 1 ? t.app[0] : yaml(t.app)}`] : []), ...(t.site.length ? [`site: ${t.site.length === 1 ? t.site[0] : yaml(t.site)}`] : []), ...(t.ask?.length ? [`ask: ${yaml(t.ask)}`] : []),
    ...(t.video ? [`video: ${plain(t.video)}`, ...(t.times?.length ? [`times: ${yaml(t.times)}`] : [])] : [])]
  const anchors = Object.entries(t.anchors).filter(([, a]) => Object.keys(a).length)
  if (anchors.length) fm.push("anchors:", ...anchors.map(([k, a]) => `  ${yaml(k)}: ${yaml(a)}`))
  fm.push("---")
  return `${fm.join("\n")}\n${t.video ? `![[${t.video}]]\n\n` : ""}${t.steps.map((s, i) => stepLine(s, i + 1)).join("\n")}\n`
}

export type Context = { near?: (Seen & { id: string })[]; app?: string; site?: string; window?: Rect }
export function tourFromAnswer(text: string, title: string, ctx: Context = {}): Tour {
  const anchors: Tour["anchors"] = {}
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
  const parts = fixed.replace(/\s+/g, " ").trim().match(/[^.!?…]+(?:[.!?…]+|$)(?:\s*\[[^\]]*\])*/g) ?? []
  const groups: string[] = []
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (/\[\s*[a-z]+[\s\]]/i.test(p) || !groups.length) groups.push(p)
    else groups[groups.length - 1] += ` ${p}`
  }
  const steps = groups.map((g, i) => parseStep(i + 1, g))
  return { title, app: ctx.app && !ctx.site ? [ctx.app] : [], site: ctx.site ? [ctx.site] : [], steps, anchors }
}

export type Aim = { ok: true; at: Rect; shown: boolean; dir?: "up" | "down" | "left" | "right"; how: string } | { ok: false; why: string }
export type Fx = {
  aim: (a: Anchor) => Promise<Aim>
  show: (step: Step, at: (Aim | null)[]) => Promise<void>
  say: (text: string) => Promise<void>
  wait: (c: Condition, signal?: AbortSignal) => Promise<Watched>
  act: (d: Do, at: Aim | null) => Promise<{ ok: boolean; why?: string }>
  fallback: (step: Step, missing: string[], signal?: AbortSignal) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  follow?: (step: Step, at: (Aim | null)[]) => Promise<void> | void
}
export type Played = { n: number; how: "played" | "model" | "lost" | "stopped"; ms: number; waited?: Watched; why?: string; missing?: string[]; hidden?: string[] }
export type Result = { ended: "done" | "stopped" | "lost"; steps: Played[] }

export function anchorFor(t: Pick<Tour, "anchors" | "app" | "site">, s: Spot): Anchor | "lost" | null {
  if ("find" in s) return { ...(t.anchors[s.find] ?? {}), label: s.find }
  if ("ui" in s) return { label: s.ui, ui: s.ui, app: "vaultite" }
  if ("ax" in s) return "lost"
  return null
}

const COMING_MS = 5000
const INTO_VIEW_MS = 30_000
export function plan(step: Step, mode: Mode): { wait?: Condition; does: Do[] } {
  if (mode === "show") return { does: [] }
  const does = step.do ?? []
  if (mode === "do") {
    const clicks = step.wait?.any.length === 1 ? step.wait.any[0].filter((c) => c.kind === "click" && c.text) : []
    const rest = step.wait?.any.length === 1 ? step.wait.any[0].filter((c) => !(c.kind === "click" && c.text)) : null
    if (clicks.length && rest) {
      const left = rest.length ? { ...step.wait!, any: [rest], source: "" } : undefined
      if (left) left.source = conditionText(left)
      return { does: [...does, ...clicks.flatMap((c) => (c.kind === "click" && c.text ? [{ action: "click" as const, text: c.text }] : []))], ...(left ? { wait: left } : {}) }
    }
    return { does, ...(step.wait ? { wait: step.wait } : {}) }
  }
  if (!does.length) return { does: [], ...(step.wait ? { wait: step.wait } : {}) }
  const theirs = does.map((d) => (d.action === "click" ? `click ${JSON.stringify(d.text)}` : d.action === "type" ? `type${d.text ? ` ${JSON.stringify(d.text)}` : ""}` : "changed"))
  return { does: [], wait: step.wait ?? parseCondition(theirs.join(" and ")) }
}

export async function play(t: Tour, mode: Mode, fx: Fx, signal?: AbortSignal, from = 1): Promise<Result> {
  const out: Played[] = []
  for (const step of t.steps.filter((s) => s.n >= from)) {
    let unfollow = () => {}
    try {
      const t0 = Date.now()
      if (signal?.aborted) return { ended: "stopped", steps: out }
      const { wait, does } = plan(step, mode)
      const own = [...(step.do ?? []), ...does], tags = step.tags.length || !own.some((d) => d.text) ? step.tags : own.filter((d, i) => d.text && own.findIndex((x) => x.text === d.text) === i).map((d): Tag => ({ kind: "point", at: { find: d.text! }, offset: 0 }))
      const spots = tags.flatMap((g) => [g.at, ...(g.to ? [g.to] : [])])
      const missingIn = (a: (Aim | null)[]) => spots.flatMap((s, i) => (a[i] && !a[i]!.ok ? [labelOf(s)] : []))
      let aims = await aimAll(t, spots, fx), missing = missingIn(aims)
      for (let waited = 0; missing.length && waited < COMING_MS && !signal?.aborted; waited += 500) {
        await fx.sleep(500)
        aims = await aimAll(t, spots, fx)
        missing = missingIn(aims)
      }
      let how: Played["how"] = "played"
      if (missing.length) {
        if (signal?.aborted) return { ended: "stopped", steps: out }
        const none = !out.length && aims.every((a) => !a?.ok)
        const healed = !none && await fx.fallback(step, missing, signal).catch(() => false)
        if (signal?.aborted) return { ended: "stopped", steps: [...out, { n: step.n, how: "stopped", ms: Date.now() - t0 }] }
        if (!healed) { out.push({ n: step.n, how: "lost", ms: Date.now() - t0, why: `not found: ${missing.join(", ")}`, missing }); return { ended: "lost", steps: out } }
        how = "model"
      } else {
        const hidden = aims.find((a): a is Extract<Aim, { ok: true }> => !!a?.ok && !a.shown)
        if (hidden) {
          const away = spots.flatMap((s, i) => { const a = aims[i]; return a?.ok && !a.shown ? [labelOf(s)] : [] })
          const got = await intoView(t, spots, hidden.dir ?? "down", mode, fx, signal)
          if (!got) { out.push({ n: step.n, how: signal?.aborted ? "stopped" : "lost", ms: Date.now() - t0, why: "it didn't come into view", hidden: away }); return { ended: signal?.aborted ? "stopped" : "lost", steps: out } }
          aims.splice(0, aims.length, ...got)
        }
        await fx.show({ ...step, tags }, pairUp(tags, aims))
        unfollow = following(t, { ...step, tags }, spots, aims, fx, signal)
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

export function lostLine(title: string, r: Result): string {
  const last = r.steps.at(-1)
  if (!last || last.how !== "lost") return ""
  if (!last.missing?.length) return `"${title}" stopped at step ${last.n}: ${last.why ?? "it couldn't go on"}.`
  const what = `${last.missing.map((m) => JSON.stringify(m)).join(" or ")} ${last.missing.length > 1 ? "aren't" : "isn't"} on your screen`
  return r.steps.length === 1 ? `I can't show "${title}" here: ${what}.` : `${what} now, so "${title}" stops here.`
}

export const FLIP_MS = 6000
export const readMs = (said: string) => Math.min(7000, 1200 + said.length * 50)
const FOLLOW_MS = 700, MOVED = 6
const moved = (a: Aim | null, b: Aim | null) => {
  if (!a || !b) return false
  if (a.ok !== b.ok) return true
  if (!a.ok || !b.ok) return false
  return a.shown !== b.shown || (["x", "y", "width", "height"] as const).some((k) => Math.abs(a.at[k] - b.at[k]) > MOVED)
}
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
    return a ? fx.aim(a).catch((e) => ({ ok: false as const, why: messageOf(e) })) : null
  }))
}
function pairUp(tags: Tag[], aims: (Aim | null)[]) {
  const out: (Aim | null)[] = []
  let i = 0
  for (const g of tags) { out.push(aims[i++] ?? null); if (g.to) out.push(aims[i++] ?? null) }
  return out
}
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
