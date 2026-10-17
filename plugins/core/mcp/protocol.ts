// The part of MCP it speaks (JSON-RPC 2.0: initialize, ping, tools/*, resources/* for MCP Apps' cards), the same for both
// transports. No SDK: it brings a web framework and a schema library for what is this file.
import { OpError, type Who, whoOf } from "../../../core/plugins.ts"
import { cardData, contents, linked, listed, type McpApp, takesUi, UI_EXTENSION, UI_MIME } from "./apps.ts"

/** Who a tool works for: the MCP client, as ops name who asked (core/ops.ts whoOf: the agent's id, how to name it,
 *  what a note it writes says as its source). */
export type Client = Omit<Who, "client"> & { client?: string | null }

/** An op's answer: its text, and its result (what a card draws). */
export type OpOut = { text: string; result?: unknown }
/** What a tool runs with: who it's for, and how to run an operation (by id: its answer as text, or with its result). */
export type ToolCtx = { client: Client; op: (id: string, params: Record<string, unknown>) => Promise<string | OpOut> }

export type Tool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP's hints: readOnlyHint, destructiveHint, idempotentHint, openWorldHint. */
  annotations: Record<string, boolean>
  /** Hosts' own fields (ChatGPT's openai/fileParams: the parameters it fills with a file from the chat). */
  meta?: Record<string, unknown>
  /** What it did, as Markdown for the AI. Throws ToolError (or OpError) when it can't (what to do instead, in its
   *  message). */
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string | OpOut>
  /** The card that reads its answers (apps.ts linked). */
  app?: McpApp
}

/** A tool that can't do what it was asked: its message goes back to the AI as the tool's result (isError). */
export class ToolError extends Error {}

/** An MCP client by the name it gives itself (initialize's clientInfo.name). */
export const clientOf = (name: unknown): Client => whoOf("mcp", typeof name === "string" ? name : null)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The versions it speaks, newest first: a client asking for one of these gets it, any other the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

/** What initialize says before the lines of the plugins that are on (core/plugins.ts agentLines), and after them. */
const INTRO = "This is the user's Vaultite vault: plain Markdown files they also read, which these tools read and write."
const LAST = [
  "Prefer an operation's own tool; ops lists the rest and call runs one.",
  "A photo or file the user shares goes in too: upload_file, with note set to the note or log it belongs to (write that first).",
]

/** The instructions: INTRO, the plugins' lines (an operation's id named by its tool's name, where it has one), LAST,
 *  then `extra` (the public server's own). */
export function instructionsOf(lines: string[], ops: { id: string; mcp?: string | null }[], extra: string[] = []) {
  const tools = new Map(ops.filter((o) => o.mcp).map((o) => [o.id, o.mcp!]))
  const say = (l: string) => l.replace(/`([a-z][\w-]*\.[a-z][\w.-]*)`/g, (all, id: string) => (tools.has(id) ? `\`${tools.get(id)}\`` : all))
  return [INTRO, ...[...lines, ...LAST, ...extra].map((l) => `- ${say(l)}`)].join("\n")
}

export type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Any; result?: unknown; error?: unknown }
export type Answer = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

/** What an adapter keeps of one client between messages: who it said it is, and whether it takes cards (initialize). */
export type Session = { client: Client | null; ui?: boolean }

export type Server = {
  /** The app's version, for serverInfo. */
  version: string
  /** A tool's context for this session's client, the tool being run named (for Activity). */
  ctx: (client: Client, tool: string) => ToolCtx
  /** The tools, as they are now (plugins turned on or off change them): catalog.ts. */
  tools: () => Promise<Tool[]> | Tool[]
  /** What initialize tells the client: instructionsOf, from the plugins that are on now. */
  instructions: () => Promise<string> | string
  /** serverInfo's icons and websiteUrl (MCP 2025-11-25), where the server has a public address. */
  identity?: { icons: { src: string; mimeType: string; sizes?: string[] }[]; websiteUrl?: string }
  /** The cards the plugins that are on offer (apps.ts), and the app's address on the internet for their links. */
  apps?: () => Promise<McpApp[]> | McpApp[]
  appUrl?: () => string | null
}

const fail = (id: Message["id"], code: number, message: string): Answer => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

/** A tool's declaration as tools/list gives it. */
export const declared = (t: Tool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
  annotations: { title: t.title, ...t.annotations }, ...(t.meta ? { _meta: t.meta } : {}) })

