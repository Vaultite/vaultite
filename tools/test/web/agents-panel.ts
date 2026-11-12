import { check, section } from "../lib.ts"
import { type Any, web } from "./lib.ts"

await section("agents panel order", async () => {
  const { orderRuns }: Any = await web("core/agentorder.ts")
  const run = (id: string, state: string, at: number, more: Any = {}) => ({ id, kind: "terminal", title: id, state, at, ...more })
  const list = [
    run("done-old", "done", 1), run("work-late", "working", 50), run("needs", "needs", 40), run("done-new", "done", 90), run("work-early", "working", 10),
    run("chat-dup", "done", 95, { kind: "chat", session: "s1", machine: "m4" }), run("term-dup", "working", 20, { session: "s1", machine: "m4" }),
    run("chat-elsewhere", "done", 80, { kind: "chat", session: "s1", machine: "m1" }),
  ]
  const ids = orderRuns(list).map((r: Any) => r.id)
  check("agents panel: needs you, working (oldest first), then done (newest first); a session a terminal has shows once, as it, per machine",
    JSON.stringify(ids) === JSON.stringify(["needs", "work-early", "term-dup", "work-late", "done-new", "chat-elsewhere", "done-old"]), ids)
  const { foldsAway, QUIET_AFTER }: Any = await web("core/agentorder.ts")
  const t = 1e9, past = t - QUIET_AFTER - 1, soon = t - QUIET_AFTER + 60_000
  const folds = {
    quiet: foldsAway(run("q", "done", past), t, false), recent: foldsAway(run("r", "done", soon), t, false), tab: foldsAway(run("t", "done", past), t, true),
    unread: foldsAway(run("u", "done", past, { unread: true }), t, false), failed: foldsAway(run("f", "done", past, { failed: true }), t, false),
    needs: foldsAway(run("n", "needs", past), t, false), working: foldsAway(run("w", "working", past), t, false),
    rested: foldsAway(run("s", "done", 0, { started: true, since: past }), t, false), unknown: foldsAway(run("x", "done", past, { started: true }), t, false),
    never: foldsAway(run("v", "done", 0), t, false, null), longer: foldsAway(run("l", "done", past), t, false, 2 * QUIET_AFTER),
  }
  check("agents panel: only what's at rest a while (as set: never, never), read, not failed and in no tab folds; a terminal by when it came to rest, never unknown",
    JSON.stringify(Object.entries(folds).filter(([, v]) => v).map(([k]) => k)) === JSON.stringify(["quiet", "rested"]), folds)
})
