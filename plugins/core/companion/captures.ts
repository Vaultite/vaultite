import path from "node:path"
import { z } from "zod"
import type { OpCtx, Plugin } from "../../../core/plugins.ts"
import { OpError } from "../../../core/plugins.ts"
import { captureTitle, narrationLines } from "../../../core/desktop/clips.ts"
import { type Job, live, type Where } from "./jobs.ts"
import type { JobAsk } from "./types.ts"
import type { Found, Over } from "./where.ts"
import { localStamp } from "../../../core/desktop/names.ts"
import { freeBase, ownCapture, saveFiles, vaultFileOn } from "./vaultfiles.ts"
import { messageOf } from "./errors.ts"

const Num = z.number().catch(NaN)
const Spot = z.object({ under: z.unknown().optional(), title: z.unknown().optional(), url: z.unknown().optional(), app: z.unknown().optional(), path: z.unknown().optional() })
const Frame = z.object({ t: Num, file: z.string() })
const Said = z.object({ t: z.unknown().optional(), text: z.string() }).transform((n) => ({ t: Math.max(0, Number(n.t) || 0), text: n.text.slice(0, 2000) }))
const listOf = <T,>(item: z.ZodType<T>) => z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => item.safeParse(x).data ?? []))
const CaptureIn = z.object({
  kind: z.enum(["recording", "replay"]), job: z.string().optional().catch(undefined), clip: z.string(), ms: Num, width: Num, height: Num,
  frames: listOf(Frame).transform((fs) => fs.filter((f) => ownCapture(f.file) && !f.file.endsWith(".mp4")).slice(0, 12)),
  narration: listOf(Said).transform((ns) => ns.slice(0, 200)),
  box: z.object({ x: Num, y: Num, width: Num, height: Num }), at: z.unknown().optional().transform((v) => Number(v) || Date.now()),
  place: Spot.catch({}), end: Spot.optional().catch(undefined),
})
export type Capture = z.infer<typeof CaptureIn>
type Jobs = { list: () => Job[]; begin: (ctx: OpCtx, task: (w: Where) => Promise<string>, m: JobAsk | undefined, p: { title: string }) => Promise<Job>
  tell: (ctx: OpCtx, id: string, text: string) => Promise<void>; placeHere: (o: Over) => Promise<Found & { repo: string }> }

const str = (v: unknown) => (typeof v === "string" ? v : "")
const RECENT_MS = 6 * 3600_000
const SURFACES = new Set(["preview", "editor", "github"])
const origin = (u: string) => URL.parse(u)?.origin ?? ""

export function jobFor(jobs: Job[], at: { url?: string; found?: Found & { repo?: string } }, now = Date.now()): Job | undefined {
  const o = at.url ? origin(at.url) : "", f = at.found && SURFACES.has(at.found.from ?? "") ? at.found : null, fo = f?.preview ? origin(f.preview) : ""
  const same = (j: Job) => {
    const p = j.where.preview ? origin(j.where.preview) : ""
    return (!!p && (p === o || p === fo)) || (!!f && ((!j.where.machine && j.where.cwd === f.cwd) || (!!f.repo && j.where.repo === f.repo)))
  }
  const hits = jobs.filter((j) => j.state !== "stopped" && (live(j.state) || now - j.at < RECENT_MS) && same(j))
  return hits.find((j) => live(j.state)) ?? hits.sort((a, b) => b.at - a.at)[0]
}

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


export function captureOps(plugin: Plugin, jobs: Jobs) {
  const setting = (k: string) => str(plugin.settings()[k]).trim() || str(plugin.manifest.settings?.[k]?.default)

  async function save(ctx: OpCtx, c: Capture, title: string) {
    const folder = setting("captures_folder").replace(/^\/+|\/+$/g, ""), base = freeBase(plugin, `${folder ? `${folder}/` : ""}${localStamp(c.at)} ${title}`)
    const [clip, ...rels] = await saveFiles(ctx, base, [{ from: c.clip, name: "clip.mp4" }, ...c.frames.map((f) => ({ from: f.file, name: path.basename(f.file) }))])
    return { base, clip, frames: c.frames.map((f, i) => ({ t: f.t, path: rels[i] })), note: `${base}.md` }
  }
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
      job: { type: "string", description: "the job it's for (Still broken after its proof), else the one on that surface" },
    },
    run: async (p, ctx) => {
      const c = CaptureIn.safeParse(p).data
      if (!c || !ownCapture(c.clip) || !c.clip.endsWith("clip.mp4")) throw new OpError("clip: one of the helper's own captures")
      const title = captureTitle(c.narration, str(c.place.title) || str(c.place.app))
      const saved = await save(ctx, c, title)
      const said = c.narration.map((n) => n.text).join(" ").trim()
      const over: Over = { url: str(c.place.url) || undefined, app: str(c.place.app) || undefined, title: str(c.place.title) || undefined, path: str(c.place.path) || undefined, under: str(c.place.under) || undefined }
      const found = await jobs.placeHere(over).catch(() => undefined)
      const job = (str(p.job) && jobs.list().find((j) => j.id === str(p.job))) || jobFor(jobs.list(), { url: over.url, found })
      let went = "Saved here: no job was working on it and nothing was said to do.", to = `Saved in ${setting("captures_folder") || "the vault"}`, sent = ""
      try {
        if (job) {
          const broken = str(p.job) === job.id ? "They watched your change shown on their screen and it's still broken. " : ""
          await jobs.tell(ctx, job.id, `${broken}${captureText(c, saved, await vaultFileOn(plugin, job.where.machine), false)}`)
          went = `Sent to the job "${job.title}" (${job.id}).`
          to = `Sent to ${job.title}`
          sent = job.id
        } else if (said) {
          const m = { kind: "ask", t: Date.now(), text: said, voice: true, summoned: true, ...over } satisfies JobAsk
          const j = await jobs.begin(ctx, async (w) => `${said}\n\n${captureText(c, saved, await vaultFileOn(plugin, w.machine), true)}`, m, { title })
          went = `Sent to a new job, "${j.title}" (${j.id}).`
          to = `Started a job: ${j.title}`
          sent = j.id
        }
      } catch (e) {
        went = `Saved here: the job didn't take it (${messageOf(e)}).`
        to = "Saved: the job didn't take it"
      }
      await note(ctx, c, saved, went)
      return { note: saved.note, clip: saved.clip, said: to, ...(sent ? { job: sent } : {}) }
    },
    text: (r) => `${r.said}. The capture: ${r.note}`,
  })
}
