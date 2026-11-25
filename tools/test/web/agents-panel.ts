import { check, section } from "../lib.ts"
import { type Any, plugin, same, web } from "./lib.ts"

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

await section("agents panel shelves", async () => {
  const s: Any = await plugin("agents/shelves.ts")
  const run = (id: string, state: string, at: number, more: Any = {}) => ({ id, kind: "terminal", title: id, state, at, ...more })
  const t = 1e9, marks = { pinned: { pinned: true }, snoozed: { snoozed: t + 60_000 }, woke: { snoozed: t - 1 }, settled: { settled: t - 10 }, again: { settled: t - 10 }, asks: { snoozed: t + 60_000 } }
  const list = [run("pinned", "done", t - 100), run("snoozed", "done", t - 100), run("woke", "done", t - 100), run("settled", "done", t - 100), run("again", "done", t - 100, { since: t - 5 }),
    run("asks", "needs", t - 100), run("work", "working", t - 100), run("bg", "waiting", t - 100), run("quiet", "done", t - 100), run("rest", "done", t - 100)]
  const by = s.shelve(list, marks, t, (r: Any) => r.id === "quiet")
  const ids = Object.fromEntries([...by].map(([k, rs]: Any) => [k, rs.map((r: Any) => r.id)]))
  check("shelves: pinned, needs you (asks, then what's done for you to settle), working (and waiting on its work), snoozed till its time, settled (and what folded away); a new turn unsettles",
    same(ids, { pinned: ["pinned"], needs: ["woke", "again", "asks", "rest"], working: ["work", "bg"], snoozed: ["snoozed"], settled: ["settled", "quiet"] }), ids)
  check("shelves: settle refuses a run working, waiting on its work or on you", s.canSettle(run("a", "done", 0)) && !s.canSettle(run("b", "working", 0)) && !s.canSettle(run("c", "waiting", 0)) && !s.canSettle(run("d", "needs", 0)))
  const needs = ["a", "b", "c"].map((id) => run(id, "done", 0))
  check("shelves: settle and next goes to the next that needs you below, else the first above, else none",
    s.nextNeeding(needs, "b")?.id === "c" && s.nextNeeding(needs, "c")?.id === "a" && s.nextNeeding([needs[0]], "a") === undefined && s.nextNeeding(needs, "gone")?.id === "a")
  const projects = s.projectsOf([run("x", "done", 0, { project: "lighthouse" }), run("y", "working", 0, { project: "beacon" }), run("z", "done", 0, { project: "harbor" }), run("w", "done", 0, { project: "beacon" }), run("v", "done", 0)],
    { z: { settled: 10 } }, t)
  check("shelves: the repository chips are the ones runs not settled work in, each once, by name", same(projects, ["beacon", "lighthouse"]), projects)
  let m = s.withMark({}, "a", { pinned: true })
  m = s.withMark(m, "a", { snoozed: t })
  const both = m.a
  m = s.withMark(m, "a", { pinned: null, snoozed: null })
  check("shelves: a mark changes key by key and goes once it holds nothing", same(both, { pinned: true, snoozed: t }) && same(m, {}), [both, m])
  const kept = s.keptMarks({ a: { pinned: true }, gone: { pinned: true }, later: { snoozed: t + 1 }, past: { snoozed: t - 1 } }, new Set(["a"]), t)
  check("shelves: marks kept for runs still listed and snoozes to come", same(Object.keys(kept), ["a", "later"]), kept)
})

await section("inbox sessions setting", async () => {
  const { inInbox, lists }: Any = await plugin("inbox/threads.ts")
  const ev = (id: string, kind: string, more: Any = {}) => ({ id, t: 1, kind, state: "open", title: id, ...more })
  const events = [ev("s", "session"), ev("cloud", "waiting", { session: "https://claude.ai/code/session_01Beacon" }), ev("gate", "waiting", { gate: true, session: "https://claude.ai/code/x" }), ev("w", "waiting"), ev("m", "info")]
  const off = lists(events.filter(inInbox(false)), []), on = lists(events.filter(inInbox(true)), [])
  check("inbox: off, a coding agent's session (a terminal's, a chat's, a cloud one's) leaves the Inbox's lists, its gates, asks and messages stay; on, it's there as before",
    same(off.needs.map((e: Any) => e.id), ["gate", "w"]) && same(off.messages.map((e: Any) => e.id), ["m"]) && same(on.needs.map((e: Any) => e.id), ["s", "cloud", "gate", "w"]), [off.needs, on.needs])
})

await section("code workspace preset", async () => {
  const { CODE, freeSlot }: Any = await plugin("workspaces/code.ts")
  check("Code workspace: the Agents panel alone on the left, nothing on the right, no tab list", same(CODE.sidebars.left, ["agents:agents"]) && same(CODE.sidebars.right, []) &&
    !JSON.stringify(CODE).includes("tabs:tabs") && CODE.name === "Code")
  const slots = [1, 2, 3, 4]
  check("Code workspace: the first number that's free and not the current one, none when all are used",
    freeSlot(slots, (n: number) => n === 1 || n === 3, 2) === 4 && freeSlot(slots, (n: number) => n === 1, 3) === 2 && freeSlot(slots, () => true, 1) === undefined)
})
