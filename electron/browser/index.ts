// The browser engine's features, each adding itself to the engine's hooks (engine.ts) as it loads. main.ts imports this;
// what's heavy waits for the browser's first use (`later`).
import { later } from "./engine.ts"
import "./containers.ts"
import "./lock.ts"
import "./agent.ts"
import "./default.ts"
import "./adblock.ts"
import "./picker.ts"
import "./history.ts"
import "./import.ts"
// (in this order: extensions' request hooks go after Shields')
later(async () => {
  await import("./extensions.ts")
  await import("./extwebrequest.ts")
})
