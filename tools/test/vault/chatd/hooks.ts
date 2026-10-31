// Loaded with `node --import` into a real chat keeper (chatd.ts) a test starts: its SDK is the stand-in (sdk.ts), the
// rest of it (the socket, the host, the MCP server of relayed tools) as it runs for the app.
import { registerHooks } from "node:module"

const FAKE = new URL("./sdk.ts", import.meta.url).href
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@anthropic-ai/claude-agent-sdk" && ctx.parentURL !== FAKE) return { url: FAKE, shortCircuit: true }
    return next(spec, ctx)
  },
})