/** The answer to one message, or null for a notification (and for a client's answers to us: this server asks nothing). */
export async function handle(msg: unknown, session: Session, server: Server): Promise<Answer | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "Invalid Request: a JSON-RPC message is an object")
  const m = msg as Message
  const isRequest = m.id !== undefined && m.id !== null
  if (typeof m.method !== "string") return isRequest ? fail(m.id, -32600, "Invalid Request: no method") : null
  if (!isRequest) return null // notifications/initialized, notifications/cancelled...
  const id = m.id!
  const ok = (result: unknown): Answer => ({ jsonrpc: "2.0", id, result })
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "")
      session.client = clientOf(m.params?.clientInfo?.name)
      session.ui = takesUi(m.params?.capabilities)
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, extensions: { [UI_EXTENSION]: { mimeTypes: [UI_MIME] } } },
        serverInfo: { name: "vaultite", title: "Vaultite", version: server.version, ...server.identity },
        instructions: await server.instructions(),
      })
    }
    case "ping":
      return ok({})
    case "tools/list":
      return ok({ tools: (await toolsWithApps(server)).map(declared) })
    case "tools/call": {
      const name = String(m.params?.name ?? "")
      const tools = await toolsWithApps(server)
      const tool = tools.find((t) => t.name === name)
      if (!tool) return fail(id, -32602, `Unknown tool: ${name || "(none)"}. Tools: ${tools.map((t) => t.name).join(", ")}`)
      const args = m.params?.arguments
      if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) return fail(id, -32602, "arguments is an object")
      const client = session.client ?? clientOf("")
      return ok(await callTool(tool, (args ?? {}) as Record<string, unknown>, server.ctx(client, tool.name), session.ui !== false ? server.appUrl?.() ?? null : undefined))
    }
    case "resources/list":
      return ok({ resources: (await server.apps?.() ?? []).map(listed) })
    case "resources/read": {
      const uri = String(m.params?.uri ?? "")
      const app = (await server.apps?.() ?? []).find((a) => a.uri === uri)
      if (!app) return { jsonrpc: "2.0", id, error: { code: -32002, message: `Resource not found: ${uri || "(none)"}`, data: { uri } } }
      return ok(await contents(app))
    }
    case "resources/templates/list":
      return ok({ resourceTemplates: [] })
    case "prompts/list":
      return ok({ prompts: [] })
    default:
      return fail(id, -32601, `Method not found: ${m.method}`)
  }
}

/** The tools, each linked to the card that draws or reads it. */
export const toolsWithApps = async (server: Pick<Server, "tools" | "apps">) => linked(await server.tools(), await server.apps?.() ?? [])

/** A tool's CallToolResult: its text, and its card's structuredContent unless `app` is undefined (a client that said it
 *  takes no cards: text-only clients needn't read it twice). Its errors are results too (isError). */
export async function callTool(tool: Tool, args: Record<string, unknown>, ctx: ToolCtx, app?: string | null) {
  try {
    const out = await tool.run(args, ctx)
    const text = typeof out === "string" ? out : out.text
    const data = tool.app && app !== undefined && typeof out !== "string" ? await cardData(tool.app, { tool: tool.name, args, result: out.result, text, app }) : undefined
    return { content: [{ type: "text", text }], ...(data ? { structuredContent: data } : {}), isError: false }
  } catch (e) {
    const known = e instanceof ToolError || e instanceof OpError
    if (!known) console.error(`mcp: ${tool.name}:`, e)
    return { content: [{ type: "text", text: known ? (e as Error).message : `${tool.name} failed: ${(e as Error)?.message ?? e}` }], isError: true }
  }
}

/** A POST's body (one message, or a
 *  batch: a list of them) answered: one answer, a list, or null when there's nothing to answer (only notifications). */
export async function handleBody(body: unknown, session: Session, server: Server): Promise<Answer | Answer[] | null> {
  if (Array.isArray(body)) {
    if (!body.length) return fail(null, -32600, "Invalid Request: an empty batch")
    const out: Answer[] = []
    for (const m of body) { const a = await handle(m, session, server); if (a) out.push(a) }
    return out.length ? out : null
  }
  return handle(body, session, server)
}

/** Did this body start a session (an initialize among its messages)? */
export const initializes = (body: unknown) => (Array.isArray(body) ? body : [body]).some((m) => (m as Message)?.method === "initialize")

