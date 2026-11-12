// Activity: who did what and how fast the app answers. Callers on this machine are looked up as a request starts (a quick
// curl is gone by its end); events are kept on this machine, not the vault, since one per request would churn iCloud.
import { events, flush } from "./events.ts"
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

process.on("exit", () => { try { if (events) flush(); rollMinute(true) } catch { /* exiting */ } })
