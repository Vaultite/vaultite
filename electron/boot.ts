// The desktop app's entry: Node's compile cache on before main.ts's modules load (it can't turn it on itself: an ES
// module's imports all load before its code runs). Without it each launch strips their types again.
import module from "node:module"

module.enableCompileCache?.()
await import("./main.ts")
