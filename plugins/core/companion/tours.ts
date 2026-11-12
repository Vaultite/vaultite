// Tours, anchors and waits on the server (companion tour, tour-save, anchor, wait) over a screen windows.ts lends:
// Vaultite's window, or the app an ask was over through the Mac's helper. The rules are tour.ts', core/desktop/anchor.ts', condition.ts'.
import fs from "node:fs"
import os from "node:os"
import nodePath from "node:path"
import { type Machine, MACHINE_CLIENT, type OpCtx, OpError, onTailnet, type Plugin, serverUrl } from "../../../core/plugins.ts"
import { joinPath, Kind, parseText, safeName } from "../../../core/vault.ts"
import { type Anchor, anchorOf, anchorText, keepAnchor, refind, type Seen, type Where } from "../../../core/desktop/anchor.ts"
import { type Condition, conditionText, type Input, parseCondition, watch } from "./condition.ts"
import { playedThrough, promoted, skillName } from "./lesson.ts"
import { noteText, writeNote } from "./teachops.ts"
import { type Aim, type Do, type Fx, lostLine, type Mode, MODES, nativeSteps, parseTour, play, type Result, type Step, type Tour, tourAsked, tourFromAnswer, tourText } from "./tour.ts"
import type { Condition as Check, Rect } from "../../../core/desktop/uimodel.ts"
import { fileTitle } from "../../../core/desktop/names.ts"
import { saveFiles } from "./vaultfiles.ts"
import { proofUrl, recordProof } from "./proofvideo.ts"

/** A path as given, "~/" its home's. */
const local = (p: string) => p.replace(/^~(?=\/)/, os.homedir())
/** Whether a proof may be recorded at `url`: an http address, never this server (the user's live app: a window of theirs
 *  would open on it), which throws saying so. */
function recordable(url: string) {
  let u: URL
  try { u = new URL(url) } catch { throw new OpError(`record: an address (http://127.0.0.1:<port>), not ${url}`) }
  if (!/^https?:$/.test(u.protocol)) throw new OpError(`record: an http address, not ${url}`)
  const here = ["127.0.0.1", "localhost", "[::1]", os.hostname().toLowerCase()].includes(u.hostname.toLowerCase())
  if (here && (u.port || (u.protocol === "https:" ? "443" : "80")) === String(process.env.PORT ?? "8793"))
    throw new OpError("record: that's the user's own app, where your change isn't yet: record on your own copy (your worktree's dev server, or a sandbox server: vau sandbox, then npm start on a free port)", 409)
}

/** Where a tour plays: what shows there now and what it can do there. */
export type Screen = {
  /** What it is (Vaultite's window, or an app and its site) and its things now. */
  things: () => Promise<{ where: Where; things: Seen[] } | null>
  /** A ui model check, once (`before`: a snapshot to compare with, for changed). */
  holds: (c: Check, before?: string) => Promise<boolean>
  snapshot: () => Promise<string>
  /** Say a step's words with its marks at the places found; `before`: a picture of its first target before a change,
   *  laid over it and flipped with how it is now. */
  show: (said: string, marks: { kind: string; at: Seen | null; to?: Seen | null; label?: string; n?: number; dir?: string }[], before?: string, draw?: Record<string, unknown>[]) => Promise<void>
  /** Draw a shown step's marks again where their things are now, unsaid (null: off screen); none: they stay put. */
  follow?: (marks: Parameters<Screen["show"]>[1]) => Promise<void>
  say: (text: string) => Promise<void>
  act: (d: Do, at: Seen | null) => Promise<{ ok: boolean; why?: string }>
  /** Ask the model to play a step whose targets weren't found: whether it did. */
  fallback: (tour: Tour, step: Step, missing: string[], signal?: AbortSignal) => Promise<boolean>
  /** Start or stop hearing what the user does there (clicks, that a key was typed). */
  inputs: (on: boolean) => void
}

/** What the user did lately, as the screens told it (clicks, typing; never which keys), and an Esc there. */
const heard: Input[] = []
const KEEP_MS = 10 * 60_000
let escaped = 0
/** `ms` gone by, or sooner if `signal` stops it. */
const rest = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => {
  if (signal.aborted) return ok()
  // (its listener goes with it: a long tour's rests would pile them up on one signal)
  const stop = () => { clearTimeout(t); ok() }, t = setTimeout(() => { signal.removeEventListener("abort", stop); ok() }, ms)
  signal.addEventListener("abort", stop, { once: true })
})
/** Kept anchors (k1, k2: what the companion pointed at), by agent. */
type Kept = { id: string; anchor: Anchor; t: number }

