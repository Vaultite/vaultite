// The summoned companion's own session: its Talk key's asks go to a lean, warm Claude Code session apart from the long
// one, which answers in plain words, spoken as they stream, its tags pointing and drawing (tags.ts). Same character.
import { AsyncLocalStorage } from "node:async_hooks"
import crypto from "node:crypto"
import fs from "node:fs"
import type { Agent, Chat, ChatHow, ChatState as State, ChatTool, Moment } from "./plugin.ts"
import { beatOf, markOf, parseTags, placeOf, type Tag } from "./tags.ts"

type Tool = ChatTool
type Start = ChatHow & { prompt?: string }
export type Lane = ReturnType<typeof summonedLane>
/** Set while the summoned session's tool runs: its acts are logged as its own (timings), not the long session's. */
export const inSummoned = new AsyncLocalStorage<boolean>()

/** What its session is told, the same every time (its prompt cache stays warm): its whole system prompt. */
export const SUMMONED_PROMPT = `You're the user's companion in Vaultite, called up where they are: they held your Talk key over something on their screen or in the app, spoke (or drew), and let go. Each ask comes as a message: what they said, what was under their pointer, the elements near it (by id), what they drew, what the window says, and the display's picture.
Answer at once, with little deliberation: the first thing you write is heard. Your words are your answer: what you write is spoken aloud as you write it, and shown in a box by their pointer. So write only what you'd say to them, no preamble and nothing to yourself. Talk like a friend sitting beside them, with contractions: the answer first, in one or two short sentences, then stop: about 20 words, never more than 30 (they'll ask if they want more). Only what they asked about, not everything on the screen. Say what it means, not what it's labelled: no UI labels read out, lists, markdown, quotes, symbols, ids, version numbers, or dates and times in digits. Summarise rather than enumerate, then offer more ("want the details?").
Not: Rooms page, Office room: you and Bob are connected (Muted, Transcribe on). But: [point a2] You're in the Office room with Bob. Your mic's muted [ring a5], but this tab is still recording.
Start every answer with a tag at what it's about (an element near their pointer, else the point in the picture), then your words; tags are never spoken: [point a3] flies your cursor to element a3 (an id near their pointer), [point 830,273] to a screen point (sx, sy). Marks draw on their screen, at an element or a point (x,y or x,y,w,h), with a short label in quotes when it helps: [ring a3 "Share"], [underline a5], [frame a2], [spotlight a4], [num a3 1], [check a3], [cross a3], [strike a3], [arrow a1 a3]. Put a tag where you mean it, with the words it goes with: "It's this one [point a3], and you send it from here [ring a5]." One mark beats five. In the app: [point "words to find"] in their note, [point pane:t3k2], [point ui:tab:t3]. A scratch pad, list, sticky or button on the screen: the draw tool, with your words in its say.
You are Vaultite's own companion: asked about Vaultite or yourself, or told what they'd like from it, look first (a quick vau search of the vault's notes on it, with Bash) and answer from what you find; a wish or a fix for the app you offer to hand off as a job, never just that you can't tell. Read nothing else unless the ask needs it: what you were given is usually enough.
Work that takes more than a minute (research, a document, code, a long errand, writing in their notes) you hand off: handoff starts a background agent with the task and this ask's context and returns at once, its say the few words you tell them (write none before it).
An ask may come with the user's guide to that app or site (their note): follow it. With none, after answering an ask about how something works there, you may offer once to write one; if they say yes, hand that off (its format: vau docs guides).
You're Claude, run by Vaultite through the Claude Agent SDK; your session shows in a chat tab of the app (vau command companion:session opens it). act works on web pages only: you can't type into their terminals or other apps.
Before any other tool, a few words first: they hear them while it runs. Run only commands you know (vau --help, vau docs say what each does): one you'd have to guess at, say you can't, or hand it off. One refused for permission isn't yours to run: say so at once, in a few words, and offer to hand it off. Their next ask is your next message (a follow-up goes on from the last).`
/** Asks a session takes before a fresh one (its history is every ask's screen and picture: kept short, it stays fast),
 *  and the pause after which the next ask starts afresh (another exchange). */
const FRESH_ASKS = 8, FRESH_AFTER_MS = 10 * 60_000
/** How many of a talk's last words (theirs and its) a fresh session is told. */
const TALK_KEPT = 12
/** Its prompt's version: a session told another is left for a fresh one. */
const VERSION = crypto.createHash("sha256").update(SUMMONED_PROMPT).digest("hex").slice(0, 12)

