import { requestWriter } from "../../../core/vault.ts"
import { placeText } from "../../../core/desktop/places.ts"
import { AS, PLACE, target, who } from "./args.ts"
import { plugin } from "./self.ts"
import type { Moment, Note } from "./types.ts"
import { sayMs, wakes, str, mode } from "./settings.ts"
import { moments, seq, delivered, handed, asking, waiters, agents, seen, ends, dead, watching, notes, timers, did, showed, broadcast, key, isMain, meantFor, focus, placeOf, batches, ROOTS, setAgent, putNote, dropNote, life, atWork, stateOf } from "./state.ts"
import { keepSaid } from "./comments.ts"
import { paneById, headAware, resolve } from "./windowpanes.ts"
import { streams, toolUse, answering } from "./edits.ts"
import { session, writeSession, ASK_AGAIN, handing, fresh, due, handOver } from "./alwayson.ts"
import { excerpts, momentsText } from "./momentstext.ts"


plugin.op({
  id: "companion.next",
  cli: "companion next",
  summary: "Wait for what the user does next in the app (asks you, writes, opens a note, answers you), as the companion.",
  help: `Answers the moments since you last asked, or waits for one (up to timeout seconds; none by then: an empty list).
ask: they addressed you, a line with your @name (it stays in their note), @claude in a comment of theirs or Ask
companion (answer in that thread, companion comment --id). Always answer. edit: lines they changed after a pause (pair
mode): answer what's meant for you, @name or not; writing to themselves, pass. point: an ask without words (they held
your Talk key and drew or pointed): look there and answer, as for an ask. open: the note they went to, with the next moment. reply,
accept, reject, dismiss: their answer to your comment, suggestion or bubble. move: they moved your words, a bubble into
the note or what you wrote back into a bubble: a hint for next time. Lines count from 1 with the frontmatter. Asks,
replies and edits come with the note's text around them, numbered: no need to read it again. While you wait your cursor
rests; given moments, it shows you reading (thinking, for an ask) there until you act, or run this again: the user sees
a seen tick (companion pass says why). Run it again after acting, forever. With several agents (--as), each gets the
asks to its @name and answers to its items; edit and open go to the companion, or to an agent with --watch.

  vau companion next --timeout 240`,
  kind: "read",
  lock: false,
  params: {
    timeout: { type: "integer", minimum: 0, maximum: 240, default: 100, description: "seconds to wait for a moment" },
    after: { type: "integer", minimum: 0, description: "only moments after this one (default: after the last you were given)" },
    as: AS,
    watch: { type: "boolean", description: "also get edit and open moments (pair mode), which only the companion gets otherwise" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
  },
  run: async (p, ctx) => {
    const name = who(p), k = key(name), era = ends.get(k)
    const over = () => ({ mode: mode(), focus: null, moments: [], cursor: delivered.get(k) ?? 0, notes: [], ended: true })
    if (p.terminal && dead.has(p.terminal)) return over()
    seen.set(k, Date.now())
    if (p.watch) watching.add(k)
    else watching.delete(k)
    did(name, "next")
    const joined = !agents.has(k), was = joined ? null : stateOf(name)
    asking.delete(k); life.delete(k); atWork.delete(k)
    if (handed.delete(k)) setAgent(name, { seen: true })
    else if (joined || stateOf(name) !== was || was === "writing") setAgent(name, {})
    const after = p.after ?? delivered.get(k) ?? Math.max(0, seq - 20)
    const pending = () => pendingFor(name, after)
    let got = pending()
    const sess = !got.some(wakes) ? session(name) : null
    const handover = () => {
      fresh.delete(k); handing.set(k, Date.now())
      did(name, "asked to hand over")
      return { mode: mode(), focus: focus(), moments: [], cursor: after, notes: [], handover: true, as: isMain(name) ? "" : name }
    }
    if (sess && (fresh.has(k) || (Date.now() - (handing.get(k) ?? 0) > ASK_AGAIN && await due(sess)))) return handover()
    if (!got.some(wakes) && p.timeout > 0) {
      waiters.get(k)?.([])
      const woken = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(k) === wake) waiters.delete(k); resolve(false) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m.length > 0) }
        waiters.set(k, wake)
      })
      if (ends.get(k) !== era) return over()
      got = woken ? pending() : []
      seen.set(k, Date.now())
      if (!got.length && fresh.has(k) && session(name)) return handover()
    }
    if (got.length) got = hand(name, got)
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(k) ?? after, notes: await excerpts(ctx, got), ...(got.length && headAware(name) ? { aware: headAware(name) } : {}) }
  },
  text: (r) => ("ended" in r ? "Your session has ended: stop here, without running next again." : "handover" in r ? handoverAsk(r.as) : momentsText(r.moments, r.mode, r.focus, r.notes, r.aware)),
})

export const pendingFor = (name: string, after = delivered.get(key(name)) ?? Math.max(0, seq - 20)) =>
  moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000 && meantFor(m, name))

