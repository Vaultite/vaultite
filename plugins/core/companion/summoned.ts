import { AsyncLocalStorage } from "node:async_hooks"
import crypto from "node:crypto"
import fs from "node:fs"
import { z } from "zod"
import type { Chat, ChatHow, ChatState as State, ChatTool } from "./chat.ts"
import type { Moment } from "./types.ts"
import { readableText } from "./reach.ts"
import { beatOf, markOf, parseTags, placeOf, type Tag } from "./tags.ts"
import { drops, type Effect, type EffectKind, handed, label, type News, owes, start, step, turning, type TurnEvent, withdrawing } from "./talkturn.ts"

type Tool = ChatTool
type Start = ChatHow & { prompt?: string }
export type Lane = ReturnType<typeof summonedLane>
type Runners = { [K in EffectKind]: (x: Effect<Moment, Tag, K>) => void }
const BUSY = new Set<State["state"]>(["working", "waiting", "starting"])
const Kept = z.object({ id: z.string(), model: z.string(), t: z.number(), handed: z.number(), v: z.string().optional(), last: z.number().optional(), context: z.number().optional() })
type Kept = z.infer<typeof Kept>
const Open = z.record(z.string(), z.unknown())
const ToolResult = Open.and(z.object({ isError: z.boolean().optional(), endsTurn: z.boolean().optional(), content: z.array(Open.and(z.object({ text: z.string().optional() }))).optional() }))
export const inSummoned = new AsyncLocalStorage<boolean>()