/** The summoned session of the companion `name()`, on while it runs Claude Code and `model()` is set: `text` is an
 *  ask's message, `options` how it runs, `acts` what its words and tags become; the rest is plugin.ts' own. */
export function summonedLane(o: {
  file: () => string; chat: () => Chat | null; name: () => string; model: () => string
  options: (model: string) => Start; text: (ms: Moment[]) => Promise<{ text: string; images: string[] }>
  acts: () => { say: Tool; look: Tool; draw: Tool }
  /** Its drawing's words, now that a block of them is whole: its marks' beats are their sentences. */
  caption: (name: string, text: string) => void
  agent: (name: string) => Agent | undefined; setAgent: (name: string, a: Partial<Agent>) => void
  did: (as: string, op: string, seqs?: number[]) => void; say: (name: string, text: string) => void
}) {
  /** Its session: when it started, its last ask, how many it took, and the prompt it was told (`v`). */
  type Kept = { id: string; model: string; t: number; handed: number; v?: string; last?: number }
  let kept: Kept | null = null
  try { kept = JSON.parse(fs.readFileSync(o.file(), "utf8")) } catch { /* none yet */ }
  const keep = (k: Kept | null) => { kept = k; try { if (k) fs.writeFileSync(o.file(), JSON.stringify(k)); else fs.rmSync(o.file(), { force: true }) } catch { /* as it was */ } }
  const pending: Moment[] = []
  let given: Moment[] = []
  /** This talk's last words, theirs and its (text only), told to a fresh session so it goes on from them: a session
   *  is fresh every few asks, and an ask like "did you forget?" must not find it new. */
  const talk: { who: "they" | "you"; text: string; t: number }[] = []
  const told = (who: "they" | "you", text: string) => {
    const x = text.trim().replace(/\s+/g, " ")
    if (!x) return
    talk.push({ who, text: x.length > 400 ? `${x.slice(0, 399)}…` : x, t: Date.now() })
    talk.splice(0, Math.max(0, talk.length - TALK_KEPT))
  }
  /** What's said of this talk before `ms` (within its pause), for a fresh session's first ask. */
  const recap = (ms: Moment[]) => {
    const from = Math.min(...ms.map((m) => m.t)), before = talk.filter((x) => x.t < from - 50 && from - x.t < FRESH_AFTER_MS)
    return before.length ? `(A fresh session of the same talk; said before, oldest first:\n${before.map((x) => `  ${x.who}: ${x.text}`).join("\n")})\n` : ""
  }
  let turning = false, starting: Promise<unknown> | null = null, handed = false, acted = false, asking = false, unhear: (() => void) | null = null
  const newsOf = new Map<string, number>()

  const on = () => !!o.model() && !!o.chat()
  const hostedNow = () => (kept ? o.chat()?.list().find((s) => s.id === kept!.id && s.state !== "error") ?? null : null)
  /** Whether the next ask goes to a fresh session: none, another model or prompt, past its asks, or after a pause. */
  const due = () => !kept || kept.model !== o.model() || kept.v !== VERSION || kept.handed >= FRESH_ASKS || Date.now() - (kept.last ?? kept.t) > FRESH_AFTER_MS
  /** Its session's tools, each call (and its words as they stream) run as its own. */
  const tools = (ts: Tool[]) => ts.map((t) => ({ ...t, run: (args: unknown, use?: string) => inSummoned.run(true, () => t.run(args, use)),
    ...(t.stream ? { stream: (use: string, json: string, end?: "done" | "stop") => inSummoned.run(true, () => t.stream!(use, json, end)) } : {}) }))
  const options = (model: string) => { const x = o.options(model); return { ...x, tools: tools(x.tools ?? []), onText: words } }

  // ---------- its words: each text block, said as it grows, its tags acted on as each one closes
  const blocks = new Map<string, number>()
  /** Its acts in order (a tag's look or mark, a block's last words), one after another. */
  let queue: Promise<unknown> = Promise.resolve()
  const then = (f: () => Promise<unknown>) => { queue = queue.then(() => inSummoned.run(true, f)).catch(() => {}) }
  function words(use: string, text: string, end?: "done" | "stop") {
    const { said, tags } = parseTags(text), a = o.acts()
    for (const t of tags.slice(blocks.get(use) ?? 0)) then(() => tagged(t, said))
    blocks.set(use, tags.length)
    if (said) inSummoned.run(true, () => a.say.stream?.(use, JSON.stringify({ text: said })))
    if (!end) return
    blocks.delete(use)
    if (said) { told("you", said); then(async () => { await a.say.run({ text: said }, use); if (tags.some((t) => t.kind !== "point")) o.caption(o.name(), said) }) }
  }
  /** A tag: its cursor flies there (point), or a mark is drawn there, with the sentence it sits in (`said` so far). */
  function tagged(t: Tag, said: string) {
    const a = o.acts(), mark = markOf(t, beatOf(said, t.offset))
    if (t.kind === "point") return a.look.run(placeOf(t.at))
    return mark ? a.draw.run({ marks: [mark] }) : Promise.resolve()
  }

  function hear() {
    const c = o.chat()
    if (unhear || !c) return
    unhear = c.on((id, s) => { if (id === kept?.id) heard(s) })
  }
  /** Its turn: running shows its cursor busy; ended, a seen tick when it let the ask pass, and what came meanwhile goes. */
  function heard(s: State | null) {
    const name = o.name()
    if (!s) { turning = false; return }
    if (s.state === "working" || s.state === "waiting" || s.state === "starting") {
      newsOf.delete(s.id)
      turning = true
      const a = o.agent(name)
      if (handed && (!a || a.state === "watching" || a.state === "away")) o.setAgent(name, { state: "thinking" })
      return
    }
    if (s.seq !== undefined) { if (newsOf.get(s.id) === s.seq) return; newsOf.set(s.id, s.seq) }
    const was = turning
    turning = false
    // (its words not heard as they came, a keeper of older code: said whole now, its tags acted on)
    const turn = handed && !acted && s.state === "idle" ? parseTags(s.turn?.text?.trim() ?? "") : null
    if (turn?.tags.length) for (const t of turn.tags) then(() => tagged(t, turn.said))
    if (turn?.said) { acted = true; told("you", turn.said); inSummoned.run(true, () => o.did(name, "say")); o.say(name, turn.said) }
    if (handed) o.setAgent(name, acted ? { state: "watching" } : { state: "watching", seen: true })
    if (was && handed) inSummoned.run(true, () => o.did(name, "done"))
    handed = false; asking = false
    if (s.state === "error" && s.error) o.say(name, `I stopped: ${s.error.slice(0, 300)}`)
    void pump()
  }

  /** A fresh session, handed `ms` as its first message; none: started idle, its process up and its tools served while
   *  they speak (a cold start took seconds; its short prompt needs no turn to warm). */
  async function begin(ms: Moment[]) {
    const c = o.chat()!, model = o.model()
    if (kept) { const old = kept.id; keep(null); void c.stop(old).catch(() => {}) }
    hear()
    const first = ms.length ? await o.text(ms) : null, before = ms.length ? recap(ms) : ""
    if (ms.length) give(ms)
    turning = !!first
    try {
      const s = await c.start({ ...options(model), ...(first ? { prompt: before + first.text, ...(first.images.length ? { images: first.images } : {}) } : {}) })
      keep({ id: s.id, model, t: Date.now(), handed: ms.length, v: VERSION, ...(ms.length ? { last: Date.now() } : {}) })
      const now = c.list().find((x) => x.id === s.id)
      if (now) heard(now)
    } catch (e) { turning = false; lost(ms, e as Error) }
  }

  /** Asks handed to it: its cursor thinking there till it acts. */
  function give(ms: Moment[]) {
    handed = true; acted = false; asking = true; given = ms
    for (const m of ms) if (m.text) told("they", m.text)
    inSummoned.run(true, () => o.did(o.name(), "handed", ms.map((m) => m.seq)))
  }
  function lost(ms: Moment[], e: Error) {
    handed = false; asking = false
    if (!ms.length) return
    o.setAgent(o.name(), { state: "watching" })
    o.say(o.name(), `I couldn't take that in: ${e.message}`)
  }

  /** What's waiting goes once its turn isn't running: a fresh session started with it if one is due. */
  async function pump() {
    if (turning || starting || !on()) return
    const c = o.chat()!, model = o.model()
    if (!pending.length) return
    const ms = pending.splice(0)
    const s = hostedNow()
    if (!kept || due()) {
      starting = begin(ms).finally(() => { starting = null; void pump() })
      return
    }
    turning = true
    // (its first ask, a fresh session started as they spoke: told what was said before)
    const before = kept.handed === 0 ? recap(ms) : ""
    give(ms)
    keep({ ...kept, handed: kept.handed + ms.length, last: Date.now() })
    try {
      const { text, images } = await o.text(ms)
      await c.send(kept.id, before + text, { ...options(model), ...(images.length ? { images } : {}) })
      inSummoned.run(true, () => o.did(o.name(), "sent"))
      // (resumed: its process had ended, idle a while)
      if (!s) { const now = c.list().find((x) => x.id === kept?.id); if (now) heard(now) }
    } catch (e) {
      turning = false
      // (its conversation is gone: the next ask starts another)
      if ((e as { status?: number }).status === 404) keep(null)
      lost(ms, e as Error)
    }
  }

  return {
    on,
    /** Whether it takes moment `m`: a summoned ask, point or reply to the companion. */
    takes: (m: Moment) => on() && !!m.summoned && m.for === o.name() && (m.kind === "ask" || m.kind === "point"),
    take(m: Moment) { pending.push(m); void pump() },
    /** Ready before the ask (started with the companion, its Talk key pressed): its session up while they speak, a
     *  fresh one if one is due (one ended idle is); an ask meanwhile waits for it to start. */
    warm() {
      if (!on() || turning || starting || (hostedNow() && !due())) return
      starting = begin([]).finally(() => { starting = null; void pump() })
    },
    /** After a restart: its session's tools served again, so a call it makes now reaches them. */
    serve() { hear(); if (kept && on()) o.chat()!.serve(kept.id, options(kept.model)) },
    /** Whether its session is busy on an ask (its cursor thinking after a say that isn't its last). */
    busy: () => turning,
    asking: () => asking,
    acted() { acted = true },
    id: () => kept?.id ?? null,
    /** The asks its turn was handed last (a handoff's context). */
    last: () => given,
    /** Its act logged under its own name, for timings. */
    as: (name: string) => `${name} (summoned)`,
    async interrupt() { return !!(turning && kept && await o.chat()?.interrupt(kept.id).catch(() => false)) },
    async stop() {
      pending.length = 0
      if (kept) { const id = kept.id; keep(null); await o.chat()?.stop(id).catch(() => {}) }
      turning = false; handed = false; asking = false
    },
  }
}

