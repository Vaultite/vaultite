import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import type { Chat, ChatState } from "../../../plugins/core/companion/chat.ts"
import type { Moment } from "../../../plugins/core/companion/types.ts"
import { inSummoned, type Lane, summonedLane } from "../../../plugins/core/companion/summoned.ts"

const BOOKKEEPING = new Set(["next", "handed", "sent", "done", "again", "result", "withdrawn", "talked", "shown"])
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((ok) => setImmediate(ok)) }

type Held = { what: string; ok: () => void; no: (why: string) => void }
type Bench = { log: string[]; held: Held[]; hold: boolean; on: boolean; textFails: number; sessions: Map<string, ChatState>; n: number; seq: number
  marks: boolean[]; results: Any[]; onText: Any; tools: Any[]; agent: Any; lane: Lane | null }

/** The summoned lane over a made-up chat and plugin: everything it does lands in `log`, in order. `hold`: its chat's
 *  start and send, and its asks' text, wait in `held` till let go. */
export function laneRig(make: typeof summonedLane = summonedLane, store: typeof inSummoned | null = null) {
  const quick = store ?? inSummoned
  const log: string[] = [], sessions = new Map<string, ChatState>(), ears = new Set<(id: string, s: ChatState | null) => void>()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talkturn-"))
  const held: Held[] = []
  const r: Bench = { log, held, hold: false, on: true, textFails: 0, sessions, n: 0, seq: 0, marks: [], results: [], onText: null, tools: [], agent: undefined, lane: null }
  const later = <T>(what: string, v: () => T) => new Promise<T>((ok, no) => {
    const go = () => { try { ok(v()) } catch (e) { no(e) } }
    if (r.hold) held.push({ what, ok: go, no: (why) => no(new Error(why)) }); else queueMicrotask(go)
  })
  const emit = (id: string, s: ChatState | null) => { if (s) sessions.set(id, s); else sessions.delete(id); for (const f of ears) f(id, s) }
  const did = (_as: string, op: string, seqs?: number[], text?: string) => {
    log.push(`did:${op}${seqs ? `[${seqs}]` : ""}${text ? ` ${text}` : ""}`)
    if (!BOOKKEEPING.has(op) && quick.getStore()) r.lane?.acted(op)
  }
  const tool = (name: string, run: (args: Any) => Any) => ({ name, description: `${name} (in screen points)`, schema: { properties: {} }, run: async (args: Any) => run(args) })
  const marked = () => { const ok = r.marks.length ? r.marks.shift()! : true; return ok ? { content: [{ type: "text", text: "Drew it." }] } : { isError: true, content: [{ type: "text", text: "nothing on the user's screen says that" }] } }
  const chat: Chat = {
    start: (x: Any) => { log.push(`start:${x.prompt ? "asked" : "warm"}`); r.onText = x.onText; r.tools = x.tools
      return later("start", () => { const id = `s${++r.n}`, s: ChatState = { id, state: x.prompt ? "working" : "idle" }; sessions.set(id, s); return s }) },
    send: (id: string, _text: string, x: Any) => { log.push(`send:${id}`); r.onText = x.onText; r.tools = x.tools; return later("send", () => { if (!sessions.has(id)) throw new Error("no such session") }) },
    stop: async (id: string) => { log.push(`stop:${id}`); emit(id, null) },
    interrupt: async (id: string) => { log.push(`interrupt:${id}`); return true },
    list: () => [...sessions.values()], touch: () => {}, serve: () => {}, asking: () => [],
    on: (f) => { ears.add(f); return () => ears.delete(f) },
  }
  const lane = make({
    file: () => path.join(dir, "summoned.json"), chat: () => (r.on ? chat : null), name: () => "Claude", model: () => (r.on ? "haiku" : ""),
    options: () => ({ tools: [tool("draw", () => { did("Claude", "draw"); return marked() }), tool("act", () => { did("Claude", "act"); return r.results.shift() ?? { content: [{ type: "text", text: "Pressed Send." }] } }),
      tool("pass", () => { did("Claude", "pass"); return { endsTurn: true, content: [{ type: "text", text: "Passed." }] } }),
      tool("end", () => ({ endsTurn: true, content: [{ type: "text", text: "Opened the page." }] })), tool("see", () => r.results.shift() ?? { content: [{ type: "text", text: "A page about cats (pane p1)." }] }), tool("handoff", () => { did("Claude", "handoff"); return { content: [{ type: "text", text: "Handed off." }] } })] }),
    text: (ms) => { log.push(`text:${ms.map((m) => m.seq)}`); return later("text", () => { if (r.textFails && r.textFails--) throw new Error("no picture"); return { text: ms.map((m) => m.text).join("\n"), images: [] } }) },
    acts: () => ({ say: { ...tool("say", (a) => { log.push(`said:${a.text}`); did("Claude", "say") }), stream: () => {} },
      look: tool("look", () => { did("Claude", "look"); return { content: [{ type: "text", text: "Looked." }] } }), draw: tool("draw", () => { did("Claude", "draw"); return marked() }) }),
    found: async () => null, caption: () => {}, answered: () => {},
    thinking: () => { if (r.agent !== "thinking") { r.agent = "thinking"; log.push("agent:thinking") } },
    watching: (_n, seen) => { r.agent = "watching"; log.push(`agent:watching${seen ? "+seen" : ""}`) },
    did, say: (_n, text) => log.push(`say:${text}`), talk: () => ({ me: "", now: null, said: "" }),
  })
  r.lane = lane
  const id = () => lane.id() ?? [...sessions.keys()].at(-1)!
  return Object.assign(r, {
    lane, settle, dir,
    ask: (seq: number, more: Partial<Moment> = {}) => { const m: Moment = { seq, t: Date.now(), kind: "ask", text: `ask ${seq}`, summoned: true, for: "Claude", ...more }; lane.take(m); return m },
    busy: () => emit(id(), { id: id(), state: "working" }),
    idle: (text = "") => emit(id(), { id: id(), state: "idle", seq: ++r.seq, turn: { text } }),
    error: (error: string) => emit(id(), { id: id(), state: "error", error, seq: ++r.seq }),
    gone: () => emit(id(), null),
    words: (use: string, text: string, end?: "done" | "stop" | "tool") => r.onText(use, text, end),
    run: (name: string, args: Any = {}) => r.tools.find((t: Any) => t.name === name).run(args, "u"),
    let: (what?: string, no?: string) => { const i = held.findIndex((h) => !what || h.what === what); const [h] = held.splice(i, 1); if (no) h.no(no); else h.ok() },
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  })
}
export type Rig = ReturnType<typeof laneRig>
type Scenario = [play: (r: Rig) => Promise<void>, log: string]