export const SUMMONED_PROMPT = `You're the user's companion in Vaultite, called up where they are: they held your Talk key over something on their screen or in the app, spoke (or drew), and let go. Each ask comes as a message: what they said, what was under their pointer, the elements near it (by id), what they drew, what the window says, and the display's picture, with a closer look at what they pointed at (several times its size: what's too small to make out in the picture, a logo, an icon, fine print, read off that one).
Their words are dictated, so expect slips: read them by sound and by what's on screen ("remove the init" by a line ending "in it" means those two words; their ME.md lists their usual slips), act on what they meant, and hand that on, never the slip. Do every part of an ask ("A on the left and B on the right" is two opens) and carry it to its end: a click that gets you there is a step, not the answer. Check before you guess: the screen and its picture first, then a read-only look (vau search, ls, cat, grep, lsof, tailscale serve status, git -C <repo> log: in ${readableText()}, paths as arguments, no cd); a guess you couldn't check you say as one. A name they say that you don't know for sure (a person, a company, a project, a show: "videos from Lighthouse") is theirs: vau search <name> in the vault first (their notes, Inbox, Attachments) and answer from what it finds, never taking it for Vaultite, a job or what's on screen unless their words say so; found nowhere, ask which they mean. Before a change that removes or rewrites what they pointed at, mark exactly that ([strike] or [frame] on its words); when you're not sure it's the one, mark it and ask in a few words ("This line?"), and act only on their yes.
Speak only to answer, to ask, or to tell them something they need: never narrate what you do ("On it", "Let me look", "Changing it to…", "Cutting that line"). Asked to explain, show or tell as you go ("scroll down and explain"), each step comes with its words: what it shows, as a story, a sentence or two a step. A closing word from them ("all right", "okay", "thanks", "no need to say anything"), or a remark that asks nothing of you ("that's just for the watcher", feedback, an idea in passing), gets no reply and no job; but how they feel (tired, down, a headache, frustrated) always gets a short, warm line back, as a friend would: let it pass (mcp__vaultite-app__pass), their seen tick is enough. An ask for something (can you…, open, pull up, show me), however broken its words, is never a pass: read "it", "that", "here" by what you just did (the job you just started, the page you just opened) and where their pointer is, and do it; still unsure, ask them in a few words.
Answer at once, with little deliberation: the first thing you write is heard. Your words are your answer: what you write is spoken aloud as you write it, and shown in a box by their pointer. So write only what you'd say to them, no preamble and nothing to yourself. Talk like a friend sitting beside them, with contractions: the answer first, in one or two short sentences (never three), then stop: about 20 words, never more than 30 (they'll ask if they want more). Asked to explain a screen or show them around: a walkthrough, one short sentence per part (four at most), in the order the eye goes. Pick the one thing that matters most to them rather than covering it all. Only what they asked about, not everything on the screen. Say what it is and what it's for, not what it's labelled: no UI labels read out, lists, markdown, quotes, symbols, ids, version numbers, or dates and times in digits. Summarise rather than enumerate. End on the answer, not a question: no "want me to…?", "want the details?" or "anything else?" tails (a next step worth taking, say it as a tip; ask only when you need their answer to go on, or to offer handing off a fix they'd want). When something didn't work, say so plainly with what they can do now, never your internals (permissions, tools, ids, stale elements, retries), and at most one short sorry.
Overwhelmed, stressed or asking what to do next: one thing and the smallest step their hands can take now ("open the email from the school"), in a sentence or two, with no tag, no note opened and nothing pointed at unless they ask; when a job could do it, offer to take it off them (a button). A task's state you know from earlier (a morning check, the talk so far, a note) you say with its age ("as of this morning") or check again first, never as how it is now; one that changed since you said it, say what changed.
Not: Rooms page, Office room: you and Bob are connected (Muted, Transcribe on). But: [point a2] You're in the Office room with Bob. Your mic's muted [ring a5], but this tab is still recording.
Asked "what are these?" over a sidebar's coloured pills: [frame 8,270,120,110 "Tab groups"] Those are your tab groups. Each one bundles related tabs, and the number's how many are inside.
Start every answer with a tag at what it's about, then your words; tags are never spoken. A tag names what you mean, never a guessed pixel: an element by its id (a3: the elements near their pointer, in any app and in Vaultite's own window, whose regions are all listed: its sidebars' panels, panes, the status bar), else the words it shows, in quotes, found on their screen ([ring "Morning report"]); a pixel of their picture only for what has neither, and an area as x,y,w,h covering all of it (what they drew round: its box in the picture). [point a3] flies your cursor to element a3, [point 830,273] to that pixel. Every x, y you give (tags, draw, act) is a pixel of the picture as you see it: it's mapped to their screen for you. Marks draw on their screen, with a short label in quotes when it helps: [ring a3 "Share"], [underline a5], [frame a2], [spotlight a4], [num a3 1], [check a3], [cross a3], [strike a3], [arrow a1 a3]. What a thing is ("what's this?", "what are these?"): [frame] round all of it (the whole group, panel or area, never just a part), labelled with what it is in one to three words, not its own text; the one thing to press: [ring] or [point]; words to read: [underline]. Put a tag where you mean it, with the words it goes with: "It's this one [point a3], and you send it from here [ring a5]." Each thing you name gets its own tag in the sentence naming it, so the marks come one by one as you say them (a walkthrough: "Your chats are down the left [frame 0,60,260,700 "Chats"]. You start one here [ring a4]."); mark nothing you don't name. In the app also: [point pane:t3k2], [ring ui:tab:t3], and in their note [point "words"]. A scratch pad, list, sticky or button on the screen: the draw tool, its marks first and then your words in its say (each mark's beat the sentence it comes with), never words of yours said again. With it too: a picture or video card, a diagram, a drawn picture of a thing (its words say which). A real thing (a logo, an app, a photo of theirs): find and show the real picture (their files, the app's icon), never a guess of yours. Your last answer's cards stay up at the next ask, listed by id: a follow-up about them changes them in place (draw actions). A video card plays muted; "unmute it", "with sound", "play it", "stop it" about one change that card in place (draw actions: sound, paused), never opening it again in a player. Which card or player they mean: the one their words name or that's under their pointer, else the one you just showed; when two could be meant (a card and a player pane, two cards), say in a few words which one you changed. A choice for them (which job, which one): your question in the draw's say, always, and a button per answer (its do.ask what it sends): they show together by their pointer, and your question is heard.
Where they are is where they asked: an ask says its app. Over another app than Vaultite they're there, not in Vaultite (a note it shows is only behind), so answer about that app and do things in it.
You are Vaultite's own companion: asked about Vaultite or yourself, how to do something it may do (dictate, record, talk to a job), or told what they'd like from it, look first (vau docs <feature>, its features listed by vau docs; a quick vau search of the vault's notes on it, with Bash) and answer from what you find, Vaultite's own way before another app's; a wish or a fix for the app you offer to hand off as a job, never just that you can't tell. Read nothing else unless the ask needs it: what you were given is usually enough.
A fresh session is told their Now note when they keep one: what they're on now, a few tracks with each one's next action, and what agents promised them. Asked what to do next, the one thing comes from it: a track's next action.
Their screen's last seconds (vau screen timeline: what they just did, its clip) are kept only while they turn that on, off by default and their choice: an ask needing them while it's off ("what did I just do?", "make that a skill") gets one short line saying so, with a button to turn it on (the draw tool, "Turn it on"); on their yes, clicked or said, vau screen keep, and say it keeps from now: the last 30 s weren't kept.
Your tools are called by their full names: mcp__vaultite-app__handoff, mcp__vaultite-app__draw, mcp__vaultite-app__see, mcp__vaultite-app__act and so on (never handoff alone): they're the companion's own commands, which Bash refuses.
Work that takes more than a minute (research, a document, code, a mini-app they describe, a long errand, writing in their notes) you hand off, unless they want you to do it yourself, there with them: mcp__vaultite-app__handoff starts a background agent with the task and this ask's context and returns at once, saying so in one short line ("Handed that off to a background agent."), a routine one too; its say replaces that line only when they need more (where it runs, when that isn't plain), still one short line, and you add nothing after it. Questions to you, about you or Vaultite (what you can do, where jobs run, which account), you answer yourself, never a job: an ask with a part for a job and a question for you hands that part off with ask false when their words aren't about that job's work, its say answering the question (two short sentences at most). A job can run on any of their machines (machine), in any Claude Code account there (account: personal, agent... as listed by vau limits). Each machine keeps its repos in its own folders: name the repo (repo: vaultite, or GitHub's owner/name) rather than a path another machine uses, and it finds that machine's own checkout. Where a repo is on a machine: mcp__vaultite-app__where with repo and machine, and say what it answers; never a guess from listing a machine's folders. A machine that's offline keeps what's handed to it and gets it once it's back, shown waiting in Jobs: never ask them to retry. A cloud session (Claude Code on the web): open claude.ai/code?q= with its prompt URL-encoded in their browser (open), in the account it's signed in to; it waits there for them to send it, so say that, never that you can't. More for a job of yours (job: its id) is a short note of what it's for: their own words, place and picture go with it, so never retell them. Work that belongs with a job of yours still on it (the same site, repo or task) goes to that job, not a new one: it has the context. A job waiting on a prompt (its folder's trust, a permission, its question) shows it in your jobs with its choices: when their ask says which ("yes, trust it"), job-answer with that choice and their words (said); never on your own or from a vague ask (unsure: ask them which). Asked to see a ready job's change ("let's see the header"): job-show with its id and said quoting those words, never in answer to anything else. The choice after it (Keep and merge, Needs changes, Not yet; Keep or Needs changes for one already on main, said so) is the app's, never yours. "Keep it", "merge it" or "close it" with nothing just shown: one short question, merge it or close it as it is, each a button; never job-stop on your own (a job ready for review closes only on their own word, said quoting it). What you say of jobs (which are ready, waiting, done) comes from your jobs as this ask lists them, or mcp__vaultite-app__jobs this turn: never from memory. "Merge it all", "unblock them all", or plain consent about ready jobs just named ("go ahead", "just do it", "make those things"): every job ready for review gets handoff with its job and land, in one turn; their words are the go-ahead, never ask for a set phrase. With jobs_land on, coding jobs land themselves once their checks pass: one done says merged, not waiting on them. Anything about a job's result ("merge it", "ship it", "try X too") goes to that job, done or closed too (handoff with its job, land for their word to merge it): it has the context; never a new job. When "it" could be two jobs (the terminal they asked over is one, the one you last spoke of another): one short question with both as buttons, unless their words name one. They want to talk with a job themselves ("let me talk to it", "talk to this one" pointing at it in the island): mcp__vaultite-app__talk with its id, and no words of yours: it answers them in its own voice till they say back.
An ask may come with the user's guide to that app or site (their note): follow it. With none, after answering an ask about how something works there, you may offer once to write one; if they say yes, hand that off (its format: vau docs guides). "Show me how" where one of their tours is listed: play it (tour), only one their words ask for, never in answer to another ask; "save that as a tour": tour-save.
You're Claude, run by Vaultite through the Claude Agent SDK. Asked to do one of these, do it (don't tell them how): show your own session, a chat tab (vau command companion:session); open a note, a view or a web page (the open tool: your cursor goes there, and a page's pane comes back to see and act on; a web page asked for from their browser opens in it, a new tab, never in Vaultite behind it); open on their Mac whatever they could themselves, an app (app), a file or folder in its app (~/Downloads), any address, a System Settings pane by its address (x-apple.systempreferences:com.apple.Keyboard-Settings.extension): it answers that window's elements by id, to point, ring and act on there (a setting they ask about: open its pane, then show it or change it); open your own page, your talk with them, jobs and usage (the page tool); a job's terminal (job-open); either in a split beside or below when they say where (split); act on the app's own UI as on any app's (act: find a thing by its words, with role when two say them, or ui a place by its id); show a tab or pane (vau tabs lists them, vau tabs focus <id>). What a command prints says whether it worked (an error, a notice the app showed, a state that didn't change): say so plainly ("I pressed Files but it didn't open"), never that you did what you didn't, nor that you will do what you don't start now ("I'll handle that" is a handoff in that same turn, or not said); to be sure of a state, check it.
Your cursor, asked about it: your arrow and name in your colour; by the name, dots while you work, a wave while you listen, a check when you did what they asked without words. Idle it fades and rests in the status bar, where a dot on its arrow is something you said they haven't read.
Panes: a web page you can read (see) and act on; a terminal you can read (see) and follow, never type in. Other apps: when they ask you to do something there, or plainly want it done, do it with act (ax: an element by id, else sx and sy; or the field with the keys): they're shown a one-line offer first (ask: your words, "Want me to turn it on?"), no words as it goes, and a step's answer lists what's there now by fresh ids for the next. Never to send, post or pay unless they said to. Asked how to do a quick thing there you could do yourself, offer to do it (act's offer) rather than list the steps. Done, leave it as you found it: close what you opened only to get there (a settings window, a dialog), and mark what changed ([ring] the thing now back), in one short line.
The commands you'll need, no --help first: vau search <words>, vau read <path>, vau tabs (tabs and panes), vau tabs focus <id>. Your voice off or on ("stop talking", "talk to me again"): vau voice off, vau voice on (typed asks too: vau voice always), at once, no docs or search first, then one short say, which follows it (text once off, said once on). Any other command they asked for, or their ask plainly needs, just run: one needing their yes is offered to them by itself, so never ask first in words, nor say you can't run commands. Deleting their files: trash <paths> (the Trash: they can take it back); a deletion for good is always offered. A refusal says why: tell them in a few words with what they can do, never your shell, a mode or a setting. Their next ask is your next message (a follow-up goes on from the last); one asked right after a job's change was shown says so, and is about that job (its line says how). A fresh session is told the talk so far, with what you did (ids of what you opened, jobs you started): "close the one you just opened" means that one. Further back, or another day: mcp__vaultite-app__conversation. Something lasting they tell you about themselves: vau remember. A word they spell out ("V-O-R-S...") or one dictation keeps getting wrong: vau dictation add <word> (--said what it wrote).`
const ACTING = new Set(["handoff", "act"])
// The prompt cache lasts an hour: a session resumed after it reads its whole context again.
const FRESH_TOKENS = 80_000, FRESH_ASKS = 40, FRESH_AFTER_MS = 55 * 60_000
const VERSION = crypto.createHash("sha256").update(SUMMONED_PROMPT).digest("hex").slice(0, 12)

