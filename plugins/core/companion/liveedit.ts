// Live editing: Talk key asks for a change over a page a job works on go into its warm terminal (a question, to the
// companion); what changed is ringed, "undo that" takes back that ask's edits, a worker grown large starts fresh.
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { type OpCtx, OpError, type Plugin, quoted } from "../../../core/plugins.ts"
import type { Box } from "./framediff.ts"
import { followTask, gist, type Job, live } from "./jobs.ts"
import { isBrowser } from "./takeover.ts"
import { surfaceOf } from "./where.ts"
import type { Moment } from "./plugin.ts"
import { type FileEdit, unedit } from "./unedit.ts"

/** One ask sent live: its tag in the worker's terminal (how its edits are found again), its window and that window's
 *  picture before (what's ringed is what differs once it's done), whether it was ringed or undone. */
type LiveAsk = { tag: string; t: number; text: string; window?: number; shot?: string; sent?: number; rung?: boolean; undone?: boolean
  /** Its worker said it wasn't its (the companion took it). */
  handed?: boolean }
/** `fresh`: the first tag of its worker's current conversation (one started fresh: what came before isn't in it). */
type Live = { n: number; asks: LiveAsk[]; notes: string[]; at: number; fresh?: number }

type Jobs = { list: () => Job[]; find: (id: string) => Job; tell: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void>
  fresh: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void>
  context: (j: Job) => Promise<{ tokens: number; window: number } | null>
  atMachine: (machine: string, id: string, body: object, seconds?: number) => Promise<Record<string, unknown>> }
