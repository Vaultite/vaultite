// MCP and the Web clipper against a running server, as an MCP client sees them: connects over Streamable HTTP
// (POST <base>api/mcp) and over stdio (bin/vau mcp, pointed at the same server), lists the tools (the operations marked
// for MCP, the old tools no op claims yet, ops and call: plugins/core/mcp/catalog.ts) and calls each one,
// then checks the files they wrote, that Activity names the client, and who may connect (another site's page, a
// tailnet login that isn't the owner's, a proxy: refused). No browser. WRITES (notes, a log, a timeline line, ME.md, a
// clipping): throwaway server only, on a copy of examples/vault (it uses its made-up people).
//   node web/qa/mcp.mjs <base url> <vault path>
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { qa } from "./lib/qa.mjs"

const { args: [B, VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const BASE = B.replace(/\/+$/, "")
const read = (rel) => { try { return fs.readFileSync(path.join(VAULT, rel), "utf8") } catch { return "" } }
/** The vault's files (hidden folders left out), and one by its name wherever the vault keeps it (People/, Personal/People/). */
const files = () => (fs.readdirSync(VAULT, { recursive: true })).map(String).filter((f) => !f.split("/").some((x) => x.startsWith(".")))
const at = (name) => files().find((f) => f === name || f.endsWith(`/${name}`)) ?? name

// What it uses, whatever the vault turned off (the sandbox starts calm: Activity is off). vau tells the served vault, not
// the one this shell may name (VAULTITE_VAULT in a Vaultite terminal is the user's).
execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", BASE, "plugin", "on", "activity"],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: BASE, VAULTITE_VAULT: VAULT } })

/** A client over Streamable HTTP: each message a POST, the session id kept. */
function httpClient(headers = {}) {
  let sid = null, n = 0
  const post = async (msg) => {
    const res = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "Mcp-Session-Id": sid } : {}), ...headers }, body: JSON.stringify(msg) })
    sid = res.headers.get("mcp-session-id") ?? sid
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return {
    post,
    request: async (method, params) => (await post({ jsonrpc: "2.0", id: ++n, method, params })).body,
    notify: (method, params) => post({ jsonrpc: "2.0", method, params }),
    close: () => fetch(`${BASE}/api/mcp`, { method: "DELETE", headers: sid ? { "Mcp-Session-Id": sid } : {} }),
  }
}

/** A client over stdio: bin/vau mcp, a message a line. */
function stdioClient() {
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "mcp"], { env: { ...process.env, VAULTITE_URL: BASE }, stdio: ["pipe", "pipe", "inherit"] })
  const waiting = new Map()
  let buf = "", n = 0
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (c) => {
    buf += c
    let at
    while ((at = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, at); buf = buf.slice(at + 1)
      if (!line.trim()) continue
      const m = JSON.parse(line)
      waiting.get(m.id)?.(m); waiting.delete(m.id)
    }
  })
  return {
    request: (method, params) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n") }),
    notify: async (method, params) => { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n") },
    close: () => new Promise((resolve) => { child.on("exit", resolve); child.stdin.end() }),
  }
}

const page = (t) => `<!doctype html><html><head><title>${t}</title><meta name="author" content="Alice Martin"></head><body><nav>Menu</nav>
<article><h1>${t}</h1><p>A paragraph long enough to be the page's main content, about a lighthouse and its beam, with <a href="/more">a link</a>.</p></article></body></html>`