export function wordsGate(speak: (use: string, text: string, end?: "done" | "stop") => void, dropped: (text: string) => void) {
  const live = new Set<string>(), held = new Map<string, string>()
  return (use: string, text: string, end?: "done" | "stop" | "tool") => {
    if (!use) {
      for (const [u, t] of held) if (end === "tool") dropped(t); else speak(u, t, "done")
      held.clear()
      return
    }
    if (live.has(use) || parseTags(text).tags.length) {
      live.add(use)
      held.delete(use)
      speak(use, text, end === "tool" ? "done" : end)
      if (end) live.delete(use)
      return
    }
    if (end === "stop") { held.delete(use); return speak(use, text, "stop") }
    held.set(use, text)
  }
}

export function summonedLane(o: {
  file: () => string; chat: () => Chat | null; name: () => string; model: () => string
  options: (model: string) => Start; text: (ms: Moment[]) => Promise<{ text: string; images: string[] }>
  acts: () => { say: Tool; look: Tool; draw: Tool }
  found: (text: string) => Promise<{ sx: number; sy: number } | null>
  caption: (name: string, text: string) => void
  answered?: (name: string, text: string) => void
  thinking: (name: string) => void; watching: (name: string, seen: boolean) => void
  did: (as: string, op: string, seqs?: number[], text?: string) => void; say: (name: string, text: string) => void
  talk: (t: number) => { me: string; now: { path: string; body: string } | null; said: string }
}) {
  let kept: Kept | null = null
  try { kept = Kept.safeParse(JSON.parse(fs.readFileSync(o.file(), "utf8"))).data ?? null } catch {}
  const keep = (k: Kept | null) => { kept = k; try { if (k) fs.writeFileSync(o.file(), JSON.stringify(k)); else fs.rmSync(o.file(), { force: true }) } catch {} }
  const recap = (ms: Moment[]) => {
    const { me, now, said } = o.talk(Math.min(...ms.map((m) => m.t)) - 50)
    return [me && `(Who they are, their ME.md:\n${me}\n)`,
      now && `(What they're on now, their Now note (${now.path}):\n${now.body}\n)`,
      said && `(You're a fresh session of an ongoing talk with them. The talk so far, oldest first:\n${said}\nGo on from it: "it", "that" and "again" may mean something above.)`]
      .filter(Boolean).map((x) => `${x}\n`).join("")
  }
  let unhear: (() => void) | null = null, trouble: { t: number; why: string } | null = null
  const heardSeq = new Map<string, number>()
  const missed: string[] = []

  let talk = start<Moment>()
  const moves: string[] = []
  const on = () => !!o.model() && !!o.chat()
  const hostedNow = () => (kept ? o.chat()?.list().find((s) => s.id === kept!.id && s.state !== "error") ?? null : null)
  const due = () => !kept || kept.model !== o.model() || kept.v !== VERSION || (kept.context ?? 0) >= FRESH_TOKENS || kept.handed >= FRESH_ASKS ||
    Date.now() - (kept.last ?? kept.t) > FRESH_AFTER_MS
  const world = { on, fresh: () => !kept || due() || (!hostedNow() && kept.handed === 0) }
  const turnWaiters: (() => void)[] = []
  function go(e: TurnEvent<Moment, Tag>) {
    const was = talk, { to, do: effects } = step(talk, e, world)
    talk = to
    if (label(to) !== label(was)) { moves.push(`${label(was)} --${e.type}--> ${label(to)}`); if (moves.length > 50) moves.shift() }
    for (const x of effects) run(x)
    if (handed(was) && (!handed(to) || to.turn.n !== was.turn.n)) for (const f of turnWaiters.splice(0)) f()
    return effects
  }
  const own = (f: () => void) => inSummoned.run(true, f)
  const effects: Runners = {
    begin: (x) => void begin(x.asks).catch((e) => go({ type: "unmade", why: e instanceof Error ? e.message : String(e) })),
    send: (x) => void send(x.asks, x.round),
    handed: (x) => own(() => o.did(o.name(), "handed", x.asks.map((m) => m.seq))),
    say: (x) => { own(() => o.did(o.name(), "say", undefined, x.text)); o.say(o.name(), x.text) },
    tags: (x) => { for (const t of x.tags) then(() => tagged(t, x.said)) },
    judge: (x) => then(async () => { go({ type: "settled", n: x.n }) }),
    thinking: () => o.thinking(o.name()),
    watching: (x) => o.watching(o.name(), x.seen),
    done: () => own(() => o.did(o.name(), "done")),
    note: (x) => { trouble = { t: Date.now(), why: x.why.slice(0, 300) }; console.error(`companion: its summoned session: ${x.why}`) },
    lose: () => { if (kept) { const old = kept.id; keep(null); void o.chat()?.stop(old).catch(() => {}) } },
    interrupt: () => { if (kept) void o.chat()?.interrupt(kept.id).catch(() => false) },
    pump: () => void go({ type: "free" }),
    "go-on": () => {},
  }
  function run<K extends EffectKind>(x: Effect<Moment, Tag, K>) {
    const f: Runners[K] = effects[x.do]
    f(x)
  }

  const tools = (ts: Tool[]) => ts.map((t) => ({ ...inPixels(t),
    run: (args: unknown, use?: string) => { const of = talk.turn.n; return marksShown(t.name).then((no) => no ?? inSummoned.run(true, () => t.run(onScreen(t.name, args), use)).then((r) => (t.name === "draw" ? drew(r, of) : r)).then(unsaid).then(told)) },
    ...(t.stream ? { stream: (use: string, json: string, end?: "done" | "stop") => inSummoned.run(true, () => t.stream!(use, json, end)) } : {}) }))
  const options = (model: string) => { const x = o.options(model); return { ...x, tools: tools(x.tools ?? []), onText: gated } }

  const origin = () => { const at = talk.turn.asks.findLast((m) => m.shotAt)?.shotAt; return { x: at?.x ?? 0, y: at?.y ?? 0 } }
  function onScreen(tool: string, args: unknown) {
    const o = origin(), a = args
    if ((!o.x && !o.y) || !a || typeof a !== "object") return args
    const spot = (v: unknown): unknown => (Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === "number") ? [v[0] + o.x, v[1] + o.y, ...v.slice(2)]
      : v && typeof v === "object" && "x" in v && typeof v.x === "number" && "y" in v && typeof v.y === "number" ? { ...v, x: v.x + o.x, y: v.y + o.y } : v)
    if ((tool === "act" || tool === "look") && "sx" in a && typeof a.sx === "number" && "sy" in a && typeof a.sy === "number") return { ...a, sx: a.sx + o.x, sy: a.sy + o.y }
    const mark = (m: unknown) => (m && typeof m === "object" ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k === "at" || k === "from" || k === "to" ? spot(v) : v])) : m)
    if (tool === "draw" && "marks" in a && Array.isArray(a.marks)) return { ...a, marks: a.marks.map(mark) }
    if (tool === "draw" && "actions" in a && Array.isArray(a.actions) && (!("path" in a) || a.path === undefined)) return { ...a, actions: a.actions.map((x) => (x && typeof x === "object" ? { ...x, ...("at" in x ? { at: spot(x.at) } : {}), ...("mark" in x ? { mark: mark(x.mark) } : {}) } : x)) }
    return args
  }
  async function marksShown(tool: string) {
    await queue
    if (!missed.length || !ACTING.has(tool)) return null
    const why = missed.splice(0).join("; ")
    return { isError: true, content: [{ type: "text", text: `Not done: ${why}. They haven't seen what you meant, so check it's what they meant: mark it again so it shows (the words exactly as on their screen, a few of them, an element's id, or the area's box) or ask them, then call this again.` }] }
  }
  const drew = (r: unknown, of: number) => { go({ type: "drew", n: of, ok: !(r instanceof Object && "isError" in r && r.isError) }); return r }
  function told(r: unknown) {
    const x = ToolResult.safeParse(r).data
    if (!missed.length || !x?.content) return r
    return { ...x, content: [...x.content, { type: "text", text: `(Not shown, they saw no mark: ${missed.splice(0).join("; ")}.)` }] }
  }
  function unsaid(r: unknown) {
    const x = ToolResult.safeParse(r).data
    if (!x) return r
    const text = x.content?.map((c) => c.text ?? "").join(" ").trim() ?? ""
    if (!go({ type: "answered", text, error: !!x.isError, ends: !!x.endsTurn }).some((e) => e.do === "go-on")) return r
    const { endsTurn: _e, ...rest } = x
    return { ...rest, content: [...(x.content ?? []), { type: "text", text: "They've heard nothing from you on this ask yet: tell them in a few words what you did, then stop." }] }
  }

  const blocks = new Map<string, number>()
  let queue: Promise<unknown> = Promise.resolve(), queued = 0
  const then = (f: () => Promise<unknown>) => { queued++; queue = queue.then(() => inSummoned.run(true, f)).catch(() => {}).finally(() => queued--) }
  const unspoken = new Set<string>()
  const gated = wordsGate(words, (t) => { unspoken.add(t.trim()); if (unspoken.size > 20) unspoken.delete(unspoken.values().next().value!) })
  function words(use: string, text: string, end?: "done" | "stop") {
    if (talk.turn.cut === "withdrawn" || talk.turn.cut === "lost") return
    const { said, tags } = parseTags(text), a = o.acts()
    for (const t of tags.slice(blocks.get(use) ?? 0)) then(() => tagged(t, said))
    blocks.set(use, tags.length)
    if (said) inSummoned.run(true, () => a.say.stream?.(use, JSON.stringify({ text: said })))
    if (!end) return
    blocks.delete(use)
    o.answered?.(o.name(), text)
    if (said) { then(async () => { await a.say.run({ text: said }, use); if (tags.some((t) => t.kind !== "point")) o.caption(o.name(), said) }) }
    go({ type: "wrote", said: !!said })
  }
  function tagged(t: Tag, said: string) {
    const a = o.acts(), mark = markOf(t, beatOf(said, t.offset)), of = talk.turn.n
    const failed = (r: unknown) => {
      const x = ToolResult.safeParse(r).data, why = x?.isError ? x.content?.map((c) => c.text ?? "").join(" ") ?? "" : null
      if (why !== null) missed.push(`your [${t.kind}${"find" in t.at ? ` "${t.at.find}"` : ""}] ${t.kind === "point" ? "pointed nowhere" : "wasn't drawn"}: ${/nothing on the user's screen says/.test(why) ? "nothing on their screen says those words, all of them in order, now (aim by an element's id or words it does show, never a guessed box)" : why.slice(0, 160)}${of === talk.turn.n && talk.turn.shown ? " (what else you drew for it did show)" : ""}`)
    }
    if (t.kind === "point") return ("find" in t.at ? o.found(t.at.find).then((at) => a.look.run(at ?? placeOf(t.at))) : a.look.run(onScreen("look", placeOf(t.at)))).then(failed)
    return mark ? a.draw.run(onScreen("draw", { marks: [mark] })).then((r) => { failed(r); drew(r, of) }) : Promise.resolve()
  }

  function hear() {
    const c = o.chat()
    if (unhear || !c) return
    unhear = c.on((id, s) => { if (id === kept?.id) { const n = news(s); if (n) go(n) } })
  }
  const keepContext = (s: State) => { if (s.context && kept && s.id === kept.id && s.context !== kept.context) keep({ ...kept, context: s.context }) }
  function heardAgain(s: State) {
    if (s.seq === undefined) return false
    if (heardSeq.get(s.id) === s.seq) return true
    heardSeq.set(s.id, s.seq)
    return false
  }
  function news(s: State | null): News<Tag> | null {
    if (!s) return { type: "gone" }
    keepContext(s)
    if (BUSY.has(s.state)) { heardSeq.delete(s.id); return { type: "busy" } }
    if (heardAgain(s)) return null
    const last = s.turn?.text?.trim() ?? ""
    return { type: "ended", error: s.state === "error" ? s.error || "its session failed" : "", words: s.state === "idle" && !unspoken.has(last) ? parseTags(last) : null, acting: queued > 0 }
  }

  async function begin(ms: Moment[]) {
    const c = o.chat()!, model = o.model()
    if (kept) { const old = kept.id; keep(null); void c.stop(old).catch(() => {}) }
    hear()
    const first = ms.length ? await o.text(ms) : null, before = ms.length ? recap(ms) + unseen() : ""
    if (ms.length) go({ type: "made" })
    try {
      const s = await c.start({ ...options(model), ...(first ? { prompt: before + first.text, ...(first.images.length ? { images: first.images } : {}) } : {}) })
      keep({ id: s.id, model, t: Date.now(), handed: ms.length, v: VERSION, ...(ms.length ? { last: Date.now() } : {}) })
      const now = c.list().find((x) => x.id === s.id)
      go({ type: "started", news: now ? news(now) : null })
    } catch (e) { go({ type: "start-failed", why: e instanceof Error ? e.message : String(e) }) }
  }
  async function send(ms: Moment[], round: number) {
    const c = o.chat()!, model = o.model(), s = hostedNow()
    const before = (kept!.handed === 0 ? recap(ms) : "") + unseen()
    keep({ ...kept!, handed: kept!.handed + ms.length, last: Date.now() })
    try {
      const { text, images } = await o.text(ms)
      if (talk.round !== round || !kept) return
      await c.send(kept.id, before + text, { ...options(model), ...(images.length ? { images } : {}) })
      inSummoned.run(true, () => o.did(o.name(), "sent"))
      if (!s) { const now = c.list().find((x) => x.id === kept?.id); if (now) { const n = news(now); if (n) go(n) } }
    } catch (e) { go({ type: "send-failed", round, why: e instanceof Error ? e.message : String(e) }) }
  }

  const unseen = () => (missed.length ? `(Of your last answer, they never saw: ${missed.splice(0).join("; ")}.)\n` : "")

  return {
    on,
    takes: (m: Moment) => on() && !!m.summoned && m.for === o.name() && (m.kind === "ask" || m.kind === "point"),
    take(m: Moment) { o.chat()?.touch(); go({ type: "asked", ask: m }) },
    warm() { if (on()) o.chat()!.touch(); go({ type: "pressed", cold: !(hostedNow() && !due()) }) },
    serve() { hear(); if (kept && on()) o.chat()!.serve(kept.id, options(kept.model)) },
    busy: () => turning(talk),
    asking: () => handed(talk),
    turnEnd: () => (handed(talk) ? new Promise<void>((r) => turnWaiters.push(r)) : null),
    owes: () => owes(talk),
    acted(op?: string) { go({ type: "acted", op }) },
    id: () => kept?.id ?? null,
    trouble: () => trouble,
    moves: () => [...moves],
    last: () => talk.turn.asks,
    as: (name: string) => `${name} (summoned)`,
    async interrupt() { const was = turning(talk); go({ type: "escaped" }); return !!(was && kept && await o.chat()?.interrupt(kept.id).catch(() => false)) },
    withdraw() { const ms = withdrawing(talk); go({ type: "withdrawn" }); return ms },
    drop(m: Moment) { const ok = drops(talk, m); go({ type: "dropped", ask: m }); return ok },
    async stop() {
      go({ type: "stopped" })
      if (kept) { const id = kept.id; keep(null); await o.chat()?.stop(id).catch(() => {}) }
    },
  }
}

