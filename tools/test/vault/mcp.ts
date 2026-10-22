import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, vault, write } = $
  const { same } = $.vars
  // MCP (plugins/core/mcp): tools generated from the operations (catalog.ts), run in-process like the plugin runs them, the
  // protocol, and the routes; and the Web clipper (POST /api/clip).
  {
    const { addUnder } = await import("../../../plugins/core/people/ops.ts")
    const { handle, handleBody, PROTOCOL_VERSIONS, clientOf } = await import("../../../plugins/core/mcp/protocol.ts")
    const { toolsOf, toolOf, RESERVED } = await import("../../../plugins/core/mcp/catalog.ts")
    const { service } = await import("../../../core/plugins.ts")
    const { eventsOf } = await import("../../../core/events.ts")
    // What plugin.ts gives a tool: ops and the API in-process, as the client.
    const server = {
      version: "0.0.0",
      instructions: async () => (await app.callOp("mcp.instructions", {}, { client: "mcp" } as Any)).text,
      tools: () => toolsOf(app.catalog()),
      ctx: (client: Any) => {
        const who = { ...client, client: "mcp" }
        return { client, op: async (id: string, p: Any) => (await app.callOp(id, p, who)).text }
      },
    }
    const session: Any = { client: null }
    const rpc = (method: string, params?: unknown, id: number | null = 1) => handle({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }, session, server) as Promise<Any>
    const tool = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc("tools/call", { name, arguments: args })
      return { error: r.result?.isError === true, text: String(r.result?.content?.[0]?.text ?? r.error?.message ?? "") }
    }

    let r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } })
    check("mcp: initialize agrees on the client's version, offers tools, says how to use the vault", r.result.protocolVersion === "2025-06-18" && r.result.capabilities.tools && r.result.serverInfo.name === "vaultite" && r.result.instructions.includes("ME.md"), r)
    {
      const ins = String(r.result.instructions)
      check("mcp: the instructions are the plugins' lines that are on, an op's id said as its tool", ins.includes("- `ME.md` is the user") && ins.includes("`remember`") && !ins.includes("people.remember") &&
        ins.includes("`.vaultite/AGENTS.md` is the vault's rules") && !ins.includes("People/") && ins.length < 1500, ins)
      const was = vault.config("plugins")
      await api("PUT", "config/plugins", { ...was, enabled: was.enabled.filter((id: string) => id !== "activity") })
      const off = String((await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } })).result.instructions)
      check("mcp: a plugin turned off takes its line out", ins.includes("Recaps/") && !off.includes("Recaps/") && off.includes("ME.md"), off)
      await api("PUT", "config/plugins", was)
    }
    check("mcp: the session knows its client", session.client?.agent === "claude-code" && session.client.source === "claude" && session.client.client === "mcp", session)
    r = await rpc("initialize", { protocolVersion: "1999-01-01", clientInfo: { name: "Claude Desktop" } })
    check("mcp: a version it doesn't speak gets its newest", r.result.protocolVersion === PROTOCOL_VERSIONS[0] && session.client.agent === "claude-app", r.result.protocolVersion)
    check("mcp: clients by name (as ops name who asked)", clientOf("codex-mcp-client").agent === "codex" && clientOf("").agent === null && clientOf("").label === "An MCP client" && clientOf("My Tool 2").agent === "my-tool-2")
    check("mcp: a notification isn't answered, ping is", (await rpc("notifications/initialized", undefined, null)) === null && same((await rpc("ping")).result, {}))
    check("mcp: an unknown method is -32601, not an object -32600", (await rpc("nope")).error?.code === -32601 && (await handle([1], session, server))?.error?.code === -32600)
    const listed = (await rpc("tools/list")).result.tools as Any[]
    const batch = await handleBody([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }], session, server) as Any[]
    check("mcp: a batch answers its requests, in order", batch.length === 2 && batch[0].id === 1 && batch[1].result.tools.length === listed.length, batch)
    const names = listed.map((t) => t.name)
    const mcpOps = app.catalog().filter((e) => e.mcp)
    check("mcp: every op marked mcp is a tool, named by it, with its parameters as its schema", mcpOps.length >= 3 && mcpOps.every((e) => {
      const t = listed.find((x) => x.name === e.mcp)
      return t && same(t.inputSchema, e.params) && t.description.startsWith(e.summary)
    }) && names.includes("docs") && names.includes("open") && names.includes("events_wait"), names)
    check("mcp: the tools from before the operations are ops now, once each; ops and call last", ["search", "read", "render", "list", "query", "write_note", "write_log", "add_timeline", "remember", "clip", "inbox_add"].every((n) => names.includes(n))
      && new Set(names).size === names.length && same(names.slice(-2), ["ops", "call"]), names)
    check("mcp: every tool has a schema, a description and its hints", listed.every((t) => t.inputSchema.type === "object" && t.description.length > 40 && typeof t.annotations.readOnlyHint === "boolean"), listed.filter((t) => t.description.length <= 40).map((t) => t.name))
    check("mcp: hints from the op's kind (read only; a write isn't destructive; call may be)", listed.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort().join() === "actions,browser_read,browser_screenshot,browser_snapshot,browser_tabs,browser_wait,calendar,choose,docs,events_wait,history,inbox,links,list,ops,query,read,read_version,render,search,tags"
      && listed.find((t) => t.name === "open").annotations.destructiveHint === false && listed.find((t) => t.name === "call").annotations.destructiveHint === true, listed.map((t) => [t.name, t.annotations]))
    const fake = { id: "lantern.clear", plugin: "lantern", summary: "Clear the lantern's log: every line goes.", help: "", kind: "destructive" as const, params: { type: "object" as const, properties: {} }, args: [], cli: null, mcp: "lantern_clear", result: null, owner: null, action: null }
    check("mcp: a destructive op is destructiveHint, titled by its summary's first clause", same(toolOf(fake).annotations, { readOnlyHint: false, destructiveHint: true }) && toolOf(fake).title === "Clear the lantern's log", toolOf(fake))
    check("mcp: an op can't take the generic tools' names", RESERVED.has("ops") && RESERVED.has("call") && !toolsOf([{ ...fake, mcp: "call" }]).some((t) => t.name === "call" && t.description.startsWith("Clear")))
    check("mcp: an unknown tool is -32602", (await rpc("tools/call", { name: "nope", arguments: {} })).error?.code === -32602)
    session.client = clientOf("claude-code")

    let t = await tool("ops", {})
    check("mcp ops: lists every operation, the ones with a tool named", !t.error && t.text.includes("- `events.wait` (read, tool events_wait)") && t.text.includes("- `ui.command` (write)"), t.text.slice(0, 300))
    t = await tool("ops", { filter: "events" })
    check("mcp ops: by area", !t.error && t.text.includes("events.list") && !t.text.includes("ui.open"), t)
    t = await tool("ops", { id: "ui.notify" })
    check("mcp ops: one explained, with its parameters", !t.error && t.text.startsWith("## ui.notify") && t.text.includes("- `text` (string, required)") && t.text.includes("call: {\"id\": \"ui.notify\""), t)
    t = await tool("call", { id: "docs.list" })
    check("mcp call: any op by id, its text", !t.error && t.text.includes("- `api`: Operations (the API)"), t)
    t = await tool("call", { id: "ui.open", params: {} })
    check("mcp call: an op's error is the tool's (what's missing)", t.error && t.text.includes("path is missing"), t)
    t = await tool("call", { id: "nope.never" })
    check("mcp call: an unknown op says so", t.error && t.text.includes("no operation 'nope.never'"), t)
    const bus = eventsOf(vault)
    const cursor = bus.cursor
    t = await tool("call", { id: "ui.command", params: { id: "sidebar:toggle" } })
    const done = bus.since(cursor, { types: ["op.done"] }).events
    check("mcp call: a write op tells op.done, as the client", !t.error && done.length === 1 && done[0].id === "ui.command" && done[0].ok === true && (done[0].who as Any).agent === "claude-code" && (done[0].params as Any).id === "sidebar:toggle", [t, done])
    t = await tool("events_wait", { after: cursor, types: ["op"], timeout: 0 })
    check("mcp events_wait: what happened after a cursor, at once", !t.error && t.text.includes("\"type\":\"op.done\"") && t.text.includes("Cursor: "), t)
    t = await tool("events_wait", { types: ["file.moved"], timeout: 0.05 })
    check("mcp events_wait: nothing within the timeout", !t.error && t.text.startsWith("No events."), t)
    const mcpTool = service(app.plugins, "mcp:tool")!
    check("mcp:tool (the service): a tool by name, run as another plugin's client", (await mcpTool(null, "docs", { topic: "query" }, { agent: "ai-import", label: "ChatGPT", source: "chatgpt" })).startsWith("## Database views"))

    write("People/Sam Park.md", "---\ntype: person\nrelation: friend\n---\n\n```block-person\n```\n\nCooks.\n\n## Timeline\n\n- 2026-09-01 · call · Hi\n")
    write("People/Sam Reyes.md", "---\ntype: person\nrelation: friend\naliases: [Sammy]\n---\n\nDraws.\n")
    t = await tool("search", { query: "Cooks" })
    check("mcp search: finds a file and the line", !t.error && t.text.includes("People/Sam Park.md") && t.text.includes("Cooks"), t)
    t = await tool("search", { query: "zzqqxx" })
    check("mcp search: says when nothing matches", !t.error && t.text.startsWith("No matches"), t)
    t = await tool("read", { path: "Sam Park" })
    check("mcp read: a name is enough", !t.error && t.text.startsWith("People/Sam Park.md") && t.text.includes("relation: friend"), t)
    t = await tool("read", { path: "Nobody here" })
    check("mcp read: a file that isn't there is an error", t.error, t)
    t = await tool("render", { path: "People/Sam Park.md" })
    check("mcp render: blocks filled in", !t.error && !t.text.includes("```block-person"), t)
    t = await tool("docs", {})
    check("mcp docs: the topics (the op docs.read)", !t.error && t.text.includes("- `query`: Database views"), t)
    t = await tool("docs", { topic: "query" })
    check("mcp docs: one topic", !t.error && t.text.startsWith("## Database views") && t.text.includes("```base") && t.text.includes("### query.run"), t.text?.slice(0, 200))
    t = await tool("list", { folder: "People" })
    check("mcp list: a folder's files and their types", !t.error && t.text.includes("- People/Sam Park.md (person)") && !t.text.includes("Notes/"), t)
    t = await tool("query", { type: "person", columns: ["file", "relation"], sort: "file" })
    check("mcp query: a table of the matches", !t.error && /\| Sam Park \| friend \|/.test(t.text) && t.text.includes("files."), t)

    t = await tool("write_note", { title: "MCP idea: tools", body: "One catalog, MCP as one adapter.", kind: "idea", status: "seed", tags: ["Product"] })
    check("mcp write_note: a note in Notes/ (a colon made safe, the title kept)", !t.error && exists("Notes/MCP idea - tools.md") && read("Notes/MCP idea - tools.md").includes("kind: idea") && read("Notes/MCP idea - tools.md").includes("aliases: ['MCP idea: tools']"), t)
    t = await tool("write_note", { title: "MCP idea: tools", body: "Changed body.", kind: "idea" })
    check("mcp write_note: the same title again updates it", !t.error && read("Notes/MCP idea - tools.md").includes("Changed body.") && !exists("Notes/MCP idea - tools 2.md"), t)
    t = await tool("write_note", { title: "A good day", body: "Climbed.", journal: true })
    check("mcp write_note: a journal entry is tagged Journal", !t.error && read("Notes/A good day.md").includes("tags: [Journal]"), read("Notes/A good day.md"))
    t = await tool("write_log", { area: "nutrition", date: "2026-09-30", title: "Rice bowl", data: { meal: "Lunch", kcal: 650 } })
    check("mcp write_log: a log in its area's folder, with its source", !t.error && exists("Logs/Nutrition/2026-09-30 Rice bowl.md") && read("Logs/Nutrition/2026-09-30 Rice bowl.md").includes("kcal: 650") && read("Logs/Nutrition/2026-09-30 Rice bowl.md").includes("source: claude"), t)
    t = await tool("write_log", { area: "nutrition", date: "2026-09-30", title: "Rice bowl", data: { protein: 40 } })
    check("mcp write_log: again corrects it, data merged", !t.error && read("Logs/Nutrition/2026-09-30 Rice bowl.md").includes("kcal: 650") && read("Logs/Nutrition/2026-09-30 Rice bowl.md").includes("protein: 40"), read("Logs/Nutrition/2026-09-30 Rice bowl.md"))
    await app.callOp("log.create", { area: "nutrition", title: "Rice bowl", date: "2026-09-30", data: { fat: 12 } }, (await import("../../../core/ops.ts")).whoOf("cli", "codex"))
    check("write_log: another AI correcting it by its id corrects the same log, not a second one", !exists("Logs/Nutrition/2026-09-30 Rice bowl 1.md") && read("Logs/Nutrition/2026-09-30 Rice bowl.md").includes("fat: 12") && read("Logs/Nutrition/2026-09-30 Rice bowl.md").includes("source: claude"), read("Logs/Nutrition/2026-09-30 Rice bowl.md"))
    {
      const areasBefore = vault.config("plugins/logs/data")
      t = await tool("write_log", { area: "Pottery 🏺", date: "2026-09-30", title: "Bowl 🍵" })
      const made = (vault.config("plugins/logs/data")?.areas ?? []) as Any[]
      check("mcp write_log: a new area is added to the settings, the others kept; the emoji stays in the file name", !t.error && exists("Logs/Pottery 🏺/2026-09-30 Bowl 🍵.md")
        && made.some((a) => a.slug === "pottery" && a.name === "Pottery 🏺") && made.some((a) => a.slug === "nutrition"), [t, made])
      fs.rmSync(path.join(VAULT, "Logs/Pottery 🏺"), { recursive: true })
      if (areasBefore) vault.setConfig("plugins/logs/data", areasBefore); else vault.removeConfig("plugins/logs/data")
    }
    const up = listed.find((x) => x.name === "upload_file")
    check("mcp upload_file: ChatGPT is told which parameter takes the chat's file", same(up?._meta, { "openai/fileParams": ["file"] }) && up.inputSchema.properties.file.properties.download_url, up)
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)])
    t = await tool("upload_file", { data: jpeg.toString("base64"), name: "Rice bowl", note: "Logs/Nutrition/2026-09-30 Rice bowl.md" })
    check("mcp upload_file: base64 saved in Attachments with its type's extension, embedded at the end of the log", !t.error && exists("Attachments/Rice bowl.jpg") && fs.readFileSync(path.join(VAULT, "Attachments/Rice bowl.jpg")).equals(jpeg)
      && read("Logs/Nutrition/2026-09-30 Rice bowl.md").trimEnd().endsWith("![[Rice bowl.jpg]]") && t.text.includes("embedded at the end of Logs/Nutrition/2026-09-30 Rice bowl.md"), [t, read("Logs/Nutrition/2026-09-30 Rice bowl.md")])
    t = await tool("upload_file", { data: jpeg.toString("base64"), name: "Rice bowl.jpg" })
    check("mcp upload_file: a taken name gets a number; without note, says how to embed it", !t.error && exists("Attachments/Rice bowl 1.jpg") && t.text.includes("![[Rice bowl 1.jpg]]"), t)
    t = await tool("upload_file", { data: jpeg.toString("base64"), name: "Lost", note: "Logs/Nowhere.md" })
    check("mcp upload_file: a note that isn't there saves nothing", t.error && !exists("Attachments/Lost.jpg"), t)
    t = await tool("upload_file", { name: "Nothing" })
    check("mcp upload_file: no file and the vault not on the internet: says what to give", t.error && t.text.includes("file, url, or data"), t)
    t = await tool("upload_file", { url: "http://127.0.0.1:1/x.png" })
    check("mcp upload_file: a local address isn't fetched", t.error && t.text.includes("couldn't download it"), t)
    fs.rmSync(path.join(VAULT, "Attachments"), { recursive: true, force: true })
    const { PublicMcp } = await import("../../../plugins/core/mcp/public.ts")
    const pubMcp = new PublicMcp({} as Any, { url: "https://own.example", port: 0, redirectHosts: [], tools: null, approvalWait: 1 })
    pubMcp.cloudUrl = () => "https://alice.vaultite.app"
    const byDefault = new PublicMcp({} as Any, PublicMcp.cloudOnly())
    check("public mcp sign-in: Claude, ChatGPT, Grok Bot (cursor.com) and Muse (agent.meta.ai) are let in by default, over https only",
      ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect", "https://www.cursor.com/agents/mcp/oauth/callback", "https://agent.meta.ai/api/hatch/oauth/callback"].every((r) => byDefault.redirectOk(r))
      && !byDefault.redirectOk("http://www.cursor.com/agents/mcp/oauth/callback") && !byDefault.redirectOk("https://cursor.com.evil.example/cb") && !byDefault.redirectOk("https://evil.meta.ai/cb"))
    const viaCloud = { client: "mcp", agent: "claude-app", label: "Claude", source: "claude" }, viaNothing = { ...viaCloud }
    pubMcp.bases.set(viaCloud, "https://alice.vaultite.app")
    check("upload links: on the address the app reached (an app with the Cloud's can't reach the owner's tunnel), else the owner's",
      pubMcp.uploadLink({}, viaCloud)!.url.startsWith("https://alice.vaultite.app/upload/") && pubMcp.uploadLink({}, viaNothing)!.url.startsWith("https://own.example/upload/"))
    {
      // Read-only access (public.ts): only tools that read are listed, and an op that writes is refused, through call too.
      const { accessRefusal } = await import("../../../plugins/core/mcp/public.ts")
      const ro = new PublicMcp({ host: { catalog: () => app.catalog(), call: (id: string, p: Any, w: Any) => app.callOp(id, p, w) }, vault, service: () => null } as Any, PublicMcp.cloudOnly())
      const g: Any = { name: "Lighthouse bot", client: "c", created: "2026-10-01T00:00:00Z", refresh: "x", access: "read" }
      const kinds = new Map(app.catalog().filter((e) => e.mcp).map((e) => [e.mcp, e.kind]))
      const roTools = ro.toolsFor(g).map((x) => x.name), rwTools = ro.toolsFor({ ...g, access: undefined }).map((x) => x.name)
      check("public mcp read-only: only reading tools (and ops, call) are listed; a write grant gets the writing ones",
        roTools.includes("list") && roTools.includes("ops") && roTools.includes("call") && roTools.every((n) => !kinds.has(n) || kinds.get(n) === "read")
        && !roTools.includes("write_note") && rwTools.includes("write_note"), roTools)
      const who = { client: "mcp", agent: "lighthouse-bot", label: "Lighthouse bot", source: "lighthouse-bot" }
      const callTool = ro.toolsFor(g).find((x) => x.name === "call")!
      const ctx = { client: who, op: ro.opFor(["g1", g], who as Any, "call") }
      const refused = await callTool.run({ id: "note.create", params: { title: "Sneaky" } }, ctx).then(() => "", (e: Error) => e.message)
      const listId = app.catalog().find((e) => e.mcp === "list")!.id
      const listed = await callTool.run({ id: listId, params: { folder: "People" } }, ctx).then((r: Any) => String(r.text ?? r), (e: Error) => e.message)
      check("public mcp read-only: call refuses an op that writes, saying how the user changes it, and runs one that reads",
        refused === "Lighthouse bot has read-only access to this vault: the user can change it in Connections." && !exists("Notes/Sneaky.md") && listed.includes("People/Sam Park.md"), [refused, listed])
      check("public mcp read-only: an unknown op is unknown, a write grant isn't refused", accessRefusal("A", "read", null, "nope.x").startsWith("No operation")
        && accessRefusal("A", undefined, app.catalog().find((e) => e.id === "note.create")!, "note.create") === "")
    }
    {
      // Connect (plugins/core/mcp/connect.ts): Vaultite Cloud's signed header for the handle's owner.
      const { MCP_PATHS, ownerOnly, verifyConnect } = await import("../../../plugins/core/mcp/connect.ts")
      const { refusal: ownerRefusal } = await import("../../../core/owner.ts")
      const crypto = await import("node:crypto")
      const sign = (c: Record<string, unknown>, key = "k1") => { const b = Buffer.from(JSON.stringify(c)).toString("base64url"); return `${b}.${crypto.createHmac("sha256", key).update(b).digest("base64url")}` }
      const t0 = 1_800_000_000, claims = { sub: "u1", handle: "alice", role: "owner", exp: t0 + 300 }
      check("connect: the owner's signed header holds", verifyConnect("k1", sign(claims), "alice", t0)?.sub === "u1")
      check("connect: not with another key, handle, role, once expired, or far in the future", !verifyConnect("k2", sign(claims), "alice", t0) && !verifyConnect("k1", sign(claims), "bob", t0)
        && !verifyConnect("k1", sign({ ...claims, role: "viewer" }), "alice", t0) && !verifyConnect("k1", sign(claims), "alice", t0 + 301)
        && !verifyConnect("k1", sign({ ...claims, exp: t0 + 7200 }), "alice", t0) && !verifyConnect(null, sign(claims), "alice", t0) && !verifyConnect("k1", "x.y", "alice", t0))
      check("connect: MCP's routes are never the app's", ["/mcp", "/register", "/token", "/authorize", "/authorize/status", "/.well-known/oauth-authorization-server", "/upload/abc", "/favicon.ico"].every((x) => MCP_PATHS.test(x))
        && !["/", "/api/state", "/assets/main.js", "/index.html"].some((x) => MCP_PATHS.test(x)))
      check("connect: terminals, dispatch, screens and settings refused without owner tools; the rest not",
        ["/api/terminals", "/api/terminal/x", "/api/web-viewer/tabs", "/api/web-viewer/live/3", "/api/dispatch", "/api/ops/terminal.list", "/api/ops/dispatch.run", "/api/ops/settings.set", "/api/ops/ui.command", "/api/ui", "/api/vaults/open"].every((x) => ownerOnly(x))
        && !["/api/state", "/api/ops/docs.read", "/api/events", "/api/file"].some((x) => ownerOnly(x)))
      const fake = (headers: Record<string, string>) => ({ headers: { host: "127.0.0.1:8793", ...headers }, socket: { remoteAddress: "127.0.0.1" } }) as Any
      check("connect: the app's owner checks refuse what Connect marks, even with allowRemote", ownerRefusal(fake({ "x-vaultite-connect": "1" }), { allowRemote: true, owner: "" }, "the terminal").includes("Vaultite Connect")
        && ownerRefusal(fake({}), { owner: "" }, "the terminal") === "")
      check("machines: a request another machine passes on for a guest is refused what only the owner gets, even with allowRemote",
        ownerRefusal(fake({ "x-vaultite-guest": "1" }), { allowRemote: true, owner: "" }, "the terminal").includes("another machine"))
    }
    t = await tool("add_timeline", { person: "Sammy", kind: "call", text: "Talked about the show", date: "2026-09-29", duration_min: 30 })
    check("mcp add_timeline: by an alias, placed by date", !t.error && read("People/Sam Reyes.md").includes("- 2026-09-29 · call · 30 min · Talked about the show"), read("People/Sam Reyes.md"))
    t = await tool("add_timeline", { person: "Sam", kind: "call", text: "x" })
    check("mcp add_timeline: a first name two people have is asked about, not guessed", t.error && t.text.includes("Sam Park") && t.text.includes("Sam Reyes"), t)
    t = await tool("add_timeline", { person: "Nobody", kind: "call", text: "x" })
    check("mcp add_timeline: no one by that name is an error", t.error && t.text.includes("No one called 'Nobody'"), t)
    const meBefore = exists("ME.md") ? read("ME.md") : ""
    t = await tool("remember", { fact: "Plays the cello." })
    check("mcp remember: a fact about the user under About me", !t.error && /## About me\n[\s\S]*- Plays the cello\./.test(read("ME.md")) && (!meBefore || read("ME.md").startsWith(meBefore.split("\n## ")[0].trimEnd())), read("ME.md"))
    t = await tool("remember", { fact: "Plays the cello." })
    check("mcp remember: twice is once", !t.error && t.text.includes("already") && read("ME.md").split("Plays the cello.").length === 2, t)
    t = await tool("remember", { fact: "Prefers short answers.", about: "preference" })
    check("mcp remember: a preference under How to work with me", !t.error && /## How to work with me\n[\s\S]*- Prefers short answers\./.test(read("ME.md")), read("ME.md"))
    t = await tool("remember", { fact: "Is vegetarian.", about: "Sam Park", source: "ChatGPT" })
    const park = read("People/Sam Park.md")
    check("mcp remember: a fact about a person in their body, before the timeline, with its source", !t.error && /Cooks\.\n\nIs vegetarian\. \(from ChatGPT, \d{4}-\d\d-\d\d\)\n\n## Timeline/.test(park), park)

    // addUnder: a list grows by an item, prose by a paragraph, a missing heading is made, a body without prose after a block.
    check("addUnder: a list section", addUnder("---\na: 1\n---\n\n## About me\n\n- One\n\n## How to work with me\n\n- Two\n", "## About me", "Three") === "---\na: 1\n---\n\n## About me\n\n- One\n- Three\n\n## How to work with me\n\n- Two\n")
    check("addUnder: a prose section", addUnder("## About me\n\nSome text.\n", "## About me", "More.") === "## About me\n\nSome text.\n\nMore.\n")
    check("addUnder: no such heading", addUnder("---\na: 1\n---\n\nHi.\n", "## About me", "Fact.") === "---\na: 1\n---\n\nHi.\n\n## About me\n\n- Fact.\n")
    check("addUnder: a person with only a block", addUnder("---\na: 1\n---\n\n```block-person\n```\n\n## Timeline\n\n- x\n", null, "Fact.") === "---\na: 1\n---\n\n```block-person\n```\n\nFact.\n\n## Timeline\n\n- x\n",
      addUnder("---\na: 1\n---\n\n```block-person\n```\n\n## Timeline\n\n- x\n", null, "Fact."))

    t = await tool("open", { path: "Sam Park" })
    check("mcp open: in the window used last (the made-up ones above; the op ui.open)", !t.error && t.text === "Opened People/Sam Park.md.", t)

    // The clipper, with the page given (no network): Defuddle's Markdown, the clipper's keys, once per address.
    const page = `<!doctype html><html><head><title>Lighthouse: a plant reminder | Example</title><meta name="author" content="Alice Park">
<meta property="article:published_time" content="2026-09-20T10:00:00Z"><meta name="description" content="See which plants need water"></head>
<body><nav><a href="/">Home</a> <a href="/blog">Blog</a></nav><article><h1>Lighthouse: a plant reminder</h1><p>Lighthouse lists your
plants, so the thirsty ones stand out at a glance. It reads, never writes, and it's <a href="/docs">documented</a>.</p><h2>Why</h2>
<ul><li>Fast</li><li>Read-only</li></ul></article><footer>Copyright</footer></body></html>`
    t = await tool("clip", { url: "https://lighthouse.example.com/blog/plant-reminder#intro", html: page })
    const clipped = exists("Clippings/Lighthouse - a plant reminder.md") ? read("Clippings/Lighthouse - a plant reminder.md") : ""
    check("clip: a note in Clippings/ with the page's content as Markdown", !t.error && clipped.includes("so the thirsty ones stand out") && clipped.includes("## Why") && clipped.includes("[documented](https://lighthouse.example.com/docs)") && !clipped.includes("Copyright") && !clipped.includes("Home"), [t, clipped])
    check("clip: the clipper's frontmatter, in the note format", clipped.startsWith("---\ntype: note\nkind: note\ntitle: 'Lighthouse: a plant reminder'\naliases: ['Lighthouse: a plant reminder']\nsource: https://lighthouse.example.com/blog/plant-reminder\nauthor: [Alice Park]\npublished: 2026-09-20\ndescription: See which plants need water\ntags: [Clipping]\nid: note-lighthouse-a-plant-reminder\ncreated: '"), clipped.slice(0, 400))
    t = await tool("clip", { url: "https://lighthouse.example.com/blog/plant-reminder", html: page })
    check("clip: the same address again answers its note", !t.error && t.text.startsWith("Already clipped: Clippings/Lighthouse - a plant reminder.md") && !exists("Clippings/Lighthouse - a plant reminder 2.md"), t)
    {
      const at = "Clippings/Lighthouse - a plant reminder.md"
      write(at, read(at).replace("tags: [Clipping]", "tags: [Clipping, Plants]"))
      t = await tool("clip", { url: "https://lighthouse.example.com/blog/plant-reminder", html: page.replace("stand out at a glance", "stand out at once"), update: true })
      const now = read(at)
      check("clip: update clips the page into its note again, the note's own keys kept", !t.error && t.text.startsWith(`Updated ${at}`) && now.includes("stand out at once") && !now.includes("at a glance")
        && now.includes("tags: [Clipping, Plants]") && now.includes("source: https://lighthouse.example.com/blog/plant-reminder") && !exists("Clippings/Lighthouse - a plant reminder 2.md"), [t, now])
    }
    t = await tool("clip", { url: "https://lighthouse.example.com/review-me", html: page, inbox: true })
    const inClip = exists("Inbox/Lighthouse - a plant reminder.md") ? read("Inbox/Lighthouse - a plant reminder.md") : ""
    check("clip: into the inbox, to review", !t.error && inClip.startsWith("---\ntype: inbox\nstatus: new\nfrom: Claude Code\ntitle: 'Lighthouse: a plant reminder'") && inClip.includes("source: https://lighthouse.example.com/review-me"), inClip.slice(0, 300))
    t = await tool("inbox_add", { title: "Lighthouse competitors", body: "## Three tools\n- One", source: "https://lighthouse.example.com/competitors" })
    check("inbox_add: a result in Inbox/, from the client", !t.error && t.text.includes("Inbox/Lighthouse competitors.md") && read("Inbox/Lighthouse competitors.md").includes("from: Claude Code") && read("Inbox/Lighthouse competitors.md").includes("## Three tools"), t)
    let [cs, cb] = await api("POST", "clip", { url: "https://lighthouse.example.com/other", html: page, folder: "Notes/Reading", tags: ["Reading"] })
    check("clip: another folder and tags", cs === 201 && cb.path === "Notes/Reading/Lighthouse - a plant reminder.md" && read(cb.path).includes("tags: [Reading]"), [cs, cb])
    ;[cs, cb] = await api("POST", "clip", { url: "http://127.0.0.1:8793/api/state" })
    check("clip: the server never fetches a local address", cs === 400 && /local address/.test(cb.error), [cs, cb])
    ;[cs, cb] = await api("POST", "clip", { url: "ftp://example.com/x" })
    check("clip: only http(s)", cs === 400, [cs, cb])
    ;[cs, cb] = await api("POST", "clip", { url: "https://example.com/empty", html: "<html><body></body></html>" })
    check("clip: a page with no text is refused", cs === 422, [cs, cb])

    // The routes, in-process: no HTTP request, so no loopback to call; the protocol and its refusals still answer.
    let [ms, mb] = await api("POST", "mcp", { jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-03-26", clientInfo: { name: "test" } } })
    check("mcp route: initialize over POST /api/mcp", ms === 200 && JSON.parse(mb).result.protocolVersion === "2025-03-26", [ms, mb])
    ;[ms, mb] = await api("POST", "mcp", { jsonrpc: "2.0", method: "notifications/initialized" })
    check("mcp route: a notification is a 202", ms === 202, [ms, mb])
    ;[ms, mb] = await api("POST", "mcp", { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "list", arguments: { folder: "People" } } })
    check("mcp route: a tool runs in-process (no loopback)", ms === 200 && JSON.parse(mb).result.isError === false && JSON.parse(mb).result.content[0].text.includes("People/Sam Park.md"), mb)
    ;[ms, mb] = await api("POST", "mcp", { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "docs", arguments: { topic: "api" } } })
    check("mcp route: an op's tool runs in-process", ms === 200 && JSON.parse(mb).result.content[0].text.includes("## Operations (the API)"), mb.slice?.(0, 200))
    ;[ms, mb] = await api("POST", "mcp", { jsonrpc: "2.0", id: 10, method: "tools/list" })
    check("mcp route: tools/list over POST /api/mcp is the catalog's", ms === 200 && same(JSON.parse(mb).result.tools.map((x: Any) => x.name), names), mb.slice?.(0, 200))
    ;[ms] = await api("GET", "mcp")
    check("mcp route: no event stream (GET is a 405)", ms === 405)
    check("mcp route: the vault isn't held for it, nor for clips", app.unlocked("POST", ["mcp"]) && app.unlocked("POST", ["clip"]) && !app.unlocked("POST", ["notes"]))
  }
}
