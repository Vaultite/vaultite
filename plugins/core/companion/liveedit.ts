import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { z } from "zod"
import { type OpCtx, OpError, type Plugin, quoted } from "../../../core/plugins.ts"
import type { Box } from "../../../core/desktop/framediff.ts"
import { gist, type Job, JOB_STATES, live } from "./jobs.ts"
import type { Moment } from "./types.ts"
import { unedit } from "./unedit.ts"
import { messageOf } from "./errors.ts"
import { editsFor, freshText, isQuestion, isUndo, type LiveAsk, liveText, NOT_MINE, pageOf, type Span } from "./liveasks.ts"

type Live = { n: number; asks: LiveAsk[]; notes: string[]; at: number; fresh?: number }

type Jobs = { list: () => Job[]; find: (id: string) => Job; tell: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void>
  fresh: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void>
  context: (j: Job) => Promise<{ tokens: number; window: number } | null>
  atMachine: (machine: string, id: string, body: object, seconds?: number) => Promise<Record<string, unknown>> }
export type LiveDeps = {
  jobs: Jobs
  ctx: (from?: IncomingMessage) => OpCtx
  say: (name: string, text: string, m: Moment) => Promise<unknown>
  seen: (name: string, why: string, m: Moment) => void
  ring: (name: string, boxes: Box[]) => Promise<unknown>
  fallback: (m: Moment) => void
  desktop: (name: string, args: { window: number; before?: string }) => Promise<unknown>
}

const WARM_MS = 20 * 60_000
const RECENT_MS = 2 * 3600_000
const MOST = 40
// Past this, the agent would compact its context mid-ask, while they watch.
const FRESH_TOKENS = 120_000, FRESH_SHARE = 0.6


const Shot = z.object({ ok: z.boolean().optional(), file: z.string().optional() })
const Changed = z.object({ ok: z.boolean().optional(), boxes: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).optional() })
const Unedited = z.object({ ok: z.boolean().catch(false), tag: z.string().catch(""), files: z.array(z.string()).catch([]), said: z.string().catch("") })
type Unedited = z.infer<typeof Unedited>
const wasLive = (s: string) => JOB_STATES.some((x) => x === s && live(x))


