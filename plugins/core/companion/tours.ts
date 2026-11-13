import fs from "node:fs"
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { joinPath, Kind, parseText, safeName } from "../../../core/vault.ts"
import { type Anchor, anchorOf, anchorText, keepAnchor, refind, type Seen, type Where } from "../../../core/desktop/anchor.ts"
import { type Condition, conditionText, type Input, parseCondition, watch } from "./condition.ts"
import { playedThrough, promoted, skillName } from "./lesson.ts"
import { noteText, writeNote } from "./teachops.ts"
import { z } from "zod"
import { messageOf } from "./errors.ts"
import type { Message } from "./rooms.ts"
import { type Aim, type Do, type DrawMark, type Frontmatter, type Fx, lostLine, type Mode, MODES, parseTour, play, type Result, type Step, type Tour, tourAsked } from "./tour.ts"
import type { Condition as Check, Rect } from "../../../core/desktop/uimodel.ts"
import { type Answer, tourSaving } from "./toursave.ts"

export type Screen = {
  things: () => Promise<{ where: Where; things: Seen[] } | null>
  holds: (c: Check, before?: string) => Promise<boolean>
  snapshot: () => Promise<string>
  show: (said: string, marks: { kind: string; at: Seen | null; to?: Seen | null; label?: string; n?: number; dir?: string }[], before?: string, draw?: DrawMark[]) => Promise<void>
  follow?: (marks: Parameters<Screen["show"]>[1]) => Promise<void>
  say: (text: string) => Promise<void>
  act: (d: Do, at: Seen | null) => Promise<{ ok: boolean; why?: string }>
  fallback: (tour: Tour, step: Step, missing: string[], signal?: AbortSignal) => Promise<boolean>
  inputs: (on: boolean) => void
}

const heard: Input[] = []
const KEEP_MS = 10 * 60_000
let escaped = 0
const rest = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => {
  if (signal.aborted) return ok()
  const stop = () => { clearTimeout(t); ok() }, t = setTimeout(() => { signal.removeEventListener("abort", stop); ok() }, ms)
  signal.addEventListener("abort", stop, { once: true })
})
type Kept = { id: string; anchor: Anchor; t: number }
const Heard = z.object({ kind: z.enum(["click", "type", "esc"]), label: z.string().optional().catch(undefined), role: z.string().optional().catch(undefined),
  x: z.number().optional().catch(undefined), y: z.number().optional().catch(undefined) })
const Row = z.looseObject({ id: z.string(), title: z.string(), body: z.string(), job: z.string().optional(), ask: z.array(z.string()).optional() })
type Row = z.infer<typeof Row>
const some = (v: string | string[] | undefined) => ((Array.isArray(v) || typeof v === "string") && v.length ? v : null)