export function hand(name: string, got: Moment[]) {
  const k = key(name)
  delivered.set(k, got[got.length - 1].seq)
  got = got.filter((m, i) => m.kind !== "open" || !got.slice(i + 1).some((x) => x.kind === "open"))
  const s = session(name)
  if (s) { try { writeSession({ ...s, handed: (s.handed ?? 0) + got.length }) } catch {} }
  did(name, "handed", got.map((m) => m.seq))
  batches.set(k, got.map((m) => m.seq))
  const at = [...got].reverse().find((m) => m.path || m.pane || m.ui), asked = got.some((m) => m.kind === "ask" || m.kind === "point" || m.kind === "reply")
  if (asked) asking.add(k)
  handed.add(k)
  setAgent(name, at ? placeOf(at) : {})
  return got
}

export const handoverAsk = (as: string, chat = false) => `Time for a fresh session: this one has grown long. In a few lines, write what the next one should know (what the user is working on, what they asked you to keep in mind, anything you promised), then ${chat ? "call your handover tool with those lines" : `run \`vau companion handover${as ? ` --as ${as}` : ""} "<those lines>"\``}. It starts the new session, which takes over your cursor and threads; then end your turn.`

plugin.op({
  id: "companion.handover",
  cli: "companion handover",
  summary: "Hand over to a fresh session (when next asks you to): it starts with your summary and open threads; then end your turn.",
  help: `  vau companion handover "Alice is planning the Lisbon trip; I promised to check the budget note tomorrow."`,
  kind: "write",
  lock: false,
  params: { summary: { type: "string", description: "what the next session should know, in a few lines" }, as: AS },
  args: ["summary"],
  run: async (p, ctx) => await handOver(ctx, who(p), str(p.summary)),
  text: (r) => `Handed over to ${r.id}: end your turn now.`,
})


plugin.op({
  id: "companion.look",
  cli: "companion look",
  summary: "Move your cursor to a place, without a word: in a note, a pane (a terminal's row, a page's element) or the app's own UI.",
  help: `  vau companion look --path Notes/Idea.md --line 12
  vau companion look --find "the second paragraph"
  vau companion look --path Drawings/Plan.excalidraw --find login
  vau companion look --ui tab:t3k2
  vau companion look --pane t3k2 --find "error:"
  vau companion look --pane t5x1 --el e12`,
  kind: "read",
  params: { ...PLACE, as: AS },
  run: async (p) => {
    const name = who(p), t = await resolve(target(p, true), name)
    const at = t.frame ? { x: t.frame.x, y: t.frame.y, w: t.frame.width, h: t.frame.height } : t.sx !== undefined && t.sy !== undefined ? { x: t.sx, y: t.sy } : undefined
    const on = at ? undefined : placeText(t, t.pane ? paneById(t.pane)?.title : undefined)
    showed(name, [{ t: Date.now(), what: "your cursor pointed", ...(at ? { at } : { on }) }])
    did(name, "look", undefined, at ? `at ${Math.round(at.x)},${Math.round(at.y)} on the screen` : `at ${on}`)
    setAgent(name, { ...t, pointed: Date.now() })
    return t
  },
  text: (r) => `Looking at ${placeText(r, paneById(r.pane)?.title)}.`,
})

plugin.op({
  id: "companion.say",
  cli: "companion say",
  summary: "Say something in a bubble by your cursor: your voice, for answers in the moment, how something works, quick replies.",
  help: `As long as it needs, no longer: it stays a while, longer the more it says, and its history is a click on your cursor.
With a place, your cursor goes there first. With ask, it's a question (shown as one, with a box to answer); ignored, it
fades, which means "stay quiet". What they'd want in the note tomorrow goes in it (edit); a thought by a line, a comment.

  vau companion say "Done: three tasks added below."
  vau companion say "That date is a Sunday." --find "May 3"
  vau companion say "For you, or a note to yourself?" --ask
  vau companion say "This step needs a way back." --path Drawings/Plan.excalidraw --find login
  vau companion say "That's the failing test." --pane t3k2 --find "FAIL"
  vau companion say "Your sidebar's search is here." --ui button:switcher:open`,
  kind: "read",
  params: { ...PLACE, ask: { type: "boolean", description: "it asks them something: a question bubble they can answer in" },
    text: { type: "string", required: true, description: "what to say (Markdown)" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p)
    did(name, "say", undefined, str(p.text))
    const given = ROOTS.some((k) => p[k] !== undefined) || p.line !== undefined || p.find || p.x !== undefined
    const t = given ? await resolve(target(p, true), name) : {}
    setAgent(name, { ...t, ...(given ? { pointed: Date.now() } : {}) })
    const use = toolUse.getStore(), shown = use ? streams.get(use)?.note : undefined, was = shown ? notes.get(shown) : undefined
    if (shown && !was) {
      const n: Note = { id: shown, kind: "say", agent: name, text: str(p.text), ...t, t: Date.now(), seen: true }
      keepSaid(n)
      return n
    }
    if (was) {
      Object.assign(was, { text: str(p.text), ...t, ...(p.ask ? { question: true } : {}) })
      broadcast({ t: "note", note: was })
      clearTimeout(timers.get(was.id))
      timers.set(was.id, setTimeout(() => dropNote(was.id), sayMs(str(p.text))))
    }
    const answers = was ? undefined : answering(name)
    const n = was ?? putNote({ kind: "say", agent: name, text: str(p.text), ...t, ...(p.ask ? { question: true } : {}), ...(answers ? { answers } : {}), writer: requestWriter.getStore() ?? { client: ctx.who.client, agent: ctx.who.agent } }, sayMs(str(p.text)))
    keepSaid(n)
    return n
  },
  text: () => "Said.",
})