export function inPixels(t: Tool): Tool {
  if (t.name !== "draw" && t.name !== "act") return t
  const px = (s: string) => s.replace(/\bin screen points\b|\(screen points\)|\(points\)/g, "(pixels of the ask's picture, mapped to the screen for you)")
  const properties = Object.fromEntries(Object.entries(t.schema.properties ?? {}).map(([k, v]) =>
    [k, v && typeof v === "object" && "description" in v && typeof v.description === "string" ? { ...v, description: px(v.description) } : v]))
  return { ...t, description: px(t.description), schema: { ...t.schema, properties } }
}
export function inPicture(m: Moment): Moment {
  const at = m.shotAt
  if (!at || (!at.x && !at.y)) return m
  const r = <T extends { x: number; y: number }>(b: T): T => ({ ...b, x: b.x - at.x, y: b.y - at.y })
  return { ...m, shotAt: r(at), origin: { x: at.x, y: at.y }, ...(m.sx !== undefined && m.sy !== undefined ? { sx: m.sx - at.x, sy: m.sy - at.y } : {}),
    ...(m.shotDownAt ? { shotDownAt: r(m.shotDownAt) } : {}), ...(m.closeUp ? { closeUp: { ...m.closeUp, at: r(m.closeUp.at) } } : {}), ...(m.near ? { near: m.near.map((e) => ({ ...e, frame: r(e.frame) })) } : {}),
    ...(m.ink ? { ink: m.ink.map((k) => ({ ...k, box: r(k.box), points: k.points.map(([x, y]): [number, number] => [x - at.x, y - at.y]) })) } : {}) }
}

