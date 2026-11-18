import { CODE, HOST } from "./identity.ts"
import { launchedFrom, updatesReady } from "./updates.ts"
import type { Win } from "./servers.ts"

let shellTold = false, shellReported = false
export function shellReady(w: Win | null) {
  if (!shellTold) { shellTold = true; HOST?.ready(); updatesReady() }
  if (!w || shellReported || !HOST) return
  shellReported = true
  const short = (c: string | null) => c?.slice(0, 7) ?? "this build"
  const events = HOST.events(), passed = events.find((e) => e.kind === "passed")
  launchedFrom({ from: HOST.from, commit: CODE?.commit ?? null, ...(passed ? { fellBack: { commit: passed.commit, why: passed.why } } : {}) })
  const errors = events.map((e) => ({ kind: "boot", t: e.t, stack: "", build: CODE?.commit ?? "",
    message: e.kind === "passed" ? `The app didn't start on ${short(e.commit)}: ${e.why}; it runs ${short(CODE?.commit ?? null)}`
      : `The app ${e.kind === "late" ? "was slow to start" : e.kind === "crashed" ? "crashed starting" : "couldn't start"} on ${short(e.commit)}: ${e.why}` }))
  if (errors.length) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: "desktop", errors }) }).catch(() => {})
}
