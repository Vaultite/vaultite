import { events, flush } from "./events.ts"
import { plugin } from "./store.ts"
import "./callers.ts"
import "./describe.ts"
import { rollMinute } from "./timings.ts"
import "./requests.ts"
import "./reports.ts"
import "./reading.ts"
import "./ops.ts"
import "./blocks.ts"
import "./dayrecaps.ts"

export { plugin } from "./store.ts"

plugin.onExit(() => { if (events) flush(); rollMinute(true) })
