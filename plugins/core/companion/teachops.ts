import { z } from "zod"
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import fs from "node:fs"
import { dirname } from "node:path"
import { readText, writeText } from "../../../core/vault.ts"
import { type Act, recentStretch } from "../../../core/desktop/teach.ts"
import { kindFor, type Lesson, lessonSkillText, lessonTitle, lessonTour, lessonTourText, skillName } from "./lesson.ts"
import { fileTitle } from "../../../core/desktop/names.ts"
import { offWhy } from "../../../core/desktop/screentimeline.ts"
import { messageOf } from "./errors.ts"

const KINDS = ["app", "click", "key", "field", "said"]
const RectIn = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const ElIn = z.looseObject({ role: z.string(), label: z.string(), frame: RectIn, inside: z.array(z.object({ role: z.string(), label: z.string() })).optional() })
const maybe = <T extends z.ZodType>(t: T) => t.optional().catch(undefined)
const ActIn = z.discriminatedUnion("kind", [
  z.looseObject({ t: z.number(), kind: z.literal("click"), x: z.number(), y: z.number(), el: maybe(ElIn), under: maybe(z.string()), window: maybe(RectIn) }),
  z.looseObject({ t: z.number(), kind: z.literal("key"), key: z.string() }),
  z.looseObject({ t: z.number(), kind: z.literal("field"), el: ElIn, value: z.string(), window: maybe(RectIn) }),
  z.looseObject({ t: z.number(), kind: z.literal("app"), app: z.string(), name: z.string().catch(""), title: maybe(z.string()), private: maybe(z.boolean()) }),
  z.looseObject({ t: z.number(), kind: z.literal("said"), text: z.string() }),
])
const actsOf = (v: unknown[]): Act[] => v.flatMap((a) => ActIn.safeParse(a).data ?? [])
const Timeline = z.object({ ok: z.boolean(), why: z.string().optional(), events: z.array(z.unknown()).optional() })
const FileText = z.object({ text: z.unknown() })
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() ? (Number.isFinite(Number(v)) ? Number(v) : Date.parse(v)) : undefined)

export const SKILL = /^\.agents\/skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/
export async function noteText(plugin: Plugin, ctx: OpCtx, rel: string) {
  if (SKILL.test(rel)) { try { return readText(plugin.vault.abs(rel)) } catch { return "" } }
  return String(FileText.safeParse(await ctx.api("GET", `file?path=${encodeURIComponent(rel)}`).catch(() => null)).data?.text ?? "")
}
export async function writeNote(plugin: Plugin, ctx: OpCtx, rel: string, text: string) {
  if (SKILL.test(rel)) { const abs = plugin.vault.abs(rel); fs.mkdirSync(dirname(abs), { recursive: true }); return void writeText(abs, text) }
  await ctx.api("PUT", "file", { path: rel, text })
}


