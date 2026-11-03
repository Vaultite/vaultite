// The Agent SDK in a test's chat keeper, its `query` answering with no model: "call|stream|cut <tool> <json>" calls a
// tool (streamed first; cut off half way), "slow" waits (an interrupt ends it), "list" says how it was started.
import crypto from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Any } from "../../lib.ts"
export * from "@anthropic-ai/claude-agent-sdk"

/** A message's lines, each ask in a moments message as its text. */
const linesOf = (text: string) => text.split("\n").map((l) => {
  const ask = /^- ask .*?: (".*")$/.exec(l.trim())
  try { return ask ? String(JSON.parse(ask[1])) : l.trim() } catch { return l.trim() }
})
/** What a message asks it to call. */
const callsIn = (text: string) => linesOf(text).flatMap((t) => {
  const m = /^(call|stream|cut) (\w+) (\{.*\})$/.exec(t)
  try { return m ? [{ how: m[1], name: m[2], args: JSON.parse(m[3]), json: m[3] }] : [] } catch { return [] }
})

export function query({ prompt, options }: Any) {
  const out: Any[] = []
  let wake = null as (() => void) | null, done = false
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
  /** A tool call's input streamed: its block opened, its JSON in pieces of `n`, closed (`whole`: else cut off half way). */
  const streamIn = async (name: string, json: string, use: string, whole: boolean) => {
    const mid = `msg_${crypto.randomUUID().slice(0, 8)}`, ev = (event: Any) => push({ type: "stream_event", event, uuid: crypto.randomUUID(), ...base })
    ev({ type: "message_start", message: { id: mid } })
    ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: use, name: `mcp__vaultite-app__${name}`, input: {} } })
    const upTo = whole ? json.length : Math.floor(json.length / 2)
    for (let i = 0; i < upTo; i += 6) {
      ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, Math.min(upTo, i + 6)) } })
      if (await pause(15)) return false
    }
    if (whole) ev({ type: "content_block_stop", index: 0 })
    return whole
  }
  void (async () => {
    push({ type: "system", subtype: "init", model: options.model ?? "claude-haiku-5", permissionMode: options.permissionMode ?? "default", cwd: options.cwd, ...base })
    for await (const m of prompt) {
      const text = String(m.message.content)
      if (/\bslow\b/.test(text) && await pause(800)) {
        push({ type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 10, uuid: crypto.randomUUID(), ...base })
        continue
      }
      if (linesOf(text).some((l) => /^list\b/.test(l))) {
        const tools = options.mcpServers?.["vaultite-app"] ? (await (await mcp()).listTools()).tools : []
        const always = tools.length && tools.every((t) => t._meta?.["anthropic/alwaysLoad"] === true)
        say(`Tools: ${tools.map((t) => t.name).join(",")}${always ? " (always loaded)" : ""}. Allowed: ${(options.allowedTools ?? []).join(",")}. Denied: ${(options.disallowedTools ?? []).join(",")}. Resumed: ${options.resume ? "yes" : "no"}. Told: ${/vaultite-app tools/.test(options.systemPrompt?.append ?? "") ? "tools" : "nothing"}. Ends: ${options.env?.CLAUDE_CODE_TERMINAL_MCP_TOOLS ?? ""}`)
        continue
      }
      const calls = callsIn(text), said: string[] = []
      let stopped = false
      for (const c of calls) {
        const use = `toolu_${crypto.randomUUID().slice(0, 8)}`
        // (cut off, or interrupted, as it wrote it: its turn ends there)
        if (c.how !== "call" && !(await streamIn(c.name, c.json, use, c.how === "stream"))) { stopped = true; break }
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
      say(said.length ? `Called: ${said.join(" | ")}` : `Read it (${(text.match(/^- ask /gm) ?? []).length} asks)`)
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
    interrupt: async () => { interrupted?.() }, setModel: async () => {}, setPermissionMode: async () => {}, applyFlagSettings: async () => {},
    close: () => { done = true; wake?.() },
  })
}
