// Region captures (the desktop app's capture.ts records them): saved in the vault and handed to the job on that surface,
// else a new job when they said what to do over it. The companion only says where it went.
import fs from "node:fs"
import path from "node:path"
import type { Machine, OpCtx, Plugin } from "../../../core/plugins.ts"
import { OpError } from "../../../core/plugins.ts"
import { captureTitle, type Narration, narrationLines, type Rect } from "./clips.ts"
import { type Job, live, type Where } from "./jobs.ts"
import type { Moment } from "./plugin.ts"
import type { Found, Over } from "./where.ts"

export type Capture = { kind: "recording" | "replay"; clip: string; ms: number; width: number; height: number; frames: { t: number; file: string }[]
  narration: Narration[]; box: Rect; at: number; place: Record<string, unknown>; end?: Record<string, unknown> }
type Jobs = { list: () => Job[]; begin: (ctx: OpCtx, task: (w: Where) => Promise<string>, m: Moment | undefined, p: Record<string, unknown>) => Promise<Job>
  tell: (ctx: OpCtx, id: string, text: string) => Promise<void>; placeHere: (o: Over) => Promise<Found & { repo: string }> }

/** Only the helper's own captures are read: a clip and frames under its captures folder. */
const OWN = /[/\\]captures[/\\][\w-]+[/\\](clip\.mp4|frames[/\\]\d+\.\ds\.png)$/
const str = (v: unknown) => (typeof v === "string" ? v : "")
const RECENT_MS = 6 * 3600_000
/** What ties a surface to a repo (a note or the vault never does: any job could be on it). */
const SURFACES = new Set(["preview", "editor", "github"])
const origin = (u: string) => { try { return new URL(u).origin } catch { return "" } }

/** The job working on the surface a capture shows: one previewing its address, or (a preview, an editor, a GitHub page)
 *  working in its folder here or on its repo elsewhere. Live ones first, then the latest. */
export function jobFor(jobs: Job[], at: { url?: string; found?: Found & { repo?: string } }, now = Date.now()): Job | undefined {
  const o = at.url ? origin(at.url) : "", f = at.found && SURFACES.has(at.found.from ?? "") ? at.found : null, fo = f?.preview ? origin(f.preview) : ""
  const same = (j: Job) => {
    const p = j.where.preview ? origin(j.where.preview) : ""
    return (!!p && (p === o || p === fo)) || (!!f && ((!j.where.machine && j.where.cwd === f.cwd) || (!!f.repo && j.where.repo === f.repo)))
  }
  const hits = jobs.filter((j) => j.state !== "stopped" && (live(j.state) || now - j.at < RECENT_MS) && same(j))
  return hits.find((j) => live(j.state)) ?? hits.sort((a, b) => b.at - a.at)[0]
}

/** What a worker is told of a capture, its files where it runs (`file`: a vault path there): a new job's prompt, or one
 *  line typed into a job at work (`fresh` false). */
export function captureText(c: Capture, saved: { clip: string; frames: { t: number; path: string }[]; note: string }, file: (rel: string) => string, fresh: boolean) {
  const secs = (c.ms / 1000).toFixed(1), b = c.box
  const said = narrationLines(c.narration)
  return [
    `${fresh ? "The user" : "More from the user:"} ${c.kind === "replay" ? `sent the last ${secs} s of their screen` : `recorded ${secs} s of their screen`} through their companion, a box they drew (sx ${b.x}-${b.x + b.width}, sy ${b.y}-${b.y + b.height} in screen points; the clip is ${c.width}×${c.height} px).`,
    `The clip: ${file(saved.clip)}`,
    saved.frames.length ? `Frames where it changes (read these first; ffmpeg gives more from the clip): ${saved.frames.map((f) => `${(f.t / 1000).toFixed(1)} s ${file(f.path)}`).join(", ")}` : "",
    said.length ? `What they said as it played: ${said.join(" · ")}` : "They said nothing over it: look for what changes.",
    str(c.place.under) ? `Under their pointer as it began: ${str(c.place.under)}` : "",
    str(c.end?.under) && c.end?.under !== c.place.under ? `Under their pointer at the end: ${str(c.end?.under)}` : "",
    `It's saved in their vault too: ${saved.note}`,
  ].filter(Boolean).join(fresh ? "\n" : " · ")
}