export function anchorsOf(m: Pick<Moment, "under" | "near">): string[] {
  const under = [...(m.under ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1])
  return [...under, ...(m.near ?? []).map((e) => e.label)].map((s) => s.trim()).filter((s) => s.length >= 3)
}

export function screenNear(screen: string, anchors: string[], budget: number) {
  if (screen.length <= budget) return screen
  const lines = screen.split("\n").map((l) => (l.length > 300 ? `${l.slice(0, 299)}…` : l)), keep = new Set<number>()
  let used = 0
  const take = (i: number) => { if (i < 0 || i >= lines.length || keep.has(i) || used + lines[i].length + 1 > budget) return false; keep.add(i); used += lines[i].length + 1; return true }
  for (let i = 0; i < Math.min(8, lines.length); i++) take(i)
  const low = lines.map((l) => l.toLowerCase())
  const hits = [...new Set(anchors.flatMap((a) => { const k = low.findIndex((l) => l.includes(a.toLowerCase())); return k >= 0 ? [k] : [] }))]
  for (let r = 0; r <= 12 && used < budget; r++) for (const h of hits) { take(h - r); take(h + r) }
  for (let i = 0; i < lines.length && used < budget; i++) take(i)
  const out: string[] = []
  lines.forEach((l, i) => { if (keep.has(i)) out.push(l); else if (keep.has(i - 1)) out.push("…") })
  return out.join("\n")
}