async function session(label, c) {
  const init = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "qa" } })
  check(`${label}: initialize`, init.result?.protocolVersion === "2025-06-18" && init.result.serverInfo?.name === "vaultite" && init.result.instructions?.includes("ME.md"), init)
  await c.notify("notifications/initialized")
  const tools = (await c.request("tools/list")).result?.tools ?? []
  const names = tools.map((t) => t.name)
  check(`${label}: tools/list`, ["search", "read", "render", "docs", "list", "query", "write_note", "write_log", "add_timeline", "remember", "clip", "inbox_add", "open", "events_wait", "today", "calendar", "routines", "check_routine", "write_file", "links", "tags", "history", "read_version", "book_progress", "inbox"].every((n) => names.includes(n))
    && names.slice(-2).join() === "ops,call" && new Set(names).size === names.length, names)
  const call = async (name, args) => {
    const r = await c.request("tools/call", { name, arguments: args })
    return { error: r.result?.isError, text: r.result?.content?.[0]?.text ?? r.error?.message ?? "" }
  }
  let t = await call("search", { query: "Lighthouse" })
  check(`${label} search`, !t.error && t.text.includes("Lighthouse"), t)
  t = await call("read", { path: "Me" })
  check(`${label} read`, !t.error && t.text.startsWith("ME.md") && t.text.includes("## About me"), t)
  t = await call("render", { path: "Today" })
  check(`${label} render`, !t.error && t.text.includes("# Today") && !t.text.includes("```block-"), t.text.slice(0, 200))
  t = await call("docs", { topic: "query" })
  check(`${label} docs`, !t.error && t.text.includes("block-query"), t.text?.slice(0, 200))
  const alice = at("Alice Martin.md") // (People/, or wherever the vault keeps people)
  t = await call("list", { folder: alice.split("/").slice(0, -1).join("/") })
  check(`${label} list`, !t.error && t.text.includes(`${alice} (person)`), t)
  t = await call("query", { type: "person", columns: ["file", "relation"], sort: "file" })
  check(`${label} query`, !t.error && t.text.includes("| Alice Martin | friend |"), t)
  t = await call("write_note", { title: `QA note ${label}`, body: "Written by the MCP QA.", tags: ["Test"] })
  check(`${label} write_note`, !t.error && read(at(`QA note ${label}.md`)).includes("Written by the MCP QA."), t)
  t = await call("write_log", { area: "reading", title: `QA reading ${label}`, duration_min: 15 })
  const logs = files().filter((f) => f.includes(`QA reading ${label}`))
  check(`${label} write_log`, !t.error && logs.length === 1 && read(logs[0]).includes("source: claude"), t)
  t = await call("add_timeline", { person: "Bob", kind: "text", text: `QA over ${label}` })
  check(`${label} add_timeline`, !t.error && read(at("Bob Carter.md")).includes(`· text · QA over ${label}`), t)
  t = await call("remember", { fact: `Ran the MCP QA over ${label}.` })
  check(`${label} remember`, !t.error && read("ME.md").includes(`- Ran the MCP QA over ${label}.`), t)
  t = await call("remember", { fact: "Likes lighthouses.", about: "Dave", source: "QA" })
  check(`${label} remember about a person`, !t.error && /Likes lighthouses\. \(from QA, \d{4}-\d\d-\d\d\)/.test(read(at("Dave Kim.md"))), t)
  t = await call("clip", { url: `https://lighthouse.example.com/qa-${label}`, html: page(`A beam of light ${label}`) })
  check(`${label} clip`, !t.error && read(`Clippings/A beam of light ${label}.md`).includes(`source: https://lighthouse.example.com/qa-${label}`) && read(`Clippings/A beam of light ${label}.md`).includes("[a link](https://lighthouse.example.com/more)"), t)
  t = await call("inbox_add", { title: `Research ${label}`, body: "## Findings\n- One", source: `https://lighthouse.example.com/research-${label}` })
  check(`${label} inbox_add`, !t.error && read(`Inbox/Research ${label}.md`).includes("status: new") && read(`Inbox/Research ${label}.md`).includes("## Findings"), t)
  t = await call("clip", { url: `https://lighthouse.example.com/inbox-${label}`, html: page(`A page to review ${label}`), inbox: true })
  check(`${label} clip into the inbox`, !t.error && read(`Inbox/A page to review ${label}.md`).includes("type: inbox"), t)
  t = await call("open", { path: "Today" })
  check(`${label} open (an answer either way: opened, or no window)`, /Opened \S*Today\.md/.test(t.text) || /no (Vaultite|app) window/i.test(t.text), t)
  t = await call("today", {})
  check(`${label} today`, !t.error && t.text.includes("Today"), t.text?.slice(0, 200))
  t = await call("routines", {})
  check(`${label} routines`, !t.error, t)
  t = await call("calendar", {})
  check(`${label} calendar (events, or none set up)`, t.text.length > 0, t)
  t = await call("links", { path: "Alice Martin" })
  check(`${label} links`, !t.error && t.text.includes("Alice Martin"), t.text?.slice(0, 200))
  t = await call("tags", {})
  check(`${label} tags`, !t.error, t)
  t = await call("history", {})
  check(`${label} history`, !t.error, t)
  t = await call("inbox", {})
  check(`${label} inbox`, !t.error && t.text.includes(`Research ${label}`), t.text?.slice(0, 300))
  t = await call("book_progress", { book: "Piranesi", page: 42 })
  check(`${label} book_progress`, !t.error && read("Notes/Books/Piranesi.md").includes("42"), t)
  const scratch = `Notes/QA file ${label}.md`
  t = await call("write_file", { path: scratch, text: "# QA file\n\nOne line.\n" })
  check(`${label} write_file`, !t.error && read(scratch).includes("One line."), t)
  t = await call("write_file", { path: scratch, text: "# QA file\n\nOne line.\n\n(cut at 20000 characters of 30000)" })
  check(`${label} write_file refuses what read cut`, t.error === true && read(scratch).endsWith("One line.\n"), t)
  t = await call("ops", { filter: "events" })
  check(`${label} ops`, !t.error && t.text.includes("events.wait"), t)
  t = await call("call", { id: "events.list", params: { types: ["file"], limit: 3 } })
  check(`${label} call (events.list: the files the tools just wrote)`, !t.error && t.text.includes("file.changed"), t)
  t = await call("write_log", { area: "pottery", title: "x" })
  check(`${label} a tool's refusal is a result with isError`, t.error === true && t.text.includes("No area"), t)
  const bad = await c.request("tools/call", { name: "nope", arguments: {} })
  check(`${label} an unknown tool is a protocol error`, bad.error?.code === -32602, bad)
  await c.close()
}

