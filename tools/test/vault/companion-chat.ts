import { spawn } from "node:child_process"
import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const CHATD = path.join(ROOT, "plugins/core/claude-code/chatd.ts")
const HOOKS = path.join(import.meta.dirname, "chatd", "hooks.ts")

/** A real chat keeper (chatd.ts, its own process) at `sock`, its SDK the stand-in (chatd/sdk.ts). */
async function keeper(sock: string) {
  const p = spawn(process.execPath, ["--import", pathToFileURL(HOOKS).href, CHATD, sock, sock], { stdio: ["ignore", "ignore", "pipe"], env: process.env })
  let err = ""
  p.stderr!.on("data", (d) => { err += d })
  const up = await waitFor(() => new Promise<boolean>((r) => { const c = net.connect(sock); c.on("connect", () => { c.destroy(); r(true) }); c.on("error", () => r(false)) }), 10000, 100)
  if (!up) throw new Error(`the chat keeper didn't start: ${err}`)
  return { stop: async () => { p.kill("SIGTERM"); await new Promise((r) => p.once("exit", r)); fs.rmSync(sock, { force: true }); fs.rmSync(`${sock}.pid`, { force: true }) } }
}

/** A line-JSON client of a keeper, as the server is: requests answered by `re`, the rest its events. */
function wire(sock: string) {
  const c = net.connect(sock), heard: Any[] = [], waiting = new Map<number, (m: Any) => void>()
  let buf = "", re = 0
  c.setEncoding("utf8")
  c.on("data", (d: string) => {
    buf += d
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
      if (typeof m.re === "number" && waiting.has(m.re)) { waiting.get(m.re)!(m); waiting.delete(m.re) } else heard.push(m)
    }
  })
  const ask = (op: string, p: Any = {}) => new Promise<Any>((r) => { waiting.set(++re, r); c.write(JSON.stringify({ op, re, ...p }) + "\n") })
  return { heard, ask, close: () => new Promise((r) => { c.once("close", r); c.destroy() }) }
}

/** A window of the app with `path` open, as its socket's messages: it types edits in (at once) and streamed ones as
 *  their words come, answering as editor.ts does. */
async function window(path: string) {
  const { matchSocket } = await import("../../../core/plugins.ts")
  const got: Any[] = [], typed = new Map<string, string>()
  const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send(d: string) { const m = JSON.parse(d); got.push(m); answer(m) }, close() {}, ping() {}, terminate() {} })
  const reply = (m: object) => setTimeout(() => ws.emit("message", Buffer.from(JSON.stringify(m))), 5)
  const answer = (m: Any) => {
    if (m.t === "edit") reply({ t: "done", rid: m.rid, ok: true })
    else if (m.t === "stream") typed.set(m.rid, m.text)
    else if (m.t === "stream-more") typed.set(m.rid, (typed.get(m.rid) ?? "") + m.add)
    else if (m.t === "stream-end") reply({ t: "done", rid: m.rid, ok: true, text: m.text })
  }
  return { ws, got, typed, open: (plugins: Any[]) => {
    matchSocket(plugins, ["companion", "live"])![1].fn(ws as Any, {} as IncomingMessage, { wild: [], query: {} })
    ws.emit("message", Buffer.from(JSON.stringify({ t: "where", open: [path], focus: { path, line: 3 }, active: true })))
  }, close: () => ws.emit("close") }
}

