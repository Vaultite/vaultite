import { definePlugin } from "@vaultite"
import { McpAppBlock } from "./Host"

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})

export default definePlugin({
  blocks: {
    "mcp-app": (ctx) => <McpAppBlock tool={String(ctx.options.tool ?? "")} args={obj(ctx.options.arguments)}
      height={typeof ctx.options.height === "number" ? ctx.options.height : undefined} />,
  },
})