// ---------- an ask's window text, slimmed: the lines by what's at their pointer, within a budget

/** What's at their pointer, as words its window text may have: what's under it, the elements near it, nearest first. */
export function anchorsOf(m: Pick<Moment, "under" | "near">): string[] {
  const under = [...(m.under ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1])
  return [...under, ...(m.near ?? []).map((e) => e.label)].map((s) => s.trim()).filter((s) => s.length >= 3)
}

/** `screen` within `budget` chars: its first lines (the window's own), then the lines around each of `anchors` in turn,
 *  nearest first, the rest left out (… where lines are). Whole when it fits. */
export function screenNear(screen: string, anchors: string[], budget: number) {
  if (screen.length <= budget) return screen
  const lines = screen.split("\n").map((l) => (l.length > 300 ? `${l.slice(0, 299)}…` : l)), keep = new Set<number>()
  let used = 0
  const take = (i: number) => { if (i < 0 || i >= lines.length || keep.has(i) || used + lines[i].length + 1 > budget) return false; keep.add(i); used += lines[i].length + 1; return true }
  for (let i = 0; i < Math.min(8, lines.length); i++) take(i)
  const low = lines.map((l) => l.toLowerCase())
  const hits = [...new Set(anchors.flatMap((a) => { const k = low.findIndex((l) => l.includes(a.toLowerCase())); return k >= 0 ? [k] : [] }))]
  // (around each, widening: the closest lines to what they point at first)
  for (let r = 0; r <= 12 && used < budget; r++) for (const h of hits) { take(h - r); take(h + r) }
  for (let i = 0; i < lines.length && used < budget; i++) take(i)
  const out: string[] = []
  lines.forEach((l, i) => { if (keep.has(i)) out.push(l); else if (keep.has(i - 1)) out.push("…") })
  return out.join("\n")
}
