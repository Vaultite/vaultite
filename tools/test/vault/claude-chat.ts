import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

/** A stand-in for the Agent SDK's query: it answers each message by what it says ("permission", "question", "plan",
 *  "slow"), streaming its answer, and keeps what it was given and answered. */
function fakeSdk() {
  const runs: Any[] = []
  const query = ({ prompt, options }: Any) => {
    const out: Any[] = []
    let wake = null as (() => void) | null, done = false
    const push = (m: Any) => { out.push(m); wake?.() }
    const sid = options.sessionId ?? options.resume
    const run: Any = { options, model: options.model, mode: options.permissionMode, efforts: [], said: [] }
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
    void (async () => {
      push({ type: "system", subtype: "init", model: options.model ?? "claude-sonnet-5", permissionMode: options.permissionMode ?? "default", cwd: options.cwd, ...base })
      for await (const m of prompt) {
        const text = String(m.message.content)
        run.said.push({ text, uuid: m.uuid })
        if (/permission/.test(text)) run.permission = await ask("Bash", { command: "rm -rf build" }, { title: "Claude wants to run rm -rf build",
          suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm:*" }], behavior: "allow", destination: "localSettings" }] })
        else if (/question/.test(text)) run.question = await ask("AskUserQuestion", { questions: [{ question: "Tea or coffee?", header: "Drink", multiSelect: false,
          options: [{ label: "Tea", description: "Hot leaves" }, { label: "Coffee", description: "Roasted beans" }] }] })
        else if (/plan/.test(text)) run.plan = await ask("ExitPlanMode", { plan: "## Plan\n1. Do it" })
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
      interrupt: async () => { run.stop?.(); run.abort?.() },
      setModel: async (m: string) => { run.model = m },
      setPermissionMode: async (m: string) => { run.mode = m },
      applyFlagSettings: async (s: Any) => { run.efforts.push(s.effortLevel) },
      close: () => { run.closed = true },
    })
  }
  return { runs, query }
}

export default async ($: VaultTest) => {
  const { CLAUDE_DIR, VAULT, api, app, check } = $
  const { Host, listen } = await import("../../../plugins/core/claude-code/chathost.ts")
  const { CHAT_SOCKET } = await import("../../../plugins/core/claude-code/chat.ts")
  const { settled } = await import("../../../plugins/core/inbox/plugin.ts")
  const { Reader } = await import("../../../plugins/core/claude-code/chatlog.ts")
  const as = (client: string, agent: string | null = null) => ({ socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:8793", "x-vaultite-client": client, ...(agent ? { "x-vaultite-agent": agent } : {}) } }) as unknown as IncomingMessage
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
  }
}
