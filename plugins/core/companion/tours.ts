// Tours, anchors and waits on the server (companion tour, tour-save, anchor, wait) over a screen plugin.ts lends:
// Vaultite's window, or the app an ask was over through the Mac's helper. The rules are tour.ts', anchor.ts', condition.ts'.
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { joinPath, Kind, parseText, safeName } from "../../../core/vault.ts"
import { type Anchor, anchorOf, anchorText, keepAnchor, refind, type Seen, type Where } from "./anchor.ts"
import { type Condition, conditionText, type Input, parseCondition, watch } from "./condition.ts"
import { playedThrough, promoted, skillName } from "./teach.ts"
import { noteText, writeNote } from "./teachops.ts"
import { type Aim, type Do, type Fx, type Mode, MODES, parseTour, play, type Result, type Step, type Tour, tourFromAnswer, tourText } from "./tour.ts"
import type { Condition as Check, Rect } from "./uimodel.ts"

/** Where a tour plays: what shows there now and what it can do there. */
export type Screen = {
  /** What it is (Vaultite's window, or an app and its site) and its things now. */
  things: () => Promise<{ where: Where; things: Seen[] } | null>
  /** A ui model check, once (`before`: a snapshot to compare with, for changed). */
  holds: (c: Check, before?: string) => Promise<boolean>
  snapshot: () => Promise<string>
  /** Say a step's words with its marks at the places found. */
  show: (said: string, marks: { kind: string; at: Seen | null; to?: Seen | null; label?: string; n?: number; dir?: string }[]) => Promise<void>
  /** Draw a shown step's marks again where their things are now, unsaid (null: off screen); none: they stay put. */
  follow?: (marks: Parameters<Screen["show"]>[1]) => Promise<void>
  say: (text: string) => Promise<void>
  act: (d: Do, at: Seen | null) => Promise<{ ok: boolean; why?: string }>
  /** Ask the model to play a step whose targets weren't found: whether it did. */
  fallback: (tour: Tour, step: Step, missing: string[]) => Promise<boolean>
  /** Start or stop hearing what the user does there (clicks, that a key was typed). */
  inputs: (on: boolean) => void
}

/** What the user did lately, as the screens told it (clicks, typing; never which keys), and an Esc there. */
const heard: Input[] = []
const KEEP_MS = 10 * 60_000
let escaped = 0
/** `ms` gone by, or sooner if `signal` stops it. */
const rest = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); signal.addEventListener("abort", () => { clearTimeout(t); ok() }, { once: true }) })
/** Kept anchors (k1, k2: what the companion pointed at), by agent. */
type Kept = { id: string; anchor: Anchor; t: number }