export function teachOps(plugin: Plugin) {
  const exists = async (ctx: OpCtx, path: string) => !!await noteText(plugin, ctx, path)
  async function free(ctx: OpCtx, make: (n: number) => string) {
    for (let n = 1; n < 50; n++) if (!await exists(ctx, make(n))) return make(n)
    throw new OpError("too many lessons by that name", 409)
  }

  plugin.op({
    id: "companion.teach",
    cli: "companion teach",
    summary: "Make what the user showed on their screen (watch me, or the timeline's last minutes) a draft tour in Guides/ or a draft skill in .agents/skills/.",
    help: `The desktop app sends a lesson when they say "watch me … that's it" or "make what I just did a skill"; called
with no acts, it takes what the screen's timeline kept (its setting timeline; off, offer to turn it on): the last minutes, back
to their last pause of a minute. Each click, typing and shortcut is a step on the thing it acted on (found again by what
it is when played), their words as they did it its words. A tour when they explained what's where, else a skill;
either is a draft (status: draft) till it has played through once (companion tour).

  vau companion teach --as skill --title "Add a deploy key"
  vau companion teach --last 90 --preview`,
    kind: "write",
    lock: false,
    params: {
      as: { type: "string", enum: ["tour", "skill"], description: "what to make (default: a tour when they explained, else a skill)" },
      title: { type: "string", description: "its name (default: what they called it, else where and when)" },
      about: { type: "string", description: "what they said it was as they began (watch me …)" },
      acts: { type: "array", description: "what they did and said: the timeline's app, click, key, field and said events (the desktop app's)" },
      last: { type: "number", minimum: 5, maximum: 300, description: "with no acts: the timeline's last seconds (default 300, cut at their last pause of a minute)" },
      from: { type: "string", description: "with no acts: from when (ISO time, or ms since 1970)" },
      preview: { type: "boolean", description: "answer what it would write, writing nothing" },
    },
    run: async (p, ctx) => {
      let acts: Act[], from = num(p.from), to = Date.now()
      if (Array.isArray(p.acts)) acts = actsOf(p.acts).slice(0, 2000)
      else {
        const r = Timeline.safeParse(await plugin.desktop("screen:timeline", { ...(from ? { from } : { from: to - (num(p.last) ?? 300) * 1000 }), kinds: KINDS })
          .catch((e) => ({ ok: false, why: messageOf(e) }))).data ?? { ok: false }
        if (!r.ok) throw new OpError(`nothing to learn from: ${offWhy(r.why ?? "the desktop app didn't answer")}`, 409)
        acts = actsOf(r.events ?? [])
        if (!from) acts = recentStretch(acts)
      }
      if (!acts.length) throw new OpError("nothing to learn from: nothing was done on screen in that stretch", 409)
      from = Math.min(...acts.map((a) => a.t))
      const asked = z.enum(["tour", "skill"]).safeParse(p.as).data
      const lesson: Lesson = { from, to, acts, ...(typeof p.about === "string" && p.about.trim() ? { about: p.about.trim() } : {}), ...(asked ? { as: asked } : {}) }
      const as = kindFor(lesson)
      const appNames = [...new Set(acts.flatMap((a) => (a.kind === "app" && !a.private && a.name ? [a.name] : [])))]
      const title = fileTitle(typeof p.title === "string" && p.title.trim() ? p.title : lessonTitle(lesson, appNames[0]), 80)
      const { tour, unnamed } = lessonTour(lesson, title)
      if (!tour.steps.some((s) => s.do?.length)) throw new OpError(`nothing to learn from: no click, typing or shortcut on a thing with a name${unnamed ? ` (${unnamed} on things with no name)` : ""}`, 409)
      let path: string, text: string
      if (as === "tour") {
        path = await free(ctx, (n) => `Guides/${title}${n > 1 ? ` ${n}` : ""}.md`)
        text = lessonTourText({ ...tour, title: path.replace(/^Guides\//, "").replace(/\.md$/, "") }, from)
      } else {
        const name = skillName(title)
        path = await free(ctx, (n) => `.agents/skills/${name}${n > 1 ? `-${n}` : ""}/SKILL.md`)
        text = lessonSkillText(tour, { name: path.split("/")[2], at: from, appNames })
      }
      const steps = tour.steps.length
      if (!p.preview) await writeNote(plugin, ctx, path, text)
      const said = as === "tour" ? `Saved a draft tour, ${title}: say "play ${title}" to try it` : `Saved a draft skill, ${title}: say "run ${title}" to try it`
      return { path, as, title, steps, ...(unnamed ? { unnamed } : {}), said, ...(p.preview ? { text, preview: true } : {}) }
    },
    text: (r) => r.preview ? `${r.path} (${r.as}, ${r.steps} steps), not written:\n${r.text}`
      : `Saved ${r.path}: a draft ${r.as}, ${r.steps} steps${r.unnamed ? ` (${r.unnamed} clicks on things with no name left out)` : ""}. Play it: vau companion tour "${r.path}"${r.as === "skill" ? " --mode do" : ""}.`,
  })
}