/** Local "YYYY-MM-DD HH.mm.ss", a capture's name's start. */
const stamp = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}` }

export function captureOps(plugin: Plugin, jobs: Jobs) {
  const setting = (k: string) => str(plugin.settings()[k]).trim() || str(plugin.manifest.settings?.[k]?.default)

  /** The capture's files in the vault, beside its note (`<folder>/<stamp> <title>/`). */
  async function save(ctx: OpCtx, c: Capture, title: string) {
    const folder = setting("captures_folder").replace(/^\/+|\/+$/g, ""), base = `${folder ? `${folder}/` : ""}${stamp(c.at)} ${title}`
    await ctx.api("POST", "folder", { path: base }).catch(() => {})
    const put = async (from: string, name: string) => { const rel = `${base}/${name}`; await ctx.api("POST", "upload", { path: rel, bytes: fs.createReadStream(from) }); return rel }
    const clip = await put(c.clip, "clip.mp4")
    const frames = []
    for (const f of c.frames) frames.push({ t: f.t, path: await put(f.file, path.basename(f.file)) })
    return { base, clip, frames, note: `${base}.md` }
  }
  /** Its note: the clip, their words by time, the frames, and where it went. */
  async function note(ctx: OpCtx, c: Capture, saved: Awaited<ReturnType<typeof save>>, went: string) {
    const where = [str(c.place.title) && `"${str(c.place.title)}"`, str(c.place.url)].filter(Boolean).join(", ")
    const text = ["---", "type: note", "tags: [capture]", "---", "",
      `${c.kind === "replay" ? "The last" : "Recorded"} ${(c.ms / 1000).toFixed(1)} s of a box on the screen${where ? ` over ${where}` : ""}. ${went}`, "",
      `![[${saved.clip}]]`, "",
      ...(c.narration.length ? ["## What you said", ...narrationLines(c.narration).map((l) => `- ${l}`), ""] : []),
      ...(saved.frames.length ? ["## Frames", saved.frames.map((f) => `![[${f.path}|240]]`).join(" "), ""] : [])].join("\n")
    await ctx.api("PUT", "file", { path: saved.note, text })
  }

  plugin.op({
    id: "companion.capture",
    owner: "Region capture",
    summary: "A clip the user recorded of a box on their screen (the desktop app's Talk key: record this, that just now): saved in the vault and handed to the job on that surface, else a new job when they said what to do.",
    kind: "write",
    lock: false,
    params: {
      kind: { type: "string", enum: ["recording", "replay"], required: true, description: "recorded, or the last seconds kept" },
      clip: { type: "string", required: true, description: "the clip (the helper's file)" },
      ms: { type: "number", description: "its length" }, width: { type: "number", description: "its width in pixels" }, height: { type: "number", description: "its height in pixels" },
      frames: { type: "array", description: "its frames at each change: { t, file }" },
      narration: { type: "array", description: "their words as it played: { t, text }" },
      box: { type: "object", required: true, description: "the box, screen points" },
      at: { type: "number", description: "when it began (ms since 1970)" },
      place: { type: "object", description: "what was there as it began (app, title, url, under)" },
      end: { type: "object", description: "what was under the pointer at its end" },
    },
    run: async (p, ctx) => {
      const c = p as unknown as Capture
      if (!OWN.test(str(c.clip)) || !fs.existsSync(c.clip)) throw new OpError("clip: one of the helper's own captures")
      c.frames = (Array.isArray(c.frames) ? c.frames : []).filter((f) => OWN.test(str(f?.file)) && fs.existsSync(f.file)).slice(0, 12)
      c.narration = (Array.isArray(c.narration) ? c.narration : []).filter((n) => typeof n?.text === "string").map((n) => ({ t: Math.max(0, Number(n.t) || 0), text: n.text.slice(0, 2000) })).slice(0, 200)
      c.place = c.place && typeof c.place === "object" ? c.place : {}
      c.at = Number(c.at) || Date.now()
      const title = captureTitle(c.narration, str(c.place.title) || str(c.place.app))
      const saved = await save(ctx, c, title)
      const said = c.narration.map((n) => n.text).join(" ").trim()
      const over: Over = { url: str(c.place.url) || undefined, app: str(c.place.app) || undefined, title: str(c.place.title) || undefined, path: str(c.place.path) || undefined, under: str(c.place.under) || undefined }
      const found = await jobs.placeHere(over).catch(() => undefined)
      const job = jobFor(jobs.list(), { url: over.url, found })
      // (on another machine, its vault's own path: iCloud brings the files there)
      const fileFor = async (machine: string) => {
        const m = machine ? await plugin.ask<Machine | null>("machines:machine", null, machine) : null
        const root = machine ? m?.vault : plugin.vault.path
        return (rel: string) => (root ? path.join(root, rel) : `${rel} (in their vault)`)
      }
      let went = "Saved here: no job was working on it and nothing was said to do.", to = `Saved in ${setting("captures_folder") || "the vault"}`, sent = ""
      try {
        if (job) {
          await jobs.tell(ctx, job.id, captureText(c, saved, await fileFor(job.where.machine), false))
          went = `Sent to the job "${job.title}" (${job.id}).`
          to = `Sent to ${job.title}`
          sent = job.id
        } else if (said) {
          const m = { kind: "ask", t: Date.now(), text: said, voice: true, summoned: true, ...over } as Moment
          const j = await jobs.begin(ctx, async (w) => `${said}\n\n${captureText(c, saved, await fileFor(w.machine), true)}`, m, { title })
          went = `Sent to a new job, "${j.title}" (${j.id}).`
          to = `Started a job: ${j.title}`
          sent = j.id
        }
      } catch (e) {
        went = `Saved here: the job didn't take it (${(e as Error).message}).`
        to = "Saved: the job didn't take it"
      }
      await note(ctx, c, saved, went)
      return { note: saved.note, clip: saved.clip, said: to, ...(sent ? { job: sent } : {}) }
    },
    text: (r) => `${r.said}. The capture: ${r.note}`,
  })
}