export function toursOf(plugin: Plugin, o: {
  screen: (name: string, tour?: Tour) => Screen | null
  who: (p: { as?: unknown }) => string
}) {
  plugin.kind(new Kind({
    type: "tour", collection: "tours", folder: "Guides", label: "Tours",
    parse: (fm, body, stem) => { const [t, problems] = parseTour(fm, body, stem); return [{ title: t.title, app: t.app, site: t.site, ...(t.ask?.length ? { ask: t.ask } : {}), steps: t.steps.length, ...(fm.anchors ? { anchors: fm.anchors } : {}), ...(t.job ? { job: t.job } : {}),
      ...(t.video ? { video: t.video, ...(t.times ? { times: t.times } : {}) } : {}), body }, problems] },
    render: (t) => [{ ...(t.job ? { job: t.job } : {}), ...(t.video ? { video: t.video, ...(t.times ? { times: t.times } : {}) } : {}), app: some(t.app), site: some(t.site),
      ask: some(t.ask) }, String(t.body ?? "")],
    filename: (t, at) => joinPath(at.folder, safeName(String(t.title || "Tour"))),
  }))
  const playing = new Map<string, { title: string; mode: Mode; ctl: AbortController; done: Promise<Result>; step: number }>()
  const kept = new Map<string, Kept[]>()
  const lastAnswer = new Map<string, Answer>()

  function input(m: Message) {
    const h = Heard.safeParse(m).data
    if (!h) return
    if (h.kind === "esc") { escaped = Date.now(); for (const p of playing.values()) p.ctl.abort(); return }
    heard.push({ kind: h.kind, t: Date.now(), ...(h.label !== undefined ? { label: h.label.slice(0, 200) } : {}), ...(h.role !== undefined ? { role: h.role.slice(0, 40) } : {}),
      ...(h.x !== undefined && h.y !== undefined ? { x: Math.round(h.x), y: Math.round(h.y) } : {}) })
    while (heard.length && heard[0].t < Date.now() - KEEP_MS) heard.shift()
    if (heard.length > 500) heard.splice(0, heard.length - 500)
  }
  const interrupt = (name: string) => { playing.get(name)?.ctl.abort() }

  async function aim(s: Screen, a: Anchor): Promise<{ aim: Aim; seen: Seen | null }> {
    const now = await s.things()
    if (!now) return { aim: { ok: false, why: "nothing on screen can be read here (no window, or no Mac helper for another app)" }, seen: null }
    const r = refind(a, now.things, now.where)
    if (!r.ok) return { aim: { ok: false, why: r.text }, seen: null }
    return { aim: { ok: true, at: r.seen.frame, shown: r.shown, ...(r.dir ? { dir: r.dir } : {}), how: r.how }, seen: r.seen }
  }

  function envOf(s: Screen) {
    return {
      now: () => Date.now(), sleep: (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)),
      holds: (c: Check, before?: string) => s.holds(c, before), snapshot: () => s.snapshot(),
      inputs: (since: number) => heard.filter((i) => i.t >= since),
      where: async (text: string): Promise<Rect | null> => { const x = await aim(s, { label: text }); return x.aim.ok ? x.aim.at : null },
    }
  }
  async function waitOn(s: Screen, c: Condition, o2: { signal?: AbortSignal; timeout?: number } = {}) {
    const ins = c.any.flat().some((x) => x.kind === "click" || x.kind === "type" || x.kind === "idle")
    if (ins) s.inputs(true)
    try { return await watch(c, envOf(s), o2) } finally { if (ins) s.inputs(false) }
  }

  function start(name: string, s: Screen, tour: Tour, mode: Mode, from = 1, file?: { path: string; ctx: OpCtx }, o2: { quiet?: boolean } = {}) {
    playing.get(name)?.ctl.abort()
    const ctl = new AbortController(), began = Date.now()
    const found = new Map<Rect, Seen>()
    const marksOf = (step: Step, at: (Aim | null)[]) => {
      const seenOf = (x: Aim | null) => (x?.ok ? found.get(x.at) ?? null : null)
      let i = 0
      return step.tags.map((g) => ({ kind: g.kind, at: seenOf(at[i++] ?? null), ...(g.to ? { to: seenOf(at[i++] ?? null) } : {}), ...(g.label ? { label: g.label } : {}), ...(g.n !== undefined ? { n: g.n } : {}), ...(g.dir ? { dir: g.dir } : {}) }))
    }
    const fx: Fx = {
      aim: async (a) => { const x = await aim(s, a); if (x.aim.ok && x.seen) found.set(x.aim.at, x.seen); return x.aim },
      show: async (step, at) => {
        const p = playing.get(name)
        if (p) p.step = step.n
        await s.show(step.said, marksOf(step, at), step.before, step.draw)
      },
      ...(s.follow ? { follow: (step: Step, at: (Aim | null)[]) => s.follow!(marksOf(step, at)) } : {}),
      say: (text) => s.say(text),
      wait: (c, signal) => waitOn(s, c, { signal }),
      act: (d, at) => s.act(d, at?.ok ? found.get(at.at) ?? null : null),
      fallback: (step, missing, signal) => s.fallback(tour, step, missing, signal),
      sleep: (ms) => rest(ms, ctl.signal),
    }
    const done = play(tour, mode, fx, ctl.signal, from).then((r) => {
      console.log(`companion tour "${tour.title}" (${mode}): ${r.ended} after ${r.steps.length} steps in ${Math.round((Date.now() - began) / 1000)} s${r.steps.some((x) => x.how === "model") ? `, the model played ${r.steps.filter((x) => x.how === "model").map((x) => x.n).join(", ")}` : ""}`)
      const lost = o2.quiet ? "" : lostLine(tour.title, r)
      if (lost) void s.say(lost).catch(() => {})
      if (file && from === 1 && playedThrough(r)) void promote(file.ctx, file.path).catch((e) => console.log(`companion tour: ${file.path} played through but stays a draft: ${messageOf(e)}`))
      return r
    }).finally(() => { if (playing.get(name)?.ctl === ctl) playing.delete(name) })
    playing.set(name, { title: tour.title, mode, ctl, done, step: from })
    return done
  }

  async function promote(ctx: OpCtx, path: string) {
    const next = promoted(await noteText(plugin, ctx, path), Date.now())
    if (next) { await writeNote(plugin, ctx, path, next); console.log(`companion tour: ${path} played through, no longer a draft`) }
  }
  const rows = (): Row[] => plugin.vault.shared("tours").flatMap((t) => Row.safeParse(t).data ?? [])
  const tourAt = async (path: string, ctx: OpCtx): Promise<{ tour: Tour; path: string }> => {
    const all = rows()
    const want = path.replace(/\.md$/i, "").toLowerCase(), t = all.find((x) => x.id.replace(/\.md$/i, "").toLowerCase() === want)
      ?? all.find((x) => x.title.toLowerCase() === want.replace(/^.*\//, "")) ?? all.find((x) => x.id.toLowerCase().endsWith(`/${want.replace(/^.*\//, "")}`))
    let fm: Frontmatter, body: string, at: string, title: string
    if (t) [fm, body, at, title] = [t, t.body, t.id, t.title]
    else {
      const tries = /\.md$/i.test(path) ? [path] : /(^|\/)\.agents\/skills\/[^/]+$/.test(path) ? [`${path}/SKILL.md`] : [`${path}.md`, `.agents/skills/${skillName(path)}/SKILL.md`]
      let file = tries[0], text = ""
      for (const f of tries) if ((text = await noteText(plugin, ctx, f))) { file = f; break }
      if (!text) throw new OpError(`no tour ${path}${all.length ? ` (tours: ${all.slice(0, 12).map((x) => x.title).join(", ")})` : " (a tour is a type: tour note in Guides/)"}`, 404)
      const [front, b] = parseText(text)
      ;[fm, body, at, title] = [front, b, file, typeof front.name === "string" ? front.name : file.replace(/^.*\//, "").replace(/\.md$/i, "")]
    }
    const [tour, problems] = parseTour(fm, body, title)
    if (problems.length) throw new OpError(`${at}: ${problems.join("; ")}`)
    return { tour: /^(?:.*\/)?SKILL\.md$/i.test(at) ? { ...tour, title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() || tour.title } : tour, path: at }
  }
  const parsed = (t: Row) => parseTour(t, t.body, t.title)
  const proofOf = (id: string) => {
    const when = (x: Row) => fs.statSync(plugin.vault.abs(x.id), { throwIfNoEntry: false })?.mtimeMs ?? 0
    const t = rows().filter((x) => x.job === id).sort((a, b) => when(b) - when(a))[0]
    if (!t) return null
    const [tour, problems] = parsed(t)
    return { path: /\.md$/i.test(t.id) ? t.id : `${t.id}.md`, tour, problems }
  }
  const resultText = (t: string, r: Result) => {
    const lines = r.steps.map((s) => `  ${s.n}. ${s.how}${s.waited ? ` (waited ${Math.round(s.waited.ms / 100) / 10} s: ${s.waited.why}${s.waited.by ? `, ${s.waited.by}` : ""})` : ""}${s.why ? `: ${s.why}` : ""}`)
    const told = r.ended === "lost" ? lostLine(t, r) : ""
    return `${t}: ${r.ended === "done" ? "played to the end" : r.ended === "stopped" ? "stopped" : "stopped at a step it couldn't play"}.\n${lines.join("\n")}${told ? `\nThey were told: ${told}` : ""}`
  }
  const screenFor = (name: string, tour?: Tour) => {
    const s = o.screen(name, tour)
    if (!s) throw new OpError("no screen to play on: the user's window isn't open, or (another app) the Mac's helper isn't connected", 409)
    return s
  }

  plugin.op({
    id: "companion.tour",
    cli: "companion tour",
    summary: "Play a tour (a type: tour note in Guides/): each step's words and marks where its targets are now, without the model.",
    help: `Modes: show (straight through), guide (waits for the user at each step's wait), do (does the do: steps, and the
clicks guide would wait for). A target not found goes to the companion's model for that step. A new ask or Esc stops it.

  vau companion tour "Guides/Start a chat"
  vau companion tour "Guides/Start a chat" --mode show --wait
  vau companion tour --stop

Its format: vau docs tours.`,
    kind: "write",
    lock: false,
    params: {
      path: { type: "string", description: "the tour's note" },
      mode: { type: "string", enum: [...MODES], description: "show, guide (the default) or do" },
      from: { type: "integer", description: "the step to start at (1)" },
      wait: { type: "boolean", description: "answer once it ends, with how each step went" },
      stop: { type: "boolean", description: "stop the tour playing" },
      as: { type: "string", description: "the agent (another than the companion)" },
    },
    args: ["path"],
    run: async (p, ctx) => {
      const name = o.who(p)
      if (p.stop) { const x = playing.get(name); x?.ctl.abort(); return { stopped: x?.title ?? null } }
      if (typeof p.path !== "string" || !p.path.trim()) {
        const x = playing.get(name)
        return { playing: x ? { title: x.title, mode: x.mode, step: x.step } : null }
      }
      const { tour, path } = await tourAt(p.path.trim(), ctx), mode = MODES.find((m) => m === p.mode) ?? "guide"
      const done = start(name, screenFor(name, tour), tour, mode, Number(p.from) || 1, { path, ctx })
      if (!p.wait) return { title: tour.title, mode, steps: tour.steps.length }
      return { title: tour.title, mode, steps: tour.steps.length, result: await done }
    },
    text: (r) => r.result ? resultText(r.title, r.result) : r.title ? `Playing "${r.title}" (${r.mode}, ${r.steps} steps).` : r.playing ? `Playing "${r.playing.title}" (${r.playing.mode}), at step ${r.playing.step}.`
      : "stopped" in r ? (r.stopped ? `Stopped "${r.stopped}".` : "No tour was playing.") : "No tour is playing.",
  })

  tourSaving(plugin, { who: o.who, lastAnswer })

  plugin.op({
    id: "companion.anchor",
    cli: "companion anchor",
    summary: "Find a thing on the user's screen again by what it is (an anchor), or keep one: an id of your last ask (a3) as a lasting k1.",
    help: `An anchor is a thing's description (its app, role, words, what it's in, where in its window), found again after a
scroll, a move or a relabel; gone, it says so. Kept ones (k1, k2: what you pointed at) last the session.

  vau companion anchor --keep a3
  vau companion anchor k1
  vau companion anchor --label "Share" --role button --inside Toolbar`,
    kind: "read",
    params: {
      id: { type: "string", description: "a kept anchor (k1)" },
      keep: { type: "string", description: "an element of your last ask (a3) to keep as an anchor" },
      label: { type: "string", description: "its words" },
      role: { type: "string", description: "its role (button, row, tab...)" },
      inside: { type: "string", description: "the words of what it's in" },
      as: { type: "string", description: "the agent (another than the companion)" },
    },
    args: ["id"],
    run: async (p) => {
      const name = o.who(p), s = screenFor(name), list = kept.get(name) ?? []
      let a: Anchor | undefined
      if (typeof p.keep === "string" && p.keep) {
        const now = await s.things(), el = now?.things.find((x) => x.id === p.keep)
        if (!el || !now) throw new OpError(`no element ${p.keep} near their pointer: the ids are your last ask's`, 404)
        a = anchorOf(el, now.where)
        const next = keepAnchor(list, a, Date.now())
        kept.set(name, next)
        return { id: next.find((x) => JSON.stringify(x.anchor) === JSON.stringify(a))!.id, anchor: a, found: (await aim(s, a)).aim }
      }
      if (typeof p.id === "string" && p.id) a = list.find((x) => x.id === p.id)?.anchor
      else if (typeof p.label === "string" && p.label) a = { label: p.label, ...(p.role ? { role: String(p.role) } : {}), ...(p.inside ? { inside: [String(p.inside)] } : {}) }
      if (!a) throw new OpError(p.id ? `no anchor ${p.id} (kept: ${list.map((x) => x.id).join(", ") || "none"})` : "give a kept anchor (k1), --keep a3, or --label", 404)
      return { anchor: a, found: (await aim(s, a)).aim }
    },
    text: (r) => `${r.id ? `Kept as ${r.id}: ` : ""}${anchorText(r.anchor)}: ${r.found.ok ? `${r.found.shown ? "on screen" : `off screen (scroll ${r.found.dir})`} at ${r.found.at.x},${r.found.at.y} ${r.found.at.width}×${r.found.at.height} (${r.found.how})` : r.found.why}.`,
  })

  const CONDITION = { type: "string", required: true, description: `what to wait for or check: click "Share", shows "Saved", gone "Loading", expanded "Files", changed, idle 1s (and, or, within 10s)` } as const
  plugin.op({
    id: "companion.wait",
    cli: "companion wait",
    summary: "Wait until the user's screen meets a condition (click \"Share\", shows \"Saved\", type and idle 1s), or its time runs out.",
    help: `The condition language: vau docs tours. Five minutes at most unless within says.

  vau companion wait 'click "New chat"'
  vau companion wait 'gone "Loading" within 20s'`,
    kind: "read",
    lock: false,
    params: { condition: CONDITION, as: { type: "string", description: "the agent (another than the companion)" } },
    args: ["condition"],
    run: async (p) => {
      let c: Condition
      try { c = parseCondition(String(p.condition)) } catch (e) { throw new OpError(messageOf(e)) }
      const r = await waitOn(screenFor(o.who(p)), c)
      return { condition: conditionText(c), ...r }
    },
    text: (r) => (r.met ? `Met after ${Math.round(r.ms / 100) / 10} s: ${r.by}.` : `Not met (${r.why}) after ${Math.round(r.ms / 100) / 10} s: ${r.condition}.`),
  })

  return {
    input, interrupt,
    answered: (name: string, text: string, ctx: Answer["ctx"]) => { if (/\[\s*[a-z]+[\s\]]/i.test(text)) lastAnswer.set(name, { text, ctx }) },
    playing: (name: string) => playing.get(name) ?? null,
    proofOf,
    asked: (name: string, text: string, ended?: () => void) => {
      const row = tourAsked(rows(), text)
      if (!row) return null
      const [tour, problems] = parsed(row), s = problems.length ? null : o.screen(name, tour)
      if (problems.length || !s) { console.log(`companion tour "${row.title}": asked for, but ${problems.length ? problems.join("; ") : "there's no screen to play it on"}`); return null }
      void start(name, s, tour, "guide").catch((e) => console.log(`companion tour "${tour.title}": ${messageOf(e)}`)).finally(ended)
      return tour.title
    },
    askable: () => rows().filter((r) => r.ask?.length).map((r) => ({ path: /\.md$/i.test(r.id) ? r.id : `${r.id}.md`, ask: r.ask! })),
    show: (name: string, s: Screen, tour: Tour) => start(name, s, tour, "show", 1, undefined, { quiet: true }),
    escapedAt: () => escaped,
  }
}