export function toursOf(plugin: Plugin, o: {
  /** The screen agent `name` is on now (its last ask's), or null. */
  screen: (name: string, tour?: Tour) => Screen | null
  /** The agent the call is for. */
  who: (p: Record<string, unknown>) => string
}) {
  // (tours beside guides: type: tour notes in Guides/, read whole when played)
  plugin.kind(new Kind({
    type: "tour", collection: "tours", folder: "Guides", label: "Tours",
    parse: (fm, body, stem) => { const [t, problems] = parseTour(fm, body, stem); return [{ title: t.title, app: t.app, site: t.site, ...(t.ask?.length ? { ask: t.ask } : {}), steps: t.steps.length, ...(fm.anchors ? { anchors: fm.anchors } : {}), ...(t.job ? { job: t.job } : {}),
      ...(t.video ? { video: t.video, ...(t.times ? { times: t.times } : {}) } : {}), body }, problems] },
    render: (t) => [{ ...(t.job ? { job: t.job } : {}), ...(t.video ? { video: t.video, ...(t.times ? { times: t.times } : {}) } : {}), app: (t.app as string[] | undefined)?.length ? t.app : null, site: (t.site as string[] | undefined)?.length ? t.site : null,
      ask: (t.ask as string[] | undefined)?.length ? t.ask : null }, String(t.body ?? "")],
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
   *  promoted (lesson.ts). */
  function start(name: string, s: Screen, tour: Tour, mode: Mode, from = 1, file?: { path: string; ctx: OpCtx }, o2: { quiet?: boolean } = {}) {
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
      // (a step it couldn't play: said once, plainly; a proof says it its own way)
      const lost = o2.quiet ? "" : lostLine(tour.title, r)
      if (lost) void s.say(lost).catch(() => {})
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
  type Row = { id: string; title: string; body: string; app?: string[]; site?: string[]; ask?: string[]; anchors?: unknown; job?: string; video?: string; times?: number[] }
  const rows = () => plugin.vault.shared("tours") as unknown as readonly Row[]
  /** A tour as its note reads, or its problems. */
  const parsed = (t: Row) => parseTour(t as unknown as Record<string, unknown>, t.body, t.title)
  /** Job `id`'s proof: the newest tour saying it's that job's, its path, and its problems (none: it plays). */
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
      const { tour, path } = await tourAt(p.path.trim(), ctx), mode = (MODES as readonly string[]).includes(String(p.mode)) ? p.mode as Mode : "guide"
      const done = start(name, screenFor(name, tour), tour, mode, Number(p.from) || 1, { path, ctx })
      if (!p.wait) return { title: tour.title, mode, steps: tour.steps.length }
      return { title: tour.title, mode, steps: tour.steps.length, result: await done }
    },
    text: (r) => r.result ? resultText(r.title, r.result) : r.title ? `Playing "${r.title}" (${r.mode}, ${r.steps} steps).` : r.playing ? `Playing "${r.playing.title}" (${r.playing.mode}), at step ${r.playing.step}.`
      : "stopped" in r ? (r.stopped ? `Stopped "${r.stopped}".` : "No tour was playing.") : "No tour is playing.",
  })

  plugin.op({
    id: "companion.tour-save",
    cli: "companion tour-save",
    summary: "Save a walkthrough as a tour (Guides/<title>.md): your last answer on screen, its pointing sentences its steps, or the steps given; a job's proof with its video.",
    help: `"Save that as a tour": with no text, your last answer is saved, its ids (a3) as the words of what they were. Give
text to write it yourself, a step a numbered line with its tags, (wait: click) and (do: click "Send").

A job's proof (--job) is a video by default: --record <address> plays its steps there, on your own copy of the change
(your worktree's dev server or a sandbox server, never the user's live app), in a headless Chrome with no sound, each
step's words as a caption and its marks drawn in, and keeps the mp4 beside it (Guides/Proofs/<title>/). A step's
(before: <png>) flips over its thing; (after: <png>) shows a still of the Mac's own UI (the menu bar, the notch), which
no browser shows, as a before and after slide. --video keeps an mp4 you recorded yourself instead.

  vau companion tour-save "Start a chat"
  vau companion tour-save "Start a chat" --text '1. Start one here [ring "New chat"]. (wait: click)'
  vau companion tour-save "the blue save button" --job j3k9x2a --record http://127.0.0.1:8811 --open Notes/Idea.md \\
    --text '1. Save is blue now [ring "Save"]. (before: /tmp/save-before.png)'`,
    kind: "write",
    // (a recording runs for a while: the vault isn't held meanwhile)
    lock: false,
    params: {
      title: { type: "string", required: true, description: "its name (its file's)" },
      text: { type: "string", description: "its steps (else your last answer)" },
      app: { type: "string", description: "the app it's for (a bundle id; vaultite for the app itself)" },
      site: { type: "string", description: "the site it's for (a host)" },
      job: { type: "string", description: "the job it's the proof of (its id, as its prompt gives it): saved in Guides/Proofs, it's what Show me plays once the job is ready" },
      open: { type: "string", description: "with job: where the change shows (a note's path or a page's address), which Show me opens before it plays, and a recording opens on its server" },
      record: { type: "string", description: "with job: the address of your own copy of the change (http://127.0.0.1:<port>: your dev server or a sandbox server) to record its video on, headless" },
      video: { type: "string", description: "with job: an mp4 of it you recorded yourself (a file here), kept as its video" },
      times: { type: "array", items: { type: "number" }, description: "with video: when each step starts in it (ms)" },
      home: { type: "string", env: "VAULTITE_HOME", description: "with job: the job's home server (filled in from VAULTITE_HOME in a job's terminal on another machine): it's recorded here and saved there" },
      as: { type: "string", description: "the agent (another than the companion)" },
    },
    args: ["title"],
    run: async (p, ctx) => {
      const name = o.who(p), title = fileTitle(String(p.title), 80)
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
      const open = typeof p.open === "string" ? p.open.trim() : ""
      tour = { ...tour, ...(app ? { app } : {}), ...(site ? { site } : {}), ...(open ? { open } : {}), ...(!app && !site && !tour.app.length && !tour.site.length && last ? { app: last.ctx.app ? [last.ctx.app] : [], site: last.ctx.site ? [last.ctx.site] : [] } : {}) }
      if (!tour.steps.length) throw new OpError("nothing to save: no steps")
      const job = typeof p.job === "string" ? p.job.trim() : ""
      if (job && !/^[\w-]{1,40}$/.test(job)) throw new OpError(`job: a job's id (j3k9x2a), not ${job}`)
      const record = typeof p.record === "string" ? p.record.trim() : "", given = typeof p.video === "string" ? local(p.video.trim()) : ""
      if ((record || given) && !job) throw new OpError("record and video are a job's proof: give its job too")
      if (record && given) throw new OpError("record or video, not both")
      if (record) recordable(record)
      if (given && (!/\.(mp4|m4v|mov|webm)$/i.test(given) || !fs.existsSync(given))) throw new OpError(`video: ${p.video} isn't a video here (an mp4, mov or webm file)`)
      const home = typeof p.home === "string" ? p.home.trim().replace(/\/+$/, "") : ""
      if (job && home && !(await isHere(home))) return await saveHome(home, { title, job, tour, record, given, open, text: typeof p.text === "string" ? p.text : "", app: p.app, site: p.site, times: p.times })
      // (a proof of another job by that title is left alone; this job's own is saved over, its pictures too)
      const theirs = (rel: string) => { try { return !new RegExp(`^job: ${job}$`, "m").test(fs.readFileSync(plugin.vault.abs(rel), "utf8")) } catch { return false } }
      let base = job ? `Guides/Proofs/${title}` : `Guides/${title}`
      for (let n = 2; job && theirs(`${base}.md`); n++) base = `Guides/Proofs/${title} ${n}`
      const path = `${base}.md`
      /** A file of this machine copied in beside the proof as `name` (one there before replaced): its vault path. */
      const keep = async (from: string, name: string) => {
        if (fs.existsSync(plugin.vault.abs(`${base}/${name}`))) await ctx.api("DELETE", `file?path=${encodeURIComponent(`${base}/${name}`)}`)
        return (await saveFiles(ctx, base, [{ from, name }]))[0]
      }
      // (a before or after picture outside the vault comes into it, beside its proof: it plays wherever the vault is)
      const picture = async (n: number, which: "before" | "after", src?: string) => {
        if (!src || !nodePath.isAbsolute(local(src))) return src
        const from = local(src), ext = nodePath.extname(from).toLowerCase()
        if (!/^\.(png|jpe?g|gif|webp|heic)$/.test(ext) || !fs.existsSync(from)) throw new OpError(`step ${n}: ${which}: ${src} isn't a picture here (png, jpg, gif, webp)`)
        return keep(from, `${which} ${n}${ext}`)
      }
      const steps = await Promise.all(tour.steps.map(async (st) => {
        const before = await picture(st.n, "before", st.before), after = await picture(st.n, "after", st.after)
        return { ...st, ...(before ? { before } : {}), ...(after ? { after } : {}) }
      }))
      // (its video: recorded now on their copy of the change, or the one given; its steps' times for the narration)
      let video: { path: string; times?: number[]; bytes: number; ms?: number } | null = null
      if (record || given) {
        const ext = record ? ".mp4" : nodePath.extname(given).toLowerCase(), file = `${safeName(title)}${ext}`
        if (record) {
          const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "vaultite-proof-out-")), out = nodePath.join(tmp, file)
          try {
            const r = await recording(record, open, title, steps, out)
            video = { path: await keep(out, file), times: r.times, bytes: r.bytes, ms: r.ms }
          } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
        } else {
          const times = Array.isArray(p.times) ? p.times.map(Number).filter((t: number) => Number.isFinite(t) && t >= 0) : []
          video = { path: await keep(given, file), bytes: fs.statSync(given).size, ...(times.length ? { times } : {}) }
        }
      }
      await ctx.api("PUT", "file", { path, text: tourText({ ...tour, steps, ...(job ? { job } : {}), ...(video ? { video: video.path, ...(video.times ? { times: video.times } : {}) } : {}) }) })
      // (a tour finds its things in Vaultite's window or another app's: the Mac's menu bar or notch it never finds)
      const native = nativeSteps(tour).filter((n) => !steps.find((s) => s.n === n)?.after)
      const warning = [native.length ? `step${native.length > 1 ? "s" : ""} ${native.join(", ")} name${native.length > 1 ? "" : "s"} the Mac's own UI (the menu bar, the notch, a notification), which neither a recording nor Vaultite's window shows: give ${native.length > 1 ? "each" : "it"} an (after: <png>) still of it (and a (before: <png>)), and say in its words what to open to see it live` : "",
        job && !video ? "no video: a proof is one by default (--record on your own copy of the change, or --video), so the user sees it before it's merged" : "",
        video && video.bytes > 12 << 20 ? `its video is ${Math.round(video.bytes / (1 << 20))} MB: keep a proof short (fewer, shorter steps)` : ""].filter(Boolean).join("; ")
      return { path, steps: tour.steps.length, ...(job ? { job } : {}), ...(video ? { video: video.path, size: video.bytes < 1 << 20 ? `${Math.max(1, Math.round(video.bytes / 1024))} KB` : `${Math.round(video.bytes / 104857.6) / 10} MB`, ...(video.ms ? { seconds: Math.round(video.ms / 1000) } : {}) } : {}), ...(warning ? { warning } : {}) }
    },
    text: (r) => `${r.job ? `Saved ${r.path}${r.home ? ` on its home, ${r.home}` : ""} (${r.steps} steps), the proof of ${r.job}${r.video ? `, with its video ${r.video} (${r.seconds ? `${r.seconds} s, ` : ""}${r.size}: embed it in your report, --video)` : ""}: Show me plays it once the job is ready.` : `Saved ${r.path} (${r.steps} steps): play it with companion tour "${r.path}".`}${r.warning ? ` Warning: ${r.warning}.` : ""}`,
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

  /** A proof's video recorded here, on the worker's own copy at `record`. */
  const recording = (record: string, open: string, title: string, steps: Step[], out: string) =>
    recordProof({ url: proofUrl(record, open), tour: { title, steps }, out, pic: (src) => (nodePath.isAbsolute(src) ? src : plugin.vault.abs(src)) })
      .catch((e) => { throw new OpError(`couldn't record it: ${(e as Error).message}`, 409) })
  /** Whether `url` is this server (the home a worker on this machine names, when it's this one's job). */
  const isHere = async (url: string) => url === serverUrl() || url === ((await plugin.ask<Machine[]>("machines", [])).find((m) => m.self)?.url ?? "").replace(/\/+$/, "")
  /** A job's proof from its worker here, for its home on another machine (the job and the user are there): its video
   *  recorded here, then it and the pictures its steps name sent home, where tour-save keeps them beside the proof. */
  async function saveHome(home: string, o: { title: string; job: string; tour: Tour; record: string; given: string; open: string; text: string; app?: unknown; site?: unknown; times?: unknown }) {
    if (!onTailnet(home)) throw new OpError(`home: a server on the tailnet, not ${home}`)
    if (!o.text.trim()) throw new OpError("text: a proof saved on its job's home names its steps (your last answer here isn't theirs)")
    const send = async (from: string, name: string) => {
      const r = await fetch(`${home}/api/ops/companion.job-file?${new URLSearchParams({ job: o.job, name })}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/octet-stream" },
        body: fs.readFileSync(from), signal: AbortSignal.timeout(120_000) }).catch((e) => { throw new OpError(`its home (${home}) doesn't answer: ${(e as Error).message}`, 502) })
      const a = await r.json().catch(() => ({})) as { path?: string; error?: string }
      if (!r.ok || !a.path) throw new OpError(`its home couldn't keep ${name}: ${a.error ?? r.status}`, r.status >= 400 ? r.status : 502)
      return a.path
    }
    let text = o.text
    for (const st of o.tour.steps) for (const [which, src] of [["before", st.before], ["after", st.after]] as const) {
      if (!src || !nodePath.isAbsolute(local(src))) continue
      if (!fs.existsSync(local(src))) throw new OpError(`step ${st.n}: ${which}: ${src} isn't a picture here`)
      text = text.split(src).join(await send(local(src), `${which} ${st.n}${nodePath.extname(src).toLowerCase()}`))
    }
    let video = "", times = Array.isArray(o.times) ? o.times.map(Number) : undefined
    if (o.record) {
      const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "vaultite-proof-out-")), out = nodePath.join(tmp, `${safeName(o.title)}.mp4`)
      try { times = (await recording(o.record, o.open, o.title, o.tour.steps, out)).times; video = await send(out, nodePath.basename(out)) } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    } else if (o.given) video = await send(o.given, `${safeName(o.title)}${nodePath.extname(o.given).toLowerCase()}`)
    const r = await fetch(`${home}/api/ops/companion.tour-save`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ title: o.title, text, job: o.job, ...(o.open ? { open: o.open } : {}), ...(typeof o.app === "string" ? { app: o.app } : {}), ...(typeof o.site === "string" ? { site: o.site } : {}),
        ...(video ? { video, ...(times?.length ? { times } : {}) } : {}) }) }).catch((e) => { throw new OpError(`its home (${home}) doesn't answer: ${(e as Error).message}`, 502) })
    const a = await r.json().catch(() => ({})) as Record<string, unknown>
    if (!r.ok) throw new OpError(`its home: ${String(a.error ?? r.status)}`, r.status)
    return { ...a, home }
  }

  /** Each agent's last answer on screen (its words with their tags) and where it was: what "save that as a tour" saves. */
  const lastAnswer = new Map<string, { text: string; ctx: Parameters<typeof tourFromAnswer>[2] & {} }>()
  return {
    input, interrupt,
    /** An answer on screen ended: kept for tour-save. */
    answered: (name: string, text: string, ctx: Parameters<typeof tourFromAnswer>[2] & {}) => { if (/\[\s*[a-z]+[\s\]]/i.test(text)) lastAnswer.set(name, { text, ctx }) },
    playing: (name: string) => playing.get(name) ?? null,
    proofOf,
    /** Their ask `text`, when it's a tour's ask phrase ("what's new?"): that tour played for `name` where they asked
     *  (`ended` once it stops), its title; null: it's an ask for the model. */
    asked: (name: string, text: string, ended?: () => void) => {
      const row = tourAsked(rows(), text)
      if (!row) return null
      const [tour, problems] = parsed(row), s = problems.length ? null : o.screen(name, tour)
      if (problems.length || !s) { console.log(`companion tour "${row.title}": asked for, but ${problems.length ? problems.join("; ") : "there's no screen to play it on"}`); return null }
      void start(name, s, tour, "guide").catch((e) => console.log(`companion tour "${tour.title}": ${(e as Error).message}`)).finally(ended)
      return tour.title
    },
    /** The tours anyone may ask for by name, wherever they are: their paths and phrases. */
    askable: () => rows().filter((r) => r.ask?.length).map((r) => ({ path: /\.md$/i.test(r.id) ? r.id : `${r.id}.md`, ask: r.ask! })),
    /** Play `tour` (a proof) for `name` on screen `s` straight through: how it went. */
    show: (name: string, s: Screen, tour: Tour) => start(name, s, tour, "show", 1, undefined, { quiet: true }),
    escapedAt: () => escaped,
  }
}