await session("http", httpClient())
await session("stdio", stdioClient())

// Activity names the client for what the tools did.
// (An event is recorded once its caller is known, which takes a process lookup: wait for the writes to be in.)
const activity = async () => (await (await fetch(`${BASE}/api/activity?limit=60`)).json()).events
  .filter((e) => /QA note|ME\.md|Clipped/.test(e.text + (e.paths ?? []).join()))
let mine = []
for (let t = Date.now(); Date.now() - t < 10000; await new Promise((r) => setTimeout(r, 250))) if ((mine = await activity()).length >= 6) break
check("activity: the tools' writes are Claude Code's", mine.length >= 4 && mine.every((e) => e.actor.kind === "agent" && e.actor.name === "Claude Code"), mine.map((e) => [e.actor, e.text]))

// Who may connect: another site's page, a proxy and a tailnet login that isn't the owner's are refused before anything.
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "x" } } }
let r = await httpClient({ Origin: "https://evil.example.com" }).post(init)
check("another site's page is refused", r.status === 403, r)
r = await httpClient({ "X-Forwarded-For": "203.0.113.9" }).post(init)
check("a request through another proxy is refused", r.status === 403, r)
r = await httpClient({ "Tailscale-User-Login": "someone-else@example.com" }).post(init)
check("a tailnet login that isn't the owner's is refused", r.status === 403, r)
r = { status: (await fetch(`${BASE}/api/mcp`)).status }
check("GET has no stream: 405", r.status === 405, r)

// The clipper fetching for itself: never this machine or the networks it's on.
const local = await fetch(`${BASE}/api/clip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: `${BASE}/api/state` }) })
check("clip: a local address isn't fetched", local.status === 400, local.status)

await done()
