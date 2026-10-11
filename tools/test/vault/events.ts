import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, app, check, sleep, vault, write } = $
  const { Live, vau, same } = $.vars
  // Events (core/events.ts): the bus, its filters and cursors, the core's own (file.changed from core/live.ts, file.moved,
  // op.done), the op events.wait, `vau events`, the SSE stream, and plugin.onEvent.
  {
    const { Events, eventsOf, matching, stream, summary } = await import("../../../core/events.ts")
    const b = new Events()
    const c0 = b.cursor
    b.emit("file.changed", { paths: ["Notes/a.md", "People/Alice Park.md"] })
    b.emit("op.done", { id: "note.create", ok: true })
    b.emit("file.moved", { from: "Notes/a.md", to: "Archive/a.md" })
    check("events: since a cursor, by type and area", b.since(c0, {}).events.length === 3 && b.since(c0, { types: ["file"] }).events.length === 2 &&
      b.since(c0, { types: ["op.done", "file.moved"] }).events.map((e) => e.type).join() === "op.done,file.moved" && b.since(c0, { types: ["file.*"] }).events.length === 2)
    const narrowed = b.since(c0, { path: "Notes/" }).events
    check("events: a path prefix matches paths, from and to, and narrows file.changed's paths", narrowed.length === 2 && same(narrowed[0].paths, ["Notes/a.md"]) && narrowed[1].type === "file.moved", narrowed)
    check("events: anything may have changed matches every path", !!matching({ type: "file.changed", paths: null, seq: 1, t: 0, cursor: "x:1" }, { path: "Notes/" }))
    check("events: a cursor from another boot (a restart) starts from now", b.since(`x${b.boot}:0`, {}).events.length === 0 && b.since(undefined, {}).events.length === 0)
    let threw = ""
    try { b.emit("Bad Type") } catch (e) { threw = String(e) }
    check("events: a type is area.name", /area\.name/.test(threw))
    const waiting = b.wait({ types: ["file.trashed"] }, null, 2000)
    setTimeout(() => { b.emit("op.done", {}); b.emit("file.trashed", { path: "Notes/x.md" }) }, 20)
    const w = await waiting
    check("events: wait answers the first match", w.events.length === 1 && w.events[0].type === "file.trashed" && w.cursor === w.events[0].cursor, w)
    check("events: wait gives up at its timeout", (await b.wait({ types: ["nothing.here"] }, null, 30)).events.length === 0)
    check("events: op.done's params are summarized", same(summary({ title: "x".repeat(200), tags: [1, 2, 3, 4, 5, 6, 7], data: { a: { b: 1 } } }), { title: "x".repeat(117) + "...", tags: [1, 2, 3, 4, 5, "(2 more)"], data: { a: "{b}" } }))

    // The app's: a move, a trash, an op, a change on disk (core/live.ts), and a plugin hearing them (plugin.onEvent).
    const bus = eventsOf(vault)
    const heard: Any[] = []
    const mcp = app.plugins.find((p) => p.id === "mcp")!
    const fn = mcp.onEvent({ types: ["file"], path: "Evts/" }, (ev) => heard.push(ev))
    const c1 = bus.cursor
    write("Evts/One.md", "One.\n")
    await api("POST", "file/move", { from: "Evts/One.md", to: "Evts/Two.md" })
    await api("DELETE", "file?path=Evts/Two.md")
    const moved = bus.since(c1, { types: ["file"] }).events
    check("events: a move and a delete through the API", moved.length === 2 && moved[0].type === "file.moved" && moved[0].from === "Evts/One.md" && moved[0].to === "Evts/Two.md" &&
      moved[1].type === "file.trashed" && moved[1].path === "Evts/Two.md", moved)
    const l = new Live(vault)
    l.add("Evts/Three.md")
    await sleep(250)
    l.close()
    const changed = bus.since(c1, { types: ["file.changed"] }).events
    check("events: a change on disk is file.changed (core/live.ts)", changed.length === 1 && same(changed[0].paths, ["Evts/Three.md"]), changed)
    await sleep(20)
    check("events: a plugin hears its own (plugin.onEvent), after the emitter's turn", heard.length === 3 && heard[2].type === "file.changed", heard.map((e) => e.type))
    mcp.eventFns = mcp.eventFns.filter(([, f]) => f !== fn)
    let [st, body] = await api("POST", "ops/ui.command", { id: "sidebar:toggle" })
    const opd = bus.since(c1, { types: ["op.done"] }).events
    check("events: a write op is op.done, with who and its parameters", st === 200 && opd.length === 1 && opd[0].id === "ui.command" && opd[0].ok === true && same(opd[0].params, { id: "sidebar:toggle" }), [st, body, opd])
    ;[st] = await api("POST", "ops/ui.open", {})
    check("events: one that fails is op.done too, not ok", st === 400 && bus.last({ types: ["op.done"] }, 1)[0].ok === false && /path is missing/.test(String(bus.last({ types: ["op.done"] }, 1)[0].error)))
    ;[st] = await api("POST", "ops/docs.list", {})
    check("events: a read op isn't", bus.last({ types: ["op.done"] }, 1)[0].id === "ui.open")

    // events.wait (an op: kind read, so it holds nothing while it waits) and vau events.
    const c2 = bus.cursor
    const listening = (bus as Any).listeners.size
    const later = api("POST", "ops/events.wait", { types: "file.moved", timeout: 2 })
    // (once it listens: on a busy machine the request may start after a fixed delay)
    for (let i = 0; i < 400 && (bus as Any).listeners.size <= listening; i++) await sleep(5)
    bus.emit("file.moved", { from: "a.md", to: "b.md" })
    ;[st, body] = await later
    check("events.wait: the next match, with its cursor", st === 200 && body.events.length === 1 && body.events[0].to === "b.md" && body.cursor === body.events[0].cursor, body)
    check("events.wait: an op that waits doesn't hold the vault", app.unlocked("POST", ["ops", "events.wait"]))
    ;[st, body] = await api("POST", "ops/events.wait", { after: c2, timeout: 0 })
    check("events.wait: after a cursor, what came since, at once", st === 200 && body.events.length === 1 && body.events[0].type === "file.moved", body)
    ;[st, body] = await api("POST", "ops/events.list?as=text", { types: ["file.moved"], limit: 1 })
    check("events.list: the recent ones, as JSON lines", st === 200 && /^\{"from":"a\.md"/.test(body) && body.includes("Cursor: "), body)
    const vauOnce = vau("events", "--once", "--type", "op.done", "--timeout", "2")
    setTimeout(() => void api("POST", "ops/ui.command", { id: "theme:dark" }), 30)
    let vr = await vauOnce
    check("vau events --once: the first match, one JSON line", vr.code === 0 && JSON.parse(vr.out).type === "op.done" && JSON.parse(vr.out).params.id === "theme:dark", vr)
    vr = await vau("events", "--once", "--type", "nothing.here", "--timeout", "0.05")
    check("vau events --once: nothing in time is exit 1", vr.code === 1 && vr.err.includes("no matching event"), vr)
    vr = await vau("events", "--after", c2, "--type", "file.moved,op.done", "--timeout", "0", "--json")
    check("vau events --after --json: what came since, as a list", vr.code === 0 && JSON.parse(vr.out).map((e: Any) => e.type).join() === "file.moved,op.done", vr.out)
    vr = await vau("events", "--help")
    check("vau events --help: lists the types", vr.code === 0 && vr.out.includes("file.changed") && vr.out.includes("op.done"), vr.out)

    // The stream (GET /api/events/stream, Server-Sent Events): server.ts hands it to stream().
    const http = await import("node:http")
    const srv = http.createServer((req, res) => stream(bus, req, res, Object.fromEntries(new URL(req.url!, "http://x").searchParams)))
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok))
    const ac = new AbortController()
    const res = await fetch(`http://127.0.0.1:${(srv.address() as Any).port}/?types=file.moved&after=${c2}`, { signal: ac.signal })
    const reader = res.body!.getReader()
    let got = ""
    setTimeout(() => bus.emit("file.moved", { from: "c.md", to: "d.md" }), 30)
    while (!got.includes("d.md")) got += new TextDecoder().decode((await reader.read()).value)
    ac.abort()
    srv.close()
    check("events stream: SSE, what came after the cursor, then live", res.headers.get("content-type")?.startsWith("text/event-stream") && /event: file\.moved\ndata: \{"from":"a\.md"/.test(got) && got.includes("\"to\":\"d.md\""), got)
  }
}
