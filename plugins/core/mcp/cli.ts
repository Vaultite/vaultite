// `vau mcp`: MCP over stdio, so nothing else may go to stdout.
import { CliError, Ctx, done, homeEnv, type PluginCli } from "../../../core/cli.ts"

export const cli: PluginCli = {
  commands: [{
    name: "mcp",
    after: "notify",
    summary: "Serve the vault's tools over MCP (stdio), for Claude Code, Claude desktop and other MCP clients.",
    usage: "vau mcp",
    help: `Runs an MCP server on stdin and stdout until its client closes it. Its tools are the vault's operations marked
for MCP, plus ops (list and explain every operation) and call (run any of them), each run by the running Vaultite server
(VAULTITE_URL), so the app must be running. Activity shows what they did, as the client's (Claude Code, Claude...).
The same tools are served over HTTP at <server>/api/mcp (this machine and its owner's devices only).

  claude mcp add vaultite -- vau mcp                 (Claude Code, stdio)
  claude mcp add --transport http vaultite http://127.0.0.1:8793/api/mcp
  Claude desktop: in claude_desktop_config.json, "mcpServers": {"vaultite": {"command": "<path to>/bin/vau", "args": ["mcp"]}}`,
    run: async (_a, c) => {
      if (process.stdin.isTTY) throw new CliError("vau mcp talks MCP on stdin and stdout: an MCP client starts it (see vau mcp --help)")
      const { APP_VERSION } = await import("../../../core/plugins.ts")
      const { clientOf, handleBody, Pictured, ToolError } = await import("./protocol.ts")
      const { toolsOf } = await import("./catalog.ts")
      type Client = import("./protocol.ts").Client
      const session: import("./protocol.ts").Session = { client: null }
      let pictured = new Set<string>()
      let envs = new Map<string, [string, string][]>()
      let kinds = new Map<string, string>()
      let homes = new Set<string>()
      const as = (agent: string | null, tool: string, env = c.env) => {
        const t = new Ctx({ url: env !== c.env ? env.VAULTITE_URL : c.fixed ? c.url : undefined, env, client: "mcp", agent: agent ?? undefined })
        t.command = `mcp ${tool}`
        const asTool = async <T>(fn: () => Promise<T>) => {
          try { return await fn() } catch (e) {
            if (e instanceof CliError) throw new ToolError(e.message)
            throw e
          }
        }
        return Object.assign((method: string, route: string, body?: unknown) => asTool(() => t.call(method, route, body)),
          { op: (id: string, query: string, params: unknown) => asTool(() => t.callOp({ id, kind: kinds.get(id) ?? "write" }, query, params)) })
      }
      const server = {
        version: APP_VERSION,
        instructions: async () => String(await as(session.client?.agent ?? null, "initialize")("POST", "ops/mcp.instructions?as=text", c.env.VAULTITE_TOLD ? { told: true } : {}) ?? ""),
        tools: async () => {
          const entries = await as(session.client?.agent ?? null, "tools/list")("GET", "ops") as import("../../../core/plugins.ts").OpEntry[]
          pictured = new Set(entries.filter((e) => e.image).map((e) => e.id))
          kinds = new Map(entries.map((e) => [e.id, e.kind]))
          homes = new Set(entries.filter((e) => e.home).map((e) => e.id))
          envs = new Map(entries.map((e) => [e.id, Object.entries(e.params.properties ?? {}).flatMap(([k, s]): [string, string][] => (s.env ? [[k, s.env]] : []))]))
          return toolsOf(entries)
        },
        ctx: (client: Client, tool: string) => {
          const here = as(client.agent, tool)
          return { client, op: async (id: string, given: Record<string, unknown>) => {
            const params = { ...given }, home = homes.has(id) ? homeEnv(c.env, { home: true }) : null, env = home ?? c.env
            const call = home ? as(client.agent, tool, home) : here
            for (const [k, v] of envs.get(id) ?? []) if (params[k] === undefined && env[v]) params[k] = env[v]
            if (!pictured.has(id)) return String(await call.op(id, "?as=text", params) ?? "")
            const r = Pictured.parse(await call.op(id, "?as=answer", params))
            return { text: String(r?.text ?? ""), image: r?.image ?? null }
          } }
        },
      }
      const write = (x: unknown) => process.stdout.write(JSON.stringify(x) + "\n")
      let buf = ""
      let queue = Promise.resolve()
      const line = (raw: string) => {
        if (!raw.trim()) return
        let msg: unknown
        try { msg = JSON.parse(raw) } catch {
          write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: a line that isn't JSON" } })
          return
        }
        // In order: a client may send the next before this one is answered.
        queue = queue.then(async () => {
          const out = await handleBody(msg, session, server)
          // The SDK names a client only "mcp": VAULTITE_AGENT, set where it was connected, says who it is.
          const named = c.env.VAULTITE_AGENT?.trim()
          if (named && session.client && (!session.client.agent || session.client.agent === "mcp")) session.client = clientOf(named)
          if (out) write(out)
        }).catch((e) => console.error("vau mcp:", e))
      }
      await new Promise<void>((resolve) => {
        process.stdin.setEncoding("utf8")
        process.stdin.on("data", (chunk: string) => {
          buf += chunk
          let at: number
          while ((at = buf.indexOf("\n")) >= 0) { line(buf.slice(0, at)); buf = buf.slice(at + 1) }
        })
        process.stdin.on("end", () => { line(buf); resolve() })
      })
      await queue
      return done(null, "")
    },
  }],
}