export type LiveDeps = {
  jobs: Jobs
  /** A context for what a moment does: as its window's request (`from`), the user's own. */
  ctx: (from?: IncomingMessage) => OpCtx
  /** The companion's words by their pointer, answering `m`. */
  say: (name: string, text: string, m: Moment) => Promise<unknown>
  /** Its seen tick by `m`'s place, with why (where the ask went). */
  seen: (name: string, why: string, m: Moment) => void
  /** Rings round `boxes` (screen points) on their screen. */
  ring: (name: string, boxes: Box[]) => Promise<unknown>
  /** `m` answered by the companion after all (the job couldn't take it, or said it isn't its). */
  fallback: (m: Moment) => void
  /** A desktop call on this machine (screen:shot, screen:changed). */
  desktop: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

/** How long after its last live ask a job stays the one its page's asks go to, and keeps its terminal up. */
const WARM_MS = 20 * 60_000
/** How recent a job on the page must be to take its asks: one done longer ago gets them through the companion. */
const RECENT_MS = 2 * 3600_000
const MOST = 40
/** "Undo that" and its kin: the app's own, never a turn of anyone's (a model's guess is no way to take a change back). */
const UNDO = /^(?:(?:ok(?:ay)?|no|hmm|actually|wait)[,.!]?\s+)?(?:please\s+)?(?:(?:undo|revert|roll back)(?:\s+(?:that|this|it|that change|that one|the last(?:\s+(?:one|change|edit|thing))?|your last change|what you just did))?|(?:take|put)\s+(?:that|it|this)\s+back|take back(?:\s+(?:that|it|this))?)(?:\s+(?:too|as well|also|again|please))*\s*[.!]*$/i
export const isUndo = (text: string | undefined) => !!text && UNDO.test(text.trim().replace(/\s+/g, " "))
/** What a worker answers when an ask isn't about its page: the companion takes it instead. */
const NOT_MINE = "(not for me)"
/** A worker's context past this (tokens, or this share of its window) starts fresh before its next ask: each ask grows
 *  it, slowing every turn, and compacting would happen mid-ask, while they watch. */
const FRESH_TOKENS = 120_000, FRESH_SHARE = 0.6

// Which asks are questions: a clear one goes to the companion (fast, and it can read the job); a change, or anything
// unclear, to the job. (Words, not a model: it's decided before anyone's turn, and a guess here costs a round trip.)
const LEAD = /^(?:(?:ok(?:ay)?|so|hey|hi|hmm+|um+|uh+|well|and|but|actually|wait|sorry|quick question|question|one thing|also)[,.!:]?\s+)+/i
const ASKING = /^(?:what|what's|whats|which|who|who's|whose|where|where's|when|why|how|how's)\b|^(?:is|isn't|are|aren't|am|was|were|does|doesn't|do|did|has|have|had|can i|could i|should i|may i|will (?:this|that|it|they|i)|would (?:this|that|it|i))\b|^(?:explain|tell me|describe|remind me (?:what|how|why|where|which)|show me (?:what|how|where|which))\b|^(?:can|could|would|will) you (?:tell|explain|show|remind) me\b/i
/** A question that's a change put politely ("can you", "what if", "why isn't it"): the job's. */
const PROPOSING = /^(?:what if|how about|why not|why (?:isn't|isnt|doesn't|doesnt|won't|wont|can't|cant|is it not|does it not|is there no)|is it possible|is there a way|can (?:you|we)|could (?:you|we)|would you|will you|would it be|should (?:we|it|this|that))\b(?! (?:tell|explain|show|remind) me\b)/i
const CHANGING = /\b(?:make|move|change|add|remove|delete|drop|put|turn|swap|replace|rename|resize|shrink|grow|enlarge|fix|cent(?:er|re)|align|hide|tweak|adjust|increase|decrease|reduce|bump|raise|lower|bigger|smaller|larger|wider|narrower|taller|shorter|darker|lighter|bolder|instead|undo|revert|redo)\b/i
/** Whether `text` is plainly a question (what, how, is it...), not a change asked as one ("can you make it blue?"). */
export function isQuestion(text: string | undefined) {
  const t = (text ?? "").trim().replace(/\s+/g, " ").replace(LEAD, "").replace(/^please\s+/i, "")
  return !!t && ASKING.test(t) && !PROPOSING.test(t) && !CHANGING.test(t)
}

/** A worker's prompt when it starts fresh: what the job is, its page and folder, the asks it took so far (what's undone),
 *  then the next ask, so it goes on without its old conversation. */
export function freshText(j: Pick<Job, "title" | "on" | "where" | "result">, asks: Pick<LiveAsk, "tag" | "text" | "undone">[], next: string) {
  const w = j.where, page = j.on?.replace(/^(?:site|note):/, "") || w.preview || ""
  const done = asks.map((a) => `${a.tag} "${a.text}"${a.undone ? " (they undid it)" : ""}`).join("; ")
  return [`You're taking over a job they handed off, "${j.title}", from a worker whose conversation grew long: you start fresh, with this summary.`,
    page ? `They watch its page, ${page}, and ask for changes to it one at a time by voice (live editing).` : "",
    w.tree ? `Work in its git worktree ${w.tree} (branch ${w.branch}), beside ${w.cwd}, which you never edit${w.base ? `; what it changed so far: git -C ${w.tree} diff ${w.base}` : ""}.` : w.cwd ? `It works in ${w.cwd}.` : "",
    done ? `Their live asks so far, oldest first: ${done}.` : "",
    j.result?.text && !j.result.text.includes(NOT_MINE) ? `Its last words: ${gist(j.result.text.replace(/\s+/g, " "), 300)}` : "",
    "Read only what the next ask needs.", next].filter(Boolean).join(" ")
}

type Span = { prompt?: string; said?: string; edits: FileEdit[] }
/** The edits a worker made for live ask `tag`: from where it's told it, or says it's on it ("L2:", how it's asked to
 *  begin each), till another ask's tag or a message of the user's own. */
export function editsFor(spans: Span[], tag: string): FileEdit[] {
  let on = ""
  const out: FileEdit[] = []
  for (const s of spans) {
    const t = s.prompt !== undefined ? /Live edit (L\d+):/.exec(s.prompt)?.[1] ?? null : /^\W{0,3}(L\d+)\b/.exec(s.said ?? "")?.[1] ?? undefined
    // (their own words typed in: what follows is for that; its words without a tag go on with the ask it's on)
    if (t === null) on = ""
    else if (t) on = t
    if (on === tag) out.push(...s.edits)
  }
  return out
}

/** What a worker is told with each live ask (tagged, so its edits for it are found in its transcript again). */
export function liveText(tag: string, m: Moment, notes: string[]) {
  return followTask([`Live edit ${tag}: they're watching the page reload as you change it, so make this change now, the smallest that does it, and end your turn in a few words at most; no checks or summaries unless they ask.`,
    `More asks may come as you work: take them in order, and write each one's tag alone before its changes (${tag}:). Change files with your Edit and Write tools only, never a command (sed, printf, a script): that's how each ask is undone apart.`,
    `A question about the page: answer it in a sentence or two and change nothing. One not about this page or its code: change nothing and answer only ${NOT_MINE}.`,
    ...notes].join(" "), m)
}

/** A line of a window's text that is an address alone, or labelled as one (a browser's address bar). */
const ADDRESS_LINE = /^\s*(?:(?:address(?: and search)? bar|url|location)\b[^:]{0,20}:\s*)?\S+\s*$/i
/** The page `m` is over, as live editing takes it: a note, a web pane's page or a browser's address, never a terminal
 *  or an editor whose text only mentions one (a dev server's "Local: http://localhost:5173"). */
export function pageOf(m: Moment) {
  if (m.path || m.url) return surfaceOf(m)
  if (m.pane) return ""
  const address = (m.screen ?? "").split("\n").slice(0, 60).filter((l) => ADDRESS_LINE.test(l)).join("\n")
  return address || (m.app && isBrowser(m.app)) ? surfaceOf({ title: m.title, screen: address }) : ""
}

export function liveEdits(plugin: Plugin, d: LiveDeps) {
  // (held here, kept on each change: kept.ts gives copies, and two asks' flows must see one state)
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
  /** The asks sent live this session, by the moment (their words, to hand the companion when it isn't the job's). */
  const moments = new Map<string, Moment>()
  /** Each job's asks in order: one typed in only after the last. */
  const chains = new Map<string, Promise<unknown>>()
  const chain = (id: string, f: () => Promise<unknown>) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(f, f)
    chains.set(id, next.catch(() => {}))
    return next
  }

  /** The job working on what `m` is over: the latest one asked there (a preview's own by its address), not stopped; on
   *  a note, only one that changed it or was asked there live (a job asked over a note may only research). */
  function jobOn(m: Moment, now = Date.now()): Job | undefined {
    // (most asks: no job lately, nothing to read of where they are)
    const recent = d.jobs.list().filter((j) => j.state !== "stopped" && j.state !== "failed" && (live(j.state) || now - j.at < RECENT_MS))
    const on = recent.length ? pageOf(m) : ""
    if (!on) return undefined
    const site = on.startsWith("site:") ? on.slice(5) : "", note = on.startsWith("note:") ? on.slice(5) : ""
    const origin = (u?: string) => { try { return u ? new URL(u).origin : "" } catch { return "" } }
    const edits = (j: Job) => !note || !!state().jobs[j.id] || !!j.result?.files?.some((f) => f === note || f.endsWith(`/${note}`))
    return recent.filter((j) => (j.on === on || (!!site && origin(j.where.preview) === site)) && edits(j)).sort((a, b) => b.at - a.at)[0]
  }

  /** Its window's picture now (before the job changes it), or "" when there's none to take. */
  async function shot(window: number) {
    const r = await d.desktop("screen:shot", { window }).catch(() => null) as { ok?: boolean; file?: string } | null
    return r?.ok && r.file ? r.file : ""
  }

  /** Whether `m`, a Talk key ask, went live: straight to the job on its page (or its undo, done here). */
  function take(m: Moment, from?: IncomingMessage): boolean {
    const name = m.for
    if (!name || m.kind !== "ask" || !m.text?.trim() || m.tour) return false
    const j = jobOn(m)
    if (!j) return false
    if (isUndo(m.text)) {
      m.live = j.id
      void undoNow(d.ctx(from), j, m).catch((e) => d.say(name, (e as Error).message, m)).catch(() => {})
      return true
    }
    // (a plain question is the companion's, quicker than the job's next turn: it's told the job, to read its work)
    if (isQuestion(m.text)) { m.pageJob = j.id; return false }
    // (one waiting on a prompt answers that first: the companion tells them, and answers it on their word)
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
      // (its picture taken as it's told: a worker reads and thinks a while before its first change)
      const before = window ? shot(window) : Promise.resolve("")
      await started(j)
      // (only between turns: one mid-ask isn't cut off)
      const anew = !busy(j) && await large(j)
      const s2 = state(), r2 = recOf(s2, j.id), notes = r2.notes.splice(0), a = r2.asks.find((x) => x.tag === ask.tag)
      // (sent as it's typed: its terminal answering takes a while, and an undo meanwhile is for this one)
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
      console.error(`companion: live edit to ${j.id}: ${(e as Error).message}`)
      delete m.live
      d.fallback(m)
    })
    return true
  }
  /** Whether job `j`'s worker's context is large enough to start it fresh (its agent saying how full it is). */
  async function large(j: Job) {
    const c = await d.jobs.context(j).catch(() => null)
    return !!c && c.tokens >= Math.min(FRESH_TOKENS, c.window * FRESH_SHARE)
  }
  /** Until job `j` has begun (a prompt typed while its agent starts can be lost); one needing them meanwhile throws. */
  async function started(j: Job) {
    for (const end = Date.now() + 120_000; j.state === "starting"; await new Promise((r) => setTimeout(r, 400))) if (Date.now() > end) throw new Error("it didn't start")
    if (j.state === "needs you" || j.state === "stopped" || j.state === "failed") throw new Error(`it's ${j.state}`)
  }

  /** Job `j` moved on from `from`: its turn on live asks over, what changed is ringed (or its words said, when the
   *  page shows nothing new). True when its news is live editing's to tell. */
  function moved(j: Job, from: string) {
    if (live(j.state) || !live(from as Job["state"])) return false
    const s = state(), rec = s.jobs[j.id]
    const asks = rec?.asks.filter((a) => a.sent && !a.rung && !a.undone) ?? []
    const w = waiting.get(j.id)
    if (!asks.length && !w) return false
    // (they watched it happen: no badge in the menu bar for each)
    j.seen = true
    for (const a of asks) a.rung = true
    save(s)
    waiting.delete(j.id)
    const log = (e: Error) => console.error(`companion: live edit ${j.id}: ${e.message}`)
    // (an undo said as it worked: done now, on the ask it was on then, instead of ringing what it's taking back)
    if (w) void undoNow(w.ctx, j, w.m, w.tag).catch(log)
    else void settled(j, asks).catch(log)
    return true
  }
  /** What changed in `window` since its picture `before`: the boxes (screen points), none when it can't tell. */
  async function changedSince(before: string | undefined, window: number | undefined) {
    if (!before || !window) return []
    const r = await d.desktop("screen:changed", { before, window }).catch(() => null) as { ok?: boolean; boxes?: Box[] } | null
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

  /** Whether job `j`'s worker is on a live ask: working, or one sent whose turn hasn't ended (being typed in, say). */
  const busy = (j: Job) => (live(j.state) && j.state !== "needs you") || !!state().jobs[j.id]?.asks.some((a) => a.sent && !a.rung && !a.undone)
  /** Undos said while a job's worker works, by job: done once its turn ends, on the ask it was on then. */
  const waiting = new Map<string, { tag: string; m: Moment; ctx: OpCtx }>()
  /** "Undo that" (`m`) over job `j`'s page: its last ask's edits taken back (`only`: that ask's), what that changed
   *  ringed and said; while it works, once its turn ends. */
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

  /** The last live ask of job `j` not undone yet whose worker changed files (`only`: that one), taken back on its machine. */
  async function undoIn(ctx: OpCtx, j: Job, only?: string) {
    if (busy(j) && !only) return { said: "It's still on that one: say undo once it's done.", undone: "" }
    const s = state(), rec = s.jobs[j.id]
    // (an ask from before it started fresh is in a conversation it no longer reads: no edits to take back there)
    const tags = only ? [only] : (rec?.asks ?? []).filter((a) => a.sent && !a.undone && Number(a.tag.slice(1)) >= (rec.fresh ?? 0)).map((a) => a.tag).reverse()
    if (!tags.length) return { said: "There's nothing of mine to undo there.", undone: "" }
    const body = { terminal: j.terminal, session: j.session ?? "", agent: j.where.agent, cwd: j.where.cwd, tags }
    const r = (j.where.machine ? await d.jobs.atMachine(j.where.machine, "companion.unedit", body, 20) : await ctx.op("companion.unedit", body)) as Unedited
    const a = r.tag ? rec.asks.find((x) => x.tag === r.tag) : undefined
    if (a && r.ok) {
      a.undone = true
      // (told with its next ask, so it knows what's on disk: a turn of its own now would only say "noted")
      rec.notes.push(`(Since your last turn they undid your change for ${a.tag}, "${a.text}": its edits are reversed on disk.)`)
      save(s)
    }
    return { said: r.said, undone: r.ok ? r.tag : "" }
  }

  type Unedited = { ok: boolean; tag: string; files: string[]; said: string }
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
      const agent = String(p.agent || "claude").split("_")[0], tags = (p.tags as unknown[]).map(String).filter(Boolean)
      const cwd = path.resolve(String(p.cwd).replace(/^~(?=$|\/)/, process.env.HOME ?? "")), vault = path.resolve(plugin.vault.path)
      const spans = await plugin.ask<Span[] | null>(`agent-edits:${agent}`, null, String(p.terminal ?? ""), String(p.session ?? ""), "Live edit L")
      if (!spans) return { ok: false, tag: "", files: [], said: "I can't read what it changed there, so I left it." }
      const of = (tag: string) => editsFor(spans, tag)
      const tag = tags.find((t) => of(t).length)
      if (!tag) return { ok: false, tag: "", files: [], said: "I can't take that back: it changed it with a command, not an edit. I left it as it is." }
      // (by real paths: a folder through a link, /var as /private/var, is the same folder)
      const real = (f: string) => { try { return fs.realpathSync(f) } catch { try { return path.join(fs.realpathSync(path.dirname(f)), path.basename(f)) } catch { return f } } }
      const roots = [real(cwd), real(vault)], edits = of(tag), inside = (f: string) => roots.some((r) => f === r || f.startsWith(r + path.sep))
      const out = edits.find((e) => !inside(real(path.resolve(e.file))))
      if (out) return { ok: false, tag, files: [], said: `It changed ${out.file}, outside its folder, so I left it all.` }
      const r = unedit(edits, (f) => { try { return fs.readFileSync(f, "utf8") } catch { return null } })
      if (!r.ok) return { ok: false, tag, files: [], said: `I can't undo that cleanly: in ${path.basename(r.file)}, ${r.why}. I left it as it is.` }
      for (const [f, text] of r.files) {
        const rel = path.relative(roots[1], real(path.resolve(f)))
        // (a note goes through the vault, as any edit of the user's; other files are written as they were)
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
    /** What a question over job `id`'s page tells the companion of it: its live asks so far, newest last. */
    asksText: (id: string) => (state().jobs[id]?.asks ?? []).filter((a) => a.sent && !a.handed).slice(-8).map((a) => `${a.tag} "${a.text}"${a.undone ? " (undone)" : a.rung ? "" : " (working on it)"}`).join(", "),
    /** Whether job `j` was asked live lately: its terminal stays up for the next. */
    warm: (j: Job) => Date.now() - (state().jobs[j.id]?.at ?? 0) < WARM_MS,
  }
}
