// The Agent SDK in a test's chat keeper, no model: "call|stream|cut|hold <tool> <json>" calls a tool (streamed; cut off; held mid-text till $CHATD_TEST_RELEASE's file is there),
// "[hold ]words <text>" streams it, "slow" waits, "list" says how, "crash" fails it (once $CHATD_TEST_CRASH's file is there), "blocked <command>" is a shell call auto mode refuses.
import crypto from "node:crypto"
import fs from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Any } from "../../lib.ts"
export * from "@anthropic-ai/claude-agent-sdk"

/** A message's lines, each ask in a moments message as its text. */
const linesOf = (text: string) => text.split("\n").map((l) => {
  const ask = /^- ask .*?: (".*")$/.exec(l.trim())
  try { return ask ? String(JSON.parse(ask[1])) : l.trim() } catch { return l.trim() }
})
/** What a message asks it to call (an ask's lines, one call each). */
const callsIn = (text: string) => linesOf(text).flatMap((l) => l.split("\n")).flatMap((t) => {
  const m = /^(call|stream|cut|hold) (\w+) (\{.*\})$/.exec(t)
  try { return m ? [{ how: m[1], name: m[2], args: JSON.parse(m[3]), json: m[3] }] : [] } catch { return [] }
})

/** Half way through a call's text in its JSON (else half way through the JSON). */
function midText(json: string, args: Any) {
  const text = typeof args.text === "string" ? JSON.stringify(args.text) : "", at = text ? json.indexOf(text) : -1
  return at >= 0 ? at + Math.floor(text.length / 2) : Math.floor(json.length / 2)
}