export default async ($: VaultTest) => {
  const { api, check, write, VAULT, CLAUDE_DIR } = $
  const { CHAT_SOCKET } = await import("../../../plugins/core/claude-code/chat.ts")

  // The keeper keeps a relayed tool call the server hasn't answered: a server that comes back (follows) is told it again,
  // and its answer reaches the session. Through a keeper process and the SDK's own MCP server.
  {
    const sock = path.join(path.dirname(CHAT_SOCKET), `vaultite-chatd-test-${process.pid}.sock`)
    const k = await keeper(sock)
    try {
      const id = crypto.randomUUID()
      let w = wire(sock)
      await w.ask("follow")
      const spec = { id, resume: false, cwd: VAULT, env: {}, tools: [{ name: "shout", description: "Shout it", schema: { properties: { text: { type: "string" } }, required: ["text"] } }] }
      const started = await w.ask("start", { spec, prompt: 'call shout {"text":"hi"}' })
      const call = await waitFor(() => w.heard.find((e) => e.t === "tool"), 5000, 20)
      await w.close()
      w = wire(sock)
      await w.ask("follow")
      const again = await waitFor(() => w.heard.find((e) => e.t === "tool"), 3000, 20)
      await w.ask("tool-result", { call: again?.call, result: { content: [{ type: "text", text: "HI" }] } })
      await waitFor(async () => (await w.ask("list")).sessions.find((s: Any) => s.id === id)?.state === "idle", 3000, 50)
      const r = await w.ask("read", { id })
      check("chat keeper: a tool call not answered is told again to the next server that follows, whose answer reaches the session",
        !started.error && call?.name === "shout" && call.args?.text === "hi" && again?.call === call.call && r.entries?.some((e: Any) => e.k === "text" && e.text === "Called: HI"), [started, call, again, r.entries])
      await w.ask("stop", { id })
      await w.close()
    } finally { await k.stop() }
  }

  // The companion on Claude Code: a session of the chat keeper (its own process here, the stand-in SDK), each moment its
  // message, each action a tool it calls, relayed back to the server.
  const c = await import("../../../plugins/core/companion/plugin.ts")
  const status = async () => (await api("POST", "ops/companion.status", {}))[1]
  const claude = async () => (await status()).agents.find((a: Any) => a.name === "Claude")
  const said = async (id: string) => ((await api("POST", "ops/claude-code.chat-read", { id, limit: 100 }))[1].entries ?? []) as Any[]
  const idle = (id: string) => waitFor(async () => (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === id)?.state === "idle", 5000, 50)
  let k = await keeper(CHAT_SOCKET)
  try {
    await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", model: "haiku" })
    write("Notes/Chat.md", "# Chat\n\nCall Alice friday\n")
    let [st, r] = await api("POST", "ops/companion.start", {})
    const id = r.id
    const file = JSON.parse(fs.readFileSync(`${c.plugin.localDir()}/session.json`, "utf8"))
    check("companion on Claude Code: a chat session, not a terminal, kept with what it runs", st === 200 && /^[0-9a-f-]{36}$/.test(id) && file.id === id &&
      file.runs === "claude" && file.model === "haiku", [st, r, file])
    await idle(id)
    let entries = await said(id)
    check("companion chat: its first turn gets it ready, and its cursor shows it starting till that turn ends", /Read ME\.md/.test(entries.find((e) => e.k === "user")?.text ?? "") &&
      !!(await waitFor(async () => (await claude())?.state === "watching", 3000, 50)), [entries, await claude()])
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion chat: status names its session as a chat's", r.sessions.some((s: Any) => s.id === id && s.chat), r.sessions)
    check("companion chat: it runs in auto mode", (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === id)?.mode === "auto")

    // Resumed in a terminal it would have none of its tools, and the companion would lose it: refused, it goes on.
    const resumeIt = $.app.plugins.find((p: Any) => p.id === "claude-code")!.services["agent:claude"] as (s: Any) => Promise<Any>
    const refused = await resumeIt({ resume: id })
    check("companion chat: its session isn't resumed in a terminal while it runs, and goes on", /the companion's Claude Code session/.test((refused?.argv ?? []).join(" ")) &&
      !(refused.argv ?? []).includes("--resume") && (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.some((s: Any) => s.id === id), refused)

    // An ask is its message; the say it calls is relayed to the server and drawn by its cursor.
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"Hello from a tool","path":"Notes/Chat.md","find":"Alice"}' })
    check("companion chat: an ask shows it thinking at once", (await claude())?.state === "thinking")
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && /^Called:/.test(e.text)), 5000, 50)
    await idle(id)
    entries = await said(id)
    const ask = entries.filter((e) => e.k === "user").at(-1)
    const sayNote = (await status()).notes.find((n: Any) => n.kind === "say" && n.text === "Hello from a tool")
    check("companion chat: the ask is its message, with the note's lines", /- ask Notes\/Chat\.md:3/.test(ask?.text ?? "") && /3 {2}Call Alice friday/.test(ask?.text ?? ""), ask)
    check("companion chat: its say tool runs on the server, by its cursor, and answers it", sayNote?.agent === "Claude" && sayNote.find === "Alice" &&
      entries.some((e) => e.k === "text" && e.text === "Called: Said."), [sayNote, entries.slice(-3)])
    check("companion chat: its turn ended after acting, it's watching (no seen tick)", !!(await waitFor(async () => { const a = await claude(); return a?.state === "watching" && !a.seen }, 3000, 50)), await claude())

    // Asks while a turn runs wait for its end, then go as one message.
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow one" })
    await $.sleep(100)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 1, text: "second" })
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 1, text: "third" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && e.text === "Read it (2 asks)"), 5000, 50)
    entries = await said(id)
    const users = entries.filter((e) => e.k === "user")
    check("companion chat: moments that come while a turn runs go together, once it ends", /"slow one"/.test(users.at(-2)?.text ?? "") &&
      /"second"/.test(users.at(-1)?.text ?? "") && /"third"/.test(users.at(-1)?.text ?? ""), users.slice(-2).map((e) => e.text))
    await idle(id)
    check("companion chat: a turn that let what it was given pass is a seen tick", !!(await waitFor(async () => (await claude())?.seen, 3000, 50)), await claude())

    // Its tools: the companion's actions (as it, never another), and reading the vault unasked; told how moments come.
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "list" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && /^Tools:/.test(e.text)), 5000, 50)
    const tools = (await said(id)).findLast((e) => e.k === "text" && /^Tools:/.test(e.text))?.text ?? ""
    check("companion chat: a turn may end right after its actions, without words (Claude Code's terminal tools), not after reading",
      /Ends: [^.]*mcp__vaultite-app__say\b/.test(tools) && /mcp__vaultite-app__edit\b/.test(tools) && !/Ends: [^.]*__status\b/.test(tools), tools)
    check("companion chat: its actions are its tools, always in its prompt (not vau companion, denied), allowed unasked with reading the vault, and it's told so",
      /Tools: [^.]*\bsay\b/.test(tools) && /\bcomment\b/.test(tools) && /\bhandover\b/.test(tools) && !/\bnext\b/.test(tools.split(".")[0]) && /\(always loaded\)/.test(tools) &&
      /Allowed: mcp__vaultite-app,Bash\(vau docs:\*\)/.test(tools) && !/Allowed: [^.]*vau companion/.test(tools) && /Denied: Bash\(vau companion:\*\)/.test(tools) && /Told: tools/.test(tools), tools)
    await idle(id)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call comment {"text":"Alice is away","path":"Notes/Chat.md","find":"Alice"}' })
    const comment = await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "comment" && n.text === "Alice is away"), 5000, 50)
    check("companion chat: a comment it calls stays by its words", comment?.agent === "Claude" && comment.find === "Alice" && comment.path === "Notes/Chat.md", comment)
    await idle(id)

    // Its last call for a moment (done) ends its turn: no words of its own after it.
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"That is all","done":true}' })
    await waitFor(async () => (await status()).notes.some((n: Any) => n.kind === "say" && n.text === "That is all"), 5000, 50)
    await idle(id)
    entries = await said(id)
    const lastTurn = entries.slice(entries.findLastIndex((e) => e.k === "user") + 1)
    check("companion chat: a call that says done ends its turn there, no words after it", !lastTurn.some((e) => e.k === "text") && (await claude())?.state === "watching", lastTurn)

    // Its answers stream: a say's bubble and an edit's words show as it writes its call, before the call comes.
    const w = await window("Notes/Chat.md")
    w.open($.app.plugins)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream say {"text":"Streaming words to you now, a few at a time"}' })
    await waitFor(() => w.got.some((m) => m.t === "note" && m.note.kind === "say" && m.note.text === "Streaming words to you now, a few at a time"), 5000, 20)
    const bubbles = w.got.filter((m) => m.t === "note" && m.note.kind === "say" && /^Streaming/.test(m.note.text)).map((m) => m.note)
    check("companion chat: a say's bubble grows as it's written, one bubble, its call ending it", bubbles.length > 2 && new Set(bubbles.map((n) => n.id)).size === 1 &&
      bubbles[0].text.length < bubbles.at(-1).text.length, bubbles.map((n) => n.text))
    await idle(id)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream edit {"path":"Notes/Chat.md","after":"Call Alice friday","text":"- Book the train\\n- Pack light"}' })
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && /Typed into Notes\/Chat\.md/.test(e.text)), 5000, 20)
    const opened = w.got.find((m) => m.t === "stream"), more = w.got.filter((m) => m.t === "stream-more" && m.rid === opened?.rid), ended = w.got.find((m) => m.t === "stream-end" && m.rid === opened?.rid)
    check("companion chat: an edit's words go to the window as they're written: its place first, then more, then all of it",
      opened?.after === "Call Alice friday" && opened.text.length < 20 && more.length > 1 && ended?.text === "- Book the train\n- Pack light" &&
      w.typed.get(opened.rid) === ended.text, [opened, more.length, ended])
    const at = w.got.findLast((m) => m.t === "agent" && m.agent.name === "Claude")?.agent
    check("companion chat: its cursor stays at the end of what it wrote", at?.find === "- Pack light" && at.line === 5, at)
    await idle(id)
    const acts = (await api("POST", "ops/companion.timings", {}))[1].rows.filter((r: Any) => r.kind === "ask" && r.as === "Claude" && r.word !== undefined)
    check("companion chat: timings has its think and first word for a chat session", acts.length >= 2 && acts.every((r: Any) => r.think !== undefined), acts)
    // (its place after its words: typed in whole once its call comes)
    w.got.length = 0
    const typedSoFar = async () => (await said(id)).filter((e) => e.k === "text" && /Typed into/.test(e.text)).length, before = await typedSoFar()
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream edit {"text":"Late place","path":"Notes/Chat.md","after":"Pack light"}' })
    await waitFor(async () => (await typedSoFar()) > before, 5000, 20)
    await idle(id)
    check("companion chat: an edit whose place comes after its words is typed in whole by its call", !w.got.some((m) => m.t === "stream") && w.got.some((m) => m.t === "edit" && m.text === "Late place"), w.got.map((m) => m.t))
    // (cut off as it wrote: what it had stays, the window told it's over)
    w.got.length = 0
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'cut edit {"path":"Notes/Chat.md","after":"Late place","text":"Half of a longer thought that goes on and on, about the trip, the train, the coast and the bus back home"}' })
    const cutEnd = await waitFor(() => w.got.find((m) => m.t === "stream-end"), 5000, 20)
    check("companion chat: an edit cut off as it's written ends with what it had", !!cutEnd && cutEnd.text.length > 0 && cutEnd.text.length < 100 && /^Half/.test(cutEnd.text), cutEnd)
    await idle(id)

    // They go on writing what it's thinking over, before it acted: its turn stops, and the ask goes again, whole.
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow: how long is the train ride to the coast" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "user" && /slow: how long is the train ride to the coast"/.test(e.text)), 3000, 20)
    await $.sleep(100)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow: how long is the train ride to the coast, and is it cheaper by bus" })
    const again = await waitFor(async () => (await said(id)).find((e) => e.k === "user" && /cheaper by bus/.test(e.text))?.text, 5000, 20)
    check("companion chat: going on with an ask it hasn't answered stops its turn and sends it again, whole", /they went on writing it/.test(again ?? ""), again)
    await idle(id)

    // Esc: its turn stops where it is, and its next message says so.
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow again" })
    await waitFor(async () => (await claude())?.state === "thinking", 3000, 20)
    await $.sleep(100)
    ;[st, r] = await api("POST", "ops/companion.interrupt", {})
    check("companion chat: interrupt stops its turn", st === 200 && r.stopped === true, r)
    await idle(id)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "next" })
    const told = await waitFor(async () => (await said(id)).find((e) => e.k === "user" && /"next"/.test(e.text))?.text, 5000, 20)
    check("companion chat: after Esc, its next message says it was stopped", /They stopped your last answer/.test(told ?? ""), told)
    await idle(id)
    w.close()

    // The keeper ends (a crash): the session's next message resumes it, its tools and words as it was started.
    const proj = path.join(CLAUDE_DIR, "projects", "-tmp-companion-chat")
    fs.mkdirSync(proj, { recursive: true })
    fs.writeFileSync(path.join(proj, `${id}.jsonl`), JSON.stringify({ type: "user", uuid: crypto.randomUUID(), cwd: VAULT, sessionId: id, message: { content: "Read ME.md" }, timestamp: new Date().toISOString() }) + "\n")
    await k.stop()
    await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.length, 5000, 100)
    k = await keeper(CHAT_SOCKET)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "list after the restart" })
    const back = await waitFor(async () => (await said(id)).find((e) => e.k === "text" && /^Tools:.*Resumed: yes/.test(e.text))?.text, 9000, 100)
    check("companion chat: after its keeper ended, the next ask resumes it with its tools, allowed and told as before",
      !!back && /\bsay\b/.test(back) && /Allowed: mcp__vaultite-app/.test(back) && /Told: tools/.test(back), back)
    await idle(id)
    c.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"Back again","path":"Notes/Chat.md"}' })
    check("companion chat: and its tools still reach the server", !!(await waitFor(async () => (await status()).notes.some((n: Any) => n.kind === "say" && n.text === "Back again"), 5000, 50)))
    await idle(id)

    // Start fresh: it's asked to hand over (its handover tool), and a new session takes over with its summary.
    await api("POST", "ops/companion.fresh", {})
    const asked = await waitFor(async () => (await said(id)).filter((e) => e.k === "user").at(-1)?.text, 5000, 50)
    check("companion chat: Start fresh asks it to hand over with its tool", /call your handover tool/.test(asked ?? ""), asked)
    await idle(id)
    ;[st, r] = await api("POST", "ops/companion.handover", { summary: "Alice's trip is on Tuesday." })
    const fresh = r.id
    await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.some((s: Any) => s.id === id), 5000, 100)
    const first = (await said(fresh)).find((e) => e.k === "user")?.text ?? ""
    check("companion chat: the fresh one is a new chat session told the summary and its threads, the old one ended",
      st === 200 && fresh !== id && /^[0-9a-f-]{36}$/.test(fresh) && /Alice's trip is on Tuesday/.test(first) && /your comment tool/.test(first) &&
      JSON.parse(fs.readFileSync(`${c.plugin.localDir()}/session.json`, "utf8")).id === fresh, [r, first])
    await idle(fresh)

    // Stopped: its session ends, its cursor goes.
    await api("POST", "ops/companion.stop", {})
    await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.length, 5000, 100)
    check("companion chat: stopped, its session ends and its cursor goes", (await claude())?.state === "away" && !fs.existsSync(`${c.plugin.localDir()}/session.json`), await claude())
    await api("POST", "ops/companion.clear", {})
  } finally {
    await api("PATCH", "config/plugin/companion", { mode: "off" })
    await k.stop()
  }
}
