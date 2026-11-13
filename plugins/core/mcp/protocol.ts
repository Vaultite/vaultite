import { z } from "zod"
import { OpError, type Who, whoOf } from "../../../core/plugins.ts"
import { cardData, contents, linked, listed, type McpApp, takesUi, UI_EXTENSION, UI_MIME } from "./apps.ts"

export type Client = Omit<Who, "client"> & { client?: string | null }

export type OpOut = { text: string; result?: unknown; image?: { data: string; mimeType: string } | null }
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
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string | OpOut>
  app?: McpApp
}

export class ToolError extends Error {}

export const clientOf = (name: unknown): Client => whoOf("mcp", typeof name === "string" ? name : null)

/** The versions it speaks, newest first: a client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

const INTRO = "This is the user's Vaultite vault: plain Markdown files they also read, which these tools read and write."
const LAST = [
  "Prefer an operation's own tool; ops lists the rest and call runs one.",
  "A photo or file the user shares goes in too: upload_file, with note set to the note or log it belongs to (write that first).",
]

export function instructionsOf(lines: string[], ops: { id: string; mcp?: string | null }[], extra: string[] = []) {
  const tools = new Map(ops.filter((o) => o.mcp).map((o) => [o.id, o.mcp!]))
  const say = (l: string) => l.replace(/`([a-z][\w-]*\.[a-z][\w.-]*)`/g, (all, id: string) => (tools.has(id) ? `\`${tools.get(id)}\`` : all))
  return [INTRO, ...[...lines, ...LAST, ...extra].map((l) => `- ${say(l)}`)].join("\n")
}

const Params = z.looseObject({ clientInfo: z.looseObject({ name: z.unknown() }).optional().catch(undefined) })
const Message = z.looseObject({ id: z.union([z.string(), z.number(), z.null()]).optional(), method: z.unknown(), params: Params.optional().catch(undefined) })
type Message = z.infer<typeof Message>
const Args = z.record(z.string(), z.unknown())
export const Pictured = z.object({ text: z.unknown(), image: z.object({ data: z.string(), mimeType: z.string() }).nullish().catch(null) }).nullable().catch(null)
export type Answer = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export type Session = { client: Client | null; ui?: boolean }

export type Server = {
  version: string
  ctx: (client: Client, tool: string) => ToolCtx
  tools: () => Promise<Tool[]> | Tool[]
  instructions: () => Promise<string> | string
  /** serverInfo's icons and websiteUrl (MCP 2025-11-25), where the server has a public address. */
  identity?: { icons: { src: string; mimeType: string; sizes?: string[] }[]; websiteUrl?: string }
  apps?: () => Promise<McpApp[]> | McpApp[]
  appUrl?: () => string | null
}

const fail = (id: Message["id"], code: number, message: string): Answer => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

export const declared = (t: Tool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
  annotations: { title: t.title, ...t.annotations }, ...(t.meta ? { _meta: t.meta } : {}) })

export async function handle(msg: unknown, session: Session, server: Server): Promise<Answer | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "Invalid Request: a JSON-RPC message is an object")
  const m = Message.safeParse(msg).data
  if (!m) return fail(null, -32600, "Invalid Request: its id is a string or a number")
  const isRequest = m.id !== undefined && m.id !== null
  if (typeof m.method !== "string") return isRequest ? fail(m.id, -32600, "Invalid Request: no method") : null
  if (!isRequest) return null
  const id = m.id!, ok = (result: unknown): Answer => ({ jsonrpc: "2.0", id, result })
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
      const given = m.params?.arguments, args = Args.safeParse(given === undefined ? {} : given)
      if (!args.success) return fail(id, -32602, "arguments is an object")
      const client = session.client ?? clientOf("")
      return ok(await callTool(tool, args.data, server.ctx(client, tool.name), session.ui !== false ? server.appUrl?.() ?? null : undefined))
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

export const toolsWithApps = async (server: Pick<Server, "tools" | "apps">) => linked(await server.tools(), await server.apps?.() ?? [])

export async function callTool(tool: Tool, args: Record<string, unknown>, ctx: ToolCtx, app?: string | null) {
  try {
    const out = await tool.run(args, ctx)
    const text = typeof out === "string" ? out : out.text
    const data = tool.app && app !== undefined && typeof out !== "string" ? await cardData(tool.app, { tool: tool.name, args, result: out.result, text, app }) : undefined
    const image = typeof out !== "string" && out.image ? [{ type: "image", data: out.image.data, mimeType: out.image.mimeType }] : []
    return { content: [{ type: "text", text }, ...image], ...(data ? { structuredContent: data } : {}), isError: false }
  } catch (e) {
    const known = e instanceof ToolError || e instanceof OpError
    if (!known) console.error(`mcp: ${tool.name}:`, e)
    const message = e instanceof Error ? e.message : String(e)
    return { content: [{ type: "text", text: known ? message : `${tool.name} failed: ${message}` }], isError: true }
  }
}

export async function handleBody(body: unknown, session: Session, server: Server): Promise<Answer | Answer[] | null> {
  if (Array.isArray(body)) {
    if (!body.length) return fail(null, -32600, "Invalid Request: an empty batch")
    const out: Answer[] = []
    for (const m of body) { const a = await handle(m, session, server); if (a) out.push(a) }
    return out.length ? out : null
  }
  return handle(body, session, server)
}

export const initializes = (body: unknown) => (Array.isArray(body) ? body : [body]).some((m) => Message.safeParse(m).data?.method === "initialize")

