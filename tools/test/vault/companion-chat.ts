import { spawn } from "node:child_process"
import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { onItsOwn } from "../../../core/writegate.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const CHATD = path.join(ROOT, "plugins/core/claude-code/chatd.ts")
const HOOKS = path.join(import.meta.dirname, "chatd", "hooks.ts")
/** Where a test lets a held stream go on (chatd/sdk.ts, "hold"). */
const RELEASE = path.join(os.tmpdir(), `vaultite-chatd-release-${process.pid}`)
/** Where a test makes the next "crash" ask end its session with an error (chatd/sdk.ts). */
const CRASH = path.join(os.tmpdir(), `vaultite-chatd-crash-${process.pid}`)

/** A real chat keeper (chatd.ts, its own process) at `sock`, its SDK the stand-in (chatd/sdk.ts). */
async function keeper(sock: string) {
  const p = spawn(process.execPath, ["--import", pathToFileURL(HOOKS).href, CHATD, sock, sock], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, CHATD_TEST_RELEASE: RELEASE, CHATD_TEST_CRASH: CRASH } })
  let err = ""
  p.stderr!.on("data", (d) => { err += d })
  const up = await waitFor(() => new Promise<boolean>((r) => { const c = net.connect(sock); c.on("connect", () => { c.destroy(); r(true) }); c.on("error", () => r(false)) }), 10000, 100)
  if (!up) throw new Error(`the chat keeper didn't start: ${err}`)
  return { stop: async () => { if (p.exitCode === null && p.signalCode === null) { p.kill("SIGTERM"); await new Promise((r) => p.once("exit", r)) } fs.rmSync(sock, { force: true }); fs.rmSync(`${sock}.pid`, { force: true }) } }
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
  return { heard, ask, closed: (fn: () => void) => c.once("close", fn), close: () => new Promise<void>((r) => { if (c.destroyed) return r(); c.once("close", () => r()); c.destroy() }) }
}

/** A window with `path` open, as its socket's messages: it types edits in as editor.ts does. `hidden`: it no longer
 *  shows the note (a tab kept hidden since it said so), so it types nothing; `closes`: it goes as a stream opens. */
async function window(path: string, how: { hidden?: boolean; closes?: boolean } = {}) {
  const { matchSocket } = await import("../../../core/plugins.ts")
  const got: Any[] = [], typed = new Map<string, string>()
  const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send(d: string) { const m = JSON.parse(d); got.push(m); answer(m) }, close() {}, ping() {}, terminate() {} })
  const reply = (m: object) => setTimeout(() => ws.emit("message", Buffer.from(JSON.stringify(m))), 5)
  const answer = (m: Any) => {
    if (how.hidden && (m.t === "edit" || m.t === "stream")) reply({ t: "done", rid: m.rid, ok: false })
    else if (how.closes && m.t === "stream") setTimeout(() => ws.emit("close"), 5)
    else if (m.t === "edit") reply({ t: "done", rid: m.rid, ok: true })
    else if (m.t === "stream") typed.set(m.rid, m.text)
    else if (m.t === "stream-more") typed.set(m.rid, (typed.get(m.rid) ?? "") + m.add)
    else if (m.t === "stream-end") reply({ t: "done", rid: m.rid, ok: true, text: m.text })
  }
  return { ws, got, typed, open: (plugins: Any[]) => {
    matchSocket(plugins, ["companion", "live"])![1].fn(ws as Any, {} as IncomingMessage, { wild: [], query: {} })
    ws.emit("message", Buffer.from(JSON.stringify({ t: "where", open: [path], shown: [path], focus: { path, line: 3 }, active: true })))
  }, close: () => ws.emit("close") }
}