/** The summoned lane's scenarios, each a past fix's, and what it logs in order, its lane stopped at the end. */
export const SCENARIOS = {
  "warm, then an ask goes to that session and is answered in words": [async (r) => {
    r.lane.warm(); await r.settle()
    r.ask(1); await r.settle(); r.busy()
    r.words("u1", "[point a1] It's that one.", "done"); r.words("", "", "done"); await r.settle()
    r.idle("[point a1] It's that one."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:look | said:It's that one. | did:say | agent:watching | did:done | stop:s1"],
  "an ask with no session starts a fresh one with it as its first message": [async (r) => {
    r.ask(1); await r.settle()
    r.words("u1", "Hello.", "done"); r.words("", "", "done"); await r.settle()
    r.idle("Hello."); await r.settle()
  }, "text:1 | did:handed[1] | start:asked | agent:thinking | said:Hello. | did:say | agent:watching | did:done | stop:s1"],
  "a turn ending with nothing said says what its last tool did (563f1b3e)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    await r.run("see"); r.idle(""); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say A page about cats. | say:A page about cats. | agent:watching | did:done | stop:s1"],
  "a tool that failed, its last, is said as what it couldn't do": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.results.push({ isError: true, content: [{ type: "text", text: "the page isn't open (pane p1)." }] }); await r.run("see"); r.idle(""); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say I couldn't: the page isn't open. | say:I couldn't: the page isn't open. | agent:watching | did:done | stop:s1"],
  "a turn ending with nothing at all says it got nowhere": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.idle(""); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say I didn't get to an answer on that one. Ask me again? | say:I didn't get to an answer on that one. Ask me again? | agent:watching | did:done | stop:s1"],
  "a tool ending the turn before a word is told to say what it did (563f1b3e)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.log.push(`result:${JSON.stringify(await r.run("end"))}`); r.log.push(`result:${JSON.stringify(await r.run("pass"))}`)
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | result:{\"content\":[{\"type\":\"text\",\"text\":\"Opened the page.\"},{\"type\":\"text\",\"text\":\"They've heard nothing from you on this ask yet: tell them in a few words what you did, then stop.\"}]} | did:pass | result:{\"endsTurn\":true,\"content\":[{\"type\":\"text\",\"text\":\"Passed.\"}]} | stop:s1"],
  "a tool ending the turn after its words ends it": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.words("u1", "[point a1] Sure.", "done"); await r.settle()
    r.log.push(`result:${JSON.stringify(await r.run("end"))}`)
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:look | said:Sure. | did:say | result:{\"endsTurn\":true,\"content\":[{\"type\":\"text\",\"text\":\"Opened the page.\"}]} | stop:s1"],
  "a mark that never showed, its only answer, says so once (09b4c2ef)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.marks.push(false); await r.run("draw", { marks: [{ kind: "ring", at: [1, 2] }] }); r.idle(""); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:draw | did:say I couldn't mark that on your screen. | say:I couldn't mark that on your screen. | agent:watching | did:done | stop:s1"],
  "a mark still drawing as its turn ends: judged once it's done, said once (36986ac1)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.marks.push(false); r.words("u1", "[ring \"Send\"]", "done"); r.idle("[ring \"Send\"]"); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | agent:watching+seen | did:done | did:draw | did:say I couldn't mark that on your screen. Ask me again? | say:I couldn't mark that on your screen. Ask me again? | stop:s1"],
  "a mark still drawing that shows: nothing more said (36986ac1)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.words("u1", "[ring \"Send\"]", "done"); r.idle("[ring \"Send\"]"); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | agent:watching+seen | did:done | did:draw | stop:s1"],
  "narration before a tool is dropped, never said at its turn's end (0cc2cb68)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.words("u1", "Let me look.", "done"); r.words("", "", "tool"); await r.run("handoff"); r.idle("Let me look."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:handoff | agent:watching+seen | did:done | stop:s1"],
  "words that didn't stream are said whole at its turn's end": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.idle("[point a2] Over here."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say Over here. | say:Over here. | agent:watching | did:done | did:look | stop:s1"],
  "its session gone mid-ask: the ask goes again, once, to a fresh one (09b4c2ef)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.gone(); await r.settle()
    r.words("u1", "Done.", "done"); r.words("", "", "done"); await r.settle(); r.idle("Done."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | text:1 | did:handed[1] | start:asked | said:Done. | did:say | agent:watching | did:done | stop:s2"],
  "its session lost twice: one short line, never a third try (09b4c2ef)": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.gone(); await r.settle(); r.gone(); await r.settle()
    r.ask(2); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | text:1 | did:handed[1] | start:asked | did:say I lost my session there, ask me again? | say:I lost my session there, ask me again? | agent:watching | stop:s2 | text:2 | did:handed[2] | start:asked | agent:thinking | stop:s3"],
  "its session lost twice with another ask waiting: that one still goes": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.gone(); await r.settle()
    r.ask(2); await r.settle(); r.gone(); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | text:1 | did:handed[1] | start:asked | did:say I lost my session there, ask me again? | say:I lost my session there, ask me again? | agent:watching | stop:s2 | text:2 | did:handed[2] | start:asked | agent:thinking | stop:s3"],
  "its session failing mid-ask: retried, the error never said": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.error("Not connected"); await r.settle()
    r.idle("Fine."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | text:1 | did:handed[1] | start:asked | did:say Fine. | say:Fine. | agent:watching | did:done | stop:s2"],
  "an error after it answered: noted, not retried": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.words("u1", "Sure.", "done"); r.words("", "", "done"); await r.settle()
    r.error("overloaded"); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | said:Sure. | did:say | agent:watching | did:done | stop:s1"],
  "a send that fails is retried on a fresh session": [async (r) => {
    r.lane.warm(); await r.settle(); r.hold = true; r.ask(1); await r.settle(); r.let("text"); await r.settle(); r.let("send", "socket closed"); await r.settle()
    r.hold = false; while (r.held.length) { r.let(); await r.settle() } await r.settle(); r.idle("Ok."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | stop:s1 | text:1 | did:handed[1] | start:asked | agent:thinking | did:say Ok. | say:Ok. | agent:watching | did:done | stop:s2"],
  "a send failing after its words came ends its turn, never asked again": [async (r) => {
    r.lane.warm(); await r.settle(); r.hold = true; r.ask(1); await r.settle(); r.let("text"); await r.settle()
    r.words("u1", "[point a1] Sure.", "done"); await r.settle(); r.let("send", "socket closed"); r.hold = false; await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:look | said:Sure. | did:say | agent:watching | did:done | stop:s1"],
  "its session lost as its message was made: the late send is dropped (round)": [async (r) => {
    r.lane.warm(); await r.settle(); r.hold = true; r.ask(1); await r.settle(); r.gone(); await r.settle()
    r.hold = false; while (r.held.length) { r.let(); await r.settle() } await r.settle(); r.idle("Ok."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | stop:s1 | text:1 | did:handed[1] | start:asked | agent:thinking | did:say Ok. | say:Ok. | agent:watching | did:done | stop:s2"],
  "a start that fails: retried once, then one short line": [async (r) => {
    r.hold = true; r.ask(1); await r.settle(); r.let("text"); await r.settle(); r.let("start", "spawn failed"); await r.settle()
    r.let("text"); await r.settle(); r.let("start", "spawn failed"); await r.settle()
  }, "text:1 | did:handed[1] | start:asked | text:1 | did:handed[1] | start:asked | did:say I lost my session there, ask me again? | say:I lost my session there, ask me again? | agent:watching"],
  "a fresh session's first message that can't be made: tried once more, then one short line": [async (r) => {
    r.textFails = 2; r.ask(1); await r.settle()
  }, "text:1 | text:1 | did:say I lost my session there, ask me again? | say:I lost my session there, ask me again? | agent:watching"],
  "a warm start that fails is noted, nothing said": [async (r) => {
    r.hold = true; r.lane.warm(); await r.settle(); r.let("start", "spawn failed"); await r.settle()
  }, "start:warm"],
  "an ask while it warms waits for its start, then goes to it (no stale idle ends it)": [async (r) => {
    r.hold = true; r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.let("start"); await r.settle()
    r.hold = false; while (r.held.length) { r.let(); await r.settle() } r.busy(); r.idle("[point a1] Here."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say Here. | say:Here. | agent:watching | did:done | did:look | stop:s1"],
  "asks meanwhile wait for its turn's end, then go together": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.ask(2); r.ask(3); await r.settle()
    r.log.push(`busy:${r.lane.busy()} asking:${r.lane.asking()}`)
    r.idle("[point a1] One."); await r.settle(); r.busy(); r.idle("[point a1] Two and three."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | busy:true asking:true | did:say One. | say:One. | agent:watching | did:done | did:handed[2,3] | text:2,3 | did:look | send:s1 | did:sent | agent:thinking | agent:watching | did:done | stop:s1"],
  "turned off with asks waiting: they're told it's off": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.ask(2); r.on = false; r.idle("[point a1] One."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say One. | say:One. | agent:watching | did:done | did:say My session's off right now, so I couldn't answer that. | say:My session's off right now, so I couldn't answer that. | agent:watching | did:look"],
  "Esc stops its turn: nothing more said for it": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.log.push(`stopped:${await r.lane.interrupt()}`); r.idle(""); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | interrupt:s1 | stopped:true | agent:watching+seen | did:done | stop:s1"],
  "the realtime voice answered alone: its turn withdrawn, its words unsaid (5f46a27c)": [async (r) => {
    r.lane.warm(); await r.settle(); const m = r.ask(1); await r.settle(); r.busy()
    const w = r.lane.withdraw(); r.log.push(`withdrew:${w.map((x: Moment) => x.seq)} same:${w[0] === m}`); await r.settle()
    r.words("u1", "[point a1] Words.", "done"); r.idle("[point a1] Words."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | interrupt:s1 | withdrew:1 same:true | agent:watching+seen | did:done | stop:s1"],
  "withdraw takes the last waiting ask first": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.ask(2); r.ask(3)
    r.log.push(`withdrew:${r.lane.withdraw().map((x: Moment) => x.seq)}`); r.idle("[point a1] One."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | withdrew:3 | did:say One. | say:One. | agent:watching | did:done | did:handed[2] | text:2 | did:look | send:s1 | did:sent | stop:s1"],
  "a tour's step dropped: gone if it waits, its turn stopped if it alone was handed (0e3f4770)": [async (r) => {
    r.lane.warm(); await r.settle(); const a = r.ask(1, { tour: true }); await r.settle(); r.busy(); const b = r.ask(2, { tour: true })
    r.log.push(`dropped:${r.lane.drop(b)},${r.lane.drop(a)}`); r.words("u1", "Step.", "done"); r.idle("Step."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | interrupt:s1 | dropped:true,true | agent:watching+seen | did:done | stop:s1"],
  "a tour's step handed with their own ask isn't dropped": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.ask(2); const t = r.ask(3, { tour: true }); r.idle("[point a1] One."); await r.settle()
    r.busy(); r.log.push(`dropped:${r.lane.drop(t)}`); r.idle("[point a1] Two."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say One. | say:One. | agent:watching | did:done | did:handed[2,3] | text:2,3 | did:look | send:s1 | did:sent | agent:thinking | dropped:false | agent:watching | did:done | stop:s1"],
  "stopped: what waits is gone, its session ended": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.ask(2); await r.lane.stop(); await r.settle()
    r.log.push(`busy:${r.lane.busy()} asking:${r.lane.asking()} id:${r.lane.id()}`)
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | busy:false asking:false id:null"],
  "stopped as a fresh session starts: that session is ended once it's up": [async (r) => {
    r.hold = true; r.lane.warm(); await r.settle(); await r.lane.stop(); r.hold = false; r.let("start"); await r.settle()
    r.log.push(`id:${r.lane.id()}`)
  }, "start:warm | stop:s1 | id:null"],
  "stopped as an ask's message is made: no session starts for it": [async (r) => {
    r.hold = true; r.ask(1); await r.settle(); await r.lane.stop(); r.hold = false; r.let("text"); await r.settle()
    r.log.push(`id:${r.lane.id()} busy:${r.lane.busy()}`); r.ask(2); await r.settle()
  }, "text:1 | id:null busy:false | text:2 | did:handed[2] | start:asked | agent:thinking | stop:s1"],
  "an ask as it stops goes on, to a fresh session": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); const stopping = r.lane.stop(); r.ask(2); await stopping; await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | text:2 | did:handed[2] | start:asked | stop:s2"],
  "a kept session that never had a turn and isn't up gets a fresh one (09b4c2ef)": [async (r) => {
    r.lane.warm(); await r.settle(); r.sessions.clear(); r.ask(1); await r.settle(); r.idle("[point a1] Hi."); await r.settle()
  }, "start:warm | stop:s1 | text:1 | did:handed[1] | start:asked | agent:thinking | did:say Hi. | say:Hi. | agent:watching | did:done | did:look | stop:s2"],
  "a mark that didn't show is told to the next tool that acts, which it holds once": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.marks.push(false); r.words("u1", "[ring \"Send\"] That one.", "done"); await r.settle()
    r.log.push(`act:${JSON.stringify(await r.run("act"))}`); r.log.push(`act:${JSON.stringify(await r.run("act"))}`); r.idle("[ring \"Send\"] That one."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:draw | said:That one. | did:say | act:{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":\"Not done: your [ring \\\"Send\\\"] wasn't drawn: nothing on their screen says those words, all of them in order, now (aim by an element's id or words it does show, never a guessed box). They haven't seen what you meant, so check it's what they meant: mark it again so it shows (the words exactly as on their screen, a few of them, an element's id, or the area's box) or ask them, then call this again.\"}]} | did:act | act:{\"content\":[{\"type\":\"text\",\"text\":\"Pressed Send.\"}]} | agent:watching | did:done | stop:s1"],
  "a mark failing after its turn ended says so itself, once": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.idle(""); await r.settle()
    r.marks.push(false); await r.run("draw", { marks: [] }); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say I didn't get to an answer on that one. Ask me again? | say:I didn't get to an answer on that one. Ask me again? | agent:watching | did:done | did:draw | stop:s1"],
  "a mark failing as its turn ends, its words still to come: they're said, nothing else": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.marks.push(false); r.words("u1", "[ring \"Send\"] That one.", "done"); r.words("", "", "done"); r.idle("[ring \"Send\"] That one."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | agent:watching | did:done | did:draw | said:That one. | did:say | stop:s1"],
  "a lost turn's mark failing as its ask goes again says nothing of it": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.marks.push(false); r.words("u1", "[ring \"Send\"]", "done"); r.error("Not connected"); await r.settle()
    r.idle("[point a1] There."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | stop:s1 | text:1 | did:draw | did:handed[1] | start:asked | did:say There. | say:There. | agent:watching | did:done | did:look | stop:s2"],
  "words streamed and its turn's end together: each said and drawn once": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy()
    r.words("u1", "[point a1] It's that one.", "done"); r.words("", "", "done"); r.idle("[point a1] It's that one."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | agent:watching | did:done | did:look | said:It's that one. | did:say | stop:s1"],
  "a stale idle news (its seq heard) changes nothing": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); r.idle("[point a1] One."); await r.settle()
    r.ask(2); await r.settle(); const s = r.sessions.get(r.lane.id() ?? "")!; r.seq--; r.idle(s.turn?.text); await r.settle()
    r.log.push(`busy:${r.lane.busy()}`); r.seq++; r.busy(); r.idle("[point a1] Two."); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:say One. | say:One. | agent:watching | did:done | did:look | did:handed[2] | text:2 | send:s1 | did:sent | busy:true | agent:thinking | did:say Two. | say:Two. | agent:watching | did:done | did:look | stop:s1"],
  "a wordless act they see is its answer: their seen tick": [async (r) => {
    r.lane.warm(); await r.settle(); r.ask(1); await r.settle(); r.busy(); await r.run("handoff"); r.idle(""); await r.settle()
  }, "start:warm | did:handed[1] | text:1 | send:s1 | did:sent | agent:thinking | did:handoff | agent:watching+seen | did:done | stop:s1"],
} satisfies Record<string, Scenario>

const MOVES = "idle --pressed--> starting | starting --started--> idle | idle --asked--> turn 1 | turn 1 --ended--> idle"

export default async ($: VaultTest) => {
  const { check } = $
  for (const [name, [play, expected]] of Object.entries(SCENARIOS)) {
    const r = laneRig()
    try { await play(r) } finally { await r.lane.stop(); r.done() }
    check(`summoned: ${name}`, r.log.join(" | ") === expected, r.log)
    if (name.startsWith("warm, then an ask")) check("summoned: each move of its turn is logged, by the event that made it", r.lane.moves().join(" | ") === MOVES, r.lane.moves())
  }
}