export function query({ prompt, options }: Any) {
  const out: Any[] = []
  let wake = null as (() => void) | null, done = false, crashed: Error | null = null
  const push = (m: Any) => { out.push(m); wake?.() }
  const base = { session_id: options.sessionId ?? options.resume, parent_tool_use_id: null }
  let client: Promise<Client> | null = null
  const mcp = () => client ??= (async () => {
    const [a, b] = InMemoryTransport.createLinkedPair()
    await options.mcpServers["vaultite-app"].instance.connect(b)
    const c = new Client({ name: "fake-claude", version: "1" })
    await c.connect(a)
    return c
  })()
  const say = (text: string) => {
    const mid = `msg_${crypto.randomUUID().slice(0, 8)}`
    push({ type: "assistant", message: { id: mid, content: [{ type: "text", text }] }, uuid: crypto.randomUUID(), ...base })
    push({ type: "result", subtype: "success", is_error: false, duration_ms: 10, result: text, uuid: crypto.randomUUID(), ...base })
  }
  let interrupted: (() => void) | null = null
  const pause = (ms: number) => new Promise<boolean>((r) => { const t = setTimeout(() => { interrupted = null; r(false) }, ms); interrupted = () => { clearTimeout(t); interrupted = null; r(true) } })
  /** Its test's release file, waited for and taken (true: an interrupt came first). */
  const released = async () => {
    const file = process.env.CHATD_TEST_RELEASE!
    for (;;) {
      try { fs.rmSync(file); return false } catch { /* not yet */ }
      if (await pause(10)) return true
    }
  }
  /** A tool call's input streamed: its block opened, its JSON in pieces of `n`, closed (`whole`: else cut off half way;
   *  `held`: it waits at that index, half way through its text, until released). */
  const streamIn = async (name: string, json: string, use: string, whole: boolean, held = -1) => {
    const mid = `msg_${crypto.randomUUID().slice(0, 8)}`, ev = (event: Any) => push({ type: "stream_event", event, uuid: crypto.randomUUID(), ...base })
    ev({ type: "message_start", message: { id: mid } })
    ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: use, name: `mcp__vaultite-app__${name}`, input: {} } })
    const half = Math.floor(json.length / 2), upTo = whole ? json.length : half
    for (let i = 0; i < upTo; i += 6) {
      ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, Math.min(upTo, i + 6)) } })
      if (await pause(15)) return false
      if (i < held && i + 6 >= held && await released()) return false
    }
    if (whole) ev({ type: "content_block_stop", index: 0 })
    return whole
  }
  /** Its words written as a model's are: streamed in pieces, then the whole message and the turn's end (`held`: it
   *  waits half way, until released). */
  const write = async (text: string, held = false) => {
    const mid = `msg_${crypto.randomUUID().slice(0, 8)}`, ev = (event: Any) => push({ type: "stream_event", event, uuid: crypto.randomUUID(), ...base })
    ev({ type: "message_start", message: { id: mid } })
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
    const half = Math.floor(text.length / 2)
    for (let i = 0; i < text.length; i += 5) {
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 5) } })
      await pause(10)
      if (held && i < half && i + 5 >= half) await released()
    }
    ev({ type: "content_block_stop", index: 0 })
    push({ type: "assistant", message: { id: mid, content: [{ type: "text", text }] }, uuid: crypto.randomUUID(), ...base })
    push({ type: "result", subtype: "success", is_error: false, duration_ms: 10, result: text, uuid: crypto.randomUUID(), ...base })
  }
  /** A shell call the classifier blocks, as Claude Code goes: its PreToolUse hooks first (one may allow or deny it),
   *  else blocked, its PermissionDenied hooks told, and on their retry the same again. */
  const shell = async (command: string, tries = 2): Promise<string> => {
    const use = `toolu_${crypto.randomUUID().slice(0, 8)}`, input = { command, description: "Writes a test setting" }, signal = new AbortController().signal
    for (const m of options.hooks?.PreToolUse ?? []) if (!m.matcher || new RegExp(m.matcher).test("Bash"))
      for (const h of m.hooks) {
        const o = (await h({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: input, tool_use_id: use }, use, { signal }))?.hookSpecificOutput
        if (o?.permissionDecision === "allow") return `ran ${command}`
        if (o?.permissionDecision === "deny") return `denied ${command}: ${o.permissionDecisionReason}`
      }
    if (!tries) return `blocked ${command} again`
    let retry = false
    for (const m of options.hooks?.PermissionDenied ?? []) for (const h of m.hooks)
      retry ||= (await h({ hook_event_name: "PermissionDenied", tool_name: "Bash", tool_input: input, tool_use_id: use, reason: "judged dangerous" }, use, { signal }))?.hookSpecificOutput?.retry === true
    return retry ? shell(command, tries - 1) : `blocked ${command}`
  }
  void (async () => {
    push({ type: "system", subtype: "init", model: options.model ?? "claude-haiku-5", permissionMode: options.permissionMode ?? "default", cwd: options.cwd, ...base })
    for await (const m of prompt) {
      // (pictures with it: their count, as "[2 images]" before its text)
      const c = m.message.content, pics = Array.isArray(c) ? c.filter((x: Any) => x.type === "image").length : 0
      const text = `${pics ? `[${pics} images] ` : ""}${Array.isArray(c) ? c.filter((x: Any) => x.type === "text").map((x: Any) => x.text).join("\n") : String(c)}`
      if (/\bcrash\b/.test(text) && process.env.CHATD_TEST_CRASH && fs.existsSync(process.env.CHATD_TEST_CRASH)) {
        fs.rmSync(process.env.CHATD_TEST_CRASH)
        crashed = new Error(`MCP error -32000: Not connected (session ${base.session_id}, /tmp/claude/${base.session_id}.sock)`)
        break
      }
      if (/\bslow\b/.test(text) && await pause(800)) {
        push({ type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 10, uuid: crypto.randomUUID(), ...base })
        continue
      }
      const written = linesOf(text).find((l) => /^(hold )?words /.test(l))
      if (written) { await write(written.replace(/^(hold )?words /, ""), written.startsWith("hold ")); continue }
      if (linesOf(text).some((l) => /^list\b/.test(l))) {
        const tools = options.mcpServers?.["vaultite-app"] ? (await (await mcp()).listTools()).tools : []
        const always = tools.length && tools.every((t) => t._meta?.["anthropic/alwaysLoad"] === true)
        say(`Tools: ${tools.map((t) => t.name).join(",")}${always ? " (always loaded)" : ""}. Allowed: ${(options.allowedTools ?? []).join(",")}. Denied: ${(options.disallowedTools ?? []).join(",")}. Resumed: ${options.resume ? "yes" : "no"}. Told: ${/vaultite-app tools/.test(options.systemPrompt?.append ?? "") ? "tools" : "nothing"}. Ends: ${options.env?.CLAUDE_CODE_TERMINAL_MCP_TOOLS ?? ""}. Prompt: ${typeof options.systemPrompt === "string" ? "its own" : "Claude Code's"}. Builtins: ${Array.isArray(options.tools) ? options.tools.join(",") : "all"}. Settings: ${(options.settingSources ?? []).join(",") || "none"}. Effort: ${options.effort ?? ""}. Dirs: ${(options.additionalDirectories ?? []).join(",")}. Auto: ${options.settings?.autoMode ? "rules" : "none"}`)
        continue
      }
      const blocked = linesOf(text).flatMap((l) => l.split("\n")).filter((l) => /^blocked /.test(l)).map((l) => l.slice(8))
      if (blocked.length) { say(`Shell: ${(await Promise.all(blocked.map((b) => shell(b)))).join(" | ")}`); continue }
      const calls = callsIn(text), said: string[] = []
      let stopped = false
      for (const c of calls) {
        const use = `toolu_${crypto.randomUUID().slice(0, 8)}`
        // (cut off, or interrupted, as it wrote it: its turn ends there)
        if (c.how !== "call" && !(await streamIn(c.name, c.json, use, c.how !== "cut", c.how === "hold" ? midText(c.json, c.args) : -1))) { stopped = true; break }
        const r = await (await mcp()).callTool({ name: c.name, arguments: c.args, _meta: { "claudecode/toolUseId": use } }) as Any
        said.push(`${r.isError ? "error: " : ""}${r.content?.map((x: Any) => x.text).join(" ")}`)
        // (its hooks after the call, as Claude Code runs them: one may end the turn there)
        const tool_name = `mcp__vaultite-app__${c.name}`, outs: Any[] = []
        for (const m of options.hooks?.PostToolUse ?? []) if (!m.matcher || new RegExp(m.matcher).test(tool_name))
          for (const h of m.hooks) outs.push(await h({ hook_event_name: "PostToolUse", tool_name, tool_input: c.args, tool_response: r, tool_use_id: use }, use, { signal: new AbortController().signal }))
        if (outs.some((o) => o?.continue === false)) { stopped = true; break }
      }
      if (stopped) {
        push({ type: "result", subtype: said.length ? "success" : "error_during_execution", is_error: !said.length, duration_ms: 10, uuid: crypto.randomUUID(), ...base })
        continue
      }
      say(said.length ? `Called: ${said.join(" | ")}` : `Read it (${(text.match(/^- ask /gm) ?? []).length} asks${pics ? `, ${pics} images` : ""})`)
    }
    done = true
    wake?.()
  })()
  const gen = (async function* () {
    for (;;) {
      if (out.length) { yield out.shift(); continue }
      if (crashed) throw crashed
      if (done) return
      await new Promise<void>((r) => { wake = r })
      wake = null
    }
  })()
  return Object.assign(gen, {
    interrupt: async () => { interrupted?.() }, setModel: async () => {}, setPermissionMode: async () => {}, applyFlagSettings: async () => {},
    close: () => { done = true; wake?.() },
  })
}