export default async ($: VaultTest) => {
  const { api, check, write, VAULT, CLAUDE_DIR } = $
  const { CHAT_SOCKET } = await import("../../../plugins/core/claude-code/chatwire.ts")

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
      const call = await waitFor(() => w.heard.find((e) => e.t === "tool"), 15_000, 20)
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
      // Ended by a SIGTERM (a reboot) mid-turn: its sessions end unheard, so the server takes their turns up again after.
      const cut = crypto.randomUUID()
      await w.ask("start", { spec: { id: cut, resume: false, cwd: VAULT, env: {} }, prompt: "slow" })
      await waitFor(async () => (await w.ask("list")).sessions.find((s: Any) => s.id === cut)?.state === "working", 3000, 20)
      const closed = new Promise<void>((r) => w.closed(r))
      await k.stop()
      await closed
      check("chat keeper: a SIGTERM ends it without telling a server its sessions are gone (a reboot's turns are taken up again)",
        !w.heard.some((e) => e.t === "gone" && e.id === cut), w.heard.map((e) => `${e.t}:${e.id ?? e.s?.id}`))
      await w.close()
    } finally { await k.stop() }
  }

  // The companion on Claude Code: a session of the chat keeper (its own process here, the stand-in SDK), each moment its
  // message, each action a tool it calls, relayed back to the server.
  const c = await import("../../../plugins/core/companion/plugin.ts")
  const cState = await import("../../../plugins/core/companion/state.ts")
  const cWindows = await import("../../../plugins/core/companion/windows.ts")
  const status = async () => (await api("POST", "ops/companion.status", {}))[1]
  const claude = async () => (await status()).agents.find((a: Any) => a.name === "Claude")
  const said = async (id: string) => ((await api("POST", "ops/claude-code.chat-read", { id, limit: 100 }))[1].entries ?? []) as Any[]
  // (an agent's turn waited for generously: under the whole suite a Windows runner once took over 5 s; it ends when done)
  const idle = (id: string) => waitFor(async () => (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === id)?.state === "idle", 15_000, 50)
  let k = await keeper(CHAT_SOCKET)
  try {
    // (followed first by the plugin acting on its own, as its timer does when a server starts: the calls it relays are
    // still the session's, which writes notes like any agent)
    await onItsOwn("claude-code", () => api("POST", "ops/claude-code.chat-list", {}))
    // (its Talk key's asks the long session's, as before: the summoned one has its own test below)
    await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", model: "haiku", summoned_model: "companion" })
    write("Notes/Chat.md", "# Chat\n\nCall Alice friday\n")
    let [st, r] = await api("POST", "ops/companion.start", {})
    const id = r.id
    const file = JSON.parse(fs.readFileSync(`${c.plugin.localDir()}/session.json`, "utf8"))
    check("companion on Claude Code: a chat session, not a terminal, kept with what it runs", st === 200 && /^[0-9a-f-]{36}$/.test(id) && file.id === id &&
      file.runs === "claude" && file.model === "haiku", [st, r, file])
    await idle(id)
    let entries = await said(id)
    check("companion chat: its first turn gets it ready, and its cursor shows it starting till that turn ends", (entries.find((e) => e.k === "user")?.text ?? "").startsWith("Read ME.md and `vau docs companion` first, once.") &&
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
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"Hello from a tool","path":"Notes/Chat.md","find":"Alice"}' })
    check("companion chat: an ask shows it thinking at once", (await claude())?.state === "thinking")
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && /^Called:/.test(e.text)), 15_000, 50)
    await idle(id)
    entries = await said(id)
    const ask = entries.filter((e) => e.k === "user").at(-1)
    const sayNote = (await status()).notes.find((n: Any) => n.kind === "say" && n.text === "Hello from a tool")
    check("companion chat: the ask is its message, with the note's lines", /- ask Notes\/Chat\.md:3/.test(ask?.text ?? "") && /3 {2}Call Alice friday/.test(ask?.text ?? ""), ask)
    check("companion chat: its say tool runs on the server, by its cursor, and answers it", sayNote?.agent === "Claude" && sayNote.find === "Alice" &&
      entries.some((e) => e.k === "text" && e.text === "Called: Said."), [sayNote, entries.slice(-3)])
    check("companion chat: its turn ended after acting, it's watching (no seen tick)", !!(await waitFor(async () => { const a = await claude(); return a?.state === "watching" && !a.seen }, 3000, 50)), await claude())

    // Asks while a turn runs wait for its end, then go as one message.
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow one" })
    await $.sleep(100)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 1, text: "second" })
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 1, text: "third" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && e.text === "Read it (2 asks)"), 15_000, 50)
    entries = await said(id)
    const users = entries.filter((e) => e.k === "user")
    check("companion chat: moments that come while a turn runs go together, once it ends", /"slow one"/.test(users.at(-2)?.text ?? "") &&
      /"second"/.test(users.at(-1)?.text ?? "") && /"third"/.test(users.at(-1)?.text ?? ""), users.slice(-2).map((e) => e.text))
    await idle(id)
    check("companion chat: a turn that let what it was given pass is a seen tick", !!(await waitFor(async () => (await claude())?.seen, 3000, 50)), await claude())

    // Its tools: the companion's actions (as it, never another), and reading the vault unasked; told how moments come.
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "list" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && /^Tools:/.test(e.text)), 15_000, 50)
    const tools = (await said(id)).findLast((e) => e.k === "text" && /^Tools:/.test(e.text))?.text ?? ""
    check("companion chat: a turn may end right after its actions, without words (Claude Code's terminal tools), not after reading",
      /Ends: [^.]*mcp__vaultite-app__say\b/.test(tools) && /mcp__vaultite-app__edit\b/.test(tools) && !/Ends: [^.]*__status\b/.test(tools), tools)
    check("companion chat: its actions are its tools, always in its prompt (not vau companion, denied), allowed unasked with reading the vault, and it's told so",
      /Tools: [^.]*\bsay\b/.test(tools) && /\bcomment\b/.test(tools) && /\bhandover\b/.test(tools) && !/\bnext\b/.test(tools.split(".")[0]) && /\(always loaded\)/.test(tools) &&
      /Allowed: mcp__vaultite-app,Bash\(vau docs:\*\)/.test(tools) && !/Allowed: [^.]*vau companion/.test(tools) && /Denied: Bash\(vau companion:\*\)/.test(tools) && /Told: tools/.test(tools), tools)
    await idle(id)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call comment {"text":"Alice is away","path":"Notes/Chat.md","find":"Alice"}' })
    const comment = await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "comment" && n.text === "Alice is away"), 15_000, 50)
    check("companion chat: a comment it calls stays by its words", comment?.agent === "Claude" && comment.find === "Alice" && comment.path === "Notes/Chat.md", comment)
    await idle(id)

    // Its last call for a moment (done) ends its turn: no words of its own after it.
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"That is all","done":true}' })
    await waitFor(async () => (await status()).notes.some((n: Any) => n.kind === "say" && n.text === "That is all"), 15_000, 50)
    await idle(id)
    entries = await said(id)
    const lastTurn = entries.slice(entries.findLastIndex((e) => e.k === "user") + 1)
    check("companion chat: a call that says done ends its turn there, no words after it", !lastTurn.some((e) => e.k === "text") && (await claude())?.state === "watching", lastTurn)

    // Its answers stream: a say's bubble and an edit's words show as it writes its call, before the call comes.
    const w = await window("Notes/Chat.md")
    w.open($.app.plugins)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream say {"text":"Streaming words to you now, a few at a time"}' })
    await waitFor(() => w.got.some((m) => m.t === "note" && m.note.kind === "say" && m.note.text === "Streaming words to you now, a few at a time"), 15_000, 20)
    const bubbles = w.got.filter((m) => m.t === "note" && m.note.kind === "say" && /^Streaming/.test(m.note.text)).map((m) => m.note)
    check("companion chat: a say's bubble grows as it's written, one bubble, its call ending it", bubbles.length > 2 && new Set(bubbles.map((n) => n.id)).size === 1 &&
      bubbles[0].text.length < bubbles.at(-1).text.length, bubbles.map((n) => n.text))
    await idle(id)
    // (held mid-text till its window opened it: a slow open would take all its words with it)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'hold edit {"path":"Notes/Chat.md","after":"Call Alice friday","text":"- Book the train\\n- Pack light"}' })
    await waitFor(() => w.got.some((m) => m.t === "stream"), 15_000, 20)
    fs.writeFileSync(RELEASE, "")
    await waitFor(async () => (await said(id)).some((e) => e.k === "text" && /Typed into Notes\/Chat\.md/.test(e.text)), 15_000, 20)
    fs.rmSync(RELEASE, { force: true })
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
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream edit {"text":"Late place","path":"Notes/Chat.md","after":"Pack light"}' })
    await waitFor(async () => (await typedSoFar()) > before, 15_000, 20)
    await idle(id)
    check("companion chat: an edit whose place comes after its words is typed in whole by its call", !w.got.some((m) => m.t === "stream") && w.got.some((m) => m.t === "edit" && m.text === "Late place"), w.got.map((m) => m.t))
    // (cut off as it wrote: what it had stays, the window told it's over)
    w.got.length = 0
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'cut edit {"path":"Notes/Chat.md","after":"Late place","text":"Half of a longer thought that goes on and on, about the trip, the train, the coast and the bus back home"}' })
    const cutEnd = await waitFor(() => w.got.find((m) => m.t === "stream-end"), 15_000, 20)
    check("companion chat: an edit cut off as it's written ends with what it had", !!cutEnd && cutEnd.text.length > 0 && cutEnd.text.length < 100 && /^Half/.test(cutEnd.text), cutEnd)
    await idle(id)
    // (its window no longer shows the note, a tab kept hidden: its call writes the file instead)
    const hid = await window("Notes/Chat.md", { hidden: true })
    hid.open($.app.plugins)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream edit {"path":"Notes/Chat.md","after":"Call Alice friday","text":"Hidden tab line"}' })
    const wrote = await waitFor(async () => (await said(id)).find((e) => e.k === "text" && /Wrote Notes\/Chat\.md|couldn't type/.test(e.text))?.text, 15_000, 20)
    check("companion chat: a streamed edit its window can't show is written to the file by its call", /Wrote Notes\/Chat\.md/.test(wrote ?? "") &&
      $.read("Notes/Chat.md").includes("Call Alice friday\nHidden tab line\n"), [wrote, $.read("Notes/Chat.md")])
    await idle(id)
    hid.close()
    // (its window closes as it's typed: the call fails then, not minutes later, and the note's turn is free)
    const gone = await window("Notes/Chat.md", { closes: true })
    gone.open($.app.plugins)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream edit {"path":"Notes/Chat.md","after":"Hidden tab line","text":"The window goes as this is typed"}' })
    const failed = await waitFor(async () => (await said(id)).find((e) => e.k === "text" && /closed as it was typed/.test(e.text))?.text, 15_000, 20)
    check("companion chat: a window that closes as a streamed edit is typed fails its call at once", !!failed, await said(id).then((x) => x.slice(-2)))
    await idle(id)

    {
      const traced = async (f: () => void) => {
        const from = w.got.length
        await f()
        await $.sleep(100)
        await idle(id)
        await $.sleep(50)
        const s = w.got.slice(from).flatMap((m) => (m.t === "agent" && m.agent.name === "Claude" ? [`${m.agent.state}${m.agent.seen ? " seen" : ""}`] : []))
        return s.filter((x: string, i: number) => x !== s[i - 1]).join(", ")
      }
      const turns: Record<string, string> = {}
      turns.ask = await traced(() => cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"First"}\ncall say {"text":"Second","done":true}' }))
      turns.change = await traced(() => cState.addMoment({ kind: "change", pane: "t9", title: "zsh", what: "a command ended", changes: ['call say {"text":"Seen it"}', 'call say {"text":"Bye","done":true}'] }))
      turns.passes = await traced(() => cState.addMoment({ kind: "change", pane: "t9", title: "zsh", what: "a command ended", changes: ['call pass {"reason":"not mine"}'] }))
      turns.idles = await traced(() => cState.addMoment({ kind: "change", pane: "t9", title: "zsh", what: "it changed", changes: ["nothing to call"] }))
      turns.streams = await traced(() => cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'stream edit {"path":"Notes/Chat.md","after":"Call Alice friday","text":"Traced line"}' }))
      const want = { ask: "thinking, watching", change: "reading, watching, thinking, watching", passes: "reading, watching seen", idles: "reading, watching seen", streams: "thinking, writing, thinking, watching" }
      check("companion chat: its cursor's state through a turn (busy between its calls, not while one shows)", JSON.stringify(turns) === JSON.stringify(want), turns)
    }

    // Closed as it was written: a bubble or a comment the user dismissed mid-stream stays gone once its call comes. Its
    // stream waits half way for the dismissal: a runner that stalls would otherwise get its last words before it.
    const long = (what: string) => `${what} with a long answer that keeps going for a while, word after word, so it can be closed before it ends, and a little more to be sure`
    const dismissed = async (kind: string, ask: string, words: string) => {
      w.got.length = 0
      cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: ask })
      const shown = await waitFor(() => w.got.find((m) => m.t === "note" && m.note.kind === kind && m.note.text?.length > 8 && words.startsWith(m.note.text))?.note, 5000, 5)
      w.ws.emit("message", Buffer.from(JSON.stringify({ t: "answer", id: shown?.id, verdict: "dismiss" })))
      await waitFor(() => w.got.some((m) => m.t === "drop" && m.id === shown?.id), 3000, 5)
      fs.writeFileSync(RELEASE, "")
      await idle(id)
      fs.rmSync(RELEASE, { force: true })
      return { shown, back: w.got.some((m) => m.t === "note" && m.note.kind === kind && m.note.text === words), open: (await status()).notes.some((n: Any) => n.id === shown?.id || n.text === words) }
    }
    const bub = await dismissed("say", `hold say {"text":"${long("A bubble")}"}`, long("A bubble"))
    check("companion chat: a bubble closed as it's written stays closed when its call comes", !!bub.shown && !bub.back && !bub.open, bub)
    const card = await dismissed("comment", `hold comment {"path":"Notes/Chat.md","find":"Alice","text":"${long("A comment")}"}`, long("A comment"))
    const past = (await api("POST", "ops/companion.history", { path: "Notes/Chat.md" }))[1].past as Any[]
    check("companion chat: a comment dismissed as it's written stays dismissed, with all its words", !!card.shown && !card.back && !card.open &&
      past.some((n) => n.id === card.shown.id && n.text === long("A comment")), [card, past])

    // They go on writing what it's thinking over, before it acted: its turn stops, and the ask goes again, whole.
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow: how long is the train ride to the coast" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "user" && /slow: how long is the train ride to the coast"/.test(e.text)), 3000, 20)
    await $.sleep(100)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow: how long is the train ride to the coast, and is it cheaper by bus" })
    const again = await waitFor(async () => (await said(id)).find((e) => e.k === "user" && /cheaper by bus/.test(e.text))?.text, 15_000, 20)
    check("companion chat: going on with an ask it hasn't answered stops its turn and sends it again, whole", /they went on writing it/.test(again ?? ""), again)
    await idle(id)

    // Esc: its turn stops where it is, and its next message says so.
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow again" })
    await waitFor(async () => (await claude())?.state === "thinking", 3000, 20)
    await $.sleep(100)
    ;[st, r] = await api("POST", "ops/companion.interrupt", {})
    check("companion chat: interrupt stops its turn", st === 200 && r.stopped === true, r)
    await idle(id)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "next" })
    const told = await waitFor(async () => (await said(id)).find((e) => e.k === "user" && /"next"/.test(e.text))?.text, 15_000, 20)
    check("companion chat: after Esc, its next message says it was stopped", /They stopped your last answer/.test(told ?? ""), told)
    await idle(id)
    // (stopped as it streamed a bubble: it isn't writing any more, so going on with an ask still sends it again)
    w.got.length = 0
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: `stream say {"text":"${long("Stopped")}"}` })
    await waitFor(() => w.got.some((m) => m.t === "note" && m.note.kind === "say" && /^Stopped with/.test(m.note.text ?? "")), 5000, 5)
    await api("POST", "ops/companion.interrupt", {})
    await idle(id)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow: which bus goes to the coast" })
    await waitFor(async () => (await said(id)).some((e) => e.k === "user" && /slow: which bus goes to the coast"/.test(e.text)), 3000, 20)
    await $.sleep(100)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "slow: which bus goes to the coast, and when is the last one" })
    const resent = await waitFor(async () => (await said(id)).find((e) => e.k === "user" && /when is the last one/.test(e.text))?.text, 15_000, 20)
    check("companion chat: after Esc on a streamed answer, going on with an ask still stops its turn and sends it again", /they went on writing it/.test(resent ?? ""), resent)
    await idle(id)
    w.close()

    // The keeper ends (a crash): the session's next message resumes it, its tools and words as it was started.
    const proj = path.join(CLAUDE_DIR, "projects", "-tmp-companion-chat")
    fs.mkdirSync(proj, { recursive: true })
    fs.writeFileSync(path.join(proj, `${id}.jsonl`), JSON.stringify({ type: "user", uuid: crypto.randomUUID(), cwd: VAULT, sessionId: id, message: { content: "Read ME.md" }, timestamp: new Date().toISOString() }) + "\n")
    await k.stop()
    await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.length, 5000, 100)
    k = await keeper(CHAT_SOCKET)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "list after the restart" })
    const back = await waitFor(async () => (await said(id)).find((e) => e.k === "text" && /^Tools:.*Resumed: yes/.test(e.text))?.text, 9000, 100)
    check("companion chat: after its keeper ended, the next ask resumes it with its tools, allowed and told as before",
      !!back && /\bsay\b/.test(back) && /Allowed: mcp__vaultite-app/.test(back) && /Told: tools/.test(back), back)
    await idle(id)
    cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: 'call say {"text":"Back again","path":"Notes/Chat.md"}' })
    check("companion chat: and its tools still reach the server", !!(await waitFor(async () => (await status()).notes.some((n: Any) => n.kind === "say" && n.text === "Back again"), 15_000, 50)))
    await idle(id)

    // Start fresh: it's asked to hand over (its handover tool), and a new session takes over with its summary.
    await api("POST", "ops/companion.fresh", {})
    const asked = await waitFor(async () => (await said(id)).filter((e) => e.k === "user").at(-1)?.text, 15_000, 50)
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

    // Its Talk key's asks: a session of their own on a small model, warm from the companion's start, apart from the long one.
    {
      await api("PATCH", "config/plugin/companion", { summoned_model: "haiku", model: "sonnet" })
      // (they keep a Now note: fresh sessions are told it, the long one where it is and the summoned one what it says)
      const meWas = $.exists("ME.md") ? $.read("ME.md") : null
      write("ME.md", "---\ntype: me\n---\n\n## About me\n\n- Keeps the Lighthouse.\n")
      write("Now.md", "---\ntype: now\n---\n\n## Tracks\n\n### Lighthouse\n- Next: call Alice about the lamp\n")
      ;[st, r] = await api("POST", "ops/companion.start", {})
      const longId = r.id, laneFile = `${c.plugin.localDir()}/summoned.json`
      const quick = await waitFor(() => { try { return JSON.parse(fs.readFileSync(laneFile, "utf8")).id as string } catch { return null } }, 5000, 50)
      await idle(longId)
      await idle(quick!)
      const listed = (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions as Any[]
      check("summoned: started with the companion, a session of its own on its model, up with no turn (its short prompt needs none)", !!quick && quick !== longId &&
        !(await said(quick!)).some((e) => e.k === "user") && /haiku/.test(listed.find((s) => s.id === quick)?.model ?? "") &&
        !/haiku/.test(listed.find((s) => s.id === longId)?.model ?? ""), listed)
      check("summoned: it runs in auto mode (what it may run unasked is listed: no classifier's wait while they talk)",
        listed.find((s) => s.id === quick)?.mode === "auto", listed.map((s) => [s.id === quick ? "quick" : "long", s.mode]))
      const shot = path.join($.tmp, "screens", "display-1-1.png")
      fs.mkdirSync(path.dirname(shot), { recursive: true })
      fs.writeFileSync(shot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"))
      const before = (await said(longId)).length
      const screen = ["Inbox", ...Array.from({ length: 400 }, (_, i) => `Message ${i} from Bob about the weekly digest`), "Send", "Attach"].join("\n")
      // (held half way till its growing bubble is seen: a slow poll would miss it, and the whole one go before it's asked)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'hold words That is the Send button [point a1], and this sends it [ring a1 "Send"].', app: "com.example.mail", window: 9, title: "Inbox", sx: 500, sy: 480,
        shot, shotAt: { x: 0, y: 0, width: 1600, height: 1000 }, screen, near: [{ id: "a1", role: "button", label: "Send", frame: { x: 480, y: 470, width: 60, height: 24 } }] })
      const growing = await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "say" && /^That is the Send button/.test(n.text ?? "") && n.text !== "That is the Send button, and this sends it."), 15_000, 5)
      fs.writeFileSync(RELEASE, "")
      const answered = await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "say" && n.text === "That is the Send button, and this sends it."), 15_000, 50)
      await idle(quick!)
      fs.rmSync(RELEASE, { force: true })
      const asked = (await said(quick!)).filter((e) => e.k === "user").at(-1)?.text ?? ""
      check("summoned: an ask on screen is its session's message, its picture attached, answered in words by the companion's cursor",
        answered?.agent === "Claude" && /- ask on screen/.test(asked) && /a1 button "Send"/.test(asked) && (await said(longId)).length === before, [answered, asked])
      const meAt = asked.indexOf("(Who they are, their ME.md:"), nowAt = asked.indexOf("(What they're on now, their Now note (Now.md):\n## Tracks")
      check("now: a fresh chat session is told to read their Now note, a fresh summoned one what it says, after ME.md",
        ((await said(longId)).find((e) => e.k === "user")?.text ?? "").startsWith("Read ME.md, Now.md (what they're on now) and `vau docs companion` first, once.") &&
        meAt >= 0 && nowAt > meAt && asked.indexOf("- Next: call Alice about the lamp\n)") > nowAt, asked.slice(0, 600))
      fs.rmSync(path.join(VAULT, "Now.md"))
      if (meWas === null) fs.rmSync(path.join(VAULT, "ME.md")); else write("ME.md", meWas)
      check("summoned: its picture is said to be attached, not a path to read", /its picture, attached to this message/.test(asked) && !asked.includes(shot), asked.slice(0, 400))
      check("summoned: its words show as they're written, their tags never", !!growing && !/\[/.test(growing.text), growing)
      const windowText = (/what the window says[^\n]*\n((?: {4}.*(?:\n|$))+)/.exec(String(asked))?.[1] ?? "").replace(/^ {4}/gm, "").trimEnd()
      check("summoned: the window's text it's given is cut to what's by their pointer", windowText.length > 0 && windowText.length <= 4000 && /Send/.test(windowText) && /…/.test(windowText), windowText.length)
      const drew = (await api("POST", "ops/companion.timings", {}))[1].rows.filter((x: Any) => x.as === "Claude (summoned)").at(-1)
      const acts = fs.readFileSync(fs.readdirSync(c.plugin.localDir()).filter((f) => f.startsWith("actions-")).map((f) => path.join(c.plugin.localDir(), f)).at(-1)!, "utf8")
      check("summoned: a tag points (its cursor there) and a mark tag draws", /"op":"look"/.test(acts) && /"op":"draw"/.test(acts) && drew?.word !== undefined, drew)
      check("summoned: its answer says it answers a Talk key's ask, a typed one", answered?.answers?.t > 0 && !answered.answers.voice, answered?.answers)
      // (its picture's pixels are its points: what it's told and its tags agree, mapped to the screen by where the picture
      // sits; a mark that didn't show is told with its next ask)
      await idle(quick!)
      // (the helper's socket: marks are drawn only where it is)
      const { matchSocket: socketOf } = await import("../../../core/plugins.ts")
      const screen1: Any = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got: [] as Any[], send(t: string) { screen1.got.push(JSON.parse(t)) }, close() {}, ping() {}, terminate() {} })
      socketOf($.app.plugins, ["companion", "live"])![1].fn(screen1, {} as IncomingMessage, { wild: [], query: { screen: "1" } })
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'words Here [frame 10,20,30,40 "Tabs"], not [ring "Nowhere at all"].', app: "com.example.mail", window: 9, sx: 150, sy: 90,
        shot, shotAt: { x: 100, y: 50, width: 1329, height: 864 }, ink: [{ shape: "ring", box: { x: 400, y: 300, width: 50, height: 40 }, points: [[400, 300], [450, 340]] }] })
      await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "say" && /^Here/.test(n.text ?? "")), 15_000, 50)
      await idle(quick!)
      const inPicture = (await said(quick!)).filter((e) => e.k === "user").at(-1)?.text ?? ""
      const framed = screen1.got.find((m: Any) => m.t === "drawing" && m.drawing)?.drawing?.marks?.find((k: Any) => k.label === "Tabs")
      check("summoned: its ask's points are its picture's pixels, and a tag's pixels land on the screen where the picture shows them",
        /their pointer at 50, 40 in it/.test(inPicture) && /its box 300,250,50,40/.test(inPicture) && JSON.stringify(framed?.at) === '{"x":110,"y":70,"w":30,"h":40}', [framed, inPicture.slice(0, 900)])
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "words Okay.", app: "com.example.mail", window: 9, sx: 150, sy: 90 })
      await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "say" && n.text === "Okay."), 15_000, 50)
      await idle(quick!)
      const toldOf = (await said(quick!)).filter((e) => e.k === "user").at(-1)?.text ?? ""
      check("summoned: a mark of its last answer that didn't show is told with the next ask, so it doesn't go on as if they saw it; nor as if they saw nothing, when another did",
        /they never saw: your \[ring "Nowhere at all"\] wasn't drawn[^.]*\(what else you drew for it did show\)/.test(toldOf), toldOf.slice(0, 400))
      check("summoned: its Talk key's next ask takes the last answer's drawing down (a corrected mark replaces it, never stacks)",
        screen1.got.some((m: Any) => m.t === "drawing" && m.drawing === null), screen1.got.map((m: Any) => m.t))
      {
        const traced = async (f: () => void) => {
          const from = screen1.got.length
          await f()
          await $.sleep(100)
          await idle(quick!)
          await $.sleep(100)
          const s = screen1.got.slice(from).flatMap((m: Any) => (m.t === "agent" && m.agent.name === "Claude" ? [`${m.agent.state}${m.agent.seen ? " seen" : ""}`] : []))
          return s.filter((x: string, i: number) => x !== s[i - 1]).join(", ")
        }
        const turns: Record<string, string> = {}
        turns.words = await traced(() => cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "words Sure thing.", app: "com.example.mail", window: 9, sx: 150, sy: 90 }))
        turns.calls = await traced(() => cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'call look {"sx":200,"sy":100}\ncall say {"text":"There.","done":true}', app: "com.example.mail", window: 9, sx: 150, sy: 90 }))
        turns.passes = await traced(() => cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'call pass {"reason":"not for me"}', app: "com.example.mail", window: 9, sx: 150, sy: 90 }))
        check("summoned: its cursor thinks through a Talk key's turn, then watches (a seen tick when it passed)",
          JSON.stringify(turns) === JSON.stringify({ words: "thinking, watching", calls: "thinking, watching", passes: "thinking, watching seen" }), turns)
      }
      // (its draw tool's points are the same pixels, mapped the same way: the same box lands on the same spot, and a
      // wordless answer that shows is an answer, nothing said for it)
      const drawCalls = () => screen1.got.filter((m: Any) => m.t === "drawing" && m.drawing).length
      const before2 = drawCalls(), says2 = (await status()).notes.filter((n: Any) => n.kind === "say").length
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'call draw {"marks":[{"type":"frame","at":[10,20,30,40],"label":"Tabs"}],"done":true}', app: "com.example.mail", window: 9, sx: 150, sy: 90,
        shot, shotAt: { x: 100, y: 50, width: 1329, height: 864 }, displays: [{ x: 0, y: 0, width: 1470, height: 956 }] })
      const tooled = await waitFor(() => (drawCalls() > before2 ? screen1.got.filter((m: Any) => m.t === "drawing" && m.drawing).at(-1).drawing.marks.find((k: Any) => k.label === "Tabs") : null), 15_000, 50)
      await idle(quick!)
      check("summoned: a draw tool's box and the same inline tag land on the same screen spot, the picture's origin added once",
        JSON.stringify(tooled?.at) === JSON.stringify(framed?.at) && JSON.stringify(tooled?.at) === '{"x":110,"y":70,"w":30,"h":40}', [tooled, framed])
      check("summoned: a wordless draw that showed is its answer: nothing said for it", (await status()).notes.filter((n: Any) => n.kind === "say").length === says2, (await status()).notes.filter((n: Any) => n.kind === "say").slice(-2))
      // (a mark off every display isn't drawn nor said to be, and an answer that was only that isn't silent)
      for (const [how, text] of [["tool", 'call draw {"marks":[{"type":"frame","at":[3000,20,30,40]}],"done":true}'], ["tag", "words [frame 3000,20,30,40]"]]) {
        const n0 = screen1.got.length, sorry = async () => (await status()).notes.filter((n: Any) => n.kind === "say" && /couldn't mark that/.test(n.text ?? "")), had = (await sorry()).length
        cWindows.screenMoment({ kind: "ask", agent: "Claude", text, app: "com.example.mail", window: 9, sx: 150, sy: 90, shot, shotAt: { x: 100, y: 50, width: 1329, height: 864 }, displays: [{ x: 0, y: 0, width: 1470, height: 956 }] })
        const told = await waitFor(async () => (await sorry()).length > had || null, 15_000, 50)
        await idle(quick!)
        const results = fs.readFileSync(fs.readdirSync(c.plugin.localDir()).filter((f) => f.startsWith("actions-")).map((f) => path.join(c.plugin.localDir(), f)).at(-1)!, "utf8").trim().split("\n").slice(-6).join("\n")
        check(`summoned: a mark off their screen (its ${how}) isn't drawn, never "Drew", and the answer says so instead of silence`,
          !!told && !screen1.got.slice(n0).some((m: Any) => m.t === "drawing" && m.drawing) && !/Drew 1/.test(results), [told, results])
      }
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "words O botão de enviar", voice: true, app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      const aloud = await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "say" && n.text === "O botão de enviar"), 15_000, 50)
      check("summoned: one asked by voice says so (the desktop app says it aloud)", aloud?.answers?.voice === true && aloud.answers.t > answered.answers.t, aloud?.answers)
      await idle(quick!)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'call draw {"marks":[{"type":"point","at":[500,480]}],"say":"Right here, by Send.","done":true}', voice: true, app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      const drawn = await waitFor(async () => { const d = (await status()).notes.filter((n: Any) => n.kind === "say" && n.text === "Right here, by Send."); return d.length ? d : null }, 15_000, 50)
      check("summoned: a draw's words are a say as it writes them, one bubble, an answer by voice", drawn?.length === 1 && drawn[0].answers?.voice === true, drawn)
      await idle(quick!)
      // (a draw refused (a mark it can't draw, words nothing shows) and tried again: its words are said once)
      const tour = (say: string, bad: string) => `stream draw {"marks":[${bad}],"say":"${say}"}\nstream draw {"marks":[{"type":"ring","at":[500,480]},{"type":"arrow","from":[500,480],"to":[600,480],"beat":1}],"say":"${say}","done":true}`
      for (const [say, bad, why] of [["Your inbox. Then Send.", '{"type":"blob","at":[500,480]}', "a mark it can't draw"], ["The list. Then Attach.", '{"type":"ring","at":{"find":"Nowhere at all"}}', "words nothing shows"]]) {
        cWindows.screenMoment({ kind: "ask", agent: "Claude", text: tour(say, bad), voice: true, app: "com.example.mail", window: 9, sx: 500, sy: 480 })
        await waitFor(async () => (await status()).notes.some((n: Any) => n.kind === "say" && n.text === say) || null, 15_000, 50)
        await idle(quick!)
        const once = (await status()).notes.filter((n: Any) => n.kind === "say" && n.text === say)
        check(`summoned: a draw refused for ${why}, then drawn, says its words once (one bubble), never again`, once.length === 1, (await status()).notes.filter((n: Any) => n.kind === "say").slice(-3))
      }
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "what's this?", app: "com.example.mail", window: 9, sx: 500, sy: 480, shot })
      const seen = await waitFor(async () => (await said(quick!)).findLast((e) => e.k === "text" && /^Read it \(1 asks/.test(e.text))?.text, 15_000, 50)
      check("summoned: the display's picture comes with its message (no Read before its first word)", seen === "Read it (1 asks, 1 images)", seen)
      await idle(quick!)
      check("summoned: words it wrote that didn't stream (a keeper of older code) are said by its cursor at its turn's end",
        !!(await waitFor(async () => (await status()).notes.some((n: Any) => n.kind === "say" && n.text === "Read it (1 asks, 1 images)"), 3000, 50)))
      const down = path.join($.tmp, "screens", "display-1-2.png")
      fs.copyFileSync(shot, down)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "what's this?", app: "com.example.mail", window: 9, sx: 500, sy: 480, shot, shotDown: down, shotDownAt: { x: 0, y: 0, width: 1600, height: 1000 },
        notices: '"Claude isn\'t running" (4 s ago)' })
      const both = await waitFor(async () => (await said(quick!)).findLast((e) => e.k === "text" && /^Read it \(1 asks, 2 images/.test(e.text))?.text, 15_000, 50)
      const withDown = (await said(quick!)).filter((e) => e.k === "user").at(-1)?.text ?? ""
      check("summoned: the screen changed as they spoke, the key-down's picture comes too (a toast gone by the let-go), and Vaultite's toasts in words",
        both === "Read it (1 asks, 2 images)" && /as the key went down, attached before it/.test(withDown) && !withDown.includes(down) && /toasts of the last minute.*Claude isn't running/.test(withDown), [both, withDown.slice(0, 600)])
      const close = path.join($.tmp, "screens", "close-1-3.png")
      fs.copyFileSync(shot, close)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "what is this one?", app: "com.example.mail", window: 9, sx: 450, sy: 280, shot, shotAt: { x: 100, y: 50, width: 1329, height: 864 },
        closeUp: { shot: close, at: { x: 400, y: 250, width: 100, height: 60 }, scale: 3.2, mark: "pointer" } })
      const closer = await waitFor(async () => (await said(quick!)).findLast((e) => e.k === "text" && /^Read it \(1 asks, 2 images/.test(e.text))?.text, 15_000, 50)
      const withClose = (await said(quick!)).filter((e) => e.k === "user").at(-1)?.text ?? ""
      check("summoned: a closer look at what they pointed at comes with its picture, placed in that picture's pixels (small logos read off it)",
        closer === "Read it (1 asks, 2 images)" && /a closer look at what they pointed at, attached after its picture \(3\.2× its picture's size, of its x 300-400, y 200-260; their pointer's arrow is drawn on it, its tip on the thing they mean/.test(withClose) && !withClose.includes(close), [closer, withClose.slice(0, 900)])
      await idle(quick!)
      const sent = (await api("POST", "ops/claude-code.chat-read", { id: quick, limit: 100 }))[1].entries.filter((e: Any) => e.k === "text").map((e: Any) => e.text)
      cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "list", summoned: true })
      const qtools = await waitFor(async () => (await said(quick!)).findLast((e) => e.k === "text" && /^Tools:/.test(e.text))?.text, 15_000, 50)
      check("summoned: an ask by its Talk key in the app goes there too, with the short list of tools (its words are its say; no writing in notes)",
        /\bhandoff\b/.test(qtools ?? "") && /\bdraw\b/.test(qtools ?? "") && !/\bsay\b|\bedit\b|\bcomment\b|\bhandover\b/.test((qtools ?? "").split(".")[0]) && (await said(longId)).length === before, [qtools, sent])
      check("summoned: a lean session: its own prompt, only Bash of Claude Code's tools, none of the user's settings, low effort",
        /Prompt: its own\. Builtins: Bash\. Settings: none\. Effort: low/.test(qtools ?? ""), qtools)
      check("summoned: it looks in their projects and documents unasked (ls, lsof, tailscale serve status), never home's dotfiles or Library, nor git -c",
        ["Bash(tailscale serve status:*)", "Bash(git * -c *)", `Dirs: ${path.join(os.homedir(), "Projects")},${path.join(os.homedir(), "Documents")}`].every((x) => (qtools ?? "").includes(x)) &&
        !(qtools ?? "").includes(`Dirs: ${os.homedir()}.`), qtools)
      // (dontAsk refuses at once what isn't listed: a command or tool its prompt names must be one it may run)
      const { SUMMONED_PROMPT } = await import("../../../plugins/core/companion/summoned.ts")
      const rules = (k: string) => (new RegExp(`${k}: (.*?)\\. [A-Z]`).exec(qtools ?? "")?.[1] ?? "").split(",").flatMap((x) => /^Bash\((.*?)(:\*)?\)$/.exec(x)?.slice(1, 3) ?? [])
      const allow = rules("Allowed"), deny = rules("Denied")
      const runs = (cmd: string, rs: (string | undefined)[]) => rs.some((r, i) => i % 2 === 0 && !!r && (cmd === r || (rs[i + 1] !== undefined && cmd.startsWith(`${r} `))))
      const named = [...SUMMONED_PROMPT.matchAll(/\bvau(?: [a-z][\w:-]*){1,2}/g)].map((x) => x[0]), refused = named.filter((x) => !runs(x, allow) || runs(x, deny))
      const served = (qtools ?? "").split(".")[0].replace(/^Tools: /, "").split(",").map((x: string) => x.replace(/ \(.*\)$/, "")), tools = [...SUMMONED_PROMPT.matchAll(/mcp__vaultite-app__([\w-]+)|the ([\w-]+) tool\b/g)].map((x) => x[1] ?? x[2])
      check("summoned: every command its prompt names runs without asking, and every tool it names is served (its own page with a split too)",
        named.length >= 5 && !refused.length && tools.every((t) => served.includes(t)) && served.includes("page"), { refused, tools, served, allow })
      await idle(quick!)
      check("summoned: auto mode has its rules (a Mac's settings always asked on a card)", /Auto: rules/.test(qtools ?? ""), qtools)
      // A command auto mode blocks: offered by their pointer, run on their yes (said or clicked), a no told, each offer its own.
      {
        const { matchSocket } = await import("../../../core/plugins.ts")
        let onHelper: (m: Any) => void = () => {}
        const helper: Any = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got: [] as Any[], send(t: string) { const m = JSON.parse(t); helper.got.push(m); onHelper(m) }, close() {}, ping() {}, terminate() {} })
        matchSocket($.app.plugins, ["companion", "live"])![1].fn(helper, {} as IncomingMessage, { wild: [], query: { screen: "1" } })
        const tell = (m: object) => helper.emit("message", Buffer.from(JSON.stringify(m)))
        tell({ t: "moment", kind: "none" })
        const offers = () => helper.got.filter((m: Any) => m.t === "confirm"), up: string[] = []
        // (a stand-in helper: its cards up, a spoken answer for the one by the pointer, `aim`, else the newest)
        let aim = (): string | undefined => up.at(-1)
        onHelper = (m) => {
          if (m.t === "confirm") { up.push(m.id); setImmediate(() => tell({ t: "takeover-asking", id: m.id, agent: m.agent, ms: 600_000 })) }
          if (m.t === "takeover-answer") { const id = m.asked ? undefined : aim(); for (const x of id ? [id] : [...up]) { up.splice(up.indexOf(x), 1); tell({ t: "takeover-done", id: x, ok: m.yes === true, why: m.yes ? "yes" : m.asked ? "asked" : "no" }) } }
        }
        const click = (id: string, yes: boolean) => { up.splice(up.indexOf(id), 1); tell({ t: "takeover-done", id, ok: yes, why: yes ? "yes" : "no" }) }
        const shellSaid = async (n: number) => waitFor(async () => (await said(quick!)).filter((e) => e.k === "text" && /^Shell: /.test(e.text))[n]?.text as string | undefined, 15_000, 20)
        const ask = (text: string) => cWindows.screenMoment({ kind: "ask", agent: "Claude", text, app: "com.example.mail", window: 9, sx: 500, sy: 480 })
        const spoken = (text: string) => tell({ t: "moment", kind: "ask", agent: "Claude", text, voice: true, app: "com.example.mail", window: 9, sx: 500, sy: 480 })
        const cmd = "defaults write com.vaultite.offer-test probe -int 1"
        const seq0 = ask(`blocked ${cmd}`)?.seq ?? 0
        await waitFor(() => offers().length === 1, 15_000, 20)
        const o1 = offers()[0]
        check("summoned: a command auto mode blocks is offered by their pointer as one line, what it does under it",
          o1?.line === `Run \`${cmd}\`?` && o1.sub === "Writes a test setting. Say yes or click Run." && o1.agent === "Claude", [o1, (await said(quick!)).slice(-4).map((e) => `${e.k}: ${String(e.text).slice(-400)}`)])
        spoken("yes please")
        check("summoned: their spoken yes runs that very command (retried, not blocked again) and the ask completes",
          (await shellSaid(0)) === `Shell: ran ${cmd}` && helper.got.some((m: Any) => m.t === "takeover-answer" && m.yes === true), [(await said(quick!)).slice(-3).map((e) => `${e.k}: ${String(e.text).slice(-300)}`), helper.got.map((m: Any) => m.t)])
        await idle(quick!)
        const seq1 = ask(`blocked ${cmd}`)?.seq ?? 0
        check("summoned: their spoken yes answers the offer, not kept as an ask", seq1 === seq0 + 1, [seq0, seq1])
        await waitFor(() => offers().length === 2, 15_000, 20)
        click(offers()[1].id, true)
        check("summoned: a click on its Run runs it too (a yes before counts for nothing: offered again)", (await shellSaid(1)) === `Shell: ran ${cmd}`, await said(quick!))
        await idle(quick!)
        ask(`blocked ${cmd}`)
        await waitFor(() => offers().length === 3, 15_000, 20)
        spoken("no")
        const no = await shellSaid(2)
        check("summoned: their no isn't run and is told to it as theirs (don't try it another way), the ask completing",
          no?.startsWith(`Shell: denied ${cmd}: Not run: the user said no`) === true, no)
        await idle(quick!)
        // (two at once: a yes said by the older card runs that one, not the newest; the other's own answer stands)
        const a = "defaults write com.vaultite.offer-test a -int 1", b = "defaults write com.vaultite.offer-test b -int 1"
        ask(`blocked ${a}\nblocked ${b}`)
        await waitFor(() => offers().length === 5, 15_000, 20)
        const [oa, ob] = offers().slice(3).sort((x: Any, y: Any) => (x.line.includes(" a ") ? -1 : 1) - (y.line.includes(" a ") ? -1 : 1))
        aim = () => oa.id
        spoken("yes")
        await $.sleep(100)
        const pending = up.slice()
        click(ob.id, false)
        const two = await shellSaid(3)
        check("summoned: with two offers up, a yes meant for one runs that one and leaves the other waiting for its own answer",
          pending.length === 1 && pending[0] === ob.id && /ran defaults write com\.vaultite\.offer-test a /.test(two ?? "") && /denied defaults write com\.vaultite\.offer-test b /.test(two ?? ""), [pending, two])
        aim = () => up.at(-1)
        await idle(quick!)
        ask("blocked cat ~/.ssh/id_ed25519")
        const secret = await shellSaid(4)
        check("summoned: keys and secrets never run, nor are offered", /^Shell: denied cat ~\/\.ssh\/id_ed25519: That reads keys/.test(secret ?? "") && offers().length === 5, secret)
        await idle(quick!)
        helper.emit("close")
      }
      // (a tool that ends its turn before a word: its turn goes on, told to say what it did, so no ask ends in silence)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: 'call follow {"done":true}', app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      const nudged = await waitFor(async () => (await status()).notes.find((n: Any) => n.kind === "say" && /^Called: Following nothing\./.test(n.text ?? "")), 15_000, 50)
      check("summoned: a tool ending its turn with nothing said yet goes on, told to tell them what it did: an ask always gets words",
        /heard nothing from you on this ask/.test(nudged?.text ?? ""), nudged)
      await idle(quick!)
      const { quietly } = await import("../../../plugins/core/companion/talkturn.ts")
      check("summoned: a turn still ending silent says what its last tool did (no ids), else that it got nowhere",
        quietly('Closed "Fix the page" (jzzed4g2): done.') === 'Closed "Fix the page": done.' && /^I didn't get to an answer/.test(quietly("")) && quietly("I couldn't: no job zz") === "I couldn't: no job zz")
      const rows = (await api("POST", "ops/companion.timings", {}))[1].rows.filter((x: Any) => x.as === "Claude (summoned)")
      check("summoned: timings tell its asks apart, with their first word", rows.some((x: Any) => x.word !== undefined), rows)
      cState.addMoment({ kind: "ask", path: "Notes/Chat.md", line: 3, text: "call pass {\"reason\":\"not for me\"}" })
      await waitFor(async () => (await said(longId)).length > before, 15_000, 50)
      check("summoned: an ask in a note (no Talk key) still goes to the long session", (await said(longId)).some((e) => e.k === "user" && /not for me/.test(e.text)))
      await idle(longId)
      // (its process gone, idle a while: its Talk key pressed starts a fresh one before the ask)
      await api("POST", "ops/claude-code.chat-stop", { id: quick })
      const { matchSocket } = await import("../../../core/plugins.ts")
      const sc = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send() {}, close() {}, ping() {}, terminate() {} })
      matchSocket($.app.plugins, ["companion", "live"])![1].fn(sc as Any, {} as IncomingMessage, { wild: [], query: { screen: "1" } })
      sc.emit("message", Buffer.from(JSON.stringify({ t: "summoning" })))
      const warmed = await waitFor(() => { try { const x = JSON.parse(fs.readFileSync(laneFile, "utf8")).id; return x !== quick ? x : null } catch { return null } }, 5000, 50)
      check("summoned: its Talk key pressed with no process up, a fresh one starts while they speak", !!warmed && (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.some((s: Any) => s.id === warmed), warmed)
      await idle(warmed!)
      // (pressed again, or Esc, mid-answer: its turn stops, the long session's left alone)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "slow: tell me all about this window", app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      await waitFor(async () => (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === warmed)?.state === "working", 5000, 20)
      const longBefore = (await said(longId)).length
      const recapped = (await said(warmed!)).find((e) => e.k === "user")?.text ?? ""
      check("summoned: a fresh session's first ask is told the talk so far from its log (theirs, its words and what it did), so it goes on from there",
        /fresh session of an ongoing talk/.test(recapped) && /they (said|asked): words O botão de enviar/.test(recapped) && /you: O botão de enviar/.test(recapped) &&
        /min ago|just now/.test(recapped) && !/Now note/.test(recapped), recapped.slice(0, 900))
      sc.emit("message", Buffer.from(JSON.stringify({ t: "interrupt" })))
      check("summoned: the Talk key pressed again (or Esc) mid-answer stops its turn at once, never the long session's",
        !!(await waitFor(async () => (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === warmed)?.state === "idle", 500, 20)) &&
        (await said(longId)).length === longBefore)
      // (the realtime voice answered alone: the summoned answer asked meanwhile stops, unsaid and unkept; their ask stays once)
      await idle(warmed!)
      const box: Any[] = []
      Object.assign(sc, { send: (t: string) => box.push(JSON.parse(t)) })
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "slow: how's it going", voice: true, front: "realtime", app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      await waitFor(async () => (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === warmed)?.state === "working", 5000, 20)
      sc.emit("message", Buffer.from(JSON.stringify({ t: "answered", agent: "Claude", heard: "slow: how's it going", said: "Good, thanks!", withdraw: true })))
      const stopped = await waitFor(async () => (await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.find((s: Any) => s.id === warmed)?.state === "idle", 2000, 20)
      await $.sleep(200)
      const kept = (box.filter((m) => m.t === "said").at(-1)?.said ?? []) as Any[]
      check("summoned: the realtime voice answering alone withdraws the summoned answer: its turn stops, nothing of it said or kept, their ask once, its words the realtime voice's",
        !!stopped && kept.filter((n) => n.kind === "ask" && /how's it going/.test(n.text)).length === 1 && kept.some((n) => n.kind === "say" && n.text === "Good, thanks!") &&
        !(await status()).notes.some((n: Any) => n.kind === "say" && /I stopped/.test(n.text)), { stopped, kept: kept.slice(-4).map((n) => `${n.kind}: ${n.text}`) })
      await idle(warmed!)

      // A lost ask: its session gone or failing before it answered goes to a fresh one once; nothing raw is ever said.
      const laneId = () => { try { return JSON.parse(fs.readFileSync(laneFile, "utf8")).id as string } catch { return null } }
      const says = async (): Promise<string[]> => (await status()).notes.filter((n: Any) => n.kind === "say").map((n: Any) => n.text as string)
      const raw = (xs: string[]) => xs.filter((x) => /couldn't take that in|I stopped|no session|Not connected|keeper|[0-9a-f]{8}-[0-9a-f]{4}/.test(x))
      const actions = () => fs.readFileSync(fs.readdirSync(c.plugin.localDir()).filter((f) => f.startsWith("actions-")).map((f) => path.join(c.plugin.localDir(), f)).at(-1)!, "utf8")
      // (its keeper ended for an update as a fresh session sat warm for the ask they were speaking, as on 2026-11-06)
      await api("POST", "ops/claude-code.chat-stop", { id: warmed })
      sc.emit("message", Buffer.from(JSON.stringify({ t: "summoning" })))
      const cold = await waitFor(() => { const x = laneId(); return x && x !== warmed ? x : null }, 5000, 50)
      await idle(cold!)
      await k.stop()
      await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.length, 5000, 100)
      k = await keeper(CHAT_SOCKET)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "what's in this window", app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      const answeredCold = await waitFor(async () => { const x = laneId(); return x && x !== cold ? (await said(x)).findLast((e) => e.k === "text" && /^Read it/.test(e.text))?.text : null }, 15_000, 50)
      check("summoned: an ask after its keeper ended (an update) as its session sat warm goes to a fresh session and is answered, nothing raw said",
        !!answeredCold && !raw(await says()).length, [answeredCold, await says()])
      await idle(laneId()!)
      // (its session failing mid-ask: handed again once, to a fresh one, which answers)
      fs.writeFileSync(CRASH, "")
      const failing = laneId()
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "crash: what's this button", app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      const retried = await waitFor(async () => { const x = laneId(); return x && x !== failing ? (await said(x)).findLast((e) => e.k === "text" && /^Read it/.test(e.text))?.text : null }, 15_000, 50)
      const handedTwice = (actions().match(/"op":"handed"/g) ?? []).length
      check("summoned: its session failing mid-ask hands the ask again, once, to a fresh session that answers it; the error isn't said, it's in status",
        !!retried && !fs.existsSync(CRASH) && !raw(await says()).length && /Not connected/.test((await status()).summoned?.trouble?.why ?? ""), [retried, await says(), (await status()).summoned])
      await idle(laneId()!)
      // (no keeper to answer at all: one short line, said and logged as its say, never the error)
      await k.stop()
      await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.length, 5000, 100)
      cWindows.screenMoment({ kind: "ask", agent: "Claude", text: "and this one?", app: "com.example.mail", window: 9, sx: 500, sy: 480 })
      const gaveUp = await waitFor(async () => (await says()).find((x) => /ask me again/.test(x)), 15_000, 50)
      const handed = (actions().match(/"op":"handed"/g) ?? []).length - handedTwice
      check("summoned: an ask no session can take is tried once more, then gets one short line, logged as its say, nothing raw",
        gaveUp === "I lost my session there, ask me again?" && handed === 2 && actions().includes('"op":"say","text":"I lost my session there, ask me again?"') && !raw(await says()).length,
        [gaveUp, handed, await says()])
      k = await keeper(CHAT_SOCKET)
      sc.emit("close")
      await api("POST", "ops/companion.stop", {})
      check("summoned: the companion stopped, its summoned session ends too", !!(await waitFor(async () => !(await api("POST", "ops/claude-code.chat-list", {}))[1].sessions.length, 5000, 100)) &&
        !fs.existsSync(laneFile))
    }
    await api("POST", "ops/companion.clear", {})
  } finally {
    await api("PATCH", "config/plugin/companion", { mode: "off" })
    await k.stop()
  }
}
