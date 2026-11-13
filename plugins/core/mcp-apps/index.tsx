import { definePlugin } from "@vaultite"
import { McpAppBlock } from "./Host"

export default definePlugin({
  blocks: {
    "mcp-app": (ctx) => <McpAppBlock tool={String(ctx.options.tool ?? "")} args={ctx.options.arguments}
      height={typeof ctx.options.height === "number" ? ctx.options.height : undefined} />,
  },
})
