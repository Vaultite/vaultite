// `vau mcp`: the MCP server over stdio, its tools the running server's ops called as the client. Nothing else goes to
// stdout; the MCP modules load only when it runs, since every vau command loads this file.
import { CliError, Ctx, done, type PluginCli } from "../../../core/cli.ts"

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
      const { clientOf, handleBody, ToolError } = await import("./protocol.ts")
      const { toolsOf } = await import("./catalog.ts")
      type Client = import("./protocol.ts").Client
      const session: import("./protocol.ts").Session = { client: null }
      /** The server's API as the client, each call told to Activity as `mcp <tool>`; its errors are the tool's. Unless one
       *  was named, each call finds the server again: the desktop app's vault may open after the client started this. */
      const as = (agent: string | null, tool: string) => {
        const t = new Ctx({ url: c.fixed ? c.url : undefined, env: c.env, client: "mcp", agent: agent ?? undefined })
        t.command = `mcp ${tool}`
        return async (method: string, route: string, body?: unknown) => {
          try { return await t.call(method, route, body) } catch (e) {
            if (e instanceof CliError) throw new ToolError(e.message)
            throw e
          }
        }
      }
      const server = {
        version: APP_VERSION,
        instructions: async () => String(await as(session.client?.agent ?? null, "initialize")("POST", "ops/mcp.instructions?as=text", {}) ?? ""),
        // The catalog as the server has it now (plugins turned on or off change it).
        tools: async () => toolsOf(await as(session.client?.agent ?? null, "tools/list")("GET", "ops")),
        ctx: (client: Client, tool: string) => {
          const call = as(client.agent, tool)
          return { client, op: async (id: string, params: Record<string, unknown>) => String(await call("POST", `ops/${encodeURIComponent(id)}?as=text`, params) ?? "") }
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
        // In order, one at a time (a client may send the next before this one is answered).
        queue = queue.then(async () => {
          const out = await handleBody(msg, session, server)
          // A client naming itself only as the SDK does ("mcp"): VAULTITE_AGENT, set where it was connected, says who it is.
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
