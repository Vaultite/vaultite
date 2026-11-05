// The browser engine's features, each adding itself to the engine's hooks (engine.ts) as it loads. main.ts imports this;
// what's heavy waits for the browser's first use (`later`).
import { later } from "./engine.ts"
import "./sessioncookies.ts"
import "./containers.ts"
import "./lock.ts"
import "./agent.ts"
import "./logins.ts"
import "./live.ts"
import "./default.ts"
import "./adblock.ts"
import "./challenges.ts"
import "./googlesignin.ts"
import "./picker.ts"
import "./sitestyles.ts"
import "./passkeys.ts"
import "./history.ts"
import "./navlog.ts"
import "./import.ts"
// (in this order: extensions' request hooks go after Shields')
later(async () => {
  await import("./extensions.ts")
  await import("./extwebrequest.ts")
})
// (what Electron leaves to a browser to ask: rare, so never loaded at launch)
later(() => Promise.all([import("./httpauth.ts"), import("./prompt.ts"), import("./screenshare.ts")]))
// (dark pages: before any page's first request, which waits for these)
later(() => import("./darkmode.ts"))
// (agents' past runs, read when the replay page asks; their scripts and downloads, at their first)
later(() => Promise.all([import("./agentruns.ts"), import("./agentrun.ts")]))