export function toursOf(plugin: Plugin, o: {
  /** The screen agent `name` is on now (its last ask's), or null. */
  screen: (name: string) => Screen | null
  /** The agent the call is for. */
  who: (p: Record<string, unknown>) => string
}) {
  // (tours beside guides: type: tour notes in Guides/, read whole when played)
  plugin.kind(new Kind({
    type: "tour", collection: "tours", folder: "Guides", label: "Tours",
    parse: (fm, body, stem) => { const [t, problems] = parseTour(fm, body, stem); return [{ title: t.title, app: t.app, site: t.site, steps: t.steps.length, ...(fm.anchors ? { anchors: fm.anchors } : {}), body }, problems] },
    render: (t) => [{ app: (t.app as string[] | undefined)?.length ? t.app : null, site: (t.site as string[] | undefined)?.length ? t.site : null }, String(t.body ?? "")],
    filename: (t, at) => joinPath(at.folder, safeName(String(t.title || "Tour"))),
  }))
  const playing = new Map<string, { title: string; mode: Mode; ctl: AbortController; done: Promise<Result>; step: number }>()
  const kept = new Map<string, Kept[]>()

  /** An input from a window or a helper: `{ t: "input", kind: "click" | "type" | "esc", label?, role?, x?, y? }`. */
  function input(m: Record<string, unknown>) {
    const kind = m.kind === "click" || m.kind === "type" ? m.kind : m.kind === "esc" ? "esc" : null
    if (!kind) return
    if (kind === "esc") { escaped = Date.now(); for (const p of playing.values()) p.ctl.abort(); return }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined)
    heard.push({ kind, t: Date.now(), ...(typeof m.label === "string" ? { label: m.label.slice(0, 200) } : {}), ...(typeof m.role === "string" ? { role: m.role.slice(0, 40) } : {}),
      ...(num(m.x) !== undefined && num(m.y) !== undefined ? { x: num(m.x), y: num(m.y) } : {}) })
    while (heard.length && heard[0].t < Date.now() - KEEP_MS) heard.shift()
    if (heard.length > 500) heard.splice(0, heard.length - 500)
  }
  /** A new ask of theirs, or Esc: whatever plays for that agent stops (they moved on). */
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

  /** Play `tour` for agent `name` on its screen in `mode`, from step `from`; a draft (`file`) that plays through is
   *  promoted (teach.ts). */
  function start(name: string, s: Screen, tour: Tour, mode: Mode, from = 1, file?: { path: string; ctx: OpCtx }) {
    playing.get(name)?.ctl.abort()
    const ctl = new AbortController(), began = Date.now()
    const found = new Map<Rect, Seen>()
    /** A step's tags as marks at the things found for them (an arrow's end after its start). */
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
        await s.show(step.said, marksOf(step, at))
      },
      ...(s.follow ? { follow: (step: Step, at: (Aim | null)[]) => s.follow!(marksOf(step, at)) } : {}),
      say: (text) => s.say(text),
      wait: (c, signal) => waitOn(s, c, { signal }),
      act: (d, at) => s.act(d, at?.ok ? found.get(at.at) ?? null : null),
      fallback: (step, missing) => s.fallback(tour, step, missing),
      sleep: (ms) => rest(ms, ctl.signal),
    }
    const done = play(tour, mode, fx, ctl.signal, from).then((r) => {
      console.log(`companion tour "${tour.title}" (${mode}): ${r.ended} after ${r.steps.length} steps in ${Math.round((Date.now() - began) / 1000)} s${r.steps.some((x) => x.how === "model") ? `, the model played ${r.steps.filter((x) => x.how === "model").map((x) => x.n).join(", ")}` : ""}`)
      if (file && from === 1 && playedThrough(r)) void promote(file.ctx, file.path).catch((e) => console.log(`companion tour: ${file.path} played through but stays a draft: ${(e as Error).message}`))
      return r
    }).finally(() => { if (playing.get(name)?.ctl === ctl) playing.delete(name) })
    playing.set(name, { title: tour.title, mode, ctl, done, step: from })
    return done
  }

  async function promote(ctx: OpCtx, path: string) {
    const next = promoted(await noteText(plugin, ctx, path), Date.now())
    if (next) { await writeNote(plugin, ctx, path, next); console.log(`companion tour: ${path} played through, no longer a draft`) }
  }
  /** A tour by its path, its title or its name: a type: tour note in Guides/, or any note whose steps are one (a skill's
   *  SKILL.md a lesson made). Its path too, for a draft to be promoted. */
  const tourAt = async (path: string, ctx: OpCtx): Promise<{ tour: Tour; path: string }> => {
    const all = plugin.vault.shared("tours") as unknown as readonly { id: string; title: string; body: string; app?: string[]; site?: string[]; anchors?: unknown }[]
    const want = path.replace(/\.md$/i, "").toLowerCase(), t = all.find((x) => x.id.replace(/\.md$/i, "").toLowerCase() === want)
      ?? all.find((x) => x.title.toLowerCase() === want.replace(/^.*\//, "")) ?? all.find((x) => x.id.toLowerCase().endsWith(`/${want.replace(/^.*\//, "")}`))
    let fm: Record<string, unknown>, body: string, at: string, title: string
    if (t) [fm, body, at, title] = [t as unknown as Record<string, unknown>, t.body, t.id, t.title]
    else {
      // (a skill by its folder, or by its title: "run Share the page")
      const tries = /\.md$/i.test(path) ? [path] : /(^|\/)\.agents\/skills\/[^/]+$/.test(path) ? [`${path}/SKILL.md`] : [`${path}.md`, `.agents/skills/${skillName(path)}/SKILL.md`]
      let file = tries[0], text = ""
      for (const f of tries) if ((text = await noteText(plugin, ctx, f))) { file = f; break }
      if (!text) throw new OpError(`no tour ${path}${all.length ? ` (tours: ${all.slice(0, 12).map((x) => x.title).join(", ")})` : " (a tour is a type: tour note in Guides/)"}`, 404)
      ;[fm, body] = parseText(text)
      ;[at, title] = [file, typeof fm.name === "string" ? fm.name : file.replace(/^.*\//, "").replace(/\.md$/i, "")]
    }
    const [tour, problems] = parseTour(fm, body, title)
    if (problems.length) throw new OpError(`${at}: ${problems.join("; ")}`)
    return { tour: /^(?:.*\/)?SKILL\.md$/i.test(at) ? { ...tour, title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() || tour.title } : tour, path: at }
  }
  const resultText = (t: string, r: Result) => {
    const lines = r.steps.map((s) => `  ${s.n}. ${s.how}${s.waited ? ` (waited ${Math.round(s.waited.ms / 100) / 10} s: ${s.waited.why}${s.waited.by ? `, ${s.waited.by}` : ""})` : ""}${s.why ? `: ${s.why}` : ""}`)
    return `${t}: ${r.ended === "done" ? "played to the end" : r.ended === "stopped" ? "stopped" : "stopped at a step it couldn't play"}.\n${lines.join("\n")}`
  }
  const screenFor = (name: string) => {
    const s = o.screen(name)
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
      const { tour, path } = await tourAt(p.path.trim(), ctx), mode = (MODES as readonly string[]).includes(String(p.mode)) ? p.mode as Mode : "guide"
      const done = start(name, screenFor(name), tour, mode, Number(p.from) || 1, { path, ctx })
      if (!p.wait) return { title: tour.title, mode, steps: tour.steps.length }
      return { title: tour.title, mode, steps: tour.steps.length, result: await done }
    },
    text: (r) => r.result ? resultText(r.title, r.result) : r.title ? `Playing "${r.title}" (${r.mode}, ${r.steps} steps).` : r.playing ? `Playing "${r.playing.title}" (${r.playing.mode}), at step ${r.playing.step}.`
      : "stopped" in r ? (r.stopped ? `Stopped "${r.stopped}".` : "No tour was playing.") : "No tour is playing.",
  })

  plugin.op({
    id: "companion.tour-save",
    cli: "companion tour-save",
    summary: "Save a walkthrough as a tour (Guides/<title>.md): your last answer on screen, its pointing sentences its steps, or the steps given.",
    help: `"Save that as a tour": with no text, your last answer is saved, its ids (a3) as the words of what they were. Give
text to write it yourself, a step a numbered line with its tags, (wait: click) and (do: click "Send").

  vau companion tour-save "Start a chat"
  vau companion tour-save "Start a chat" --text '1. Start one here [ring "New chat"]. (wait: click)'`,
    kind: "write",
    params: {
      title: { type: "string", required: true, description: "its name (its file's)" },
      text: { type: "string", description: "its steps (else your last answer)" },
      app: { type: "string", description: "the app it's for (a bundle id; vaultite for the app itself)" },
      site: { type: "string", description: "the site it's for (a host)" },
      as: { type: "string", description: "the agent (another than the companion)" },
    },
    args: ["title"],
    run: async (p, ctx) => {
      const name = o.who(p), title = String(p.title).trim().replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").slice(0, 80).trim()
      if (!title) throw new OpError("give the tour a title")
      const last = lastAnswer.get(name)
      let tour: Tour
      if (typeof p.text === "string" && p.text.trim()) {
        const [t, problems] = parseTour({}, p.text, title)
        if (problems.length) throw new OpError(problems.join("; "))
        tour = t
      } else if (last) tour = tourFromAnswer(last.text, title, last.ctx)
      else throw new OpError("nothing to save: you haven't answered on screen lately; give its steps (text)", 409)
      const app = typeof p.app === "string" && p.app.trim() ? [p.app.trim()] : null, site = typeof p.site === "string" && p.site.trim() ? [p.site.trim().toLowerCase()] : null
      tour = { ...tour, ...(app ? { app } : {}), ...(site ? { site } : {}), ...(!app && !site && !tour.app.length && !tour.site.length && last ? { app: last.ctx.app ? [last.ctx.app] : [], site: last.ctx.site ? [last.ctx.site] : [] } : {}) }
      if (!tour.steps.length) throw new OpError("nothing to save: no steps")
      const path = `Guides/${title}.md`
      await ctx.api("PUT", "file", { path, text: tourText(tour) })
      return { path, steps: tour.steps.length }
    },
    text: (r) => `Saved ${r.path} (${r.steps} steps): play it with companion tour "${r.path}".`,
  })

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
      try { c = parseCondition(String(p.condition)) } catch (e) { throw new OpError((e as Error).message) }
      const r = await waitOn(screenFor(o.who(p)), c)
      return { condition: conditionText(c), ...r }
    },
    text: (r) => (r.met ? `Met after ${Math.round(r.ms / 100) / 10} s: ${r.by}.` : `Not met (${r.why}) after ${Math.round(r.ms / 100) / 10} s: ${r.condition}.`),
  })

  /** Each agent's last answer on screen (its words with their tags) and where it was: what "save that as a tour" saves. */
  const lastAnswer = new Map<string, { text: string; ctx: Parameters<typeof tourFromAnswer>[2] & {} }>()
  return {
    input, interrupt,
    /** An answer on screen ended: kept for tour-save. */
    answered: (name: string, text: string, ctx: Parameters<typeof tourFromAnswer>[2] & {}) => { if (/\[\s*[a-z]+[\s\]]/i.test(text)) lastAnswer.set(name, { text, ctx }) },
    playing: (name: string) => playing.get(name) ?? null,
    escapedAt: () => escaped,
  }
}
