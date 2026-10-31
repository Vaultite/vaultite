// The Agent SDK in a test's chat keeper: the real one (its MCP servers too) but `query`, which answers with no model:
// "call <tool> <json>" calls that tool through the session's MCP server, "slow" waits, "list" says how it was started.
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
  const m = /^call (\w+) (\{.*\})$/.exec(t)
  try { return m ? [{ name: m[1], args: JSON.parse(m[2]) }] : [] } catch { return [] }
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
  void (async () => {
    push({ type: "system", subtype: "init", model: options.model ?? "claude-haiku-5", permissionMode: options.permissionMode ?? "default", cwd: options.cwd, ...base })
    for await (const m of prompt) {
      const text = String(m.message.content)
      if (/\bslow\b/.test(text)) await new Promise((r) => setTimeout(r, 800))
      if (linesOf(text).some((l) => /^list\b/.test(l))) {
        const tools = options.mcpServers?.["vaultite-app"] ? (await (await mcp()).listTools()).tools : []
        const always = tools.length && tools.every((t) => t._meta?.["anthropic/alwaysLoad"] === true)
        say(`Tools: ${tools.map((t) => t.name).join(",")}${always ? " (always loaded)" : ""}. Allowed: ${(options.allowedTools ?? []).join(",")}. Denied: ${(options.disallowedTools ?? []).join(",")}. Resumed: ${options.resume ? "yes" : "no"}. Told: ${/vaultite-app tools/.test(options.systemPrompt?.append ?? "") ? "tools" : "nothing"}`)
        continue
      }
      const calls = callsIn(text), said: string[] = []
      for (const c of calls) {
        const r = await (await mcp()).callTool({ name: c.name, arguments: c.args }) as Any
        said.push(`${r.isError ? "error: " : ""}${r.content?.map((x: Any) => x.text).join(" ")}`)
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
    interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, applyFlagSettings: async () => {},
    close: () => { done = true; wake?.() },
  })
}