export function liveEdits(plugin: Plugin, d: LiveDeps) {
  let held: { vault: string; s: { jobs: Record<string, Live> } } | null = null
  const state = () => {
    if (held?.vault !== plugin.vault.path) held = { vault: plugin.vault.path, s: plugin.kept<{ jobs: Record<string, Live> }>("live", { jobs: {} }) }
    return held.s
  }
  const save = (s: { jobs: Record<string, Live> }) => {
    const since = Date.now() - RECENT_MS
    for (const [id, l] of Object.entries(s.jobs)) if (l.at < since) delete s.jobs[id]
    plugin.keep("live", s)
  }
  const recOf = (s: { jobs: Record<string, Live> }, id: string) => (s.jobs[id] ??= { n: 0, asks: [], notes: [], at: Date.now() })
  const moments = new Map<string, Moment>()
  const chains = new Map<string, Promise<unknown>>()
  const chain = (id: string, f: () => Promise<unknown>) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(f, f)
    chains.set(id, next.catch(() => {}))
    return next
  }

  function jobOn(m: Moment, now = Date.now()): Job | undefined {
    const recent = d.jobs.list().filter((j) => j.state !== "stopped" && j.state !== "failed" && (live(j.state) || now - j.at < RECENT_MS))
    const on = recent.length ? pageOf(m) : ""
    if (!on) return undefined
    const site = on.startsWith("site:") ? on.slice(5) : "", note = on.startsWith("note:") ? on.slice(5) : ""
    const origin = (u?: string) => (u ? URL.parse(u)?.origin ?? "" : "")
    const edits = (j: Job) => !note || !!state().jobs[j.id] || !!j.result?.files?.some((f) => f === note || f.endsWith(`/${note}`))
    return recent.filter((j) => (j.on === on || (!!site && origin(j.where.preview) === site)) && edits(j)).sort((a, b) => b.at - a.at)[0]
  }

  async function shot(window: number) {
    const r = Shot.safeParse(await d.desktop("screen:shot", { window }).catch(() => null)).data
    return r?.ok && r.file ? r.file : ""
  }

  function take(m: Moment, from?: IncomingMessage): boolean {
    const name = m.for
    if (!name || m.kind !== "ask" || !m.text?.trim() || m.tour) return false
    const j = jobOn(m)
    if (!j) return false
    if (isUndo(m.text)) {
      m.live = j.id
      void undoNow(d.ctx(from), j, m).catch((e) => d.say(name, messageOf(e), m)).catch(() => {})
      return true
    }
    if (isQuestion(m.text)) { m.pageJob = j.id; return false }
    if (j.state === "needs you") return false
    m.live = j.id
    const s = state(), rec = recOf(s, j.id), window = m.window ?? m.shotWindow, ask: LiveAsk = { tag: `L${++rec.n}`, t: m.t, text: gist(m.text, 80), ...(window ? { window } : {}) }
    rec.asks.push(ask)
    rec.asks.splice(0, Math.max(0, rec.asks.length - MOST))
    rec.at = Date.now()
    save(s)
    moments.set(`${j.id}/${ask.tag}`, m)
    if (moments.size > MOST * 4) moments.delete(moments.keys().next().value!)
    d.seen(name, "sent to the job on this page", m)
    void chain(j.id, async () => {
      const before = window ? shot(window) : Promise.resolve("")
      await started(j)
      const anew = !busy(j) && await large(j)
      const s2 = state(), r2 = recOf(s2, j.id), notes = r2.notes.splice(0), a = r2.asks.find((x) => x.tag === ask.tag)
      if (a) a.sent = Date.now()
      try {
        if (anew) {
          const before = r2.asks.filter((x) => x.sent && !x.handed && x.tag !== ask.tag)
          await d.jobs.fresh(d.ctx(from), j.id, freshText(j, before, liveText(ask.tag, m, [])), m.text)
          r2.fresh = Number(ask.tag.slice(1))
        } else await d.jobs.tell(d.ctx(from), j.id, liveText(ask.tag, m, notes), m.text)
      } catch (e) { if (a) delete a.sent; r2.notes.unshift(...notes); throw e }
      if (a) a.shot = await before
      save(s2)
    }).catch((e) => {
      console.error(`companion: live edit to ${j.id}: ${messageOf(e)}`)
      delete m.live
      d.fallback(m)
    })
    return true
  }
  async function large(j: Job) {
    const c = await d.jobs.context(j).catch(() => null)
    return !!c && c.tokens >= Math.min(FRESH_TOKENS, c.window * FRESH_SHARE)
  }
  async function started(j: Job) {
    for (const end = Date.now() + 120_000; j.state === "starting"; await new Promise((r) => setTimeout(r, 400))) if (Date.now() > end) throw new Error("it didn't start")
    if (j.state === "needs you" || j.state === "stopped" || j.state === "failed") throw new Error(`it's ${j.state}`)
  }

  function moved(j: Job, from: string) {
    if (live(j.state) || !wasLive(from)) return false
    const s = state(), rec = s.jobs[j.id]
    const asks = rec?.asks.filter((a) => a.sent && !a.rung && !a.undone) ?? []
    const w = waiting.get(j.id)
    if (!asks.length && !w) return false
    j.seen = true
    for (const a of asks) a.rung = true
    save(s)
    waiting.delete(j.id)
    const log = (e: Error) => console.error(`companion: live edit ${j.id}: ${e.message}`)
    if (w) void undoNow(w.ctx, j, w.m, w.tag).catch(log)
    else void settled(j, asks).catch(log)
    return true
  }
  async function changedSince(before: string | undefined, window: number | undefined) {
    if (!before || !window) return []
    const r = Changed.safeParse(await d.desktop("screen:changed", { before, window }).catch(() => null)).data
    return r?.ok ? r.boxes ?? [] : []
  }
  async function settled(j: Job, asks: LiveAsk[]) {
    const last = asks.at(-1)!, m = moments.get(`${j.id}/${last.tag}`), name = m?.for
    const said = (j.last?.text ?? j.result?.text ?? "").trim()
    if (m && said.includes(NOT_MINE)) { last.handed = true; save(state()); delete m.live; return d.fallback(m) }
    const first = asks.find((a) => a.shot && a.window)
    const boxes = await changedSince(first?.shot, first?.window)
    if (!name || !m) return
    if (boxes.length) return void await d.ring(name, boxes)
    if (said) await d.say(name, gist(said.replace(/\s+/g, " "), 240), m)
  }

  const busy = (j: Job) => (live(j.state) && j.state !== "needs you") || !!state().jobs[j.id]?.asks.some((a) => a.sent && !a.rung && !a.undone)
  const waiting = new Map<string, { tag: string; m: Moment; ctx: OpCtx }>()
  async function undoNow(ctx: OpCtx, j: Job, m: Moment, only?: string) {
    const name = m.for!
    if (busy(j) && !only) {
      const tag = state().jobs[j.id]?.asks.findLast((a) => a.sent && !a.undone)?.tag
      if (!tag) return void await d.say(name, "There's nothing of mine to undo there.", m)
      waiting.set(j.id, { tag, m, ctx })
      return void await d.say(name, "I'll undo it once it's done.", m)
    }
    const window = m.window ?? m.shotWindow, before = window ? await shot(window) : ""
    const r = await undoIn(ctx, j, only)
    const boxes = r.undone ? await changedSince(before, window) : []
    if (boxes.length) await d.ring(name, boxes)
    await d.say(name, r.said, m)
  }

  async function undoIn(ctx: OpCtx, j: Job, only?: string) {
    if (busy(j) && !only) return { said: "It's still on that one: say undo once it's done.", undone: "" }
    const s = state(), rec = s.jobs[j.id]
    const tags = only ? [only] : (rec?.asks ?? []).filter((a) => a.sent && !a.undone && Number(a.tag.slice(1)) >= (rec.fresh ?? 0)).map((a) => a.tag).reverse()
    if (!tags.length) return { said: "There's nothing of mine to undo there.", undone: "" }
    const body = { terminal: j.terminal, session: j.session ?? "", agent: j.where.agent, cwd: j.where.cwd, tags }
    const r = Unedited.parse(j.where.machine ? await d.jobs.atMachine(j.where.machine, "companion.unedit", body, 20) : await ctx.op("companion.unedit", body))
    const a = r.tag ? rec.asks.find((x) => x.tag === r.tag) : undefined
    if (a && r.ok) {
      a.undone = true
      rec.notes.push(`(Since your last turn they undid your change for ${a.tag}, "${a.text}": its edits are reversed on disk.)`)
      save(s)
    }
    return { said: r.said, undone: r.ok ? r.tag : "" }
  }

  plugin.op({
    id: "companion.unedit",
    cli: "companion unedit",
    summary: "Take back a worker's own edits for one of its live asks (the newest of tags that changed files), here where its files are: the files as they are now, nothing written unless all of it reverses.",
    help: `What live-undo runs where a job's worker is (this machine, or the one it runs on). Its edits come from its
transcript (Claude Code's), so the user's own and other asks' changes stay.

  vau companion unedit --terminal claude-ab12 --tags L3 --tags L2 --cwd ~/Projects/site`,
    kind: "write",
    lock: false,
    params: { terminal: { type: "string", description: "its worker's terminal (its session when that's gone)" }, session: { type: "string", description: "its worker's session, read once its terminal is gone" },
      agent: { type: "string", default: "claude", description: "its harness (claude: Claude Code, whose transcript keeps each edit)" }, cwd: { type: "string", required: true, description: "the folder it works in: only files under it (or the vault) are changed" },
      tags: { type: "array", items: { type: "string" }, required: true, description: "its live asks' tags, newest first" } },
    run: async (p, ctx): Promise<Unedited> => {
      const agent = String(p.agent || "claude").split("_")[0], tags = z.array(z.unknown()).parse(p.tags).map(String).filter(Boolean)
      const cwd = path.resolve(String(p.cwd).replace(/^~(?=$|\/)/, process.env.HOME ?? "")), vault = path.resolve(plugin.vault.path)
      const spans = await plugin.ask<Span[] | null>(`agent-edits:${agent}`, null, String(p.terminal ?? ""), String(p.session ?? ""), "Live edit L")
      if (!spans) return { ok: false, tag: "", files: [], said: "I can't read what it changed there, so I left it." }
      const of = (tag: string) => editsFor(spans, tag)
      const tag = tags.find((t) => of(t).length)
      if (!tag) return { ok: false, tag: "", files: [], said: "I can't take that back: it changed it with a command, not an edit. I left it as it is." }
      const real = (f: string) => { try { return fs.realpathSync(f) } catch { try { return path.join(fs.realpathSync(path.dirname(f)), path.basename(f)) } catch { return f } } }
      const roots = [real(cwd), real(vault)], edits = of(tag), inside = (f: string) => roots.some((r) => f === r || f.startsWith(r + path.sep))
      const out = edits.find((e) => !inside(real(path.resolve(e.file))))
      if (out) return { ok: false, tag, files: [], said: `It changed ${out.file}, outside its folder, so I left it all.` }
      const r = unedit(edits, (f) => { try { return fs.readFileSync(f, "utf8") } catch { return null } })
      if (!r.ok) return { ok: false, tag, files: [], said: `I can't undo that cleanly: in ${path.basename(r.file)}, ${r.why}. I left it as it is.` }
      for (const [f, text] of r.files) {
        const rel = path.relative(roots[1], real(path.resolve(f)))
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
          if (text === null) await ctx.api("DELETE", `file?path=${encodeURIComponent(rel)}`)
          else await ctx.api("PUT", "file", { path: rel, text })
        } else if (text === null) fs.rmSync(f, { force: true })
        else fs.writeFileSync(f, text)
      }
      const files = [...r.files.keys()].map((f) => path.basename(f))
      return { ok: true, tag, files, said: "Undone." }
    },
    text: (r) => (r.ok ? `Undid ${r.tag} (${r.files.join(", ")}).` : r.said),
  })

  plugin.op({
    id: "companion.live-undo",
    cli: "companion live-undo",
    summary: "Undo the last live edit a job made on a page (its worker's own edits for that ask, nothing else): \"undo that\" asked some other way, or from elsewhere.",
    help: `Exactly its worker's edits for that ask, on the files as they are now (their own edits and other asks' stay);
when what it wrote changed since, it changes nothing and says why.

  vau companion live-undo
  vau companion live-undo --job jd3k2h1g`,
    kind: "write",
    lock: false,
    params: { job: { type: "string", description: "the job (default: the last one edited live)" }, as: { type: "string", description: "the agent asking, when not the companion (--as Ada)" } },
    run: async (p, ctx) => {
      const s = state()
      const id = typeof p.job === "string" && p.job.trim() ? p.job.trim() : Object.entries(s.jobs).sort((a, b) => b[1].at - a[1].at)[0]?.[0]
      if (!id) throw new OpError("no job has edited live lately: nothing to undo", 404)
      const j = d.jobs.find(id)
      const r = await undoIn(ctx, j)
      if (!r.undone) throw new OpError(r.said, 409)
      return { job: j.id, title: j.title, undone: r.undone }
    },
    text: (r) => `Undid ${r.undone} in "${r.title}" (${r.job}).`,
    did: (p) => ({ action: "run", text: `Undid a live edit${p.job ? ` of ${quoted(p.job, 20)}` : ""}`, by: typeof p.as === "string" && p.as ? p.as : "companion" }),
  })

  return {
    take, moved, jobOn,
    asksText: (id: string) => (state().jobs[id]?.asks ?? []).filter((a) => a.sent && !a.handed).slice(-8).map((a) => `${a.tag} "${a.text}"${a.undone ? " (undone)" : a.rung ? "" : " (working on it)"}`).join(", "),
    warm: (j: Job) => Date.now() - (state().jobs[j.id]?.at ?? 0) < WARM_MS,
  }
}
