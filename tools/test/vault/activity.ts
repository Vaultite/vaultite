import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, tmp, write } = $
  // ---------- Activity: who did what (plugin.onRequest, plugin.onChange), timings ----------
  const act = await import("../../../plugins/core/activity/plugin.ts")
  /** A request as server.ts reports it: started, run, ended. */
  async function actHeard(method: string, p: string, body: unknown, client: string | null, agent: string | null = null, at = Date.now()) {
    const [route, qs] = p.split("?")
    const end = app.requestStarted({ t: at, method, route, query: qs ? Object.fromEntries(new URLSearchParams(qs)) : {}, client, agent, command: null,
      ua: client ? "" : "curl/8.7.1", remote: "203.0.113.9", port: 1, forwarded: false })
    const t = performance.now()
    const r = await api(method, p, body)
    end({ status: r[0], ms: performance.now() - t, body, ...(r[0] >= 400 ? { error: r[1]?.error } : {}) })
    return r
  }
  const actEvents = async (q = "") => (await api("GET", `activity?limit=50${q}`))[1].events as Any[]
  await actHeard("PUT", "file", { path: "Act/a.md", text: "one\n" }, "app/desktop")
  await actHeard("PUT", "file", { path: "Act/a.md", text: "one two\n" }, "app/desktop")
  let ev = (await actEvents()).filter((e: Any) => e.paths?.includes("Act/a.md"))
  check("activity: the app's edits are yours, a run of them one event with a count", ev.length === 1 && ev[0].actor.kind === "you" && ev[0].actor.device === "desktop" && ev[0].count === 2 && ev[0].text === "Edited Act/a.md", ev)
  {
    // Back to back: the next request starts within a file clock's margin of the last one's write, which stays its own.
    await actHeard("PUT", "file", { path: "Act/first.md", text: "first\n" }, "app/desktop")
    const m = fs.statSync(path.join(VAULT, "Act/first.md")).mtimeMs
    await actHeard("PUT", "file", { path: "Act/second.md", text: "second\n" }, null, null, Math.floor(m) + 2)
    app.changed(["Act/first.md", "Act/second.md"])
    const second = (await actEvents()).find((e: Any) => e.paths?.includes("Act/second.md"))
    check("activity: a write just after another doesn't take the file the other wrote", second && !second.paths.includes("Act/first.md"), second)
  }
  await actHeard("POST", "logs", [{ area: "workouts", date: "2026-09-20", source: "claude", ext_id: "act-1", title: "Push day" }], "cli", "claude-code")
  ev = await actEvents("&actor=agent")
  check("activity: the CLI under a coding agent is that agent, its log worded", ev.some((e: Any) => e.actor.name === "Claude Code" && e.text === "Logged Push day" && e.route === "logs"), ev)
  await actHeard("GET", "render?path=Act/a.md", undefined, null)
  check("activity: reads aren't recorded unless asked", !(await actEvents("&actor=script")).some((e: Any) => e.action === "read"))
  write(".vaultite/plugins/activity/data.json", JSON.stringify({ reads: true }))
  await actHeard("GET", "render?path=Act/a.md", undefined, null)
  ev = await actEvents("&actor=script")
  check("activity: asked, reads by others are kept, the app's aren't", ev.some((e: Any) => e.action === "read" && e.paths?.includes("Act/a.md") && e.actor.name === "curl"), ev)
  await actHeard("GET", "state", undefined, "app/web")
  check("activity: the app's reads are only timed", !(await actEvents("&actor=you")).some((e: Any) => e.action === "read"))
  await actHeard("PATCH", "config/plugins", { panels: ["files:files"] }, "app/web")
  check("activity: settings say which", (await actEvents("&actor=you")).some((e: Any) => e.action === "settings" && e.text === "Changed plugins and the sidebar (panels)"))
  {
    // A plugin turned on just before a request hears that request (its hook is chosen before the request's sync).
    const pj = path.join(VAULT, ".vaultite/plugins.json")
    const was = fs.existsSync(pj) ? fs.readFileSync(pj, "utf8") : null
    const base = was ? JSON.parse(was) : {}
    write("Act/fresh.md", "fresh\n")
    const enabled = (base.enabled ?? []).filter((x: string) => x !== "activity")
    fs.writeFileSync(pj, JSON.stringify({ ...base, enabled }, null, 2) + "\n")
    await api("GET", "state") // a sync: plugins.json read with Activity off
    fs.writeFileSync(pj, JSON.stringify({ ...base, enabled: [...enabled, "activity"] }, null, 2) + "\n")
    fs.utimesSync(pj, new Date(), new Date(Date.now() + 2000)) // a new mtime even within the clock's resolution
    await actHeard("GET", "render?path=Act/fresh.md", undefined, null)
    check("activity: a plugin turned on just before a request hears it", (await actEvents("&actor=script")).some((e: Any) => e.paths?.includes("Act/fresh.md")))
    if (was === null) fs.rmSync(pj); else fs.writeFileSync(pj, was)
  }
  await api("POST", "activity", { device: "phone", events: [{ action: "open", text: "Opened Act/a.md", paths: ["Act/a.md"] }, { action: "nope", text: "" }] })
  ev = await actEvents("&path=Act/a.md")
  check("activity: the app's own reports, and a file's own activity by path", ev.some((e: Any) => e.action === "open" && e.actor.device === "phone") && ev.every((e: Any) => e.paths.includes("Act/a.md")), ev)
  await api("POST", "activity/hook?agent=claude&terminal=claude-x1", { tool_name: "Edit", tool_input: { file_path: path.join(VAULT, "Act/b.md") } })
  await api("POST", "activity/hook?agent=claude&terminal=claude-x1", { tool_name: "Bash", tool_input: { command: "vau open Act/b.md\nsecond line" } })
  ev = await actEvents("&actor=agent")
  check("activity: an agent's hooks report its edits (vault paths) and commands (first line)", ev.some((e: Any) => e.text === "Edited Act/b.md" && e.actor.terminal === "claude-x1") && ev.some((e: Any) => e.text === "Ran vau open Act/b.md"), ev)
  app.changed(["Act/c.md", ".vaultite/cache/github.json"])
  write("Act/c.md", "hi\n")
  app.changed(["Act/c.md", ".vaultite/cache/github.json"])
  await new Promise((r) => setTimeout(r, 2800))
  ev = await actEvents("&actor=disk")
  check("activity: a change no request made is on disk; caches aren't", ev.some((e: Any) => e.paths?.includes("Act/c.md")) && !ev.some((e: Any) => e.paths?.some((p: string) => p.startsWith(".vaultite/cache"))), ev)
  const [, sum] = await api("GET", "activity/summary?days=1")
  check("activity: the summary counts who and which files", sum.buckets.length === 24 && sum.actors.some((a: Any) => a.name === "You") && sum.files.some((f: Any) => f.path === "Act/a.md" && f.n >= 2), sum)
  const [, pf] = await api("GET", "activity/perf")
  check("activity: timings by route", pf.routes.some((r: Any) => r.route === "PUT file" && r.n >= 2) && pf.requests >= 5 && typeof pf.lag.p99 === "number", pf.routes)
  check("activity: routes' ids become *", act.routeOf("people/Alice Park") === "people/*" && act.routeOf("claude-code/session/9f2c-1") === "claude-code/session/*" && act.routeOf("state") === "state")
  // Operations (POST /api/ops/<id>): worded like the routes they replace, by who asked; reads as reads; timed per op.
  await actHeard("POST", "ops/note.create", { title: "Act op note", body: "From an op." }, "cli", "claude-code")
  await actHeard("POST", "ops/person.timeline-add", { person: "Alice Park", kind: "call", text: "About the op" }, "mcp", "codex")
  await actHeard("POST", "ops/property.list", {}, null)
  await actHeard("POST", "ops/inbox.add", { title: "Act op read", body: "For later." }, "mcp", "codex")
  await actHeard("POST", "ops/file.write", { path: "Act/op.md", text: "by an op\n" }, "cli")
  // (a describer that throws is a bug of its op's: the call is still listed, by its id)
  const create = app.ops().find((o) => o.op.id === "note.create")!.op, own = create.did
  create.did = () => { throw new Error("a test's") }
  await actHeard("POST", "ops/note.create", { title: "Act op broken" }, "cli")
  create.did = own
  await actHeard("POST", "ops/nope.thing", { path: "Act/a.md" }, "cli")
  ev = await actEvents()
  check("activity: an op is worded, as who asked", ev.some((e: Any) => e.actor.name === "Claude Code" && e.text === "Saved the note Act op note" && e.route === "ops/note.create" && e.action === "save") &&
    ev.some((e: Any) => e.actor.name === "Codex" && e.text === "Added to Alice Park's timeline (call)"), ev.slice(0, 7))
  check("activity: an op says what a call did (its did)", ev.some((e: Any) => e.text === "Left \"Act op read\" in the inbox" && e.action === "create"), ev.slice(0, 7))
  check("activity: an op without one, or whose did throws, is its id and what it was about", ev.some((e: Any) => e.text === "Ran file.write (Act/op.md)" && e.action === "request" && e.paths.includes("Act/op.md")) &&
    ev.some((e: Any) => e.text === "Ran note.create (Act op broken)"), ev.slice(0, 7))
  check("activity: a read op is a read", ev.some((e: Any) => e.action === "read" && e.text === "Read property.list" && e.actor.name === "curl"), ev.slice(0, 4))
  check("activity: a call the CLI got wrong is kept with why (vau activity --action failed)", (await actEvents("&action=failed")).some((e: Any) =>
    e.text.startsWith("nope.thing failed: no operation 'nope.thing'") && e.status === 404), await actEvents("&action=failed"))
  const [, pf2] = await api("GET", "activity/perf")
  check("activity: ops are timed one by one", act.routeOf("ops/note.create") === "ops/note.create" && pf2.routes.some((r: Any) => r.route === "POST ops/note.create"), pf2.routes.map((r: Any) => r.route))
  const [, blk] = await api("GET", "render?path=Act/a.md")
  write("Act/feed.md", "```block-activity\npath: Act/a.md\n```\n")
  const [, feedText] = await api("GET", "render?path=Act/feed.md")
  check("activity: its block as text links files", /Edited \[\[Act\/a\]\]/.test(feedText) && typeof blk === "string", feedText)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/activity/data.json"))
  check("activity: kept outside the vault", fs.existsSync(path.join(tmp, "local", "activity")) && !fs.existsSync(path.join(VAULT, "activity")))
  Object.assign($.vars, { act, actHeard })
}
