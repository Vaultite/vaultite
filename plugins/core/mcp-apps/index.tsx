// MCP Apps: the cards AI apps draw for Vaultite's tools, drawn in notes too (```block-mcp-app, Host.tsx).
import { definePlugin } from "@vaultite"
import { McpAppBlock } from "./Host"

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})

export default definePlugin({
  blocks: {
    // A tool's card: `tool: tasks_list`, `arguments: {query: not done}`, `height`.
    "mcp-app": (ctx) => <McpAppBlock tool={String(ctx.options.tool ?? "")} args={obj(ctx.options.arguments)}
      height={typeof ctx.options.height === "number" ? ctx.options.height : undefined} />,
  },
})
