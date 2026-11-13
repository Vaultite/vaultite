import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { portOf } from "../fakes.ts"
import { request } from "../fakes.ts"

/** A stand-in for the Agent SDK's query: it answers each message by what it says ("permission", "question", "plan", "slow",
 *  "hold": wait for `go()`), takes each the moment it's sent (as the SDK does) and runs them in turn; Stop takes back the rest. */
export function fakeSdk() {
  const runs: Any[] = []
  const query = ({ prompt, options }: Any) => {
    const out: Any[] = []
    let wake = null as (() => void) | null, done = false
    const push = (m: Any) => { out.push(m); wake?.() }
    const sid = options.sessionId ?? options.resume
    const run: Any = { options, model: options.model, mode: options.permissionMode, efforts: [], said: [], queued: [] }
    runs.push(run)
    const base = { session_id: sid, parent_tool_use_id: null }
    const ask = async (tool: string, input: Any, more: Any = {}) => {
      const tu = `tu_${crypto.randomUUID().slice(0, 8)}`
      push({ type: "assistant", message: { id: `msg_${tu}`, content: [{ type: "tool_use", id: tu, name: tool, input }] }, uuid: crypto.randomUUID(), ...base })
      const ctrl = new AbortController()
      run.abort = () => ctrl.abort()
      const r = await options.canUseTool(tool, input, { signal: ctrl.signal, toolUseID: tu, ...more })
      push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: tu, content: r.behavior === "allow" ? "ok" : r.message, is_error: r.behavior !== "allow" }] }, uuid: crypto.randomUUID(), ...base })
      return r
    }
    let more = null as (() => void) | null, drained = false
    void (async () => {
      for await (const m of prompt) { run.queued.push(m); more?.() }
      drained = true
      more?.()
    })()
    void (async () => {
      push({ type: "system", subtype: "init", model: options.model ?? "claude-sonnet-5", permissionMode: options.permissionMode ?? "default", cwd: options.cwd, ...base })
      for (;;) {
        if (!run.queued.length) {
          if (drained) break
          await new Promise<void>((r) => { more = r })
          more = null
          continue
        }
        const m = run.queued.shift()
        const c = m.message.content, text = typeof c === "string" ? c : c.filter((b: Any) => b.type === "text").map((b: Any) => b.text).join("\n")
        run.said.push({ text, uuid: m.uuid, content: c })
        if (/permission/.test(text)) run.permission = await ask("Bash", { command: "rm -rf build" }, { title: "Claude wants to run rm -rf build",
          suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm:*" }], behavior: "allow", destination: "localSettings" }] })
        else if (/question/.test(text)) run.question = await ask("AskUserQuestion", { questions: [{ question: "Tea or coffee?", header: "Drink", multiSelect: false,
          options: [{ label: "Tea", description: "Hot leaves" }, { label: "Coffee", description: "Roasted beans" }] }] })
        else if (/plan/.test(text)) run.plan = await ask("ExitPlanMode", { plan: "## Plan\n1. Do it" })
        else if (/background/.test(text)) {
          // (a Monitor left running when the turn ends; `background()` ends it)
          push({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bwatch", task_type: "monitor", description: "QA finishing" }, { task_id: "live", task_type: "monitor", description: "watcher", ambient: true }], ...base })
          run.background = () => push({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "live", task_type: "monitor", description: "watcher", ambient: true }], ...base })
        }
        else if (/hold/.test(text)) {
          const mid = `msg_${crypto.randomUUID().slice(0, 8)}`
          push({ type: "stream_event", event: { type: "message_start", message: { id: mid } }, ...base })
          push({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, api_message_id: mid, ...base })
          await new Promise<void>((r) => { run.go = r })
          push({ type: "assistant", message: { id: mid, content: [{ type: "text", text: `Held: ${text}` }] }, uuid: crypto.randomUUID(), ...base })
          push({ type: "result", subtype: "success", is_error: false, duration_ms: 50, result: "Done", uuid: crypto.randomUUID(), ...base })
          continue
        }
        else if (/slow/.test(text)) {
          await new Promise<void>((r) => { run.stop = r })
          push({ type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 50, errors: ["Interrupted"], uuid: crypto.randomUUID(), ...base })
          continue
        }
        const mid = `msg_${crypto.randomUUID().slice(0, 8)}`
        push({ type: "stream_event", event: { type: "message_start", message: { id: mid } }, ...base })
        push({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, api_message_id: mid, ...base })
        push({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done: " } }, api_message_id: mid, ...base })
        push({ type: "assistant", message: { id: mid, content: [{ type: "text", text: `Done: ${text}` }] }, uuid: crypto.randomUUID(), ...base })
        await options.hooks?.Stop?.[0]?.hooks?.[0]?.({ hook_event_name: "Stop", effort: { level: "medium" } }, undefined, { signal: new AbortController().signal })
        push({ type: "result", subtype: "success", is_error: false, duration_ms: 1200, result: "Done", uuid: crypto.randomUUID(), ...base })
      }
      done = true
      wake?.()
    })()
    const gen = (async function* () {
      for (;;) {
        if (out.length) { yield out.shift(); continue }
        if (done) return
        await new Promise<void>((r) => { wake = r })
        wake = null
      }
    })()
    return Object.assign(gen, {
      interrupt: async (o?: { cancelQueued?: boolean }) => {
        const queued = run.queued.map((m: Any) => m.uuid)
        if (o?.cancelQueued) run.queued.length = 0
        run.stop?.(); run.abort?.()
        return o?.cancelQueued ? { still_queued: [], cancelled: queued } : { still_queued: queued }
      },
      setModel: async (m: string) => { run.model = m },
      setPermissionMode: async (m: string) => { run.mode = m },
      applyFlagSettings: async (s: Any) => { run.efforts.push(s.effortLevel) },
      close: () => { run.closed = true },
    })
  }
  return { runs, query }
}

/** The smallest pictures: a 1x1 PNG and a JPEG's first bytes (enough to say what it is). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])

export default async ($: VaultTest) => {
  const { CLAUDE_DIR, VAULT, api, app, check } = $
  const { Host, listen } = await import("../../../plugins/core/claude-code/chathost.ts")
  const { CHAT_SOCKET } = await import("../../../plugins/core/claude-code/chatwire.ts")
  const { settled } = await import("../../../plugins/core/inbox/plugin.ts")
  const { Reader } = await import("../../../plugins/core/claude-code/chatlog.ts")
  const { IMAGES } = await import("../../../plugins/core/claude-code/chatpictures.ts")
  const { merge } = await import("../../../plugins/core/claude-code/chatentries.ts")
  const { matchSocket } = await import("../../../core/plugins.ts")
  const as = (client: string, agent: string | null = null) => request({ host: "127.0.0.1:8793", "x-vaultite-client": client, ...(agent ? { "x-vaultite-agent": agent } : {}) }, { remote: "127.0.0.1" })
  const asApp = as("app/desktop")
  const rows = async () => { await settled(); return (await api("GET", "inbox/events"))[1].events as Any[] }

  // The entries: a streamed block grows, then its whole message takes its place under the same id (as a transcript's
  // line does), a tool call gets its result, and a user's message is its uuid.
  {
    const r = new Reader()
    r.feed({ type: "user", uuid: "u1", message: { content: "Fix it<system-reminder>x</system-reminder>" } })
    r.feed({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } })
    r.feed({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, api_message_id: "m1" })
    const grew: Any[] = r.feed({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "On it" } }, api_message_id: "m1" })
    r.feed({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } }, api_message_id: "m1" })
    const typing: Any[] = r.feed({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command": "npm te' } }, api_message_id: "m1" })
    r.feed({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "On it." }] } })
    r.feed({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } })
    r.feed({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "1 failing", is_error: true }] } })
    const all = [...r.entries.values()] as Any[]
    check("chat entries: what the user said (reminders out), the answer streamed then whole under one id, a tool call and its result",
      all.length === 3 && all[0].k === "user" && all[0].text === "Fix it" && all[0].id === "u1" && grew[0]?.text === "On it" && grew[0].live &&
      all[1].id === "m1:0" && all[1].text === "On it." && !all[1].live && typing[0]?.summary === "npm te" &&
      all[2].id === "t1" && all[2].summary === "npm test" && all[2].result === "1 failing" && all[2].error === true && r.text === "On it." && r.prompt === "Fix it", all)
  }
  // A message sent mid-turn: its transcript line is an attachment, by the uuid it was sent with, where the turn took it.
  {
    const r = new Reader()
    const q = (prompt: string, uuid: string, commandMode = "prompt") => ({ type: "attachment", uuid: `a-${uuid}`, attachment: { type: "queued_command", prompt, source_uuid: uuid, commandMode, timestamp: "2026-01-02T10:00:00Z" } })
    r.feed({ type: "user", uuid: "u1", message: { content: "Fix it" } })
    r.feed({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } })
    r.feed(q("Also the phone", "u2"))
    r.feed(q("<task-notification>done</task-notification>", "u3", "task-notification"))
    r.feed(q("<agent-message from=\"x\">hi</agent-message>", "u4"))
    r.feed({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Both." }] } })
    const all = [...r.entries.values()] as Any[]
    check("chat entries: a message sent mid-turn read back from its transcript in its place, under the id it was sent with; a task's notice and another session's message aren't the user's",
      all.map((e) => e.id).join() === "u1,t1,u2,m2:0" && all[2].k === "user" && all[2].text === "Also the phone", all)
  }

  // The keeper, run in this process with the stand-in SDK, where the plugin looks for it.
  const sdk = fakeSdk()
  const host = new Host({ query: sdk.query as Any })
  const served = listen(host, CHAT_SOCKET)
  await new Promise((r) => served.server.once("listening", r))
  const cc = app.plugins.find((p) => p.id === "claude-code")!
  const was = { sample: cc.services.sample }
  cc.services.sample = async () => ({ text: "DONE", truncated: false })
  try {
    let [st, b] = await api("POST", "ops/claude-code.chat-start", { prompt: "Say hello", cwd: VAULT, model: "sonnet", mode: "default" })
    const id = b.id
    check("chat start: a new session, its id a UUID", st === 200 && /^[0-9a-f-]{36}$/.test(id), [st, b])
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 5000, 50)
    const o = sdk.runs[0]?.options
    check("chat start: a new session by its id, the model asked, Claude Code's own settings and prompt, Vaultite's words added, the account's folder",
      o?.sessionId === id && !o.resume && o.model === "sonnet" && o.cwd === VAULT && o.env.CLAUDE_CONFIG_DIR === CLAUDE_DIR && o.includePartialMessages === true &&
      o.systemPrompt?.preset === "claude_code" && /Vaultite's chat/.test(o.systemPrompt.append) && o.settingSources?.includes("project") && sdk.runs[0].said[0].text === "Say hello" &&
      o.env.CLAUDE_CODE_SESSION_ID === id && o.env.VAULTITE_AGENT === "claude" && !!o.hooks?.PostToolUse?.length,
      { ...o, env: o?.env?.CLAUDE_CONFIG_DIR, canUseTool: undefined })
    {
      // A lean session (the summoned companion's): its own prompt, none of the user's settings, few tools; its words told as written.
      const sdk3 = fakeSdk(), host3 = new Host({ query: sdk3.query as Any })
      const lean = crypto.randomUUID(), told: Any[] = [], off = host3.on((e) => { if (e.t === "partial" && e.id === lean) told.push(e) })
      host3.start({ id: lean, resume: false, cwd: VAULT, env: {}, system: "Be brief.", builtins: ["Bash"], texts: true }, "Say hello")
      await waitFor(() => host3.list().find((s) => s.id === lean)?.state === "idle", 5000, 50)
      const lo = sdk3.runs[0]?.options
      check("chat: a lean session runs with its own prompt, no settings, MCP servers or skills of the user's, only its tools",
        lo?.systemPrompt === "Be brief." && lo.settingSources?.length === 0 && lo.strictMcpConfig === true && lo.tools?.join() === "Bash", { ...lo, env: undefined, canUseTool: undefined, hooks: undefined })
      check("chat: its words are told as written, no tool's, by the entry they make", told.length >= 2 && told[0].name === "" && told[0].json === "Done: " && /^msg_\w+:0$/.test(told[0].use) && told.at(-1).end === "stop", told)
      off()
      host3.close()
    }
    {
      // An idle session's process ends after a while, but not while something it started runs in the background.
      const sdk4 = fakeSdk(), host4 = new Host({ query: sdk4.query as Any })
      host4.idleMs = 150
      const bg = crypto.randomUUID()
      host4.start({ id: bg, resume: false, cwd: VAULT, env: {} }, "Watch the QA run in the background")
      await waitFor(() => host4.list().find((s) => s.id === bg)?.state === "idle", 5000, 50)
      await new Promise((r) => setTimeout(r, 500))
      check("chat: an idle session waiting on its background task keeps running, and says it has one (a code update waits for it)",
        host4.list().find((s) => s.id === bg)?.background === 1, host4.list())
      sdk4.runs[0].background()
      const ended = await waitFor(() => !host4.list().some((s) => s.id === bg), 3000, 50)
      check("chat: once its background task is done (an ambient one doesn't count), the idle wait ends it", !!ended, host4.list())
      host4.close()
    }
    check("chat start: the mode asked is the one it runs in", o?.permissionMode === "default" && host.list().find((s) => s.id === id)?.mode === "default", o?.permissionMode)
    check("chat: the effort Claude Code applies is the session's, till one is chosen", host.list().find((s) => s.id === id)?.effort === "medium", host.list())
    let row = (await rows()).find((e) => e.session === id)
    check("chat: a turn that ended goes to the inbox through its session intake, done when nothing's for the user, its host's",
      row?.source === "claude" && row.kind === "session" && row.state === "done" && row.host === true && !row.terminal && row.body === "Done: Say hello", row)
    ;[st, b] = await api("POST", "ops/claude-code.chat-read", { id })
    check("chat read: what was said, the answer", st === 200 && b.entries.map((e: Any) => e.k).join(",") === "user,text,result" && b.entries[1].text === "Done: Say hello", b)

    // A permission: the inbox row needs the user, Approve answers it in the session (never an agent).
    await api("POST", "ops/claude-code.chat-send", { id, text: "Clean up, ask permission" })
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "waiting", 5000, 50)
    row = (await rows()).find((e) => e.session === id)
    check("chat: a permission asked is its row, waiting, in its words", row?.state === "open" && row.ask === "permission" && row.host &&
      /rm -rf build/.test(row.body ?? ""), row)
    const [byAgent] = await api("POST", "ops/claude-code.chat-answer", { id, allow: true }, as("cli", "claude-code"))
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: row.id, answer: "approve" }, asApp)
    await waitFor(() => sdk.runs[0].permission, 3000, 50)
    check("chat: Approve in the inbox allows it in the session; an agent can't", byAgent === 403 && st === 200 && sdk.runs[0].permission?.behavior === "allow" &&
      !sdk.runs[0].permission.updatedPermissions, [byAgent, st, b, sdk.runs[0].permission])
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    const ask = host.read(id)!.entries.find((e) => e.k === "ask") as Any
    check("chat: the ask is an entry, answered, offering Always allow in words", ask?.kind === "permission" && ask.answer === "Allowed" && ask.always === "`rm` commands" &&
      ask.title === "Claude wants to run rm -rf build", ask)

    // Always allow from the chat tab: its suggested rule goes with it.
    await api("POST", "ops/claude-code.chat-send", { id, text: "Again, ask permission" })
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "waiting", 3000, 50)
    ;[st] = await api("POST", "ops/claude-code.chat-answer", { id, allow: true, always: true }, asApp)
    await waitFor(() => sdk.runs[0].permission?.updatedPermissions, 3000, 50)
    check("chat answer: always allow sends its rule", st === 200 && sdk.runs[0].permission.updatedPermissions?.[0]?.rules?.[0]?.ruleContent === "rm:*", sdk.runs[0].permission)

    // A question: its row has the questions, picked in the inbox.
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    await api("POST", "ops/claude-code.chat-send", { id, text: "A question for you" })
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "waiting", 3000, 50)
    row = (await rows()).find((e) => e.session === id)
    check("chat: a question asked is its row with its questions", row?.ask === "question" && row.questions?.[0]?.question === "Tea or coffee?" &&
      row.questions[0].options.length === 2, row)
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: row.id, answer: "pick", picks: ["Tea"] }, asApp)
    await waitFor(() => sdk.runs[0].question, 3000, 50)
    await new Promise((r) => setTimeout(r, 600)) // (kept a moment after a change)
    const keptAt = path.join(cc.localDir(), "chats.json")
    check("chat: one thread per session, its id kept with the session and given back on each news", (await rows()).filter((e) => e.session === id).length === 1 &&
      fs.existsSync(keptAt) && JSON.parse(fs.readFileSync(keptAt, "utf8"))[id]?.thread === row.id, keptAt)
    check("chat: picked in the inbox, answered in the session by its label", st === 200 && sdk.runs[0].question?.updatedInput?.answers?.["Tea or coffee?"] === "Tea", [st, b, sdk.runs[0].question])

    // From the chat tab's picker: its Type something row's answer, then Chat about this (as Claude Code says it).
    const asks: [Any, (q: Any) => boolean, string][] = [
      [{ picks: [""], typed: ["Matcha"] }, (q) => q?.updatedInput?.answers?.["Tea or coffee?"] === "Matcha", "chat answer: what's typed in Type something is its answer"],
      [{ chat: true }, (q) => q?.behavior === "deny" && /clarify these questions/.test(q.message ?? ""), "chat answer: Chat about this puts the questions aside for it to ask what to clarify"]]
    for (const [a, ok, name] of asks) {
      await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
      sdk.runs[0].question = null
      await api("POST", "ops/claude-code.chat-send", { id, text: "A question for you" })
      await waitFor(() => host.list().find((s) => s.id === id)?.state === "waiting", 3000, 50)
      ;[st, b] = await api("POST", "ops/claude-code.chat-answer", { id, ...a }, asApp)
      await waitFor(() => sdk.runs[0].question, 3000, 50)
      check(name, st === 200 && ok(sdk.runs[0].question), [st, b, sdk.runs[0].question])
    }

    // A reply from the inbox goes straight in, not typed into a terminal.
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    row = (await rows()).find((e) => e.session === id)
    ;[st, b] = await api("POST", "ops/inbox.reply", { to: row.id, text: "Thanks, now the docs" }, asApp)
    await waitFor(() => sdk.runs[0].said.some((x: Any) => x.text === "Thanks, now the docs"), 3000, 50)
    check("chat: a reply from the inbox is said in the session", st === 200 && b.how === "host" && sdk.runs[0].said.at(-1)?.text === "Thanks, now the docs", [st, b])

    // A plan: approved with the mode after it.
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    await api("POST", "ops/claude-code.chat-send", { id, text: "Make a plan" })
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "waiting", 3000, 50)
    row = (await rows()).find((e) => e.session === id)
    ;[st] = await api("POST", "ops/claude-code.chat-answer", { id, allow: true, mode: "acceptEdits" }, asApp)
    await waitFor(() => sdk.runs[0].mode === "acceptEdits", 3000, 50)
    check("chat: a plan's row has it; approved, the mode after it is set", row?.ask === "plan" && row.body === "## Plan\n1. Do it" && st === 200 &&
      sdk.runs[0].plan?.behavior === "allow" && sdk.runs[0].mode === "acceptEdits", [row, sdk.runs[0].plan, sdk.runs[0].mode])

    // A message while it asks is the answer: no, and do this instead.
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    await api("POST", "ops/claude-code.chat-send", { id, text: "Once more, ask permission" })
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "waiting", 3000, 50)
    ;[st, b] = await api("POST", "ops/claude-code.chat-send", { id, text: "Move it to the trash instead" })
    await waitFor(() => sdk.runs[0].permission?.behavior === "deny", 3000, 50)
    check("chat send: while it asks permission, a message denies it with what to do instead", st === 200 && b.answered &&
      /trash instead/.test(sdk.runs[0].permission?.message ?? ""), [b, sdk.runs[0].permission])

    // Interrupt, model and effort.
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    await api("POST", "ops/claude-code.chat-send", { id, text: "Something slow" })
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "working", 3000, 50)
    ;[st] = await api("POST", "ops/claude-code.chat-interrupt", { id })
    const back = await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    ;[, b] = await api("POST", "ops/claude-code.chat-set", { id, model: "opus", effort: "high" })
    check("chat: interrupted, it's idle again; the model and effort change in place", st === 200 && !!back && sdk.runs[0].model === "opus" &&
      sdk.runs[0].efforts.includes("high") && b.model === "opus" && b.effort === "high", [st, b])
    // A mode chosen in a tab that didn't know it ran yet comes with the message: set, then said.
    ;[st] = await api("POST", "ops/claude-code.chat-send", { id, text: "Now in auto", mode: "auto" })
    await waitFor(() => sdk.runs[0].said.at(-1)?.text === "Now in auto", 3000, 50)
    check("chat send: a mode given with a message to a running session is set first", st === 200 && sdk.runs[0].mode === "auto" &&
      host.list().find((s) => s.id === id)?.mode === "auto" && sdk.runs.length === 1, [st, sdk.runs[0].mode])
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    // The inbox's services for a session with no terminal: a reply, an answer.
    const reply = cc.services["agent-reply:claude"] as (s: string, t: string) => Promise<boolean>
    const answerIt = cc.services["agent-answer:claude"] as (s: string, a: Any) => Promise<boolean>
    const took = await reply(id, "One more thing")
    await waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 3000, 50)
    const none = await answerIt(id, { answer: "approve" })
    check("agent-reply takes a message for a chat session; agent-answer nothing while it asks nothing; neither a session that isn't here",
      took && sdk.runs[0].said.at(-1)?.text === "One more thing" && !none && !(await reply("9f9f9f9f-0000-4000-8000-000000000000", "hi")), [took, none])
    ;[st, b] = await api("POST", "ops/claude-code.chat-list", {})
    check("chat list: the session, its state", st === 200 && b.sessions.some((s: Any) => s.id === id && s.state === "idle"), b)
    {
      const [sa, all] = await api("POST", "ops/claude-code.chat-list", { machine: "all" })
      const [sn] = await api("POST", "ops/claude-code.chat-list", { machine: "nowhere" })
      check("chat list: machine all has this machine's too; a machine that isn't one says so", sa === 200 && all.sessions.some((s: Any) => s.id === id) && sn === 404, [sa, all, sn])
      // The Agents panel's list: the same, every machine's, a turn's words cut short.
      const [sc, chats] = await api("GET", "claude-code/chats")
      const mine = chats?.sessions?.find((s: Any) => s.id === id)
      check("chats route: every machine's sessions, as chat list says, the last turn's words cut to a row's", sc === 200 && mine?.state === "idle" &&
        (mine.turn?.prompt ?? "").length <= 200 && (mine.turn?.text ?? "").length <= 200, [sc, mine])
    }

    // A resume or fork that gives the session a new id, told with its thread: still one row, following the new id.
    {
      const tell = app.plugins.find((p) => p.id === "inbox")!.services["inbox:session"] as (b: Any) => Promise<Any>
      const other = crypto.randomUUID(), threadId = (await rows()).find((x) => x.session === id)!.id
      const e = await tell({ agent: "claude", session: other, thread: threadId, state: "done", prompt: "Go on", text: "Went on" })
      const both = (await rows()).filter((x) => x.id === threadId || x.session === other || x.session === id)
      check("chat: two session ids on one thread are one inbox row, following the newer", e?.id === threadId && both.length === 1 && both[0].session === other, both)
      await tell({ agent: "claude", session: id, thread: threadId, state: "done", prompt: "Back", text: "Back" })
    }
    // Stopped, then a message resumes it (its transcript says where it ran).
    const proj = path.join(CLAUDE_DIR, "projects", "-tmp-chat")
    fs.mkdirSync(proj, { recursive: true })
    fs.writeFileSync(path.join(proj, `${id}.jsonl`), JSON.stringify({ type: "user", uuid: sdk.runs[0].said[0].uuid, cwd: VAULT, sessionId: id, message: { content: "Say hello" }, timestamp: new Date().toISOString() }) + "\n")
    ;[st, b] = await api("POST", "ops/claude-code.chat-stop", { id })
    await waitFor(() => !host.list().some((s) => s.id === id), 3000, 50)
    ;[st, b] = await api("POST", "ops/claude-code.chat-send", { id, text: "Are you there?" })
    await waitFor(() => sdk.runs[1]?.said.length, 3000, 50)
    check("chat: stopped, a message resumes the same session in its folder", st === 200 && b.resumed && sdk.runs[1]?.options.resume === id &&
      !sdk.runs[1].options.sessionId && sdk.runs[1].options.cwd === VAULT && sdk.runs[1].said[0].text === "Are you there?", [st, b, sdk.runs[1]?.options.resume])
    check("chat: resumed, it runs in the mode it had", sdk.runs[1]?.options.permissionMode === "auto", sdk.runs[1]?.options.permissionMode)
    ;[st, b] = await api("POST", "ops/claude-code.chat-read", { id })
    check("chat read: its transcript and the live turn, merged by id (the first message once)", b.entries.filter((e: Any) => e.text === "Say hello").length === 1 &&
      b.entries.some((e: Any) => e.text === "Are you there?"), b.entries)

    // A voice note goes to a chat session when the front door is Claude Code.
    const conf = path.join(VAULT, ".vaultite/plugins/inbox/data.json"), kept = fs.existsSync(conf) ? fs.readFileSync(conf, "utf8") : null
    fs.mkdirSync(path.dirname(conf), { recursive: true })
    fs.writeFileSync(conf, JSON.stringify({ ...(kept ? JSON.parse(kept) : {}), dispatch: "claude" }))
    ;[st, b] = await api("POST", "ops/inbox.voice", { text: "Remind me to water the plants" })
    // (the inbox names what took it: here, the chat session)
    const voiced = b.session ?? b.terminal
    await waitFor(() => sdk.runs.some((r: Any) => r.options.sessionId === voiced && r.said.length), 3000, 50)
    if (kept === null) fs.rmSync(conf); else fs.writeFileSync(conf, kept)
    if (b.path) fs.rmSync(path.join(VAULT, b.path), { force: true })
    check("voice note: handed to a new chat session, not a terminal", st === 200 && /^[0-9a-f-]{36}$/.test(voiced ?? "") &&
      sdk.runs.some((r: Any) => r.options.sessionId === voiced && /water the plants/.test(r.said[0]?.text ?? "")), b)

    // No mode asked: the account's permissions.defaultMode, else auto.
    check("chat start: none asked, it starts in auto", sdk.runs.find((r: Any) => r.options.sessionId === voiced)?.options.permissionMode === "auto",
      sdk.runs.find((r: Any) => r.options.sessionId === voiced)?.options.permissionMode)
    {
      const at = path.join(CLAUDE_DIR, "settings.json"), had = fs.existsSync(at) ? fs.readFileSync(at, "utf8") : null
      fs.writeFileSync(at, JSON.stringify({ ...(had ? JSON.parse(had) : {}), permissions: { defaultMode: "acceptEdits" } }))
      try {
        const [, s1] = await api("POST", "ops/claude-code.chat-start", { cwd: VAULT })
        const [, opts] = await api("GET", "claude-code/chat/options")
        check("chat start: none asked, the account's own defaultMode, which the tab shows", sdk.runs.find((r: Any) => r.options.sessionId === s1.id)?.options.permissionMode === "acceptEdits" &&
          opts.accounts?.[0]?.mode === "acceptEdits", [sdk.runs.at(-1)?.options.permissionMode, opts.accounts])
        host.stop(s1.id)
      } finally { if (had === null) fs.rmSync(at); else fs.writeFileSync(at, had) }
    }

    // ---------- a turn's state, as the SDK sends messages: each the moment it's sent
    {
      const sdk5 = fakeSdk(), host5 = new Host({ query: sdk5.query as Any }), states: string[] = []
      host5.idleMs = 150
      const sid = crypto.randomUUID(), off = host5.on((e) => { if (e.t === "state" && e.s.id === sid) states.push(e.s.state) })
      host5.start({ id: sid, resume: false, cwd: VAULT, env: {} }, "hold on")
      await waitFor(() => sdk5.runs[0]?.go, 3000, 20)
      // (sent while it writes its answer: the SDK has it at once, and runs it as its own turn after this one's result)
      host5.send(sid, "hold this one too")
      const first = sdk5.runs[0].go
      first()
      await waitFor(() => sdk5.runs[0].go !== first, 3000, 20)
      await new Promise((r) => setTimeout(r, 400))
      check("chat: a message sent as a turn ended runs as its own turn, working (Stop shows), not idle and ended mid-turn",
        host5.list().find((s) => s.id === sid)?.state === "working" && states.slice(-2).join() === "idle,working" && !sdk5.runs[0].closed, [states, host5.list()])
      sdk5.runs[0].go()
      await waitFor(() => host5.list().find((s) => s.id === sid)?.state === "idle", 3000, 20)
      // An ask the SDK takes back (its call aborted, not answered): working again till its turn ends.
      host5.idleMs = 60_000
      states.length = 0
      host5.send(sid, "ask permission")
      await waitFor(() => host5.list().find((s) => s.id === sid)?.state === "waiting", 3000, 20)
      sdk5.runs[0].abort()
      await waitFor(() => host5.list().find((s) => s.id === sid)?.state === "idle", 3000, 20)
      const ask = host5.read(sid)!.entries.find((e) => e.k === "ask") as Any
      check("chat: an ask taken back leaves waiting (working, then its turn's end), answered Stopped", states.join().includes("waiting,working") &&
        states.at(-1) === "idle" && ask?.answer === "Stopped" && !host5.list().find((s) => s.id === sid)!.asks.length, [states, ask])
      // Stop takes back the messages queued behind the turn, given back to send again.
      states.length = 0
      host5.send(sid, "hold the line")
      await waitFor(() => sdk5.runs[0].queued.length === 0 && host5.read(sid)!.entries.some((e) => e.k === "text" && (e as Any).live), 3000, 20)
      const q = host5.send(sid, "and this, later")
      await waitFor(() => sdk5.runs[0].queued.length === 1, 3000, 10)
      const dropped: string[] = [], off2 = host5.on((e) => { if (e.t === "drop") dropped.push(e.e) })
      const r = await host5.interrupt(sid)
      sdk5.runs[0].go?.()
      await waitFor(() => host5.list().find((s) => s.id === sid)?.state === "idle", 3000, 20)
      check("chat: Stop takes back what was queued behind the turn: given back, its entry gone, never run", r.taken.length === 1 && r.taken[0].text === "and this, later" &&
        dropped.join() === q.uuid && !host5.read(sid)!.entries.some((e) => e.id === q.uuid) && !sdk5.runs[0].said.some((x: Any) => x.text === "and this, later"), [r, dropped])
      off(); off2()
      host5.close()
    }

    // ---------- the chat tab's socket: hello first, then what changed, nothing lost or undone; the conversation merged
    {
      const tab = () => {
        const got: Any[] = []
        const ws: Any = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send(d: string) { got.push(JSON.parse(d)) }, close() { ws.readyState = 3; ws.emit("close") }, ping() {}, terminate() { ws.close() } })
        return { ws, got }
      }
      const open = (sid: string, ws: Any) => matchSocket(app.plugins, ["claude-code", "chat", sid])![1].fn(ws, asApp, { wild: [sid], query: {} })
      /** What a tab shows from its messages, as useChat draws them. */
      const drawn = (got: Any[]) => {
        let map = new Map<string, Any>(), st: Any = null
        for (const m of got) {
          if (m.t === "hello") { map = new Map(m.history.entries.map((e: Any) => [e.id, e])); st = m.s }
          else if (m.t === "put") map.set(m.e.id, m.e)
          else if (m.t === "drop") map.delete(m.e)
          else if (m.t === "state") st = m.s
        }
        return { entries: [...map.values()], st }
      }
      const [, w] = await api("POST", "ops/claude-code.chat-start", { cwd: VAULT, mode: "default" })
      let fine = true, why: Any = null
      const run = sdk.runs.find((r: Any) => r.options.sessionId === w.id)!
      const same = (got: Any[], state: string) => {
        const d = drawn(got), want = host.read(w.id)!.entries
        return got[0]?.t === "hello" && d.st?.state === state && d.st.seq === host.list().find((s) => s.id === w.id)!.seq &&
          want.every((e) => JSON.stringify(d.entries.find((x) => x.id === e.id)) === JSON.stringify(e))
      }
      for (let delay = 0; delay < 12 && fine; delay++) {
        const t = tab()
        run.go = null
        // (its message sent as the tab's hello is made: what it hears meanwhile is newer than what the hello says)
        setTimeout(() => void api("POST", "ops/claude-code.chat-send", { id: w.id, text: `hold ${delay}` }), delay)
        open(w.id, t.ws)
        await waitFor(() => run.go && t.got.some((m) => m.t === "hello"), 3000, 5)
        await new Promise((r) => setTimeout(r, 30))
        const mid = same(t.got, "working")
        run.go()
        await waitFor(() => host.list().find((s) => s.id === w.id)?.state === "idle" && t.got.some((m) => m.t === "state" && m.s?.state === "idle"), 3000, 20)
        await new Promise((r) => setTimeout(r, 30))
        if (!mid || !same(t.got, "idle")) { fine = false; why = { delay, mid, got: t.got.map((m) => `${m.t}:${m.s?.state ?? m.e?.id ?? ""}`), d: drawn(t.got) } }
        t.ws.close()
      }
      check("chat tab: its hello comes first, then each change since, so a tab opened mid-turn shows the turn and its end (never working forever)", fine, why)

      // Reload mid-way: what only the keeper has (an ask, a turn's failure) stays where it was, not at the bottom.
      await api("POST", "ops/claude-code.chat-send", { id: w.id, text: "ask permission" })
      await waitFor(() => host.list().find((s) => s.id === w.id)?.state === "waiting", 3000, 20)
      await api("POST", "ops/claude-code.chat-answer", { id: w.id, allow: true }, asApp)
      await waitFor(() => host.list().find((s) => s.id === w.id)?.state === "idle", 3000, 20)
      const live = host.read(w.id)!.entries
      // (its transcript as Claude Code writes it: the messages and calls, not the asks nor the turns' ends)
      const lines = live.flatMap((e: Any): Any[] => e.k === "user" ? [{ type: "user", uuid: e.id, message: { content: e.text }, timestamp: e.at }]
        : e.k === "text" ? [{ type: "assistant", message: { id: e.id.split(":")[0], content: [{ type: "text", text: e.text }] }, timestamp: e.at }]
        : e.k === "tool" ? [{ type: "assistant", message: { id: `msg_${e.id}`, content: [{ type: "tool_use", id: e.id, name: e.name, input: e.input }] }, timestamp: e.at },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: e.id, content: e.result ?? "" }] }, timestamp: e.at }] : [])
      fs.writeFileSync(path.join(proj, `${w.id}.jsonl`), lines.map((l) => JSON.stringify({ ...l, cwd: VAULT, sessionId: w.id })).join("\n") + "\n")
      const t = tab()
      open(w.id, t.ws)
      await waitFor(() => t.got.some((m) => m.t === "hello"), 3000, 20)
      const shown = t.got.find((m) => m.t === "hello").history.entries.map((e: Any) => e.id)
      const differs = live.findIndex((e, i) => shown[i] !== e.id), at = differs < 0 ? live.length : differs
      check("chat tab: reloaded, the transcript and the keeper's entries in the order they were shown (an ask after its call, each turn's end after it)",
        shown.join() === live.map((e) => e.id).join(), { at, of: [shown.length, live.length], shown: shown.slice(Math.max(0, at - 2), at + 4),
          live: live.slice(Math.max(0, at - 2), at + 4).map((e) => `${e.k}:${e.id}:${e.at}`) })
      t.ws.close()
      const e = (k: string, id: string, more: Any = {}) => ({ k, id, at: "", text: "", ...more })
      const m1 = merge([e("user", "u1"), e("text", "a:0"), e("note", "n", { text: "Interrupted" }), e("user", "u2"), e("text", "b:0")],
        [e("ask", "ask:1"), e("text", "a:0", { text: "newer" }), e("note", "r1", { text: "Stopped" }), e("user", "u2"), e("result", "r2"), e("text", "b:0"), e("note", "r3", { text: "Failed" })])
      check("chat: merged, the keeper's own entries after the one before them (leading ones before the first shared), its newer copy in place, Stopped once beside Interrupted",
        m1.map((x) => x.id).join() === "u1,ask:1,a:0,n,u2,r2,b:0,r3" && (m1[2] as Any).text === "newer", m1.map((x) => x.id))

      // Another machine not answering: the tab is told so and tries again (refused is for good).
      const ms = app.plugins.find((p) => p.id === "machines")!.services, wasM = { ...ms }
      const server = http.createServer((req, res) => {
        if (/\/image\/u-remote\/0$/.test(req.url ?? "")) res.writeHead(200, { "Content-Type": "image/png" }).end(PNG)
        else res.writeHead(404).end("{}")
      }).listen(0, "127.0.0.1")
      await new Promise((r) => server.once("listening", r))
      const studio = { id: "studio", label: "Studio", url: `http://127.0.0.1:${portOf(server)}`, online: false, self: false, plugins: ["claude-code"] }
      ms["machines:machine"] = async (mid: string) => (mid === "studio" ? studio : null)
      try {
        const off = tab()
        open(`${w.id}@studio`, off.ws)
        await waitFor(() => off.got.length, 3000, 20)
        check("chat tab: another machine not answering is unreachable for now, not refused", off.got[0]?.t === "unreachable" && /Studio/.test(off.got[0].reason), off.got)
        studio.online = true
        const [st, png] = await api("GET", `claude-code/chat/${w.id}@studio/image/u-remote/0`)
        check("chat: another machine's session's picture comes from that machine", st === 200 && Buffer.isBuffer(png) && png.equals(PNG), [st])
      } finally { Object.assign(ms, wasM); server.close() }
    }

    // ---------- pictures: checked by the ops, written for the keeper, sent as image blocks, shown live and read back
    {
      const [, w] = await api("POST", "ops/claude-code.chat-start", { cwd: VAULT, mode: "default" })
      const png = { data: PNG.toString("base64"), type: "image/png" }
      const refusals: [Any, RegExp, string][] = [
        [Array.from({ length: 11 }, () => png), /at most 10/, "eleven"],
        [[{ data: JPEG.toString("base64"), type: "image/png" }], /image\/jpeg, not image\/png/, "a JPEG called a PNG"],
        [[{ data: Buffer.from("hello there").toString("base64"), type: "image/png" }], /isn't a PNG, JPEG, GIF or WebP/, "not a picture"],
        [[{ data: `data:image/png;base64,${png.data}`, type: "image/png" }], /data: prefix/, "a data: URL"],
        [[{ data: Buffer.concat([PNG, Buffer.alloc(5 << 20)]).toString("base64"), type: "image/png" }], /over 5 MB/, "over 5 MB"],
        [[{ data: png.data, type: "image/tiff" }], /type/, "a type it doesn't take"]]
      const bad: Any[] = []
      for (const [images, why, name] of refusals) {
        const [st, b] = await api("POST", "ops/claude-code.chat-send", { id: w.id, text: "Look", images })
        if (st !== 400 || !why.test(b.error ?? "") || !/images/.test(b.error)) bad.push([name, st, b.error])
      }
      check("chat send: pictures refused in plain words when too many, too big, not pictures, not what they say, or a data: URL", !bad.length, bad)
      const before = sdk.runs.find((r: Any) => r.options.sessionId === w.id)!.said.length
      let [st, b] = await api("POST", "ops/claude-code.chat-send", { id: w.id, images: [png, { data: JPEG.toString("base64"), type: "image/jpeg" }] })
      const run = sdk.runs.find((r: Any) => r.options.sessionId === w.id)!
      await waitFor(() => run.said.length > before, 3000, 20)
      const got = run.said.at(-1)?.content
      check("chat send: pictures alone reach the session as image blocks (no text block)", st === 200 && Array.isArray(got) && got.length === 2 && got[0].type === "image" &&
        got[0].source.media_type === "image/png" && got[0].source.data === png.data && got[1].source.media_type === "image/jpeg", [st, b, got?.map?.((c: Any) => c.type)])
      const mine = host.read(w.id)!.entries.find((e) => e.id === b.uuid) as Any
      check("chat: the message's entry has its pictures, no \"_(image)_\" text", mine?.k === "user" && mine.text === "" && mine.images?.length === 2 &&
        mine.images[0].src === `image/${b.uuid}/0`, mine)
      ;[st, b] = await api("GET", `claude-code/chat/${w.id}/${mine.images[1].src}`)
      check("chat: a picture is served while the server keeps it", st === 200 && Buffer.isBuffer(b) && b.equals(JPEG), [st])
      // While it asks: the pictures go with the message, the ask answered by it.
      await waitFor(() => host.list().find((s) => s.id === w.id)?.state === "idle", 3000, 20)
      await api("POST", "ops/claude-code.chat-send", { id: w.id, text: "ask permission" })
      await waitFor(() => host.list().find((s) => s.id === w.id)?.state === "waiting", 3000, 20)
      ;[st, b] = await api("POST", "ops/claude-code.chat-send", { id: w.id, text: "Not that, see this", images: [png] })
      await waitFor(() => run.said.at(-1)?.text === "Not that, see this", 3000, 20)
      check("chat send: a message with pictures while it asks answers the ask and is said, pictures and all", st === 200 && !!b.answered && run.permission?.behavior === "deny" &&
        run.said.at(-1).content[0]?.type === "image", [st, b, run.permission])
      // Read back from the transcript: the user line's image blocks, and a message sent mid-turn (its queued_command).
      const r = new Reader()
      r.feed({ type: "user", uuid: "u-img", message: { content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png.data } }, { type: "text", text: "This one" }] } })
      r.feed({ type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", source_uuid: "u-q", prompt: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png.data } }] } })
      const [a, q] = [r.entries.get("u-img") as Any, r.entries.get("u-q") as Any]
      check("chat entries: a transcript's pictures are the entry's, its text without \"_(image)_\"; a picture alone sent mid-turn too",
        a?.text === "This one" && a.images?.[0]?.src === "image/u-img/0" && q?.text === "" && q.images?.length === 1, [a, q])
      const old = path.join(proj, `${w.id}.jsonl`)
      fs.writeFileSync(old, JSON.stringify({ type: "user", uuid: "u-old", cwd: VAULT, sessionId: w.id, message: { content: [{ type: "text", text: "Old" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG.toString("base64") } }] } }) + "\n")
      ;[st, b] = await api("GET", `claude-code/chat/${w.id}/image/u-old/0`)
      const [st2] = await api("GET", `claude-code/chat/${w.id}/image/u-old/1`)
      check("chat: a picture the server no longer keeps comes from its transcript; one that isn't there is a 404", st === 200 && Buffer.isBuffer(b) && b.equals(JPEG) && st2 === 404, [st, st2])
      host.stop(w.id)
    }

    // A message as its idle process ends (the keeper's news of it on its way): resumed with it, not refused.
    {
      const [, w] = await api("POST", "ops/claude-code.chat-start", { prompt: "Say hi", cwd: VAULT })
      await waitFor(() => host.list().find((s) => s.id === w.id)?.state === "idle", 3000, 20)
      fs.writeFileSync(path.join(proj, `${w.id}.jsonl`), JSON.stringify({ type: "user", uuid: crypto.randomUUID(), cwd: VAULT, sessionId: w.id, message: { content: "Say hi" }, timestamp: new Date().toISOString() }) + "\n")
      ;(host as Any).sessions.delete(w.id)
      const [st, b] = await api("POST", "ops/claude-code.chat-send", { id: w.id, text: "Still there?" })
      await waitFor(() => sdk.runs.some((r: Any) => r.options.resume === w.id && r.said.length), 3000, 20)
      check("chat send: to a session whose process just ended, it's resumed with the message", st === 200 && b.resumed &&
        sdk.runs.find((r: Any) => r.options.resume === w.id)?.said[0]?.text === "Still there?", [st, b])
      host.stop(w.id)
    }

    // The keeper dies mid-turn (a reboot, a crash): the next one takes the turn up again, once.
    const [, slow] = await api("POST", "ops/claude-code.chat-start", { prompt: "Something slow", cwd: VAULT })
    await waitFor(() => host.list().find((s) => s.id === slow.id)?.state === "working", 3000, 50)
    const cut = slow.id
    fs.writeFileSync(path.join(proj, `${cut}.jsonl`), JSON.stringify({ type: "user", uuid: crypto.randomUUID(), cwd: VAULT, sessionId: cut, message: { content: "A voice note" }, timestamp: new Date().toISOString() }) + "\n")
    await served.stop()
    const sdk2 = fakeSdk(), host2 = new Host({ query: sdk2.query as Any }), served2 = listen(host2, CHAT_SOCKET)
    try {
      await new Promise((r) => served2.server.once("listening", r))
      const again = await waitFor(() => sdk2.runs.find((r: Any) => r.options.resume === cut && r.said.length), 9000, 100)
      check("keeper gone mid-turn: the next one resumes it, told to go on", !!again && again.said[0].text === "Continue where you left off." &&
        sdk2.runs.filter((r: Any) => r.options.resume === cut).length === 1, sdk2.runs.map((r: Any) => [r.options.resume, r.said]))
      for (const s of host2.list()) host2.stop(s.id)
      await waitFor(() => !host2.list().length, 3000, 50)
    } finally { host2.close(); await served2.stop() }
    for (const s of host.list()) host.stop(s.id)
  } finally {
    cc.services.sample = was.sample
    host.close()
    await served.stop()
    fs.rmSync(IMAGES, { recursive: true, force: true })
  }
}
