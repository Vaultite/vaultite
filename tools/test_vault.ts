// Backend test, in-process: the API against a throwaway vault (or a copy of one), both directions, files and API.
// node tools/test_vault.ts [vault]   (npm test); exits 1 on any failure
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-test-"))
const VAULT = path.join(tmp, "vault")
if (process.argv[2]) fs.cpSync(process.argv[2], VAULT, { recursive: true })
else {
  fs.mkdirSync(path.join(VAULT, "People"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, "People", "Alice Park.md"), "---\ntype: person\nrelation: friend\nlocation: Seattle, WA\n---\n\n" +
    "Likes hiking.\n\n## Timeline\n\n- 2026-09-20 · call · 20 min · Caught up\n")
  // The Vaultite plugins on (the tests use them), but the few that change the app for everyone (the Dock icon...).
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "core")
  const enabled = fs.readdirSync(root).filter((id) => !["agent-meters", "app-windows", "dock-icon", "recorder"].includes(id) &&
    !JSON.parse(fs.readFileSync(path.join(root, id, "manifest.json"), "utf8")).essential)
  fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins.json"), JSON.stringify({ disabled: [], enabled }, null, 2) + "\n")
}
fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@AGENTS.md\n") // the user's own
// The People map's lookups so far (its cache), so no test asks the network for a pin.
fs.mkdirSync(path.join(VAULT, ".vaultite", "cache"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "cache", "people.json"), JSON.stringify({ places: {
  "chicago, il": [41.8781, -87.6298], "denver, co": [39.7392, -104.9903], "seattle, wa": [47.6062, -122.3321], "nowhere at all": null } }))
process.env.VAULTITE_VAULT = VAULT
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
// Claude Code's files: a made-up session (tools/fixtures/claude), never this machine's ~/.claude.
const CLAUDE_DIR = path.join(tmp, "claude")
fs.cpSync(path.join(import.meta.dirname, "fixtures", "claude"), CLAUDE_DIR, { recursive: true })
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR
// Codex's files: made-up sessions (tools/fixtures/codex), never this machine's ~/.codex (its app server then has no login:
// the limits come from the sessions).
const CODEX_DIR = path.join(tmp, "codex")
fs.cpSync(path.join(import.meta.dirname, "fixtures", "codex"), CODEX_DIR, { recursive: true })
process.env.CODEX_HOME = CODEX_DIR
// Cursor's files (tools/fixtures/cursor: `User` for Cursor.app's User folder, `config` for ~/.cursor), never this machine's.
// Its SQLite databases are kept as SQL: each <name>.sql becomes <name>. Its account is a fake Cursor API, here.
const CURSOR_DIR = path.join(tmp, "cursor")
fs.cpSync(path.join(import.meta.dirname, "fixtures", "cursor"), CURSOR_DIR, { recursive: true })
{
  const { DatabaseSync } = await import("node:sqlite")
  for (const f of fs.readdirSync(CURSOR_DIR, { recursive: true }) as string[]) {
    if (!f.endsWith(".sql")) continue
    const db = new DatabaseSync(path.join(CURSOR_DIR, f.slice(0, -4)))
    db.exec(fs.readFileSync(path.join(CURSOR_DIR, f), "utf8"))
    db.close()
  }
}
process.env.CURSOR_USER_DIR = path.join(CURSOR_DIR, "User")
process.env.CURSOR_CONFIG_DIR = path.join(CURSOR_DIR, "config")
/** "Now" for made-up usage that's minutes old and must fall on today: never in the day's first two hours (just after
 *  midnight, "an hour ago" is yesterday, and tests counting today's usage failed until 1 am). */
const fixtureNow = () => { const d = new Date(); d.setHours(2, 0, 0, 0); return Math.max(Date.now(), d.getTime()) }
const cursorSeen: { path: string; cookie: string; origin: string }[] = []
const cursorApi = (await import("node:http")).createServer((req, res) => {
  cursorSeen.push({ path: req.url ?? "", cookie: String(req.headers.cookie ?? ""), origin: String(req.headers.origin ?? "") })
  const now = fixtureNow(), min = 60_000
  const ev = (ago: number, conversationId: string, model: string, t: Record<string, number> | null, charged = 0) =>
    ({ timestamp: String(now - ago * min), model, conversationId, ...(t ? { tokenUsage: t } : {}), chargedCents: charged })
  const body = req.url === "/api/usage-summary" ? {
    billingCycleStart: new Date(now - 10 * 86400_000).toISOString(), billingCycleEnd: new Date(now + 20 * 86400_000).toISOString(), membershipType: "pro",
    individualUsage: { plan: { enabled: true, used: 930, limit: 2000, totalPercentUsed: 46.5 }, onDemand: { enabled: false } } }
    : req.url === "/api/dashboard/get-sand-usage-status" ? { currentPeriodStart: new Date(now - 4 * 86400_000).toISOString(),
      nextResetTimestampUtc: new Date(now + 3 * 86400_000).toISOString(), usagePercent: 12, hasNonZeroIncludedLimit: true }
    : req.url === "/api/dashboard/get-filtered-usage-events" ? { totalUsageEventsCount: 5, usageEventsDisplay: [
      ev(3, "c0ffee00-1111-4222-8333-444455556666", "claude-4.5-sonnet", { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 8000, totalCents: 12 }, 12),
      ev(5, "c0ffee00-1111-4222-8333-444455556666", "claude-4.5-sonnet", { inputTokens: 500, outputTokens: 100, cacheReadTokens: 4000, totalCents: 8 }, 8),
      ev(20, "5a5a5a5a-2222-4333-8444-555566667777", "gpt-5", { inputTokens: 2000, outputTokens: 300, cacheWriteTokens: 1000, totalCents: 30 }, 30),
      ev(60, "9b9b9b9b-3333-4444-8555-666677778888", "grok-bot-default", { inputTokens: 100, outputTokens: 50, totalCents: 5 }, 5),
      ev(61, "9b9b9b9b-3333-4444-8555-666677778888", "grok-bot-automation", null) ] }
    : null
  res.writeHead(body ? 200 : 404, { "Content-Type": "application/json" }).end(JSON.stringify(body ?? {}))
})
await new Promise<void>((ok) => cursorApi.listen(0, "127.0.0.1", ok))
process.env.CURSOR_API_URL = `http://127.0.0.1:${(cursorApi.address() as { port: number }).port}`
// OpenCode's database: made up (tools/fixtures/opencode/opencode.sql, times moved so the newest is an hour ago), never
// this machine's ~/.local/share/opencode.
const OPENCODE_DIR = path.join(tmp, "opencode")
{
  const sql = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "opencode", "opencode.sql"), "utf8")
  const times = [...sql.matchAll(/\b1[78]\d{11}\b/g)].map((m) => Number(m[0]))
  const shift = Date.now() - 3600000 - Math.max(...times)
  const { DatabaseSync } = await import("node:sqlite")
  fs.mkdirSync(OPENCODE_DIR)
  const db = new DatabaseSync(path.join(OPENCODE_DIR, "opencode.db"))
  db.exec(sql.replace(/\b1[78]\d{11}\b/g, (t) => String(Number(t) + shift)))
  db.close()
}
process.env.OPENCODE_DATA_DIR = OPENCODE_DIR
process.env.OPENCODE_CACHE_DIR = path.join(import.meta.dirname, "fixtures", "opencode")
// OpenClaw's state (tools/fixtures/openclaw: each <name>.sql becomes <name>, times moved so the newest reply is an hour
// ago), never this machine's ~/.openclaw. Events of 512 bytes and more are stored zstd-compressed, as OpenClaw does.
const OPENCLAW_DIR = path.join(tmp, "openclaw")
fs.cpSync(path.join(import.meta.dirname, "fixtures", "openclaw"), OPENCLAW_DIR, { recursive: true })
{
  const { DatabaseSync } = await import("node:sqlite")
  const { zstdCompressSync } = await import("node:zlib")
  const files = (fs.readdirSync(OPENCLAW_DIR, { recursive: true }) as string[]).filter((f) => f.endsWith(".sql"))
  const times = files.filter((f) => f.startsWith("agents")).flatMap((f) => [...fs.readFileSync(path.join(OPENCLAW_DIR, f), "utf8").matchAll(/\b1[78]\d{11}\b/g)].map((m) => Number(m[0])))
  const shift = Date.now() - 3600000 - Math.max(...times)
  for (const f of files) {
    const db = new DatabaseSync(path.join(OPENCLAW_DIR, f.slice(0, -4)))
    db.exec(fs.readFileSync(path.join(OPENCLAW_DIR, f), "utf8").replace(/\b1[78]\d{11}\b/g, (t) => String(Number(t) + shift))
      .replace(/\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, (t) => new Date(Date.parse(t) + shift).toISOString()))
    const big = f.startsWith("agents") ? db.prepare("SELECT session_id, seq, event_json FROM transcript_events WHERE length(event_json) >= 512 AND event_json NOT LIKE '{\"type\":\"session\"%'").all() : []
    for (const r of big as { session_id: string; seq: number; event_json: string }[]) {
      const ev = JSON.parse(r.event_json), n = Buffer.byteLength(r.event_json)
      const nav = { version: 1, report: { kind: "canonical", hasParentId: true, entry: { id: ev.id, parentId: ev.parentId, timestamp: ev.timestamp, type: ev.type } },
        navigation: {}, reset: {}, model: { type: ev.type, id: ev.id, message: { role: ev.message?.role } }, modelBytes: n, modelWithoutCheckpointBytes: n, withoutCustomDataBytes: n }
      db.prepare("UPDATE transcript_events SET event_json = NULL, event_zstd = ?, event_utf8_bytes = ?, navigation_json = ? WHERE session_id = ? AND seq = ?")
        .run(zstdCompressSync(Buffer.from(r.event_json)), n, JSON.stringify(nav), r.session_id, r.seq)
    }
    db.close()
  }
}
process.env.OPENCLAW_STATE_DIR = OPENCLAW_DIR
process.env.OPENCLAW_WORKSPACE_DIR = path.join(OPENCLAW_DIR, "workspace")
// Hermes Agent's home and a profile: made up (tools/fixtures/hermes; each state.sql becomes its state.db, times in seconds
// moved so the newest is an hour ago), never this machine's ~/.hermes. hermes.connect edits this copy's config.yaml.
const HERMES_DIR = path.join(tmp, "hermes")
fs.cpSync(path.join(import.meta.dirname, "fixtures", "hermes"), HERMES_DIR, { recursive: true })
{
  const { DatabaseSync } = await import("node:sqlite")
  const sqls = (fs.readdirSync(HERMES_DIR, { recursive: true }) as string[]).filter((f) => f.endsWith(".sql"))
  const TIME = /\b1[78]\d{8}(\.\d+)?\b/g
  const shift = Date.now() / 1000 - 3600 - Math.max(...sqls.flatMap((f) => [...fs.readFileSync(path.join(HERMES_DIR, f), "utf8").matchAll(TIME)].map((m) => Number(m[0]))))
  for (const f of sqls) {
    const db = new DatabaseSync(path.join(HERMES_DIR, f.replace(/\.sql$/, ".db")))
    db.exec(fs.readFileSync(path.join(HERMES_DIR, f), "utf8").replace(TIME, (t) => String(Number(t) + shift)))
    db.close()
    fs.rmSync(path.join(HERMES_DIR, f))
  }
}
process.env.HERMES_HOME = HERMES_DIR
// Imported after the environment is set: plugins read it when they load.
const { open } = await import("../core/app.ts")
const { merge3 } = await import("../core/textedit.ts")
const { Text } = await import("../core/plugins.ts")
const { publicOf } = await import("../core/vault.ts")
const app = await open(VAULT, { start: false })
const vault = app.vault
/** The Vaultite plugins on in the test vault (above): a test that writes plugins.json keeps them on. */
const ON: string[] = vault.config("plugins").enabled ?? []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const fails: string[] = []

function check(name: string, ok: unknown, got?: unknown) {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  -> ${JSON.stringify(got)?.slice(0, 300)}`))
  if (!ok) fails.push(name)
}

/** One API call, like the server makes it: [status, body]. */
// Workspaces' files: one per workspace (.vaultite/plugins/workspaces/<n>.json) and data.json saying so (`files`), read
// and written here as {workspaces: [...], ...data.json's other keys}.
const WS_DIR = ".vaultite/plugins/workspaces"
function readWs(): Any {
  const at = (f: string) => path.join(VAULT, WS_DIR, f)
  const list = [1, 2, 3, 4, 5].map((n) => (fs.existsSync(at(`${n}.json`)) ? JSON.parse(fs.readFileSync(at(`${n}.json`), "utf8")) : null))
  while (list.length && list[list.length - 1] === null) list.pop()
  return { ...(fs.existsSync(at("data.json")) ? JSON.parse(fs.readFileSync(at("data.json"), "utf8")) : {}), workspaces: list }
}
function writeWs({ workspaces = [], ...rest }: Any) {
  fs.mkdirSync(path.join(VAULT, WS_DIR), { recursive: true })
  ;[1, 2, 3, 4, 5].forEach((n) => {
    const f = path.join(VAULT, WS_DIR, `${n}.json`)
    if (workspaces[n - 1]) fs.writeFileSync(f, JSON.stringify(workspaces[n - 1])); else fs.rmSync(f, { force: true })
  })
  fs.writeFileSync(path.join(VAULT, WS_DIR, "data.json"), JSON.stringify({ ...rest, files: true }))
}
function clearWs() {
  for (const f of ["1", "2", "3", "4", "5", "data"]) fs.rmSync(path.join(VAULT, WS_DIR, `${f}.json`), { force: true })
}

/** A route run as the server runs it: [status, body]. */
async function run(method: string, parts: string[], query: Record<string, string>, body?: unknown, http?: IncomingMessage): Promise<[number, Any]> {
  await app.syncPlugins() // the vault's own plugins first, like the server
  const res = app.unlocked(method, parts) ? await vault.synced().then(() => app.run(method, parts, query, body ?? {}, http)) : await vault.lock(async () => {
    await vault.sync()
    return app.run(method, parts, query, body ?? {}, http)
  })
  return [res.status, res.body instanceof Text ? res.body.text : publicOf(res.body)]
}

async function api(method: string, p: string, body?: unknown, http?: IncomingMessage): Promise<[number, Any]> {
  const [route, qs] = p.split("?")
  const query: Record<string, string> = qs ? Object.fromEntries(qs.split("&").map((q) => q.split("=", 2) as [string, string])) : {}
  return run(method, route.split("/").filter(Boolean).map(decodeURIComponent), query, body, http)
}

/** A request from a client over HTTP that says who it is (X-Vaultite-Client, X-Vaultite-Agent). */
const sentBy = (client: string | null, agent: string | null = null) =>
  ({ headers: { ...(client ? { "x-vaultite-client": client } : {}), ...(agent ? { "x-vaultite-agent": agent } : {}) } }) as unknown as IncomingMessage

const read = (rel: string) => fs.readFileSync(path.join(VAULT, rel), "utf8")
const exists = (rel: string) => fs.existsSync(path.join(VAULT, rel))

function write(rel: string, text: string) {
  const p = path.join(VAULT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  const t = Date.now() / 1000 + 2 // a new mtime even within the same second
  fs.utimesSync(p, t, t)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let [, s] = await api("GET", "state")
check("state loads", Array.isArray(s.people) && "vault" in s, Object.keys(s))
check("no problems in the vault", !s.vault.problems.length, s.vault.problems.slice(0, 3))
check("state: what kinds draw and keep (a person's Timeline; a note's UTC times), and only theirs",
  JSON.stringify(s.kinds.people?.sections) === '["timeline"]' && JSON.stringify(s.kinds.notes?.stamps) === '["created","updated"]' && !s.kinds.notes.sections.length, s.kinds)
check("the rules are the app's own file, short, no index", read(".vaultite/AGENTS.md").includes("## Rules") && !read(".vaultite/AGENTS.md").includes("- `query`:")
  && Buffer.byteLength(read(".vaultite/AGENTS.md")) < 3_000, Buffer.byteLength(read(".vaultite/AGENTS.md")))
check("the rules: each plugin that's on adds its line, a setting filled in", read(".vaultite/AGENTS.md").includes("\n## Plugins\n") && read(".vaultite/AGENTS.md").includes("\n- `ME.md` is the user")
  && !read(".vaultite/AGENTS.md").includes("`.vaultite/AGENTS.md` is the vault's rules"), read(".vaultite/AGENTS.md"))
{
  const [lc, topics] = await api("GET", "docs")
  check("docs: every topic, the core's first", lc === 200 && topics[0].plugin === null && topics.some((t: Any) => t.id === "vault")
    && topics.some((t: Any) => t.id === "people" && t.plugin === "people"), topics)
  const [pc, people] = await api("GET", "docs/people")
  check("docs: a plugin's whole AGENTS.md, then its blocks from the manifest", pc === 200 && people.includes("## People") && people.includes("`moving_to")
    && !people.includes("<!-- docs -->") && people.includes("- `people-group`:"), people.slice(-400))
  const [qc, query] = await api("GET", "docs/Database%20views")
  check("docs: by a title's words", qc === 200 && query.startsWith("## Database views"), query.slice(0, 80))
  const [nc, near] = await api("GET", "docs/peple")
  check("docs: an unknown topic names the nearest", nc === 404 && near.error.includes("did you mean people"), near)
}
// Agent files: the vault's AGENTS.md and CLAUDE.md are the user's; the app only adds or takes out its pointer line.
{
  const AG = "Before writing in this vault, read `.vaultite/AGENTS.md`: how the Vaultite app reads these files."
  const setRoot = async (on: boolean) => {
    fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/agent-files"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/agent-files/data.json"), JSON.stringify({ rootFiles: on }))
    await api("GET", "state")
  }
  check("agent files: off by default, nothing outside .vaultite/", !exists("AGENTS.md") && read("CLAUDE.md") === "@AGENTS.md\n")
  await setRoot(true)
  check("agent files: on, a new AGENTS.md is the pointer", read("AGENTS.md") === AG + "\n", read("AGENTS.md"))
  check("agent files: on, CLAUDE.md keeps its line and gets the import", read("CLAUDE.md") === "@AGENTS.md\n\n@.vaultite/AGENTS.md\n", read("CLAUDE.md"))
  await setRoot(false)
  check("agent files: off, a file that was only the line goes", !exists("AGENTS.md"))
  check("agent files: off, the rest of a file stays", read("CLAUDE.md") === "@AGENTS.md\n", read("CLAUDE.md"))
  fs.writeFileSync(path.join(VAULT, "AGENTS.md"), "")
  await setRoot(true)
  await setRoot(false)
  check("agent files: off, the user's own file stays even when it was only the line", exists("AGENTS.md") && read("AGENTS.md") === "", read("AGENTS.md"))
  fs.rmSync(path.join(VAULT, "AGENTS.md"))
  fs.writeFileSync(path.join(VAULT, "AGENTS.md"), "# My project\n\nBuild with make.\n")
  await api("GET", "state")
  check("agent files: off, the user's own AGENTS.md is never touched", read("AGENTS.md") === "# My project\n\nBuild with make.\n")
  await setRoot(true)
  check("agent files: on, one line added at the end, nothing else changed", read("AGENTS.md") === `# My project\n\nBuild with make.\n\n${AG}\n`, read("AGENTS.md"))
  await setRoot(false)
  check("agent files: off again, back as it was", read("AGENTS.md") === "# My project\n\nBuild with make.\n", read("AGENTS.md"))
  fs.rmSync(path.join(VAULT, "AGENTS.md"))
  fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@AGENTS.md\n")
  await api("GET", "state")
  check("the app never writes the vault's own AGENTS.md or CLAUDE.md", !exists("AGENTS.md") && read("CLAUDE.md") === "@AGENTS.md\n")
  // The user's own rules, under their heading, stay through the app's rewrites; turned off, only they stay.
  const rules = read(".vaultite/AGENTS.md")
  const [rc] = await api("PUT", "file", { path: ".vaultite/AGENTS.md", text: rules.replace("## Rules", "## Changed") + "\nProjects live in Work/.\n", base: rules })
  await api("GET", "state")
  check("the rules: the app's part is rewritten, the user's own rules stay", rc === 200 && read(".vaultite/AGENTS.md").includes("## Rules") &&
    read(".vaultite/AGENTS.md").endsWith("## Your own rules\n<!-- The app rewrites everything above this heading; what you write under it stays. -->\n\nProjects live in Work/.\n"), read(".vaultite/AGENTS.md").slice(-300))
  const turnRules = (on: boolean) => api("PUT", "config/plugins", { ...vault.config("plugins"), disabled: on ? [] : ["agent-files"] })
  await setRoot(true)
  await turnRules(false)
  await api("GET", "state")
  check("the rules: off, the app's part and the pointer go, the user's own rules stay", read(".vaultite/AGENTS.md") === "## Your own rules\n\nProjects live in Work/.\n" &&
    read("CLAUDE.md") === "@AGENTS.md\n", [read(".vaultite/AGENTS.md"), read("CLAUDE.md")])
  await turnRules(true)
  await api("GET", "state")
  check("the rules: on again, back whole, the user's rules kept", read(".vaultite/AGENTS.md").includes("## Rules") && read(".vaultite/AGENTS.md").endsWith("\n\nProjects live in Work/.\n") &&
    read("CLAUDE.md") === "@AGENTS.md\n\n@.vaultite/AGENTS.md\n", read(".vaultite/AGENTS.md").slice(-200))
  const own = read(".vaultite/AGENTS.md")
  fs.writeFileSync(path.join(VAULT, ".vaultite/AGENTS.md"), own.replace(/\n\nProjects live in Work\/\.\n$/, "\n"))
  await turnRules(false)
  await api("GET", "state")
  check("the rules: off with no rules of the user's, there's no file", !exists(".vaultite/AGENTS.md"))
  await turnRules(true)
  await setRoot(false)
  fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@AGENTS.md\n")
  await api("GET", "state")
  check("the rules: on, written again", exists(".vaultite/AGENTS.md"))
  // Rules that can't be read aren't taken for no file (the rewrite would drop the user's own); tried again after a wait.
  const file = path.join(VAULT, ".vaultite/AGENTS.md"), mine = read(".vaultite/AGENTS.md") + "\nKeep this.\n"
  fs.writeFileSync(file, mine)
  fs.chmodSync(file, 0o000)
  await turnRules(false)
  await api("GET", "state")
  fs.chmodSync(file, 0o644)
  check("the rules: unreadable, left as they are", read(".vaultite/AGENTS.md") === mine)
  await new Promise((r) => setTimeout(r, 2_100))
  await api("GET", "state")
  check("the rules: tried again after the wait", read(".vaultite/AGENTS.md") === "## Your own rules\n\nKeep this.\n", read(".vaultite/AGENTS.md"))
  await turnRules(true)
  await api("GET", "state")
  // A write that fails leaves no temporary copy behind.
  const { writeAtomic } = await import("../core/vault.ts")
  fs.mkdirSync(path.join(VAULT, "Taken/x"), { recursive: true })
  let threw = false
  try { writeAtomic(path.join(VAULT, "Taken"), "text") } catch { threw = true }
  check("a failed write leaves no temporary file", threw && fs.readdirSync(VAULT).every((n) => !n.includes(".tmp-")), fs.readdirSync(VAULT))
  fs.rmSync(path.join(VAULT, "Taken"), { recursive: true })
}

// People: API -> file
let code: number
let p: Any
;[code, p] = await api("POST", "people", { name: "Test Person", relation: "friend", every_days: 14, location: "Chicago, IL" })
check("POST person creates the file", code === 201 && exists("People/Test Person.md"), p)
check("a location's pin is never written to the person's file", !read("People/Test Person.md").includes("coordinates") && p.lat === null, p)
;[, s] = await api("GET", "state")
{
  const tp = s.people.find((x: Any) => x.name === "Test Person")
  check("its pin comes from the map's cache", tp.lat === 41.8781 && tp.lon === -87.6298, tp)
  ;[, p] = await api("PUT", "people/Test Person", { ...tp, context: "From work" })
  check("a pin the app showed, sent back whole, isn't written either", !read("People/Test Person.md").includes("coordinates") && read("People/Test Person.md").includes("context: From work"), read("People/Test Person.md"))
  const [, g] = await api("GET", "geocode?q=Nowhere at all")
  check("a place that wasn't found has no pin (no guess)", g.lat === null, g)
}
await api("POST", "interactions", { person: "Test Person", date: "2026-09-29", kind: "call", duration_min: 15, notes: "Hi" })
check("interaction lands in the timeline", read("People/Test Person.md").includes("- 2026-09-29 · call · 15 min · Hi"))
;[code] = await api("POST", "interactions", { person: "Nobody", date: "2026-09-29", kind: "call" })
check("unknown person is a 400", code === 400, code)
// file -> API
write("People/Test Person.md", read("People/Test Person.md") + "- 2026-09-01 · note · Moved to Chicago\n")
;[, s] = await api("GET", "state")
let mine = s.interactions.filter((i: Any) => i.person_id === "People/Test Person")
check("a line added to the file shows up", mine.length === 2 && mine[mine.length - 1].kind === "note", mine)
// rename
;[, p] = await api("PUT", "people/Test Person", { name: "Tess Person" })
check("rename moves the file", p.id === "People/Tess Person" && !exists("People/Test Person.md"), p)
check("rename keeps the timeline", read("People/Tess Person.md").includes("Moved to Chicago"))
await api("DELETE", "people/People/Tess Person")
check("delete moves it to .trash", fs.readdirSync(path.join(VAULT, ".trash/People")).some((f) => f.startsWith("Tess Person")))

// Notes: upsert by id, updated bumps only on content
const n1 = (await api("POST", "notes", { ext_id: "idea-test", title: "Test: idea", body: "Hello [[Alice Park]]", kind: "idea", status: "seed" }))[1]
check("note file name drops the colon", n1.id === "Notes/Test - idea" && read("Notes/Test - idea.md").includes("aliases: ['Test: idea']"), n1)
await sleep(1100)
const n2 = (await api("POST", "notes", { ext_id: "idea-test", title: "Test: idea", body: "Hello [[Alice Park]]", kind: "idea", status: "seed" }))[1]
check("re-posting the same note is a no-op", n2.updated_at === n1.updated_at, [n1.updated_at, n2.updated_at])
const n3 = (await api("PUT", "notes/idea-test", { status: "seed" }))[1]
check("a no-op edit doesn't bump updated", n3.updated_at === n1.updated_at, n3)
check("`pinned` isn't read any more", !("pinned" in n3), n3)
const n4 = (await api("PUT", "notes/idea-test", { body: "Changed" }))[1]
check("editing the body bumps updated", n4.updated_at > n1.updated_at, n4)
write("Notes/Hand written.md", "Just a body.\n")
;[, s] = await api("GET", "state")
check("plain Markdown in Notes is a plain file, not a note: kinds come from `type:` alone", !s.notes.some((n: Any) => n.title === "Hand written"))
{
  const [, dry] = await api("POST", "ops/file.type", {})
  check("file.type: lists untyped files in a folder named like a kind's, writes nothing", dry.groups.some((g: Any) => g.folder === "Notes" && g.type === "note" && g.files.includes("Notes/Hand written.md")) &&
    read("Notes/Hand written.md") === "Just a body.\n", dry)
  const [, ctxt] = await api("POST", "ops/app.context?as=text", {})
  check("app.context says when files have no type", String(ctxt).includes("Without a type") && String(ctxt).includes("Notes/ "), ctxt)
  const [, done] = await api("POST", "ops/file.type", { folder: "Notes", apply: true })
  check("file.type: apply adds the line (then notes fills in its id and dates)", done.written >= 1 && read("Notes/Hand written.md").startsWith("---\ntype: note\n") && read("Notes/Hand written.md").endsWith("---\n\nJust a body.\n"), read("Notes/Hand written.md"))
  const [nk] = await api("POST", "ops/file.type", { folder: "Elsewhere" })
  check("file.type: a folder named like no kind's needs a kind", nk === 400, nk)
}
;[, s] = await api("GET", "state")
const hw = s.notes.find((n: Any) => n.title === "Hand written")
check("typed, it's a note, its body as it was", hw && read("Notes/Hand written.md").endsWith("Just a body.\n"), hw)
check("its id is its title's", (await api("GET", "notes/note-hand-written"))[1].title === "Hand written")
write("Notes/Typed by hand.md", "---\ntype: note\n---\n\nA body.\n")
await api("GET", "state")
check("a note written outside the app stays as it was written (reading never writes)", read("Notes/Typed by hand.md") === "---\ntype: note\n---\n\nA body.\n", read("Notes/Typed by hand.md"))
await api("PUT", "file", { path: "Notes/Typed by hand.md", text: "---\ntype: note\n---\n\nA body, edited.\n" })
check("...edited in the app, it gets an id and times", /id: note-typed-by-hand\ncreated: '.+'\nupdated: '.+'/.test(read("Notes/Typed by hand.md")), read("Notes/Typed by hand.md"))
const [, upd] = await api("POST", "notes", { ext_id: "note-hand-written", title: "Hand written", body: "Rewritten." })
check("a write by its id updates the hand-written file, and only then gets the app's keys", upd.id === "Notes/Hand written" && read("Notes/Hand written.md").includes("id: note-hand-written") && read("Notes/Hand written.md").includes("Rewritten."), upd)

// Logs: upsert on (source, ext_id), data merged
const log = { area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "meal-test", title: "Rice bowl", data: { meal: "Lunch", kcal: 650 } }
await api("POST", "logs", [log])
await api("POST", "logs", [{ ...log, data: { protein: 45 } }])
let [, logs] = await api("GET", "logs?area=health")
mine = logs.filter((l: Any) => l.ext_id === "meal-test")
check("log upsert merges data into one file", mine.length === 1 && JSON.stringify(mine[0].data) === JSON.stringify({ meal: "Lunch", kcal: 650, protein: 45 }), mine)
{
  const had = vault.config("plugins/logs/data")
  ;[code] = await api("POST", "logs", { area: "nope", date: "2026-09-29" })
  check("a log for a new area adds the area", code === 201 && vault.config("plugins/logs/data")?.areas?.some((a: Any) => a.slug === "nope"), [code, vault.config("plugins/logs/data")])
  if (had) vault.setConfig("plugins/logs/data", had); else vault.removeConfig("plugins/logs/data")
  fs.rmSync(path.join(VAULT, "Logs/Nope"), { recursive: true, force: true })
}
;[code] = await api("POST", "logs", { area: "nutrition", date: "yesterday", title: "Lunch" })
check("a date that isn't YYYY-MM-DD is a 400", code === 400 && !fs.readdirSync(path.join(VAULT, "Logs"), { recursive: true }).some((f) => String(f).includes("yesterday")), code)

// Routines: ticks go to the daily note, an empty note is removed
await api("POST", "routines", { name: "Stretch" })
await api("POST", "checks", { routine: "Stretch", date: "2026-09-29", done: true })
check("tick writes the daily note", read("Daily/2026-09-29.md").includes("done: [Stretch]"), read("Daily/2026-09-29.md"))
;[, s] = await api("GET", "state")
check("tick shows in checks", s.checks.some((c: Any) => c.routine === "Routines/Stretch" && c.date === "2026-09-29"), s.checks)
await api("POST", "checks", { routine: "Routines/Stretch", date: "2026-09-29", done: false })
check("untick removes the empty note", !exists("Daily/2026-09-29.md"))

// Settings and Me
await api("PUT", "config/plugins", { disabled: ["random-note"], order: [] })
check("settings saved in .vaultite", JSON.parse(read(".vaultite/plugins.json")).disabled[0] === "random-note")
// PATCH changes only the keys sent (the Plugins page's folded sections), null removes one; the rest stay as on disk
await api("PATCH", "config/plugins", { collapsedCategories: ["core:navigation"], order: null })
{
  const conf = JSON.parse(read(".vaultite/plugins.json"))
  check("PATCH writes one key and keeps the others", conf.collapsedCategories?.[0] === "core:navigation" && conf.disabled[0] === "random-note" && !("order" in conf), conf)
}
await api("PATCH", "config/hotkeys", { "terminal:open": ["Mod+Shift+T"] })
await api("PATCH", "config/hotkeys", { "file:new": [] })
await api("PATCH", "config/hotkeys", { "file:new": null })
check("hotkeys.json keeps one command per key", read(".vaultite/hotkeys.json") === '{\n  "terminal:open": [\n    "Mod+Shift+T"\n  ]\n}\n', read(".vaultite/hotkeys.json"))
;[, s] = await api("GET", "state")
check("hotkeys are in the state's config", s.config.hotkeys["terminal:open"][0] === "Mod+Shift+T", s.config)
let me: Any
;[, me] = await api("PUT", "me", { location: "Denver, CO" })
check("ME.md is written, without coordinates", me.lat === null && !read("ME.md").includes("coordinates"), me)
check("the user's pin comes from the map's cache", (await api("GET", "state"))[1].me?.lat === 39.7392)
{
  const { Kind } = await import("../core/vault.ts")
  const k = new Kind({ type: "me", collection: "me", file: "ME.md", parse: () => [{}, []], render: () => [{}, ""] })
  check("ME.md is the user's file in any case (Me.md from before), and only at the top", me.id === "ME" && k.owns("ME.md") && k.owns("Me.md") && !k.owns("Notes/Me.md"), me.id)
}
// Me is a plugin: its setting says where the user's file is, and remember follows; off, nothing breaks.
{
  const meText = read("ME.md")
  const setMe = async (data: Any) => {
    fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/me"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/me/data.json"), JSON.stringify(data))
    await api("GET", "state")
  }
  fs.mkdirSync(path.join(VAULT, "Personal"), { recursive: true })
  fs.renameSync(path.join(VAULT, "ME.md"), path.join(VAULT, "Personal/About.md"))
  write("Personal/About.md", meText.replace(/^---\ntype: me\n/, "---\n"))
  await setMe({ path: "Personal/About.md" })
  let [, ms] = await api("GET", "state")
  check("me: the setting's path is the user's file, without a type", ms.me?.id === "Personal/About", ms.me)
  const [, rem] = await api("POST", "ops/people.remember", { fact: "Grows tomatoes." })
  check("me: remember writes where the setting says", rem.path === "Personal/About.md" && read("Personal/About.md").includes("- Grows tomatoes.") && !exists("ME.md"), rem)
  await api("POST", "file/move", { from: "Personal", to: "Private" })
  check("me: moved in the app (its folder too), the setting follows", vault.config("plugins/me/data").path === "Private/About.md" && (await api("GET", "state"))[1].me?.id === "Private/About", vault.config("plugins/me/data"))
  await api("POST", "file/move", { from: "Private", to: "Personal" })
  const off = (on: boolean) => api("PUT", "config/plugins", { ...vault.config("plugins"), disabled: on ? [] : ["me"] })
  await off(false)
  const [rc, rr] = await api("POST", "ops/people.remember", { fact: "Grows beans." })
  const [sc] = await api("GET", "state")
  check("me: off, remember says why instead of writing, and the app still loads", rc === 409 && /Me plugin is off/.test(rr.error) && sc === 200 && !read("Personal/About.md").includes("beans"), [rc, rr])
  await off(true)
  await setMe({})
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/me"), { recursive: true })
  fs.rmSync(path.join(VAULT, "Personal"), { recursive: true })
  write("ME.md", meText)
  ;[, ms] = await api("GET", "state")
  check("me: back at ME.md", ms.me?.id === "ME", ms.me)
}

// A broken file is reported and keeps what it held
const good = "---\ntype: person\nrelation: friend\n---\n"
write("People/Broken Test.md", good)
await api("GET", "state")
write("People/Broken Test.md", "---\nrelation: [friend\n---\nbroken\n")
;[, s] = await api("GET", "state")
check("broken frontmatter is reported", s.vault.problems.some((x: Any) => x.file === "People/Broken Test.md"), s.vault.problems)
check("its person is still there", s.people.some((x: Any) => x.name === "Broken Test"))
write("People/Broken Test.md", good)
;[, s] = await api("GET", "state")
check("fixing it clears the problem", !s.vault.problems.some((x: Any) => x.file === "People/Broken Test.md"))

// Small edits: hand-written files keep their shape when the app writes to them
const hand = `---
type: person
relation: friend   # met at the gym
tags: [Climbing]
location: Denver, CO
coordinates: [39.74, -104.99]
sort: 90
custom_key: keep me
---

Likes bouldering.

## Timeline

- 2026-09-27 - text - sent the flight
  and they said they'd pick me up
* 2026-09-20 · Call · 1h 30m · Talked
- 2026-09-10 · coffee chat · Long catch-up
- 2026-09-01 Moved to Denver
Something that isn't an entry

## Gift ideas

- A book about Baltimore
`
write("People/Hand Made.md", hand)
;[, s] = await api("GET", "state")
mine = s.interactions.filter((i: Any) => i.person_id === "People/Hand Made").sort((a: Any, b: Any) => (a.date < b.date ? 1 : -1))
check("lenient: every hand-written line reads", JSON.stringify(mine.map((i: Any) => [i.date, i.kind])) ===
  JSON.stringify([["2026-09-27", "text"], ["2026-09-20", "call"], ["2026-09-10", "coffee chat"], ["2026-09-01", "note"]]), mine)
check("lenient: continuation line joins the entry", mine[0]?.notes === "sent the flight\nand they said they'd pick me up", mine.slice(0, 1))
check("lenient: 1h 30m is 90 min", mine[1]?.duration_min === 90, mine.slice(1, 2))
check("lenient: only the stray line is a problem",
  JSON.stringify(s.vault.problems.filter((x: Any) => x.file === "People/Hand Made.md").map((x: Any) => x.problem)) ===
  JSON.stringify(["timeline line not understood: Something that isn't an entry"]), s.vault.problems)
const hm = s.people.find((x: Any) => x.name === "Hand Made")
check("sections after the timeline are kept apart", hm.after.startsWith("## Gift ideas") && !hm.notes.includes("Gift"), hm)
await api("POST", "interactions", { person: "Hand Made", date: "2026-09-28", kind: "call", notes: "New one" })
let after = read("People/Hand Made.md")
check("adding an entry changes only that line", after === hand.replace("## Timeline\n\n", "## Timeline\n\n- 2026-09-28 · call · New one\n"), after)
await api("POST", "interactions", { person: "Hand Made", date: "2026-09-15", kind: "meet", notes: "Middle" })
check("an older entry goes in date order", read("People/Hand Made.md").includes("* 2026-09-20 · Call · 1h 30m · Talked\n- 2026-09-15 · meet · Middle\n- 2026-09-10"), read("People/Hand Made.md"))
await api("PUT", "people/Hand Made", { want_to: "Call about the move" })
let t = read("People/Hand Made.md")
check("a profile change touches one frontmatter line", t.includes("relation: friend   # met at the gym\n") && t.includes("want_to: Call about the move")
  && t.includes("custom_key: keep me") && t.includes("- 2026-09-27 - text - sent the flight\n  and they said"), t)
const before = read("People/Hand Made.md")
await api("PUT", "people/Hand Made", { want_to: "Call about the move" })
check("saving without a change writes nothing", read("People/Hand Made.md") === before)
;[, s] = await api("GET", "state")
const iid = s.interactions.find((i: Any) => i.person_id === "People/Hand Made" && i.date === "2026-09-10").id
await api("PUT", `interactions/${encodeURIComponent(iid)}`, { notes: "Long catch-up about climbing" })
t = read("People/Hand Made.md")
check("editing one entry rewrites only that line", t.includes("- 2026-09-10 · coffee chat · Long catch-up about climbing\n")
  && t.includes("* 2026-09-20 · Call · 1h 30m · Talked") && t.includes("## Gift ideas\n\n- A book about Baltimore"), t)
await api("PUT", "people/Hand Made", { notes: "Likes bouldering and tea." })
t = read("People/Hand Made.md")
check("editing the notes keeps the rest", t.split("## Gift ideas").length === 2 && t.includes("Likes bouldering and tea.\n\n## Timeline"), t)

// Any file's timeline, from the app's Add (POST /api/timeline): placed by date, every other line as it was
const trip = "---\ntags: [Trip]\n---\n\n```\n## Timeline\n```\n\nPlans.\n\n## Timeline\n\n- 2026-09-27 · call · Booked\n  the flights\n* 2026-09-10 · Note · Started\n\n## After\n\nKept.\n"
write("Trips/Trip.md", trip)
await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-20", kind: "meet", duration_min: 45, notes: "Planned the route" })
check("a timeline line goes in date order, after an entry's continuation", read("Trips/Trip.md") ===
  trip.replace("  the flights\n", "  the flights\n- 2026-09-20 · meet · 45 min · Planned the route\n"), read("Trips/Trip.md"))
await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-27", kind: "text", notes: "Sent the times" })
check("the newest goes first, above one of the same day", read("Trips/Trip.md").includes("## Timeline\n\n- 2026-09-27 · text · Sent the times\n- 2026-09-27 · call"), read("Trips/Trip.md"))
await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-01", kind: "note", notes: "First idea" })
check("the oldest goes last, before the next section", read("Trips/Trip.md").includes("* 2026-09-10 · Note · Started\n- 2026-09-01 · note · First idea\n\n## After"), read("Trips/Trip.md"))
write("Trips/Empty timeline.md", "Text.\n\n## Timeline\n")
await api("POST", "timeline", { path: "Trips/Empty timeline.md", date: "2026-09-29", kind: "call" })
check("an empty timeline gets its first line", read("Trips/Empty timeline.md") === "Text.\n\n## Timeline\n\n- 2026-09-29 · call\n", read("Trips/Empty timeline.md"))
write("Trips/No timeline.md", "Text.\n")
await api("POST", "timeline", { path: "Trips/No timeline.md", date: "2026-09-29", kind: "email", notes: "Asked" })
check("a file without a timeline gets one at its end", read("Trips/No timeline.md") === "Text.\n\n## Timeline\n\n- 2026-09-29 · email · Asked\n", read("Trips/No timeline.md"))
;[code] = await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-29", kind: "dance" })
check("a timeline line needs a known kind", code === 400, code)
;[code] = await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-29", kind: "note" })
check("a note line needs its text", code === 400, code)
await api("POST", "timeline", { path: "People/Hand Made.md", date: "2026-09-29", kind: "call", duration_min: 20 })
;[, s] = await api("GET", "state")
check("a person's timeline line counts as being in touch", s.interactions.some((i: Any) => i.person_id === "People/Hand Made" && i.date === "2026-09-29" && i.duration_min === 20), s.interactions.slice(0, 3))

// Plain files: indexed, not parsed
write("Ideas/Loose thought.md", "Links to [[Hand Made]].\n")
;[, s] = await api("GET", "state")
check("a plain file doesn't become a note or a problem", !s.notes.some((n: Any) => n.title === "Loose thought")
  && !s.vault.problems.some((x: Any) => x.file.startsWith("Ideas/")))

// Files: the editor's API
let f: Any, f2: Any
;[code, f] = await api("POST", "file", { path: "Notes/Untitled.md", text: "", unique: true })
check("new file", code === 201 && f.path === "Notes/Untitled.md", f)
;[code, f2] = await api("POST", "file", { path: "Notes/Untitled.md", text: "", unique: true })
check("new file with a taken name gets a number, from 1 as in Obsidian", f2.path === "Notes/Untitled 1.md", f2)
check("a new note stays as it was made (empty)", read("Notes/Untitled.md") === "", read("Notes/Untitled.md"))
;[, f] = await api("GET", "file?path=Notes/Untitled.md")
const base = f.text
;[, f] = await api("PUT", "file", { path: "Notes/Untitled.md", text: base + "Line one\nLine two\n", base })
check("save", read("Notes/Untitled.md").includes("Line one"), f)
const mineText = f.text
write("Notes/Untitled.md", mineText.replace("Line two", "Line two (by Claude)"))
;[, f] = await api("PUT", "file", { path: "Notes/Untitled.md", text: mineText.replace("Line one", "Line one edited"), base: mineText })
t = read("Notes/Untitled.md")
check("a change on disk meanwhile is merged, not lost", t.includes("Line one edited") && t.includes("(by Claude)"), t)
const cur = read("Notes/Untitled.md")
write("Notes/Untitled.md", cur.replace("Line one edited", "Line one by Claude"))
;[code, f] = await api("PUT", "file", { path: "Notes/Untitled.md", text: cur.replace("Line one edited", "Line one by me"), base: cur })
check("the same line changed on both sides is a 409 with the disk text", code === 409 && f.text.includes("by Claude"), [code, f])
write("Notes/Linker.md", "See [[Untitled]] and [[Untitled|this]] and [[Untitled#Head]]; not [[Untitled 2]].\n")
let r: Any
;[, r] = await api("POST", "file/move", { from: "Notes/Untitled.md", to: "Notes/Renamed.md" })
t = read("Notes/Linker.md")
check("rename updates links", t.includes("See [[Renamed]] and [[Renamed|this]] and [[Renamed#Head]]; not [[Untitled 2]].")
  && JSON.stringify(r.updated) === JSON.stringify(["Notes/Linker.md"]), [t, r])
let tr: Any
;[, tr] = await api("GET", "files")
const seeLine = t.split("\n").find((l) => l.startsWith("See"))
check("tree lists files, links and folders", tr.files.some((x: Any) => x.path === "Notes/Linker.md" && x.links.some((l: Any) => l[0] === "Renamed" && l[1] === seeLine))
  && tr.folders.includes("Notes"), tr.files.filter((x: Any) => x.path === "Notes/Linker.md"))
write("Img/Shot one.png", "png")
write("Notes/Pics.md", '---\ncover: "[[Shot one.png]]"\n---\n![[Shot one.png]] ![[Shot one.png|300]] [[Img/Shot one.png]] ![a](../Img/Shot%20one.png)\nnot `[[Shot one.png]]`\n```\n![[Shot one.png]]\n```\n')
;[, r] = await api("POST", "file/move", { from: "Img/Shot one.png", to: "Img/Words.jpeg" })
t = read("Notes/Pics.md")
check("renaming an image updates embeds, path links, Markdown links and frontmatter, not code", t === '---\ncover: "[[Words.jpeg]]"\n---\n![[Words.jpeg]] ![[Words.jpeg|300]] [[Img/Words.jpeg]] ![a](../Img/Words.jpeg)\nnot `[[Shot one.png]]`\n```\n![[Shot one.png]]\n```\n', [t, r])
await api("POST", "file/move", { from: "Img", to: "Media/Img" })
t = read("Notes/Pics.md")
check("moving a folder updates path links to its files, and names stay", t.includes("![[Words.jpeg]] ![[Words.jpeg|300]] [[Media/Img/Words.jpeg]] ![a](../Media/Img/Words.jpeg)"), t)
await api("POST", "file/move", { from: "Notes/Pics.md", to: "Pics.md" })
t = read("Pics.md")
check("a moved note's relative links still find their files", t.includes("![a](Media/Img/Words.jpeg)"), t)
write("A/Same.md", "a\n")
write("B/Thing.md", "b\n")
write("Notes/Refs.md", "[[Thing]] [Thing](../B/Thing.md)\n")
await api("POST", "file/move", { from: "B/Thing.md", to: "B/Same.md" })
t = read("Notes/Refs.md")
check("a link whose new name another file has gets the path", t === "[[B/Same]] [Thing](../B/Same.md)\n", t)
await api("POST", "folder", { path: "Projects/Sub" })
await api("POST", "file/move", { from: "Notes/Renamed.md", to: "Projects/Sub/Renamed.md" })
check("move into a folder", exists("Projects/Sub/Renamed.md"))
await api("DELETE", "file?path=Projects/Sub")
check("delete a folder goes to .trash", !exists("Projects/Sub") && fs.readdirSync(path.join(VAULT, ".trash/Projects")).some((n) => n.startsWith("Sub")))
;[, tr] = await api("GET", "files")
check("its files leave the index", !tr.files.some((x: Any) => x.path.startsWith("Projects/Sub/")))
vault.setConfig("files", { ...vault.config("files"), showHidden: false }) // a real vault may show hidden files
for (const bad of ["../x.md", ".vaultite/x.md"]) {
  ;[code] = await api("PUT", "file", { path: bad, text: "x" })
  check(`can't write ${bad}`, code === 400 || code === 403 || (bad.startsWith(".") && code === 404), code)
}
// With hidden files off, the app's settings files open by their exact path (the Plugins page), and nothing else hidden.
vault.setConfig("plugins", { ...vault.config("plugins") })
let cfg: Any
;[code, cfg] = await api("GET", "file?path=.vaultite/plugins.json")
check("a settings file opens by its path with hidden files off", code === 200 && cfg.text.includes("{"), [code, cfg])
;[code] = await api("PUT", "file", { path: ".vaultite/plugins.json", text: cfg.text, base: cfg.text })
check("and saves", code === 200, code)
;[code] = await api("PUT", "file", { path: ".vaultite/plugins.json", text: "{nope", base: cfg.text })
check("only as JSON", code === 400, code)
for (const bad of [".trash/x.md", ".vaultite/.secret/x.json", ".vaultite/x.txt", ".git/config"]) {
  ;[code] = await api("GET", `file?path=${bad}`)
  check(`no ${bad} with hidden files off`, code === 400, code)
}
;[, cfg] = await api("GET", "files")
check("hidden files aren't listed", !JSON.stringify(cfg).includes(".vaultite/"), null)
let res: Any
;[, res] = await api("GET", "search?q=Linker")
check("search finds by name", res.length && res[0].path === "Notes/Linker.md", res.slice(0, 2))

// Search syntax (core/searchquery.ts): operators, properties, tags, scopes, sorting, errors.
;[code] = await api("POST", "file", { path: "Searchy/Budget plan.md", text: "---\nstatus: seed\ntags: [finance]\n---\n# Rent\nPay the rent and buy food\n- [ ] call the landlord about rent\n- [x] buy food for the week\n\n## Trips\nA trip to Lisbon #travel/europe\n" })
;[code] = await api("POST", "file", { path: "Searchy/Other.md", text: "---\nstatus: exploring\n---\nRent elsewhere, food later.\nRENT in capitals\n" })
// (this helper passes the query string as it is: no encoding)
const paths = async (q: string, more = "") => { const [c, r] = await api("GET", `search?q=${q}&folder=Searchy${more}`); return c === 200 ? (r as Any[]).map((x) => x.path.slice(8)).sort().join(",") : `${c} ${r.error}` }
for (const [q, want] of [
  ["rent food", "Budget plan.md,Other.md"], ['"rent and buy"', "Budget plan.md"], ["rent -lisbon", "Other.md"], ["lisbon OR elsewhere", "Budget plan.md,Other.md"],
  ["file:budget", "Budget plan.md"], ["path:searchy rent", "Budget plan.md,Other.md"], ["searchy", ""], ["content:budget", ""],
  ["tag:#travel", "Budget plan.md"], ["tag:travel/europe", "Budget plan.md"], ["tag:trav", ""], ["tag:finance", "Budget plan.md"],
  ["line:(rent food)", "Budget plan.md,Other.md"], ["line:(landlord food)", ""], ["block:(landlord food)", "Budget plan.md"], ["section:(rent lisbon)", ""],
  ["section:(trip lisbon)", "Budget plan.md"], ["task-todo:landlord", "Budget plan.md"], ["task-done:landlord", ""], ["task-done:", "Budget plan.md"],
  ["match-case:RENT", "Other.md"], ["[status]", "Budget plan.md,Other.md"], ["[status:seed]", "Budget plan.md"], ["[status:seed OR exploring]", "Budget plan.md,Other.md"],
  ["[nope]", ""], ["/l[a-z]+d/", "Budget plan.md"], ["(lisbon OR elsewhere) -[status:seed]", "Other.md"],
]) check(`search: ${q}`, (await paths(q)) === want, await paths(q))
check("search: case=1 matches in case", (await paths("RENT", "&case=1")) === "Other.md", await paths("RENT", "&case=1"))
check("search: a query it can't read is a 400 saying why", (await paths('"open')).startsWith("400 A quote isn't closed"), await paths('"open'))
check("search: a bad regex too", (await paths("/(/")).startsWith("400 /(/ isn't a regular expression"), await paths("/(/"))
;[code, res] = await api("GET", "search?q=rent&folder=Searchy&sort=name-desc")
check("search: sorted by name, Z to A", code === 200 && res.map((r: Any) => r.title).join() === "Other,Budget plan", res)
;[code] = await api("GET", "search?q=rent&sort=nope")
check("search: an unknown sort is a 400", code === 400, code)
;[, res] = await api("GET", "search?q=landlord&folder=Searchy&lines=5&context=1")
check("search: lines with context around them", res[0]?.matches?.map((m: Any) => `${m.line}${m.ctx ? "c" : ""}`).join() === "2c,3,4c" && res[0].count === 1, res[0]?.matches)
;[, res] = await api("GET", "search?q=tag:travel&folder=Searchy&lines=5")
check("search: a tag marks its line", res[0]?.matches?.length === 1 && res[0].matches[0].text.includes("#travel/europe"), res[0])
;[, res] = await api("GET", "search?q=[status:seed]&folder=Searchy&lines=5")
check("search: a property alone lists no lines", res[0]?.count === 0, res[0])
{
  const sq = await import("../core/searchquery.ts")
  const n = sq.parse('budget (rent OR "buy food") -tag:done')
  check("searchquery: explain", sq.explain(n) === 'Files where the name or text has "budget", and (either the name or text has "rent", or the name or text has "buy food"), and not (it\'s tagged #done)', sq.explain(n))
  check("searchquery: plain words", sq.isPlain(sq.parse("budget rent")) && !sq.isPlain(n) && !sq.isPlain(sq.parse("a OR b")), null)
  check("searchquery: marks what matched, not what's excluded", JSON.stringify(sq.highlighter(n)("buy food, rent, done")) === "[[0,8],[10,14]]", sq.highlighter(n)("buy food, rent, done"))
  const ex = sq.excerpt("one two three four five six seven eight nine ten budget eleven", sq.wordRanges("one two three four five six seven eight nine ten budget eleven", ["budget"]), 30, 10)
  check("searchquery: an excerpt around the match", ex.text.startsWith("…") && ex.text.slice(ex.ranges[0][0], ex.ranges[0][1]) === "budget", ex)
}
await api("DELETE", "file?path=Searchy")

// Review fixes
check("strict merge doesn't drop lines the other side added inside a changed stretch", merge3("a\nb\nc\nd", "a\nX\nd", "a\nb\nNEW\nc\nd") === null)
write("People/Round Trip.md", "---\ntype: person\nrelation: friend\n---\n\n## Timeline\n\n- 2026-09-20 · call · Hi\n" +
  "Met at the gym, see photos\n- 2026-09-10 - text - hand written\n")
let rt: Any
;[, rt] = await api("GET", "people/Round Trip")
const tl = rt.timeline.filter((i: Any) => !("_raw" in i)).map((i: Any) => Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith("_"))))
tl[0].notes = "Hi again"
await api("PUT", "people/Round Trip", { timeline: tl })
t = read("People/Round Trip.md")
check("GET then PUT of a timeline keeps lines it can't read and hand-written lines",
  t.includes("Met at the gym, see photos") && t.includes("- 2026-09-10 - text - hand written") && t.includes("- 2026-09-20 · call · Hi again"), t)
;[, s] = await api("GET", "state")
const ids = s.interactions.filter((i: Any) => i.person_id === "People/Round Trip").map((i: Any) => i.id).sort()
check("interaction ids count only entries", JSON.stringify(ids) === JSON.stringify(["People/Round Trip#0", "People/Round Trip#1"]), ids)
write("People/Round Trip.md", read("People/Round Trip.md").replace("relation: friend", "relation: [friend"))
;[code] = await api("POST", "interactions", { person: "Round Trip", date: "2026-09-29", kind: "call" })
check("no writes to a file whose header can't be read", code === 409 && read("People/Round Trip.md").includes("relation: [friend"), code)
// A save changes only what it changed: an empty key stays, a cleared one stays empty, the file keeps its own name.
write("People/Sam Lee (school).md", "---\ntype: person\nname: Sam Lee\nrelation: friend\ncontext:\n---\n\nMet at school.\n")
await api("GET", "state")
;[code] = await api("PUT", "people/People/Sam Lee (school)", { relation: "family" })
check("save: one key's line changes, an empty one stays, the name stays the file's own",
  code === 200 && read("People/Sam Lee (school).md") === "---\ntype: person\nname: Sam Lee\nrelation: family\ncontext:\n---\n\nMet at school.\n", [code, exists("People/Sam Lee (school).md") && read("People/Sam Lee (school).md")])
;[code] = await api("PUT", "people/People/Sam Lee (school)", { relation: "" })
check("save: a value cleared keeps its key, empty (as Obsidian does)", read("People/Sam Lee (school).md") === "---\ntype: person\nname: Sam Lee\nrelation: null\ncontext:\n---\n\nMet at school.\n", read("People/Sam Lee (school).md"))
;[code] = await api("PUT", "people/People/Sam Lee (school)", { name: "Sam Leigh" })
check("save: renamed only when its name changed", code === 200 && exists("People/Sam Leigh.md") && !exists("People/Sam Lee (school).md"), code)
write("Notes/Gone.md", "x\n")
await api("GET", "state")
await api("DELETE", "file?path=Notes/Gone.md")
;[code] = await api("PUT", "file", { path: "Notes/Gone.md", text: "x\ny\n", base: "x\n" })
check("saving a deleted file doesn't bring it back", code === 404 && !exists("Notes/Gone.md"), code)
// Undo after trashing (the app's toast): DELETE says where it went, restore brings it back with hidden files off, and a
// second undo (it's gone from the trash) fails with a clear error.
write("Scratch/Undo me.txt", "keep\n")
await api("GET", "state")
let del: Any
;[code, del] = await api("DELETE", "file?path=Scratch/Undo me.txt")
check("DELETE answers where in .trash it went", code === 200 && /^\.trash\/Scratch\/Undo me \d{4}-\d{2}-\d{2} \d{6}\.txt$/.test(del.trashed) && exists(del.trashed), del)
;[code, p] = await api("POST", "file/restore", { path: del.trashed })
check("restore takes a .trash path with hidden files off (Undo)", code === 200 && p.path === "Scratch/Undo me.txt" && read("Scratch/Undo me.txt") === "keep\n", [code, p])
;[code, p] = await api("POST", "file/restore", { path: del.trashed })
check("restoring twice says it's not in the trash any more", code === 404 && /isn't in the trash/.test(p.error), [code, p])
;[code, p] = await api("POST", "file/restore", { path: ".trash/../Scratch/Undo me.txt" })
check("restore refuses paths out of the trash", code === 400, [code, p])
{
  // .trash is emptied of what's been there 30 days (by the time in its name), its emptied path folders too.
  const { emptyTrash } = await import("../core/files.ts")
  const old = "2026-08-01 101500", fresh = "2026-10-01 101500", now = new Date(2026, 9, 9).getTime()
  for (const f of [`Old ${old}.md`, `Fresh ${fresh}.md`, `Deep/Er/Old ${old} 2.md`, `Folder ${old}/a.md`, `.Cloud ${old}.md.icloud`]) write(`.trash/${f}`, "x\n")
  const gone = await emptyTrash(vault, now)
  check("trash: what's been there over 30 days goes for good, the rest stays", gone.length === 4 && !exists(`.trash/Old ${old}.md`) && exists(`.trash/Fresh ${fresh}.md`) &&
    !exists(`.trash/Folder ${old}`) && !exists(".trash/Deep") && !exists(`.trash/.Cloud ${old}.md.icloud`), gone)
  fs.rmSync(path.join(VAULT, `.trash/Fresh ${fresh}.md`))
}
;[code, p] = await api("POST", "file/move", { from: "Scratch/Undo me.txt", to: "Scratch/Moved/Undo me.txt" })
await api("DELETE", "file?path=Scratch/Moved/Undo me.txt")
;[code, p] = await api("POST", "file/move", { from: "Scratch/Moved/Undo me.txt", to: "Scratch/Undo me.txt" })
check("undoing a move of a file that's gone since fails (404)", code === 404, [code, p])
write("Notes/Idea.md", "one\n"); write("Projects/Idea.md", "---\ntype: project\n---\n"); write("Notes/Uses.md", "[[Idea]] and [[Notes/Idea]]\n")
await api("GET", "state")
await api("POST", "file/move", { from: "Notes/Idea.md", to: "Notes/Idea two.md" })
t = read("Notes/Uses.md")
check("a rename follows the file [[Name]] found, also when another file had that name", t.includes("[[Idea two]] and [[Notes/Idea two]]"), t)

// Blocks (```block-<name>): where the app draws something. A kind never sees them, and API writes leave them in place.
// A kind's own blocks are drawn on top of its files, never written into them.
{
  const { blocksIn, withoutBlocks } = await import("../core/sections.ts")
  const { onTop } = await import("../core/blocks.ts")
  const doc = "```block-a\nx: 1\n```\n\nText\n\n```` md\n```block-b\n```\n````\n\n~~~block-c extra\n~~~\n\n```block-d\nnot closed"
  check("blocksIn: closed fences, ~~~ too, a word after the name, none inside code or still open",
    JSON.stringify(blocksIn(doc).map((b) => [b.name, b.text, b.open, b.close])) === JSON.stringify([["a", "x: 1", 0, 2], ["c", "", 11, 12]]), blocksIn(doc))
  check("withoutBlocks: the text without them and the blank lines after them", withoutBlocks("```block-a\n```\n\nOne\n\n```block-b\n```\n\nTwo\n") === "One\n\nTwo", withoutBlocks("```block-a\n```\n\nOne\n\n```block-b\n```\n\nTwo\n"))
  const { tidyKindBlocks } = await import("../core/blocks.ts")
  check("tidyKindBlocks: the fences on top that repeat the kind's blocks, in order, without options",
    tidyKindBlocks(["log", "workout"], "\n```block-log\n```\n\n```block-workout\n```\n\nNotes\n") === "Notes\n"
    && tidyKindBlocks(["log", "workout"], "```block-log\n```\n\n```block-workout\nwide: true\n```\n") === "```block-workout\nwide: true\n```\n"
    && tidyKindBlocks(["person"], "Text\n\n```block-person\n```\n") === null
    && tidyKindBlocks(["person"], "```block-person\n```\n\n```block-person\nfile: Bob\n```\n") === null
    && tidyKindBlocks(["log"], "```block-log\n```\n") === "")
  check("onTop: a kind's blocks the body doesn't place", JSON.stringify(onTop(["log", "workout"], "Notes\n\n```block-workout\n```\n")) === JSON.stringify(["log"]) && onTop(undefined, "x").length === 0)
}
;[code, p] = await api("POST", "people", { name: "Block Person", relation: "friend", notes: "Likes tea." })
t = read("People/Block Person.md")
check("a new file has no fence for its kind's blocks", !t.includes("```") && t.split("---\n").slice(2).join("---\n").trimStart().startsWith("Likes tea."), t)
check("an item's text has no blocks", p.notes === "Likes tea.", p.notes)
;[, tr] = await api("GET", "files")
check("the file index says a file's kind's blocks", JSON.stringify(tr.files.find((f: Any) => f.path === "People/Block Person.md")?.kindBlocks) === JSON.stringify(["person"]))
let kr = ""
kr = (await api("GET", "render?path=People/Block Person.md"))[1]
check("render draws a kind's blocks on top of its file", kr.indexOf("Last in touch") >= 0 && kr.indexOf("Last in touch") < kr.indexOf("Likes tea."), kr)
write("People/Block Person.md", read("People/Block Person.md").replace("Likes tea.", "Likes tea.\n\n```block-person\n```") + "\n```block-query\nlimit: 3\n```\n")
kr = (await api("GET", "render?path=People/Block Person.md"))[1]
check("a fence of a kind's block draws it there, once", kr.indexOf("Last in touch") > kr.indexOf("Likes tea.") && kr.split("Last in touch").length === 2, kr)
write("People/Block Person.md", read("People/Block Person.md").replace("Likes tea.\n\n```block-person\n```", "```block-person\n```\n\nLikes tea."))
await api("PUT", "people/Block Person", { notes: "Likes coffee now." })
await api("POST", "interactions", { person: "Block Person", date: "2026-09-29", kind: "call", notes: "Hi" })
t = read("People/Block Person.md")
const body = t.split("---\n").slice(2).join("---\n")
check("API writes keep blocks where they were", body.trimStart().startsWith("```block-person\n```\n\nLikes coffee now.")
  && body.trimEnd().endsWith("```block-query\nlimit: 3\n```") && body.includes("- 2026-09-29 · call · Hi"), body)
;[, s] = await api("GET", "state")
const bp = s.people.find((x: Any) => x.name === "Block Person")
write("Notes/Tidy.md", "```block-person\n```\n")
write("People/Tidy Person.md", "---\ntype: person\n---\n\n```block-person\n```\n\nKept.\n")
;[, p] = await api("POST", "ops/block.tidy", { dry: true })
check("blocks tidy --dry: the files with their kind's blocks on top, and only those", JSON.stringify(p.files) === JSON.stringify(["People/Block Person.md", "People/Tidy Person.md"]) && read("People/Tidy Person.md").includes("```"), p)
await api("POST", "ops/block.tidy", {})
check("blocks tidy: takes them out, the rest as it was", read("People/Tidy Person.md") === "---\ntype: person\n---\n\nKept.\n" && read("Notes/Tidy.md") === "```block-person\n```\n"
  && read("People/Block Person.md").includes("```block-query") && !read("People/Block Person.md").includes("```block-person"), read("People/Tidy Person.md"))
check("a block after the timeline isn't read as part of it", !JSON.stringify(bp).includes("block")
  && !JSON.stringify(s.interactions.filter((i: Any) => i.person_id === "People/Block Person")).includes("block"), bp)
await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "block-meal", title: "Toast", notes: "Two slices", data: { kcal: 200 } }])
const lg = (await api("GET", "state"))[1].logs.find((x: Any) => x.ext_id === "block-meal")
check("a new log has no fence: its blocks are its kind's", !read(lg.id + ".md").includes("```"), read(lg.id + ".md"))
await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "block-meal", title: "Toast", notes: "Three slices", data: { kcal: 300 } }])
t = read(lg.id + ".md")
check("re-posting a log changes only its text", !t.includes("```") && t.includes("Three slices") && !t.includes("Two slices"), t)

// Pages are files: each plugin's dashboards are copied in once and pinned; then they're the user's (a new template is
// only offered, and a deleted one stays deleted).
const made = app.installPages()
check("dashboards are installed", exists("Dashboards/Today.md") && exists("Dashboards/People.md"), made)
const pinned: string[] = vault.config("pages").pinned ?? []
check("and pinned, only files (no phone Files page)", pinned.includes("Dashboards/Today.md") && !pinned.includes("files"), pinned)
check("a new vault's pins follow the plugins' pageSort",
  pinned.slice(0, 5).join() === "Dashboards/Today.md,Dashboards/Health.md,Dashboards/Learning.md,Dashboards/People.md,Dashboards/Projects.md", pinned)
check("the core's own page (Design) is installed and pinned", exists("Dashboards/Design.md") && pinned.includes("Dashboards/Design.md"), pinned)
check("a page's other tab is installed but not pinned", exists("Dashboards/People map.md") && !pinned.includes("Dashboards/People map.md")
  && pinned.includes("Dashboards/People.md"), pinned)
// An app update never changes a page by itself (core/pages.ts): a newer template is offered (dashboard.updates), its
// difference shown, then applied or dismissed until the template changes again.
const keptToday = ".vaultite/generated/Dashboards/Today.md", keptPeople = ".vaultite/generated/Dashboards/People.md"
fs.writeFileSync(path.join(VAULT, keptToday), read(keptToday).replace("icon: sun", "icon: star")) // as if installed from an older template
write("Dashboards/Today.md", read("Dashboards/Today.md").replace("icon: sun", "icon: star") + "\nMy own line.\n")
fs.writeFileSync(path.join(VAULT, keptPeople), read(keptPeople).replace("icon: users", "icon: star"))
write("Dashboards/People.md", read("Dashboards/People.md").replace("icon: users", "icon: star"))
/** Forget the versions a page's template had (the copy installed "before" is made up after the fact). */
const forgetVersions = (...rels: string[]) => {
  const v = JSON.parse(read(".vaultite/generated/versions.json"))
  for (const r of rels) delete v[r]
  fs.writeFileSync(path.join(VAULT, ".vaultite/generated/versions.json"), JSON.stringify(v))
}
forgetVersions("Dashboards/Today.md", "Dashboards/People.md")
app.installPages()
check("an app update changes no page, edited or not", read("Dashboards/Today.md").includes("icon: star") && read("Dashboards/Today.md").includes("My own line.") &&
  read("Dashboards/People.md").includes("icon: star"), [read("Dashboards/Today.md"), read("Dashboards/People.md")])
const offered = async () => ((await api("POST", "ops/dashboard.updates", {}))[1].updates as Any[])
let ups = await offered()
check("...it offers them, the one the user changed flagged", ups.find((u) => u.path === "Dashboards/People.md")?.edited === false &&
  ups.find((u) => u.path === "Dashboards/Today.md")?.edited === true, ups)
check("...and only that page's when asked for one", (await api("POST", "ops/dashboard.updates", { path: "Dashboards/People.md" }))[1].updates.length === 1)
const [, pdiff] = await api("POST", "ops/dashboard.diff", { path: "People" })
check("the difference: the page now against the new version", pdiff.diff.includes("- icon: star") && pdiff.diff.includes("+ icon: users") && !pdiff.edited, pdiff)
await api("POST", "ops/dashboard.update", { path: "Dashboards/People.md" })
check("update: the page is the new version, and isn't offered any more", read("Dashboards/People.md").includes("icon: users") &&
  !(await offered()).some((u) => u.path === "Dashboards/People.md"), read("Dashboards/People.md"))
await api("POST", "ops/dashboard.dismiss", { path: "Today" })
check("dismiss: the page stays, not offered again", read("Dashboards/Today.md").includes("My own line.") && !(await offered()).some((u) => u.path === "Dashboards/Today.md"))
app.vault.patchConfig("pages", { dismissedUpdates: { "Dashboards/Today.md": "an older version" } }) // as if its template changed since
check("...until its template changes again", (await offered()).some((u) => u.path === "Dashboards/Today.md"))
await api("POST", "ops/dashboard.dismiss", { path: "Today" })
fs.rmSync(path.join(VAULT, "Dashboards/Health.md"))
app.installPages()
check("a deleted dashboard isn't brought back", !exists("Dashboards/Health.md"))
// Folders are the user's: a page moved into another folder is still found (its name, type and plugin) and updated there,
// never copied in again; a path written before the move still renders; new pages go where the others are.
{
  const dash = () => fs.readdirSync(path.join(VAULT, "Dashboards")).filter((n) => n.endsWith(".md"))
  const pinsWere = read(".vaultite/pages.json")
  fs.mkdirSync(path.join(VAULT, "Personal/Dashboards"), { recursive: true })
  for (const n of dash()) fs.renameSync(path.join(VAULT, "Dashboards", n), path.join(VAULT, "Personal/Dashboards", n))
  fs.writeFileSync(path.join(VAULT, keptPeople), read(keptPeople).replace("icon: users", "icon: moon"))
  write("Personal/Dashboards/People.md", read("Personal/Dashboards/People.md").replace("icon: users", "icon: moon"))
  forgetVersions("Dashboards/People.md")
  fs.rmSync(path.join(VAULT, ".vaultite/generated/Dashboards/Design.md"))
  fs.rmSync(path.join(VAULT, "Personal/Dashboards/Design.md"))
  const madeNow = app.installPages()
  t = read("Personal/Dashboards/People.md")
  check("pages: one moved to another folder is offered its update there, not copied in again", t.includes("icon: moon") &&
    (await offered()).some((u) => u.path === "Personal/Dashboards/People.md") && !exists("Dashboards/People.md"), dash())
  await api("POST", "ops/dashboard.update", { path: "Personal/Dashboards/People.md" })
  check("pages: a new one goes where the others are", madeNow.join() === "Personal/Dashboards/Design.md" && exists("Personal/Dashboards/Design.md") &&
    !exists("Dashboards/Design.md"), madeNow)
  await vault.sync()
  const [, moved] = await api("GET", "render?path=Dashboards/Today.md")
  check("render: a path from before a move still reads the file", typeof moved === "string" && moved.includes("# Today") && moved.includes("plugin: today"), String(moved).slice(0, 80))
  const [, movedState] = await api("GET", "state")
  check("pins: one whose file moved outside the app shows where it is now", JSON.parse(pinsWere).pinned.includes("Dashboards/Today.md") &&
    movedState.pinned.includes("Personal/Dashboards/Today.md") && !movedState.pinned.includes("Dashboards/Today.md"), movedState.pinned)
  for (const n of fs.readdirSync(path.join(VAULT, "Personal/Dashboards"))) fs.renameSync(path.join(VAULT, "Personal/Dashboards", n), path.join(VAULT, "Dashboards", n))
  fs.rmSync(path.join(VAULT, "Personal"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite/pages.json"), pinsWere)
}
let tree: Any
;[, tree] = await api("GET", "files")
const today = tree.files.find((x: Any) => x.path === "Dashboards/Today.md")
check("the file index has a file's blocks and look", today.blocks[0][0] === "routines" && today.blocks[0][1].includes("wide: true")
  && today.icon === "star" && today.plugin === "today" && today.type === "dashboard", today) // (the icon the user gave it, above)

// A folder deleted on disk (Finder, rm -rf): kept for a moment (it may be mid-move), then its files are let go.
write("Gone soon/a.md", "hello\n")
await vault.sync()
fs.rmSync(path.join(VAULT, "Gone soon"), { recursive: true })
await vault.sync()
check("a vanished folder's files stay for a moment", vault.entries.has("Gone soon/a.md") && vault.waiting())
await new Promise((r) => setTimeout(r, 3100))
await vault.sync()
check("then they're let go", !vault.entries.has("Gone soon/a.md") && !vault.waiting())

// /api/render: a file with its blocks filled in as text (for AIs); nothing is written.
const beforeToday = read("Dashboards/Today.md")
let txt: Any
;[code, txt] = await api("GET", "render?path=Dashboards/Today.md")
check("render fills a dashboard's blocks in", code === 200 && txt.includes("## Routines") && txt.includes("## This week") && !txt.includes("```block-"), txt.slice(0, 300))
check("render doesn't touch the file", read("Dashboards/Today.md") === beforeToday)
check("render of a person file", (await api("GET", "render?path=People/Block Person.md"))[1].includes("Last in touch"))
// Markdown's extras (callouts, footnotes, math, mermaid, code fences, <details>) are plain Markdown: render passes it through.
{
  const rich = "> [!tip]- Title\n> Body [^1]\n\n$$\nx^2\n$$\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nconst a = 1\n```\n\n<details>\n<summary>More</summary>\n\nInside\n\n</details>\n\n[^1]: A note, $y$.\n"
  write("Notes/Rich markdown.md", rich)
  const [c2, out] = await api("GET", "render?path=Notes/Rich markdown.md")
  check("render keeps Markdown's extras as they are", c2 === 200 && out.includes(rich.trim()), out)
}
// Embeds and blocks written inside a code fence are code: shown as they are, not drawn (a ```` fence can hold a ``` one).
{
  const shown = "```\n![[Rich markdown]]\n```\n\n````md\n```block-books\n```\n````\n"
  write("Notes/Fenced embed.md", shown + "\n![[Rich markdown]]\n")
  const [c3, out] = await api("GET", "render?path=Notes/Fenced embed.md")
  check("render leaves embeds and blocks in code fences alone", c3 === 200 && out.includes(shown) && out.includes("> [[Rich markdown]]"), out)
}
check("render of a missing file is a 404", (await api("GET", "render?path=Nope.md"))[0] === 404)
// The block contract (core/blocks.ts): options checked against the manifests' declarations, noted after the block's text.
write("Notes/Block options.md", "```block-week-goals\ntitel: Mine\n```\n\n```block-graph\ndepth: 5\nheight: tall\n```\n\n" +
  "```block-area\n```\n\n```block-week-goals\nareas: [workouts]\nwide: true\nstack: true\n```\n\n```block-routines\n- not: options\n```\n\n```block-nope\n```\n")
txt = (await api("GET", "render?path=Notes/Block options.md"))[1]
check("render: an unknown option is noted after the block, with the name it's closest to",
  txt.includes("_(week-goals block: unknown option `titel` (did you mean `title`?))_") && txt.includes("## This week"), txt)
check("render: wrong types and values are noted, the block still drawn",
  txt.includes("_(graph block: `depth` should be one of 1, 2, 3, not 5; `height` should be a number, not \"tall\")_"), txt)
check("render: a required option left out is noted", txt.includes("_(area block: `area` is required)_"), txt)
check("render: the options every block takes are fine anywhere", !/week-goals block: .*(wide|stack)/.test(txt), txt)
check("render: options that aren't a map are noted", txt.includes("_(routines block: its options should be `key: value` lines)_"), txt)
check("render: a block no plugin draws says so", txt.includes("_(no plugin draws block-nope)_") && !txt.includes("```block-nope"), txt)
{
  // A declared block whose plugin has no text side reads as its declaration's description.
  const { blockText } = await import("../core/render.ts")
  const { Plugin } = await import("../core/plugins.ts")
  const dir = path.join(tmp, "fake-plugin")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "fake", name: "Fake", description: "Made up",
    blocks: { fake: { description: "a made-up card", options: { size: { type: "number", default: 3, description: "how big" } } } } }))
  const fake = new Plugin(path.join(dir, "manifest.json"))
  fake.vault = vault
  const t = await blockText(vault, [fake], "", {}, "", "fake", "size: big")
  check("render: a block with no text side reads as its description, its options still checked",
    t === "_(Fake: a made-up card; drawn in the app only)_\n\n_(fake block: `size` should be a number, not \"big\")_", t)
  let seen: unknown = null
  fake.block("fake", (ctx) => { seen = ctx.options; return "Drawn" })
  check("render: a block's text gets the declared defaults", await blockText(vault, [fake], "", {}, "", "fake", "") === "Drawn" && (seen as Any)?.size === 3, seen)
}
// GET /api/blocks: every block, its plugin, on or off, its options.
{
  const [bc, bl] = await api("GET", "blocks")
  const qb = bl.blocks.find((b: Any) => b.name === "query")
  check("/api/blocks: every app plugin's block, declared, with its options and text side", bc === 200 && qb?.plugin === "query" && qb.declared && qb.text === true
    && qb.options.limit?.type === "number" && typeof qb.description === "string" && bl.common.wide && bl.common.file, qb)
  check("/api/blocks: whether its plugin is on", bl.blocks.find((b: Any) => b.name === "routines")?.on === true, bl.blocks.length)
}
// GET /api/blocks/sources: where a block's data comes from, recorded while its text side runs (core/sources.ts).
{
  write("Notes/Qa sources.md", "---\ntype: note\n---\n\n```block-person\nfile: Alice Park\n```\n\n```block-people-group\n```\n\n" +
    "```block-query\ntype: person\n```\n\n```block-agenda\n```\n")
  const [sc, all] = await api("GET", "blocks/sources?path=Notes/Qa sources.md")
  const by = (n: string) => all.blocks.find((b: Any) => b.name === n)
  const at = (fence: string) => read("Notes/Qa sources.md").split("\n").indexOf(fence)
  const files = (b: Any) => b.sources.filter((x: Any) => x.kind === "file").map((x: Any) => x.path)
  check("sources: every block in the file, each with its fence's line", sc === 200 && all.blocks.length === 4 && by("person").line === at("```block-person") && by("query").line === at("```block-query") && at("```block-query") > 0, all)
  check("sources: a person's profile reads that person's file (its file:), not every person", JSON.stringify(files(by("person"))) === '["People/Alice Park.md"]' &&
    by("person").file === "People/Alice Park.md" && !by("person").sources.some((x: Any) => x.kind === "files"), by("person"))
  const group = by("people-group")
  check("sources: a list names the files it shows", files(group).includes("People/Alice Park.md") && !files(group).includes("Notes/Qa sources.md"), group)
  check("sources: a query's are its matches, not the file it's in", files(by("query")).includes("People/Alice Park.md") && !files(by("query")).includes("Notes/Qa sources.md"), by("query"))
  check("sources: live data is said in the manifest's words", by("agenda").sources.some((x: Any) => x.kind === "live" && /calendars/.test(x.label)), by("agenda"))
  const [c1, one] = await api("GET", "blocks/sources?path=Notes/Qa sources.md&name=query&text=type: person")
  check("sources: one block by its name and options' text", c1 === 200 && one.name === "query" && one.line === at("```block-query") && one.description, one)
  check("sources: a missing file is a 404, a bad name a 400", (await api("GET", "blocks/sources?path=Nope.md"))[0] === 404 &&
    (await api("GET", "blocks/sources?path=Notes/Qa sources.md&name=no%20pe"))[0] === 400)
  check("sources: nothing is traced outside a request for them", (await api("GET", "render?path=Notes/Qa sources.md"))[0] === 200)
}
// Tabs: a page's views are files (core/tabs.ts); the index carries tab/tabs and render says which tab this is.
const people = tree.files.find((x: Any) => x.path === "Dashboards/People.md")
check("the file index has a page's tabs", people.tab === "List" && JSON.stringify(people.tabs) === '["People map"]', people)
txt = (await api("GET", "render?path=Dashboards/People map.md"))[1]
check("render names the tabs, this one in bold", txt.includes("Tabs: [[People|List]] · **Map**"), txt.slice(0, 400))
{
  const { pageTabs } = await import("../core/tabs.ts")
  const files = [{ path: "CLAUDE.md" }, { path: "Personal/Dashboards/Agents.md", tab: "Overview", tabs: ["Claude", "Codex"] }, { path: "Personal/Dashboards/Claude.md" }, { path: "Personal/Dashboards/Codex.md" }]
  check("tabs: a name is found beside its head first (not the vault's CLAUDE.md)", pageTabs(files, "Personal/Dashboards/Agents.md").map((t) => t.path).join() === "Personal/Dashboards/Agents.md,Personal/Dashboards/Claude.md,Personal/Dashboards/Codex.md",
    pageTabs(files, "Personal/Dashboards/Agents.md"))
}
// `file:` in a block's options: drawn for another file (a name, or a folder's newest file).
write("Notes/Showcase.md", "```block-person\nfile: Alice Park\n```\n\n```block-person\nfile: Nobody Here\n```\n")
txt = (await api("GET", "render?path=Notes/Showcase.md"))[1]
check("a block's file: draws it for that file", txt.includes("Seattle") && txt.includes("no file Nobody Here"), txt)
await api("POST", "logs", [{ area: "workouts", date: "2026-09-28", source: "claude", ext_id: "block-gym", title: "Push",
  data: { exercises: [{ name: "Bench Press", sets: [{ type: "normal", weight_kg: 50, reps: 8 }] }] } }])
const gym = (await api("GET", "state"))[1].logs.find((x: Any) => x.ext_id === "block-gym")
t = read(gym.id + ".md")
check("a new log's kind's blocks are its area's too", !t.includes("```") && JSON.stringify((await api("GET", "files"))[1].files.find((f: Any) => f.path === gym.id + ".md")?.kindBlocks) === JSON.stringify(["log", "workout"]), t)
check("a workout renders as text", (await api("GET", `render?path=${gym.id}.md`))[1].includes("Bench Press: 50 kg x 8"))
// Logs knows no areas of its own: with no areas setting, the plugins that draw them bring theirs (the service
// `log-areas`), and an area set without an icon or colour takes the one its plugin gives.
{
  let areas = (await api("GET", "state"))[1].areas
  const gymArea = areas.find((a: Any) => a.slug === "workouts")
  check("areas come from the plugins that draw them", gymArea?.tint === "pink" && gymArea.icon === "dumbbell" && gymArea.parent === "health" &&
    ["sleep", "nutrition", "study", "reading"].every((s) => areas.some((a: Any) => a.slug === s)), areas.map((a: Any) => a.slug))
  // An offByDefault plugin's backend (Learning): its service brings nothing until it's in `enabled`.
  const was: string[] = vault.config("plugins").enabled, without = was.filter((id) => id !== "learning")
  vault.setConfig("plugins", { ...vault.config("plugins"), enabled: without }) // (a settings change: /api/state is new)
  areas = (await api("GET", "state"))[1].areas
  check("an offByDefault plugin's service is off until it's turned on", !areas.some((a: Any) => a.slug === "study"), areas.map((a: Any) => a.slug))
  vault.setConfig("plugins", { ...vault.config("plugins"), enabled: was })
  areas = (await api("GET", "state"))[1].areas
  check("turned on (enabled), it brings its areas", areas.some((a: Any) => a.slug === "study"), areas.map((a: Any) => a.slug))
  vault.setConfig("plugins", { ...vault.config("plugins"), enabled: without })
  areas = (await api("GET", "state"))[1].areas
  check("a plugin that's off brings none", !areas.some((a: Any) => a.slug === "study") && areas.some((a: Any) => a.slug === "workouts"), areas.map((a: Any) => a.slug))
  vault.setConfig("plugins", { ...vault.config("plugins"), enabled: was, disabled: [] })
  vault.setConfig("plugins/logs/data", { areas: [{ slug: "workouts", name: "Lifting", fields: [{ key: "volume_kg", label: "Volume", type: "number", unit: "kg" }] },
    { slug: "chess", name: "Chess", icon: "trophy", tint: "teal" }] })
  areas = (await api("GET", "state"))[1].areas
  check("the areas setting wins; an area without an icon or colour takes its plugin's", areas.length === 2 && areas[0].name === "Lifting" &&
    areas[0].tint === "pink" && areas[0].icon === "dumbbell" && areas[1].tint === "teal" && areas[1].icon === "trophy", areas)
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  await api("POST", "logs", [{ area: "workouts", date: day, source: "claude", ext_id: "area-total", title: "Legs", data: { volume_kg: 1234.5, place: "Home" } }])
  write("Notes/Area options.md", "```block-area\narea: workouts\nmeta: [place, volume_kg]\ntotal: volume_kg\n```\n")
  txt = (await api("GET", "render?path=Notes/Area options.md"))[1]
  check("area: meta names fields shown on each row (numbers with their unit), total sums one over the week",
    txt.includes("Volume: 1,234.5 kg.") && txt.includes(`${day}: Legs · Home · 1,234.5 kg`), txt)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/logs/data.json"))
}

// Pins follow moves made through the API (an AI moving files), not only the app's: files, whole folders, and deletes.
// "files" is an old app's phone Files page: a pin that isn't a file, kept in place.
const pins = () => JSON.stringify(vault.config("pages").pinned ?? [])
const list = (...xs: string[]) => JSON.stringify(xs)
vault.setConfig("pages", { pinned: ["Dashboards/Today.md", "files", "Dashboards/People.md", "Notes/Linker.md"] })
const movesHeard: string[] = []
const unhear = vault.onMove((from, to) => movesHeard.push(`${from} -> ${to}`))
await api("POST", "file/move", { from: "Notes/Linker.md", to: "Linker.md" })
unhear()
check("a move through the API is told (the live socket's `moved`: open tabs follow it)", movesHeard.join() === "Notes/Linker.md -> Linker.md", movesHeard)
check("a moved file keeps its pin, in place", pins() === list("Dashboards/Today.md", "files", "Dashboards/People.md", "Linker.md"), pins())
await api("POST", "file/move", { from: "Dashboards", to: "People/Dashboards" })
check("a moved folder's pins follow", pins() === list("People/Dashboards/Today.md", "files", "People/Dashboards/People.md", "Linker.md"), pins())
await api("POST", "file/move", { from: "People/Dashboards", to: "Dashboards" })
check("and back to the top level", JSON.stringify(JSON.parse(pins()).slice(0, 3)) === list("Dashboards/Today.md", "files", "Dashboards/People.md"), pins())
;[code] = await api("POST", "file/move", { from: "Dashboards", to: "Dashboards/Inner/Dashboards" })
check("a folder can't move into itself", code === 400 && fs.statSync(path.join(VAULT, "Dashboards")).isDirectory()
  && JSON.parse(pins())[0] === "Dashboards/Today.md", code)
await api("DELETE", "file?path=Linker.md")
check("a trashed file loses its pin", !JSON.parse(pins()).includes("Linker.md"), pins())
await api("POST", "folder", { path: "Boards" })
await api("POST", "file/move", { from: "Dashboards/People.md", to: "Boards/People.md" })
await api("DELETE", "file?path=Boards")
check("a trashed folder loses its pins", pins() === list("Dashboards/Today.md", "files"), pins())
vault.setConfig("pages", { pinned: ["People/Block Person.md"] })
await api("DELETE", "people/Block Person")
check("an item deleted through its collection loses its pin", pins() === list(), pins())

// Pins change one at a time (POST /api/pins), on the list as it is; install never pins an unpinned dashboard again.
vault.setConfig("pages", { pinned: ["files", "Dashboards/Today.md", "Dashboards/Claude.md"] })
await api("POST", "pins", { path: "Dashboards/Claude.md", pinned: false })
check("unpin", pins() === list("files", "Dashboards/Today.md"), pins())
app.installPages()
check("install doesn't pin it again", pins() === list("files", "Dashboards/Today.md"), pins())
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/A.md"), "A note to pin.\n")
await api("POST", "pins", { path: "Notes/A.md", pinned: true, before: "Dashboards/Today.md" })
check("pin before another", pins() === list("files", "Notes/A.md", "Dashboards/Today.md"), pins())
await api("POST", "pins", { path: "files", pinned: true, before: null })
check("move to the end", pins() === list("Notes/A.md", "Dashboards/Today.md", "files"), pins())
await api("POST", "pins", { path: "Dashboards/Today.md", pinned: true })
check("pinning a pinned one keeps its place", pins() === list("Notes/A.md", "Dashboards/Today.md", "files"), pins())
const [missing] = await api("POST", "pins", { path: "Notes/Nowhere.md", pinned: true })
check("a file that isn't there isn't pinned", missing === 404 && pins() === list("Notes/A.md", "Dashboards/Today.md", "files"), [missing, pins()])
// Bookmarks: a heading in a note, a search; a heading of a note that isn't there isn't pinned.
await api("POST", "pins", { path: "Notes/A.md#Plan", pinned: true })
await api("POST", "pins", { path: "search:tag:#book", pinned: true })
const [noHeading] = await api("POST", "pins", { path: "Notes/Nowhere.md#Plan", pinned: true })
const [noSearch] = await api("POST", "pins", { path: "search: ", pinned: true })
check("a heading and a search are pinned; a missing note's heading and an empty search aren't", noHeading === 404 && noSearch === 404 &&
  pins() === list("Notes/A.md", "Dashboards/Today.md", "files", "Notes/A.md#Plan", "search:tag:#book"), [noHeading, noSearch, pins()])
await api("POST", "pins", { path: "Notes/A.md#Plan", pinned: false })
await api("POST", "pins", { path: "search:tag:#book", pinned: false })
await api("POST", "pins", { path: "files", pinned: false })
const [filesPin] = await api("POST", "pins", { path: "files", pinned: true })
check("the old Files page can be unpinned, not pinned again", filesPin === 404 && pins() === list("Notes/A.md", "Dashboards/Today.md"), [filesPin, pins()])
const pagesJson = path.join(VAULT, ".vaultite/pages.json")
fs.writeFileSync(pagesJson, "{not json")
app.installPages()
check("an unreadable pages.json isn't replaced by every dashboard", fs.readFileSync(pagesJson, "utf8") === "{not json")
fs.rmSync(pagesJson)
app.installPages()
check("a missing one gets the default list", JSON.parse(pins()).includes("Dashboards/Today.md"), pins())
// Pinning is the Pinned plugin's (plugins/core/pages): off, installing pins nothing and writes no pages.json; a
// pages.json that's in iCloud only isn't replaced by the default list either.
const pluginsWas = vault.config("plugins")
fs.rmSync(pagesJson)
fs.writeFileSync(path.join(VAULT, ".vaultite/.pages.json.icloud"), "")
app.installPages()
check("a pages.json in iCloud only isn't replaced", !fs.existsSync(pagesJson))
fs.rmSync(path.join(VAULT, ".vaultite/.pages.json.icloud"))
vault.setConfig("plugins", { ...pluginsWas, disabled: ["pages"] })
app.installPages()
check("with Pinned off, installing pins nothing", !fs.existsSync(pagesJson))
vault.setConfig("plugins", pluginsWas)
app.installPages()
check("on again, a vault with no pins gets the default list", JSON.parse(pins()).includes("Dashboards/Today.md"), pins())
// iCloud holds a settings file while it uploads (EDEADLK): it reads as it last did, never {}, a save right after this
// server's own write goes through, and one changed elsewhere meanwhile is refused.
{
  vault.setConfig("plugins/workspaces/1", { name: "Lighthouse" })
  const held = path.join(VAULT, ".vaultite/plugins/workspaces/1.json")
  const readWas = fs.readFileSync
  const hold = () => { fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...a: unknown[]) => {
    if (p === held) throw Object.assign(new Error("EDEADLK"), { code: "EDEADLK" })
    return (readWas as (...x: unknown[]) => unknown)(p, ...a)
  }) as typeof fs.readFileSync }
  hold()
  try {
    vault.forgetConfig("plugins/workspaces/1")
    check("a settings file iCloud holds reads as it last did", vault.config("plugins/workspaces/1").name === "Lighthouse")
    const [st] = await api("PUT", "workspaces/1", { name: "Harbor" })
    fs.readFileSync = readWas
    check("a save while iCloud holds this server's own write goes through", st === 200 && JSON.parse(fs.readFileSync(held, "utf8")).name === "Harbor", st)
    fs.writeFileSync(held, JSON.stringify({ name: "Elsewhere, longer" }))
    hold()
    const [st2] = await api("PUT", "workspaces/1", { name: "Mine" })
    fs.readFileSync = readWas
    check("one changed elsewhere meanwhile isn't overwritten", st2 === 503 && JSON.parse(fs.readFileSync(held, "utf8")).name === "Elsewhere, longer", st2)
  } finally { fs.readFileSync = readWas }
  clearWs()
}
// A dashboard's subtitle under its title (/api/render) is Dashboards' (the service "page-head"): off, it's a plain file.
write("Dashboards/Sub.md", "---\ntype: dashboard\nsubtitle: A line under it\n---\n\nText.\n")
let [, sub] = await api("GET", "render?path=Dashboards/Sub.md")
check("render: a dashboard's subtitle under its title", sub.includes("# Sub\n\nA line under it\n\nText."), sub)
vault.setConfig("plugins", { ...pluginsWas, disabled: ["dashboards"] })
;[, sub] = await api("GET", "render?path=Dashboards/Sub.md")
check("render: with Dashboards off, no subtitle", sub.includes("# Sub\n\nText."), sub)
vault.setConfig("plugins", pluginsWas)
fs.rmSync(path.join(VAULT, "Dashboards/Sub.md"))

// Artifacts (.html) and tables (.csv): in the file list, written like other files, shown as text, their storage.
write("Money/Spend.html", '<!doctype html><html><head><title>Spend</title><meta name="vaultite:icon" content="wallet"></head>' +
  '<body><h1>Spending</h1><script>vau.csv("Tx.csv")</script></body></html>')
write("Money/Tx.csv", 'date,amount,note\n2026-01-01,-5.20,"Coffee, large"\n2026-01-02,1200,Pay\n')
write("Money/Board.md", "# Board\n\n![[Spend.html]]\n\n![[Tx.csv]]\n")
;[, s] = await api("GET", "files")
const art = s.files.find((f: Any) => f.path === "Money/Spend.html")
check("an artifact is a file, with its title and icon", art && art.title === "Spend" && art.icon === "wallet", art)
check("a table is a file", s.files.some((f: Any) => f.path === "Money/Tx.csv") && !s.others.some((f: Any) => f.path === "Money/Tx.csv"))
let out: Any
;[code] = await api("PUT", "file", { path: "Money/Tx.csv", text: read("Money/Tx.csv") + "2026-01-03,-9,Books\n", base: read("Money/Tx.csv") })
check("a table can be written", code === 200 && read("Money/Tx.csv").endsWith("Books\n"), code)
;[, out] = await api("GET", "render?path=Money/Board.md")
check("embeds render as text", out.includes("Reads: `Money/Tx.csv`") && out.includes("| 2026-01-01 | -5.20 | Coffee, large |") && out.includes("_3 rows._"), out)
write("Money/Long.csv", "n,sq\n" + Array.from({ length: 120 }, (_, i) => `${i},${i * i}`).join("\n") + "\n")
;[, out] = await api("GET", "render?path=Money/Long.csv")
check("a table's text has every row", out.includes("| 119 | 14161 |") && out.includes("_120 rows._"), out.slice(-200))
fs.rmSync(path.join(VAULT, "Money/Long.csv"))
;[code] = await api("PUT", "artifact/state", { path: "Money/Spend.html", data: { view: "12m" } })
check("an artifact's storage is kept in .vaultite", code === 200 && JSON.parse(read(".vaultite/artifacts/Money/Spend.html.json")).view === "12m", code)
;[code] = await api("PUT", "artifact/state", { path: ".vaultite/x.html", data: {} })
check("only artifacts in the vault have storage", code === 400, code)
;[, out] = await api("POST", "artifact/stat", { paths: ["Money/Tx.csv", "Nope.csv", ".vaultite/plugins.json"] })
check("stat: mtimes, null when missing or hidden", typeof out["Money/Tx.csv"] === "number" && out["Nope.csv"] === null && out[".vaultite/plugins.json"] === null, out)
await api("POST", "file/move", { from: "Money", to: "Finance" })
check("an artifact's storage follows it", exists(".vaultite/artifacts/Finance/Spend.html.json") && !exists(".vaultite/artifacts/Money/Spend.html.json"))
// The HTML plugin serves them outside /api/ (plugin.serve), sandboxed; with HTML and Tables off they're plain files.
let page = await app.serve("v", "Finance/Spend.html", "Finance/Spend.html?theme=dark", { theme: "dark" })
const pageText = String((page?.body as Any)?.text ?? "")
check("an artifact is served sandboxed, with its bridge first", page?.status === 200 && /connect-src 'none'/.test((page?.body as Any)?.headers["Content-Security-Policy"])
  && /^<!doctype html><html><head><script>/.test(pageText) && pageText.includes("parseCsv"), [page?.status, pageText.slice(0, 80)])
page = await app.serve("v", ".vaultite/plugins.json", ".vaultite/plugins.json", {})
check("hidden files aren't served to artifacts", page?.status === 400, page?.status)
page = await app.serve("v", "../outside.html", "../outside.html", {})
check("nothing outside the vault is", page?.status === 400, page?.status)
{
  // A page from outside the vault: only once the desktop app allowed it, sandboxed, with no storage of the vault's;
  // nothing next to it.
  const O = await import("../core/outside.ts")
  const dir = path.join(tmp, "Downloads")
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.join(dir, "Chart.html")
  fs.writeFileSync(ext, "<!doctype html><html><head><title>Chart</title></head><body>made up</body></html>")
  fs.writeFileSync(path.join(dir, "secret.txt"), "x")
  page = await app.serve("v", ext, ext.slice(1), {})
  check("an outside page nobody allowed isn't served", page?.status === 404, page?.status)
  O.allow([ext])
  page = await app.serve("v", ext, ext.slice(1), {})
  const text = String((page?.body as Any)?.text ?? "")
  check("an allowed outside page is served sandboxed, its storage empty", page?.status === 200 && /connect-src 'none'/.test((page?.body as Any)?.headers["Content-Security-Policy"]) &&
    /^<!doctype html><html><head><script>/.test(text) && text.includes('"state":{}') && text.includes("made up"), [page?.status, text.slice(0, 80)])
  page = await app.serve("v", path.join(dir, "secret.txt"), "", {})
  check("nothing next to an outside page is served", page?.status === 404, page?.status)
}
const plugOn = vault.config("plugins")
await api("PUT", "config/plugins", { ...plugOn, disabled: [...(plugOn.disabled ?? []), "html", "tables"] })
;[, s] = await api("GET", "files")
check("HTML and Tables off: pages are plain files", ["Finance/Spend.html", "Finance/Tx.csv"].every((p) => s.others.some((f: Any) => f.path === p) && !s.files.some((f: Any) => f.path === p)), s.others.map((f: Any) => f.path))
check("HTML off: an artifact isn't served", (await app.serve("v", "Finance/Spend.html", "Finance/Spend.html", {})) === null)
;[, out] = await api("GET", "render?path=Finance/Board.md")
check("HTML and Tables off: embeds stay as written", out.includes("![[Spend.html]]") && out.includes("![[Tx.csv]]") && !out.includes("Reads:"), out)
;[code] = await api("GET", "render?path=Finance/Tx.csv")
check("Tables off: a table has no text view", code === 404, code)
await api("PUT", "config/plugins", plugOn)
;[, s] = await api("GET", "files")
check("back on: pages again", s.files.some((f: Any) => f.path === "Finance/Spend.html" && f.title === "Spend") && s.files.some((f: Any) => f.path === "Finance/Tx.csv"))

// Two servers on one synced vault, one running an older app: the older one leaves the newer generated files alone.
const { templates, Versions } = await import("../core/pages.ts")
const [, tplPath, tplText] = templates(app.plugins).find(([, rel]) => exists(rel))!
const newer = read(tplPath) + "\nFrom a newer app.\n"
fs.writeFileSync(path.join(VAULT, `.vaultite/generated/${tplPath}`), newer) // what a newer app installs...
write(tplPath, newer)
const vs = new Versions(vault)
vs.add(tplPath, tplText, newer) // ...and remembers
vs.save()
app.installPages()
check("an older app's templates don't undo a newer one's", read(tplPath).includes("From a newer app.") && read(tplPath) === read(`.vaultite/generated/${tplPath}`))

// Files dropped in from a browser: a free name like Finder's, bytes never over an existing file.
let up: Any
await api("POST", "folder", { path: "Inbox" })
;[code, up] = await api("POST", "upload/name", { folder: "Inbox", name: "Dropped.md" })
check("upload: a free name", code === 200 && up.path === "Inbox/Dropped.md", up)
;[code] = await api("POST", "upload", { path: up.path, bytes: Buffer.from("# Dropped\n") })
check("upload: the bytes land", code === 201 && read("Inbox/Dropped.md") === "# Dropped\n", code)
;[, up] = await api("POST", "upload/name", { folder: "Inbox", name: "Dropped.md" })
check("upload: a clash gets \" 1\"", up.path === "Inbox/Dropped 1.md", up)
;[code] = await api("POST", "upload", { path: "Inbox/Dropped.md", bytes: Buffer.alloc(0) })
check("upload: never over a file", code === 409, code)
;[code] = await api("POST", "upload", { path: ".vaultite/x.json", bytes: Buffer.alloc(0) })
check("upload: not into hidden folders", code === 400, code)
{
  // Streamed, any size: never all in memory, nothing left beside it.
  const { Readable } = await import("node:stream")
  const piece = Buffer.alloc(1 << 20, 7)
  ;[code] = await api("POST", "upload", { path: "Inbox/Big.bin", bytes: Readable.from((function* () { for (let i = 0; i < 40; i++) yield piece })()) })
  check("upload: a stream of 40 MB lands whole", code === 201 && fs.statSync(path.join(VAULT, "Inbox/Big.bin")).size === 40 << 20 &&
    !fs.readdirSync(path.join(VAULT, "Inbox")).some((f) => f.includes(".upload-")), code)
  // An op that takes bytes gets them as the raw body, its parameters in the query (file.upload, any size).
  const raw = Object.assign(Readable.from([piece, piece]), { headers: { "content-type": "application/octet-stream" } }) as unknown as IncomingMessage
  const [c2, r2] = await api("POST", "ops/file.upload?name=Raw.bin&folder=Inbox", {}, raw)
  check("file.upload: the raw body is the file", c2 === 200 && r2.path === "Inbox/Raw.bin" && fs.statSync(path.join(VAULT, "Inbox/Raw.bin")).size === 2 << 20, [c2, r2])
  for (const f of ["Big.bin", "Raw.bin"]) fs.rmSync(path.join(VAULT, "Inbox", f))
}

// Files from outside the vault (desktop app): only paths its main process allowed.
const { allow } = await import("../core/outside.ts")
const outsideFile = path.join(tmp, "Outside.md")
fs.writeFileSync(outsideFile, "Outside text.\n")
;[code] = await api("GET", `file?path=${outsideFile}`)
check("outside: not allowed, not there", code === 404, code)
allow([outsideFile])
let o: Any
;[code, o] = await api("GET", `file?path=${outsideFile}`)
check("outside: an allowed file opens", code === 200 && o.text === "Outside text.\n", o)
;[code, o] = await api("PUT", "file", { path: outsideFile, text: "Outside text.\nMore.\n", base: "Outside text.\n" })
check("outside: saves in place", code === 200 && fs.readFileSync(outsideFile, "utf8") === "Outside text.\nMore.\n", o)
check("outside: not indexed", ![...vault.entries.keys()].some((k) => k.includes("Outside")))

// Manage vaults on the web (core/vaults.ts): a list on this machine, folders from home down, never hidden ones.
const vaultsMod = await import("../core/vaults.ts")
const opened: string[] = []
const home = os.homedir()
const vh = (method: string, route: string, query: Record<string, string>, body: Record<string, unknown> = {}): Promise<Any> =>
  vaultsMod.handle(method, ["vaults", ...route.split("/").filter(Boolean)], query, body, VAULT, async (p) => { opened.push(p) }).catch((e) => e)
let vr = await vh("GET", "folders", {})
check("vaults: home's folders, hidden ones left out", vr.path === home && !vr.folders.some((f: Any) => f.name.startsWith(".")), vr)
vr = await vh("GET", "folders", { path: path.join(home, ".ssh") })
check("vaults: a hidden folder can't be browsed", vr.status === 403 || vr.status === 404, vr)
vr = await vh("POST", "open", {}, { path: home })
check("vaults: home itself can't be a vault", vr.status === 403 && !opened.length, vr)
vr = await vh("POST", "open", {}, { path: "/etc" })
check("vaults: nothing outside home", vr.status === 403 && !opened.length, vr)
vr = await vh("GET", "", {})
check("vaults: the served one is listed", vr.current === VAULT && vr.vaults.some((v: Any) => v.path === VAULT), vr)


// Vault plugins (core/vaultplugins.ts): the made-up Lighthouse (tools/fixtures/lighthouse) in .vaultite/plugins/.
const LH = ".vaultite/plugins/lighthouse"
fs.cpSync(path.join(import.meta.dirname, "fixtures", "lighthouse"), path.join(VAULT, LH), { recursive: true })
write("Keepers/Bob Lee.md", "---\ntype: keeper\nshift: night\n---\n\nKeeps the lamp.\n")
write(".vaultite/plugins/people/manifest.json", JSON.stringify({ id: "people", name: "People again", description: "A clash." }))
write(".vaultite/plugins/tide/data.json", "{}\n") // settings only: not a plugin
const vplugin = async (id = "lighthouse") => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === id)
let lh = await vplugin()
check("vault plugins: listed", lh && lh.name === "Lighthouse" && lh.folder === LH && !lh.problems.length, lh)
check("vault plugins: a new one is off, and nothing of it runs", !lh.on && !lh.loaded && lh.bundle === null && (await api("GET", "lighthouse"))[0] === 404
  && (await api("GET", `plugins/lighthouse/${lh.hash}/bundle.js`))[0] === 404 && !app.plugins.some((p) => p.id === "lighthouse"))
check("vault plugins: a folder with only settings isn't one", !(await vplugin("tide")))
check("vault plugins: one can't take an app plugin's id", (await vplugin("people"))?.problems[0]?.includes("already has a plugin called 'people'"), await vplugin("people"))
{
  // A file that can't be read (iCloud hasn't brought it down): a problem, never a crash, and looked at again.
  const shut = path.join(VAULT, ".vaultite/plugins/shut")
  write(".vaultite/plugins/shut/manifest.json", JSON.stringify({ id: "shut", name: "Shut", description: "Made up." }))
  write(".vaultite/plugins/shut/plugin.ts", "export {}\n")
  fs.chmodSync(path.join(shut, "plugin.ts"), 0)
  check("vault plugins: an unreadable file is a problem, not a crash", (await vplugin("shut"))?.problems[0]?.includes("can't be read yet"), await vplugin("shut"))
  fs.chmodSync(path.join(shut, "plugin.ts"), 0o644)
  check("...and read once it can be", !(await vplugin("shut"))?.problems.some((p: string) => p.includes("can't be read")), await vplugin("shut"))
  fs.rmSync(shut, { recursive: true })
}
;[, s] = await api("GET", "state")
check("vault plugins: in /api/state", s.vaultPlugins.some((p: Any) => p.id === "lighthouse"))
const turn = (on: boolean) => api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: on ? [...ON, "lighthouse"] : ON })
// Per-machine trust (core/trust.ts): on in plugins.json alone (a sync, another machine, a shared vault), it waits here.
await turn(true)
lh = await vplugin()
const TRUST = path.join(process.env.VAULTITE_LOCAL!, "trust")
check("trust: on in plugins.json alone, it waits to be allowed on this machine, and nothing of it runs", lh.on && !lh.loaded && lh.bundle === null &&
  lh.approval?.state === "new" && lh.approval.changed.includes("plugin.ts") && (await api("GET", "lighthouse"))[0] === 404, lh)
check("trust: kept on this machine (VAULTITE_LOCAL/trust/), never in the vault", fs.readdirSync(TRUST).length === 1 && !fs.readdirSync(path.join(VAULT, ".vaultite")).some((f) => f.includes("trust")))
{
  const listed = ((await api("POST", "ops/plugin.list", {}))[1] as Any[]).find((x: Any) => x.id === "lighthouse")
  check("trust: vau plugins says it waits", listed.waiting === true && listed.on === false, listed)
  const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
  check("trust: only this machine's owner may allow one", await app.runOp("plugin.allow", { id: "lighthouse" }, { http: stranger }).then(() => false, (e) => e.status === 403))
  const r = await app.runOp("plugin.enable", { id: "lighthouse" }, { http: stranger })
  check("trust: turned on by someone else, it stays waiting", (r.result as Any).waiting === true && !(await vplugin()).loaded, r.result)
  const { gateOf } = await import("../plugins/core/mcp/public.ts")
  check("trust: plugin.allow is gated on the public MCP", gateOf("plugin.allow", "write", { id: "lighthouse" }).includes("run code"))
  check("trust: allowing its later edits says so", gateOf("plugin.allow", "write", { id: "lighthouse", edits: true }).includes("later edits"))
  check("trust: plugin.new isn't gated (what it makes waits to be allowed)", gateOf("plugin.new", "write", { id: "garden" }) === "")
  const { PublicMcp } = await import("../plugins/core/mcp/public.ts")
  const code = await new PublicMcp({ host: { call: (n: string, p: Any) => app.runOp(n, p) }, vault: app.vault } as Any, PublicMcp.cloudOnly()).pluginCode()
  check("trust: a waiting vault plugin's code is written without a yes", code(".vaultite/plugins/lighthouse/plugin.ts") &&
    gateOf("file.write", "write", { path: ".vaultite/plugins/lighthouse/plugin.ts" }, code) === "")
  check("trust: its data, hidden files, the app's plugins and other settings still wait",
    [".vaultite/plugins/lighthouse/data.json", ".vaultite/plugins/lighthouse/.x.ts", ".vaultite/plugins/lighthouse/../people/data.json",
      ".vaultite/plugins/people/x.json", ".vaultite/plugins.json", ".vaultite/plugins/lighthouse"].every((f) => !code(f) && gateOf("file.write", "write", { path: f }, code) !== ""))
  const [hc] = await api("POST", "ops/plugin.allow", { id: "lighthouse", hash: "0000" })
  check("trust: allowing files other than the ones shown is refused", hc === 409 && !(await vplugin()).loaded, hc)
}
let [acode, aout] = await api("POST", "ops/plugin.allow", { id: "lighthouse", hash: lh.hash })
check("trust: allowed at the hash shown, it loads", acode === 200 && aout.loaded && !(await vplugin()).approval, [acode, aout])
write(`${LH}/beam.ts`, read(`${LH}/beam.ts`) + "\n")
lh = await vplugin()
check("trust: its code changed (a sync), it's unloaded and waits again, saying which files changed", !lh.loaded && lh.approval?.state === "changed" &&
  JSON.stringify(lh.approval.changed) === '["beam.ts"]' && (await api("GET", "lighthouse"))[0] === 404, lh.approval)
;[acode, aout] = await api("POST", "ops/plugin.allow", { id: "lighthouse", edits: true })
check("trust: allowed with edits, it loads, and later edits run (a plugin written here)", acode === 200 && aout.loaded && aout.edits, aout)
let [lcode, lout] = await api("GET", "lighthouse")
check("vault plugins: turned on, its route answers", lcode === 200 && ["on", "off"].includes(lout.beam) && lout.keepers === 1, [lcode, lout])
;[, out] = await api("GET", "keepers")
check("vault plugins: its kind reads its files", out.length === 1 && out[0].shift === "night", out)
lh = await vplugin()
check("vault plugins: loaded and built", lh.on && lh.loaded && typeof lh.bundle === "string" && !lh.problems.length, lh)
check("vault plugins: an app id clash stays refused even when on", !(await vplugin("people")).loaded && app.plugins.filter((p) => p.id === "people").length === 1)
let [bcode, bundle] = await api("GET", `plugins/lighthouse/${lh.bundle}/bundle.js`)
check("vault plugins: its bundle is one module sharing the app's React and API", bcode === 200 && bundle.includes("__vaultite.modules[`react/jsx-runtime`]")
  && bundle.includes("__vaultite.modules[`@vaultite`]") && !bundle.includes("useState=") && bundle.includes("Lighting the lamp"), bundle.slice(0, 300))
const chunk = /import\(["`']\.\/(logbook-[\w-]+\.js)["`']\)/.exec(bundle)?.[1]
check("vault plugins: what it imports when needed is a chunk of its own, beside its bundle", !!chunk && !bundle.includes("calm seas") &&
  (await api("GET", `plugins/lighthouse/${lh.bundle}/${chunk}`))[1]?.includes?.("calm seas") && (await api("GET", `plugins/lighthouse/0/${chunk}`))[0] === 404, bundle.slice(-300))
check("vault plugins: CodeMirror is the app's, loaded with it, not bundled", bundle.includes('preload(["@codemirror/view"])')
  && bundle.includes("__vaultite.modules[`@codemirror/view`]") && !bundle.includes("cm-scroller"), bundle.slice(0, 300))
check("vault plugins: with its Tailwind classes, under the app's", bundle.includes("@layer plugins") && bundle.includes("tracking-\\\\[0\\\\.0625em\\\\]"), bundle.slice(0, 400))
check("vault plugins: its variants the app hasn't over the app's classes, the app's own under them", /@layer plugin-variants[^]*md\\\\:tracking-/.test(bundle) &&
  !/@layer plugin-variants[^]*md\\\\:hidden/.test(bundle), bundle.slice(0, 600))
check("vault plugins: its docs join the topics", (await api("GET", "docs"))[1].some((t: Any) => t.id === "lighthouse"))
check("vault plugins: its dashboard installs and is pinned", read("Dashboards/Lighthouse.md").includes("block-lighthouse")
  && vault.config("pages").pinned.includes("Dashboards/Lighthouse.md"))
;[, out] = await api("GET", "render?path=Dashboards/Lighthouse.md")
check("vault plugins: its block as text", out.includes("## Lighthouse") && out.includes("[[Bob Lee]]: night shift"), out)
check("vault plugins: its block declared, nothing to fix", !lh.warnings.length && lh.blocks.lighthouse?.description, lh)
check("vault plugins: its blocks in /api/blocks", (await api("GET", "blocks"))[1].blocks.some((b: Any) => b.name === "lighthouse" && b.plugin === "lighthouse" && b.on && b.text), "")
check("vault plugins: its blocks in its docs, from the manifest", (await api("GET", "docs/lighthouse"))[1].includes("- `lighthouse`: whether the beam is on, and the keepers"))
write("Beam log.md", "Tonight `=beam`, and `=other` and `x`.\n\n```\n`=beam` in code\n```\n")
;[, out] = await api("GET", "render?path=Beam log.md")
check("vault plugins: inline code a plugin reads (inline-code) as its text, the rest and code fences as they are",
  /^Tonight the beam is (on|off), and `=other` and `x`\.\n\n```\n`=beam` in code\n```/.test(out.replace(/^# Beam log\n\n/, "")), out)
fs.rmSync(path.join(VAULT, "Beam log.md"))
{
  const before = read(`${LH}/manifest.json`), text = read(`${LH}/plugin.ts`)
  write(`${LH}/manifest.json`, JSON.stringify({ ...JSON.parse(before), blocks: { beacon: { description: "" } } }))
  write(`${LH}/plugin.ts`, text.replace('plugin.block("lighthouse"', 'plugin.block("lighthouse-text"'))
  lh = await vplugin()
  check("vault plugins: a block without its declaration or its text side is a warning, and it still loads", lh.loaded && !lh.problems.length
    && lh.warnings.some((w: string) => w.includes("block 'lighthouse'") && w.includes("isn't declared"))
    && lh.warnings.some((w: string) => w.includes("no text side")) && lh.warnings.some((w: string) => w.includes("block 'beacon' needs a description"))
    && lh.warnings.some((w: string) => w.includes("declares block 'beacon', which index.tsx doesn't draw")), lh.warnings)
  write(`${LH}/manifest.json`, before)
  write(`${LH}/plugin.ts`, text)
  lh = await vplugin()
  check("vault plugins: fixed, the warnings go", lh.loaded && !lh.warnings.length, lh.warnings)
}
write(`${LH}/plugin.ts`, read(`${LH}/plugin.ts`).replace('keepers: plugin.vault.items("keepers").length', 'keepers: plugin.vault.items("keepers").length + 10'))
;[, lout] = await api("GET", "lighthouse")
check("vault plugins: an edit reloads it on the next request", lout.keepers === 11, lout)
check("vault plugins: its own files are loaded again too (a new version of beam.ts)", ["on", "off"].includes(lout.beam))
const lhPlugin = read(`${LH}/plugin.ts`)
write(`${LH}/plugin.ts`, `import "../../../core/app.ts"\n${lhPlugin}`)
lh = await vplugin()
check("vault plugins: an import outside its folder is refused", !lh.loaded && lh.problems.some((p: string) => p.includes("its own folder")) && (await api("GET", "lighthouse"))[0] === 404, lh.problems)
check("vault plugins: unloaded, its kind is gone", (await api("GET", "keepers"))[0] === 404)
write(`${LH}/plugin.ts`, lhPlugin.replace("export const plugin", 'await import(["..", "..", "x.ts"].join("/")).catch((e) => { throw e })\nexport const plugin'))
lh = await vplugin()
check("vault plugins: what the check can't see, the resolve hook refuses", !lh.loaded && lh.problems.some((p: string) => p.includes("plugin.ts couldn't be loaded") && p.includes("its own folder")), lh.problems)
write(`${LH}/plugin.ts`, lhPlugin.replace('from "@vaultite/core/vault.ts"', 'from "@vaultite/core/app.ts"'))
lh = await vplugin()
check("vault plugins: only the core's plugin files", !lh.loaded && lh.problems.some((p: string) => p.includes("@vaultite/core/app.ts")), lh.problems)
write(`${LH}/plugin.ts`, lhPlugin)
write(`${LH}/index.tsx`, `import { get } from "@/core/data"\nimport fs from "node:fs"\nvoid get; void fs\n${read(`${LH}/index.tsx`)}`)
lh = await vplugin()
check("vault plugins: the frontend's rules too", !lh.loaded && lh.problems.some((p: string) => p.includes("@/core/data")) && lh.problems.some((p: string) => p.includes("node:fs")), lh.problems)
fs.cpSync(path.join(import.meta.dirname, "fixtures", "lighthouse", "index.tsx"), path.join(VAULT, LH, "index.tsx"))
write(`${LH}/label.ts`, "export const label = (\n")
lh = await vplugin()
check("vault plugins: a frontend that doesn't build says why, the backend still runs", lh.loaded && lh.bundle === null
  && lh.problems.some((p: string) => p.startsWith("index.tsx couldn't be built")) && (await api("GET", "lighthouse"))[0] === 200, lh.problems)
fs.cpSync(path.join(import.meta.dirname, "fixtures", "lighthouse", "label.ts"), path.join(VAULT, LH, "label.ts"))
write(`${LH}/data.json`, JSON.stringify({ dusk: 0 }))
lh = await vplugin()
const version = lh.bundle
;[, lout] = await api("GET", "lighthouse")
check("vault plugins: its settings are data.json, and changing them isn't a new version", lh.loaded && version && lout.beam === "on", [lh, lout])
// What a plugin needs of the app (core/version.ts): minAppVersion and apiVersion in its manifest.
const { API_VERSION, APP_VERSION } = await import("../core/version.ts")
const { compatProblems } = await import("../core/rules.ts")
check("versions: APP_VERSION is package.json's", APP_VERSION === JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version, APP_VERSION)
;[, s] = await api("GET", "state")
check("versions: in /api/state", s.app?.version === APP_VERSION && s.app?.api === API_VERSION, s.app)
const lhManifest = read(`${LH}/manifest.json`)
const manifest = (extra: object) => write(`${LH}/manifest.json`, JSON.stringify({ ...JSON.parse(lhManifest), ...extra }))
manifest({ minAppVersion: APP_VERSION, apiVersion: API_VERSION })
lh = await vplugin()
check("versions: a plugin this app can run loads", lh.loaded && !lh.problems.length && lh.minAppVersion === APP_VERSION && lh.apiVersion === API_VERSION, lh)
manifest({ minAppVersion: "99.0.0" })
lh = await vplugin()
check("versions: one that needs a newer app isn't loaded, and says why", !lh.loaded && (await api("GET", "lighthouse"))[0] === 404
  && lh.problems.some((p: string) => p.includes("needs Vaultite 99.0.0 or later") && p.includes(`this is ${APP_VERSION}`)), lh.problems)
manifest({ apiVersion: API_VERSION + 1 })
lh = await vplugin()
check("versions: one written for a newer plugin API isn't loaded", !lh.loaded && lh.problems.some((p: string) => p.includes(`plugin API ${API_VERSION + 1}, newer`)), lh.problems)
manifest({ minAppVersion: "soon", apiVersion: "1" })
lh = await vplugin()
check("versions: fields that aren't versions are problems", !lh.loaded && lh.problems.some((p: string) => p.includes("minAppVersion must be a version"))
  && lh.problems.some((p: string) => p.includes("apiVersion must be a whole number")), lh.problems)
check("versions: an API older than the app still loads is refused", compatProblems({ apiVersion: 1 }, "m", "1.0.0", 3, 2)[0]?.includes("no longer loads"))
check("versions: semver, not text order", compatProblems({ minAppVersion: "0.10.0" }, "m", "0.9.0").length === 1 && !compatProblems({ minAppVersion: "0.9.0" }, "m", "0.10.0").length)
{
  const { manifestProblems, pluginProblems } = await import("../core/rules.ts")
  const m = { id: "lighthouse", name: "Lighthouse", description: "Made up" }
  check("category: a slug is fine, one not listed too (Other)", !manifestProblems({ ...m, category: "life" }, "lighthouse", new Set()).length &&
    !manifestProblems({ ...m, category: "boats" }, "lighthouse", new Set()).length)
  check("category: not a slug is refused", manifestProblems({ ...m, category: "Life stuff" }, "lighthouse", new Set()).some((p) => p.includes("category")))
  const root = path.dirname(import.meta.dirname), people = path.join(root, "plugins", "core", "people")
  check("category: every app plugin names a listed one", !pluginProblems(people, root, new Map([["people", "core"]]), false, "people").some((p) => p.includes("category")))
  const dock = path.join(root, "plugins", "core", "dock-icon")
  check("offByDefault: an app plugin may be", !pluginProblems(dock, root, new Map([["dock-icon", "core"]]), false, "dock-icon").length)
  check("offByDefault: not for a vault plugin", pluginProblems(dock, root, new Map([["dock-icon", "vault"]]), true, "dock-icon").some((p) => p.includes("offByDefault")))
}
write(`${LH}/manifest.json`, lhManifest)
lh = await vplugin()
check("versions: fixed, it loads again", lh.loaded && !lh.problems.length, lh.problems)
await turn(false)
lh = await vplugin()
check("vault plugins: turned off, it's unloaded", !lh.loaded && !lh.on && (await api("GET", "lighthouse"))[0] === 404 && (await api("GET", "keepers"))[0] === 404
  && !app.plugins.some((p) => p.id === "lighthouse"))
check("vault plugins: and its docs leave", (await api("GET", "docs/lighthouse"))[0] === 404)
fs.rmSync(path.join(VAULT, ".vaultite/plugins/people"), { recursive: true })
// Every file opens (core/filetypes.ts): code and any text in the editor, the rest in viewers. Only text is written.
const { kindOf } = await import("../core/filetypes.ts")
check("kinds by name", kindOf("a/b.py") === "code" && kindOf("x.IPYNB") === "notebook" && kindOf("s.pdf") === "pdf" && kindOf("w.xlsx") === "binary" &&
  kindOf("Makefile") === "code" && kindOf(".gitignore") === "code" && kindOf(".env.local") === "code" && kindOf("n.md") === "markdown" &&
  kindOf("odd.qqq") === "other", [kindOf("a/b.py"), kindOf(".env.local"), kindOf("odd.qqq")])
write("Code/clean.py", "import csv\n\n\ndef total(rows):\n    return sum(r['amount'] for r in rows)\n")
write("Code/win.txt", "one\r\ntwo\r\n")
write("Code/notes.qqq", "plain text with an odd name\n")
fs.writeFileSync(path.join(VAULT, "Code/data.bin"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0x14, 0, 0xff, 0xfe]))
fs.writeFileSync(path.join(VAULT, "Code/huge.log"), Buffer.alloc(16 << 20, 0x61))
write("Code/analysis.ipynb", JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# Totals"] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }))
write("Code/statement.pdf", "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n%%EOF\n")
write("Code/node_modules/dep/index.js", "module.exports = 1\n")
write("Code/__pycache__/clean.cpython-312.pyc", "x")
;[, s] = await api("GET", "files")
const listed = (p: string) => s.others.some((f: Any) => f.path === p)
check("every file is listed", ["Code/clean.py", "Code/win.txt", "Code/data.bin", "Code/statement.pdf", "Code/analysis.ipynb"].every(listed), s.others.map((f: Any) => f.path))
check("package and compiled caches aren't", !listed("Code/node_modules/dep/index.js") && !s.folders.includes("Code/node_modules") && !s.folders.includes("Code/__pycache__"), s.folders)
;[code, out] = await api("GET", "file?path=Code/clean.py")
check("a code file reads as text", code === 200 && out.text.startsWith("import csv") && out.size > 0, out)
const py = out.text
write("Code/clean.py", py.replace("import csv", "import csv\nimport json")) // someone else changes it meanwhile
;[code, out] = await api("PUT", "file", { path: "Code/clean.py", text: py + "\nprint(total([]))\n", base: py })
check("a code file saves, merged with a change on disk", code === 200 && read("Code/clean.py").includes("import json") && read("Code/clean.py").endsWith("print(total([]))\n"), out)
;[code, out] = await api("GET", "file?path=Code/win.txt")
;[code] = await api("PUT", "file", { path: "Code/win.txt", text: out.text + "three\n", base: out.text })
check("Windows line endings stay", code === 200 && read("Code/win.txt") === "one\r\ntwo\r\nthree\r\n", read("Code/win.txt"))
;[code, out] = await api("GET", "file?path=Code/notes.qqq")
check("an unknown file that is text opens as text", code === 200 && out.text.startsWith("plain"), code)
;[code] = await api("PUT", "file", { path: "Code/notes.qqq", text: "changed\n", base: out.text })
check("and can be written", code === 200 && read("Code/notes.qqq") === "changed\n", code)
;[code] = await api("GET", "file?path=Code/data.bin")
check("a binary file isn't text (415)", code === 415, code)
;[code] = await api("PUT", "file", { path: "Code/data.bin", text: "oops", base: null })
check("and can't be written as text", code === 400 && fs.readFileSync(path.join(VAULT, "Code/data.bin"))[0] === 0x50, code)
;[code, out] = await api("GET", "file?path=Code/huge.log")
check("a huge file reads as text, at any size", code === 200 && out.text.length === 16 << 20, [code, out?.text?.length])
{
  // A big file's save: its base's fingerprint, not the base; the base only when the file changed on disk.
  const { textHash } = await import("../core/texthash.ts")
  const huge = out.text, mine = huge + "\nmine\n"
  ;[code, out] = await api("PUT", "file", { path: "Code/huge.log", text: mine, baseHash: textHash(huge), lean: true })
  check("a big file saves with its base's fingerprint, its text not sent back", code === 200 && out.same === true && out.text === undefined && read("Code/huge.log") === mine, [code, out?.same])
  write("Code/huge.log", "theirs\n" + mine) // someone else changes it meanwhile
  ;[code] = await api("PUT", "file", { path: "Code/huge.log", text: mine + "more\n", baseHash: textHash(mine), lean: true })
  check("changed on disk meanwhile: asked for the base (412), nothing written", code === 412 && read("Code/huge.log") === "theirs\n" + mine, code)
  ;[code, out] = await api("PUT", "file", { path: "Code/huge.log", text: mine + "more\n", base: mine, lean: true })
  check("and with it, merged", code === 200 && read("Code/huge.log") === "theirs\n" + mine + "more\n" && out.text === read("Code/huge.log"), code)
}
;[code] = await api("PUT", "file", { path: "Code/analysis.ipynb", text: "{ not json", base: read("Code/analysis.ipynb") })
check("a notebook stays JSON", code === 400, code)
;[code] = await api("POST", "file", { path: "Code/new.py", text: "x = 1\n" })
check("a new code file", code === 201 && read("Code/new.py") === "x = 1\n", code)
;[code, out] = await api("GET", "file/info?path=Code/statement.pdf")
check("info: a PDF's pages and size", code === 200 && out.pages === 3 && out.kind === "pdf" && out.size > 0, out)
;[code, out] = await api("GET", "file/info?path=Code/data.bin")
check("info: any file", code === 200 && out.kind === "other" && out.size === 10 && out.pages === undefined, out)
;[, out] = await api("GET", "search?q=total rows")
check("search finds words in code files", out.some((r: Any) => r.path === "Code/clean.py" && r.title === "clean.py" && r.context.includes("def total")), out)
;[, out] = await api("GET", "search?q=module.exports")
check("but not in caches", !out.length, out)
// Every file is searched whole, at any size and of any kind that's text.
write("Code/big.log", "x".repeat(300 << 10) + "\nneedle at the end\n")
write("Code/notes.weird", "a text file of no known kind: haystack\n")
fs.writeFileSync(path.join(VAULT, "Code/blob.weird"), Buffer.from([1, 0, 2, 3]))
;[, out] = await api("GET", "search?q=needle&lines=5")
check("search: a big text file, to its end", out.some((r: Any) => r.path === "Code/big.log" && r.matches?.[0]?.line === 2), out)
;[, out] = await api("GET", "search?q=haystack")
check("search: a text file of a kind it doesn't know", out.some((r: Any) => r.path === "Code/notes.weird"), out)
write("Code/drawing.json", JSON.stringify({ title: "Pier sketch", image: `data:image/png;base64,${"QUJD".repeat(500)}xyzzy` }))
;[, out] = await api("GET", "search?q=xyzzy")
check("search: not inside an embedded file's base64 (a drawing's pasted image)", !out.some((r: Any) => r.path === "Code/drawing.json"), out)
;[, out] = await api("GET", "search?q=Pier sketch")
check("search: but the rest of that file", out.some((r: Any) => r.path === "Code/drawing.json"), out)
;[code] = await api("POST", "file/move", { from: "Code/clean.py", to: "Code/tidy.py" })
check("a code file renames", code === 200 && exists("Code/tidy.py") && !exists("Code/clean.py"), code)
;[code] = await api("DELETE", "file?path=Code/tidy.py")
check("and goes to the trash", code === 200 && !exists("Code/tidy.py") && fs.readdirSync(path.join(VAULT, ".trash/Code")).some((n) => n.startsWith("tidy ")), code)

// Live updates (core/live.ts): changes on disk reach the index and the listeners, coalesced, without a request.
const { Live, ignored } = await import("../core/live.ts")
const live = new Live(vault).start()
const heard: Any[] = []
live.listen((c) => heard.push(c))
const wait = async (ok: () => boolean, ms = 3000) => {
  for (const t = Date.now(); Date.now() - t < ms && !ok();) await new Promise((r) => setTimeout(r, 25))
  return ok()
}
await new Promise((r) => setTimeout(r, 300)) // FSEvents starts a moment after the watch
const touched = (p: string) => heard.some((c) => c.paths === null || c.paths.includes(p))
write("Notes/Live one.md", "---\ntype: note\ntitle: Live one\n---\n\nFrom disk.\n")
check("live: a file written on disk is heard", await wait(() => touched("Notes/Live one.md")), heard)
check("live: and indexed before the event goes out", vault.entries.has("Notes/Live one.md"))
heard.length = 0
for (let i = 0; i < 20; i++) write(`Notes/Burst ${i}.md`, `burst ${i}\n`)
await wait(() => touched("Notes/Burst 19.md"))
await new Promise((r) => setTimeout(r, 300))
check("live: a burst of writes is one or two events", heard.length >= 1 && heard.length <= 2, heard.length)
heard.length = 0
fs.renameSync(path.join(VAULT, "Notes/Live one.md"), path.join(VAULT, "Notes/Live two.md"))
check("live: a rename is heard as both names", await wait(() => touched("Notes/Live one.md") && touched("Notes/Live two.md")), heard)
check("live: and the index follows it", vault.entries.has("Notes/Live two.md") && !vault.entries.has("Notes/Live one.md"))
heard.length = 0
await api("PUT", "file", { path: "Notes/Live two.md", text: "From the app.\n", base: read("Notes/Live two.md") })
check("live: the app's own writes are heard too", await wait(() => touched("Notes/Live two.md")), heard)
check("live: .git, .DS_Store, iCloud placeholders and temp files are ignored",
  ignored(".git/index") && ignored("Notes/.DS_Store") && ignored("Notes/.a.md.icloud") && ignored("Notes/a.md.tmp-1-2") &&
  ignored(".vaultite/artifacts/x.html.json") && !ignored(".vaultite/cache/github.json") && !ignored("Notes/a.md"))
// The user's window: a command it couldn't run says so; a window from before answers is sent it and not waited on.
{
  const win = (answers: boolean, ran: boolean | null) => {
    const on: Record<string, (d: unknown) => void> = {}
    const ws: Any = { readyState: 1, OPEN: 1, close() {}, on: (k: string, f: (d: unknown) => void) => { on[k] = f }, sent: [] as Any[],
      send(t: string) {
        const m = JSON.parse(t); ws.sent.push(m)
        if (m.rid && ran !== null) setTimeout(() => on.message(JSON.stringify({ type: "ui-done", rid: m.rid, ran })), 5)
      } }
    live.client(ws)
    on.message(JSON.stringify({ type: "active", ...(answers ? { answers: true } : {}) }))
    return ws
  }
  win(true, false)
  const refused = await live.drive({ action: "command", id: "dispatch:claude" }).then(() => null, (e: Any) => e)
  check("ui: a command the window couldn't run is an error saying so", refused?.status === 422 && /isn't available/.test(refused.message), refused)
  win(true, true)
  check("ui: one it ran is sent", ((await live.drive({ action: "command", id: "theme:dark" })) as Any)?.ok === true)
  const old = win(false, null), t0 = Date.now()
  await live.drive({ action: "command", id: "theme:dark" })
  check("ui: a window that never answers isn't waited on", Date.now() - t0 < 500 && old.sent.at(-1)?.id === "theme:dark" && !old.sent.at(-1)?.rid)
}
live.close()

// Database views (plugins/core/query): one evaluator (query.ts) for the route and the block's text.
{
  const { parseWhere, run, QueryError, markdown } = await import("../plugins/core/query/query.ts")
  const recs = [
    { path: "Q/Alice Park.md", fm: { type: "qtest", relation: "friend", every_days: 30, tags: ["University", "AI"], with: "[[Bob Lee]]", met: "2026-09-01" }, mtime: 3 },
    { path: "Q/Bob Lee.md", fm: { type: "qtest", relation: "Family", every_days: 7, tags: ["Work"], met: "2025-01-10" }, mtime: 2 },
    { path: "Q/Lighthouse.md", fm: { type: "project", status: "live", every_days: "10" }, mtime: 1 },
    { path: "Other/Lee Park.md", fm: { type: "qtest", relation: "friend", note: "likes Lighthouse" }, mtime: 4 },
  ]
  const names = (o: Any) => run(o, recs).groups.flatMap((g: Any) => g.rows.map((r: Any) => r.title))
  check("query: and binds tighter than or", JSON.stringify(parseWhere("a = 1 or b = 2 and c = 3")) ===
    JSON.stringify({ k: "or", a: { k: "cmp", key: "a", op: "=", value: 1 }, b: { k: "and", a: { k: "cmp", key: "b", op: "=", value: 2 }, b: { k: "cmp", key: "c", op: "=", value: 3 } } }))
  check("query: parentheses and not", JSON.stringify(names({ where: "not (relation = friend or has status)" })) === '["Bob Lee"]', names({ where: "not (relation = friend or has status)" }))
  check("query: text without case, numbers as numbers", JSON.stringify(names({ where: "relation = family or every_days < 9" })) === '["Bob Lee"]'
    && JSON.stringify(names({ where: "every_days >= 10", sort: "every_days" })) === '["Lighthouse","Alice Park"]', names({ where: "every_days >= 10", sort: "every_days" }))
  check("query: quoted text, contains on text and lists, links", JSON.stringify(names({ where: "note contains 'LIGHT' or tags contains ai" })) === '["Alice Park","Lee Park"]'
    && JSON.stringify(names({ where: "with = 'Bob Lee'" })) === '["Alice Park"]', names({ where: "note contains 'LIGHT' or tags contains ai" }))
  check("query: dates compare in order", JSON.stringify(names({ where: "met > 2026-01-01" })) === '["Alice Park"]')
  check("query: from, type, tags and a where map", JSON.stringify(names({ from: "Q/", type: "qtest", tags: ["university"] })) === '["Alice Park"]'
    && JSON.stringify(names({ where: { relation: ["friend", "family"] }, sort: "-file" })) === '["Lee Park","Bob Lee","Alice Park"]')
  const g = run({ type: "qtest", group: "relation", sort: "-every_days", limit: 2, columns: ["file", "folder", "every_days"] }, recs)
  check("query: sort (blanks last), limit, then groups in order", g.total === 3 && g.shown === 2 &&
    JSON.stringify(g.groups.map((x: Any) => [x.name, x.rows.map((r: Any) => r.title)])) === '[["Family",["Bob Lee"]],["friend",["Alice Park"]]]'
    && g.groups[1].rows[0].values.folder === "Q", g.groups)
  let bad = 0
  for (const w of ["relation =", "(a = 1", "a = 1 b", "= 3", "a ~ 2", "'open", "a = 1 or", ")", "((((".repeat(20) + "a = 1"]) {
    try { parseWhere(w) } catch (e) { if (e instanceof QueryError) bad++ }
  }
  check("query: garbage is an error, never a crash", bad === 9, bad)
  const many = Array.from({ length: 700 }, (_, i) => ({ path: `M/${String(i).padStart(3, "0")}.md`, fm: { n: i }, mtime: 0 }))
  const all = run({ columns: ["file", "n"] }, many), page = run({ columns: ["file", "n"], limit: 50, offset: 600 }, many)
  check("query: every match without a limit (no cap), a page with limit and offset", all.shown === 700 && all.total === 700 &&
    page.shown === 50 && page.offset === 600 && page.groups[0].rows[0].title === "600" && markdown(page).includes("_601-650 of 700 shown; more: offset 650._"),
  [all.shown, page.shown, page.offset])
  write("Query test/Alice Park.md", "---\ntype: qtest\nrelation: friend\nevery_days: 30\n---\n\nHi.\n")
  write("Query test/Bob Lee.md", "---\ntype: qtest\nrelation: family\nevery_days: 7 # weekly\n---\n")
  write("Query test/View.md", "---\ntags: [Trip]\n---\n\n```block-query\ntitle: Test people\nfrom: Query test/\ntype: qtest\ncolumns: [file, relation, every_days]\nsort: -every_days\n```\n")
  let qr: Any
  ;[code, qr] = await api("GET", 'query?q={"from":"Query test/","type":"qtest","sort":"every_days"}')
  check("GET /api/query answers rows with paths and values", code === 200 && qr.groups[0].rows.map((r: Any) => r.path).join() === "Query test/Bob Lee.md,Query test/Alice Park.md"
    && qr.groups[0].rows[0].values.relation === "family", qr)
  ;[, qr] = await api("GET", 'query?q={"from":"Query test/"}&self=Query test/View.md')
  const listed = qr.groups.flatMap((g: Any) => g.rows).map((r: Any) => r.path)
  check("query: the file the view is in isn't listed (self)", listed.length === 2 && !listed.includes("Query test/View.md"), listed)
  write("Templates/Qtest person.md", "---\ntype: qtest\nrelation: friend\n---\n")
  ;[, qr] = await api("POST", "query", { type: "qtest" })
  check("query: templates are left out", !qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path.startsWith("Templates/")), qr)
  ;[, qr] = await api("POST", "query", { from: "Templates/", type: "qtest" })
  check("query: unless from names their folder", qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path.startsWith("Templates/")), qr)
  ;[code, qr] = await api("POST", "query", { from: "Query test/", where: "relation" })
  check("a bad query is a 400 saying why", code === 400 && /expected/.test(qr.error), qr)
  const [, md] = await api("GET", "render?path=Query test/View.md")
  check("the block reads as a Markdown table", md.includes("## Test people") && md.includes("| Name | Relation | Every days |")
    && md.indexOf("[[Alice Park]]") < md.indexOf("[[Bob Lee]]") && md.includes("| [[Bob Lee]] | family | 7 |"), md)

  // Boards: a column per value of the group key, the listed ones first (even empty), "No value" last.
  const board = run({ type: "qtest", view: "board", group: "relation", groups: ["mentor", "friend"], columns: ["file", "every_days"] }, recs)
  check("board: listed columns first (empty ones too), the rest after, no value last",
    JSON.stringify(board.groups.map((x: Any) => [x.name, x.value, x.rows.map((r: Any) => r.title)])) ===
      '[["mentor","mentor",[]],["friend","friend",["Alice Park","Lee Park"]],["Family","Family",["Bob Lee"]],[null,null,[]]]'
    && board.group === "relation", board.groups)
  const linked = run({ from: "Q/", view: "board", group: "with" }, recs)
  check("board: a column's value is what its files have (a link stays a link)", linked.groups[0].name === "Bob Lee" && linked.groups[0].value === "[[Bob Lee]]"
    && linked.groups[1].name === null && linked.groups[1].rows.length === 2, linked.groups)
  let why = ""
  try { run({ view: "board" }, recs) } catch (e) { why = (e as Error).message }
  check("board: needs a group", /needs a group/.test(why), why)
  // Calendars: a month, by a date key (default `date`, else `created`), a group per day.
  const cal = run({ view: "calendar", date: "met", month: "2026-09" }, recs)
  check("calendar: the month's files, a group per day", cal.date === "met" && cal.month === "2026-09" && cal.total === 1
    && cal.groups.length === 1 && cal.groups[0].name === "2026-09-01" && cal.groups[0].rows[0].title === "Alice Park", cal)
  const days = run({ view: "calendar" }, [
    { path: "L/Climb.md", fm: { date: "2026-09-27" }, mtime: 1 }, { path: "L/Gym.md", fm: { date: "2026-09-03 07:30" }, mtime: 1 },
    { path: "L/Old.md", fm: { date: "2026-08-30" }, mtime: 1 }, { path: "L/Undated.md", fm: {}, mtime: 1 },
  ], new Date(2026, 8, 15))
  check("calendar: default key date, this month, in order, times kept", days.date === "date" && days.month === "2026-09"
    && JSON.stringify(days.groups.map((x: Any) => [x.name, x.rows.map((r: Any) => r.title)])) === '[["2026-09-03",["Gym"]],["2026-09-27",["Climb"]]]', days.groups)
  why = ""
  try { run({ view: "calendar", month: "2026-13" }, recs) } catch (e) { why = (e as Error).message }
  check("calendar: a bad month says so", /month is YYYY-MM/.test(why), why)

  // As text, and a card moved: the app writes that one key (PUT /api/file with its base) and the board follows.
  write("Query test/Board.md", "---\ntags: [Trip]\n---\n\n```block-query\ntitle: Test board\nfrom: Query test/\ntype: qtest\nview: board\ngroup: relation\ngroups: [friend, family, mentor]\ncolumns: [file, every_days]\n```\n\n```block-query\ntitle: Test calendar\nfrom: Query test/\ntype: qtest\nview: calendar\ndate: met\nmonth: 2026-09\n```\n")
  write("Query test/Alice Park.md", "---\ntype: qtest\nrelation: friend\nevery_days: 30\nmet: 2026-09-12\n---\n\nHi.\n")
  let [, bmd] = await api("GET", "render?path=Query test/Board.md")
  check("the board reads as a section per column, a bullet per file", bmd.includes("## Test board") && bmd.includes("### friend (1)\n\n- [[Alice Park]] · 30")
    && bmd.includes("### family (1)\n\n- [[Bob Lee]] · 7") && bmd.includes("### mentor (0)\n\n_Empty._") && bmd.includes("### No value (0)"), bmd)
  check("the calendar reads as its month, a bullet per file by date", bmd.includes("## Test calendar\n\n### September 2026\n\n- 2026-09-12 · [[Alice Park]]"), bmd)
  const before = read("Query test/Bob Lee.md")
  ;[code] = await api("PUT", "file", { path: "Query test/Bob Lee.md", text: before.replace("relation: family", "relation: mentor"), base: before })
  ;[, qr] = await api("POST", "query", { from: "Query test/", type: "qtest", view: "board", group: "relation", groups: ["friend", "family", "mentor"] })
  check("a moved card: one line changes (its comment stays), the board has it in its new column", code === 200
    && read("Query test/Bob Lee.md") === "---\ntype: qtest\nrelation: mentor\nevery_days: 7 # weekly\n---\n"
    && JSON.stringify(qr.groups.map((x: Any) => [x.name, x.rows.length])) === '[["friend",1],["family",0],["mentor",1],[null,0]]', qr.groups)
  ;[, bmd] = await api("GET", "render?path=Query test/Board.md")
  check("and reads so", bmd.includes("### family (0)") && bmd.includes("### mentor (1)\n\n- [[Bob Lee]] · 7"), bmd)
}

// Obsidian Bases: a .base read as text (every view), one view as JSON, embedded with #View (this: the note), a ```base
// fence in a note, a ```block-query with a formula and summaries.
{
  write("Bases test/Books/Dune.md", "---\nstatus: done\npages: 400\nread: 400\nauthor: '[[Frank Herbert]]'\n---\n")
  write("Bases test/Books/Emma.md", "---\nstatus: reading\npages: 300\nread: 100\n---\n")
  write("Bases test/Frank Herbert.md", "---\nborn: 1920\n---\n")
  write("Bases test/cover.png", "not really a png")
  write("Bases test/Books.base", "filters:\n  and:\n    - file.inFolder(\"Bases test/Books\")\nformulas:\n  left: pages - read\nproperties:\n  formula.left:\n    displayName: Left\n"
    + "views:\n  - type: table\n    name: Reading\n    order: [file.name, status, formula.left]\n    summaries:\n      formula.left: Sum\n"
    + "  - type: list\n    name: Linked here\n    filters: file.hasLink(this)\n  - type: map\n    name: Map\n")
  write("Bases test/All.base", "filters: file.inFolder(\"Bases test\")\nviews:\n  - type: table\n    name: Every file\n    order: [file.name, file.ext]\n")
  write("Bases test/Note.md", "---\ntype: note\n---\n\nSee [[Dune]].\n\n![[Books.base#Linked here]]\n\n```base\nfilters: 'status == \"reading\"'\nviews:\n  - type: table\n    name: Inline\n    order: [file.name, pages]\n```\n\nAfter.\n")
  let [code, md] = await api("GET", "render?path=Bases test/Books.base")
  check("a .base reads as its views, a table each (a formula, its label, the summary row)", code === 200 && md.startsWith("# Books\n\n## Reading\n\n| Name | Status | Left |")
    && md.includes("| [[Emma]] | reading | 200 |") && md.includes("|  |  | **Sum** 200 |") && md.includes("## Linked here") && md.includes("## Map"), md)
  let qr: Any
  ;[code, qr] = await api("GET", "query?base=Bases test/Books.base&view=Reading")
  check("GET /api/query?base=: one view as JSON, with the base's views", code === 200 && qr.title === "Reading" && qr.current === 0
    && JSON.stringify(qr.views) === '[{"name":"Reading","type":"table"},{"name":"Linked here","type":"list"},{"name":"Map","type":"map"}]'
    && qr.groups[0].rows.find((r: Any) => r.title === "Dune").values["formula.left"] === 0 && qr.summaries[0].value === 200, qr)
  ;[, qr] = await api("GET", "query?base=Bases test/All.base")
  check("a base lists every file, attachments too", JSON.stringify(qr.groups[0].rows.map((r: Any) => [r.title, r.values["file.ext"]]).sort())
    === '[["Books.base","base"],["Dune","md"],["Emma","md"],["Frank Herbert","md"],["Note","md"],["cover.png","png"]]', qr.groups[0].rows.map((r: Any) => r.title))
  ;[code] = await api("GET", "query?base=Bases test/Nope.base")
  check("a base that isn't there is a 404", code === 404, code)
  ;[, md] = await api("GET", "render?path=Bases test/Note.md")
  check("![[Books.base#View]] in a note: that view, `this` the note (file.hasLink(this))", md.includes("**Bases test/Books.base#Linked here**\n\n### Linked here")
    && !md.includes("### Reading") && md.includes("### Linked here\n\n_Nothing matches._"), md)
  check("a ```base fence reads as its view", md.includes("### Inline\n\n| Name | Pages |\n| --- | --- |\n| [[Emma]] | 300 |\n\nAfter.") && !md.includes("```base"), md)
  write("Bases test/Books/Dune.md", "---\nstatus: done\npages: 400\nread: 400\n---\n\nMentioned in [[Note]].\n")
  ;[, md] = await api("GET", "render?path=Bases test/Note.md")
  check("this: a file linking to the note is listed", md.includes("### Linked here\n\n| Name |") && md.includes("[[Dune]]"), md)
  ;[code, qr] = await api("POST", "query", { type: "nope", formulas: { x: "1 +" }, columns: ["file", "formula.x"], summaries: { file: "Count" }, filters: "bad(" })
  check("a broken formula or filter is a note, not an error", code === 200 && JSON.stringify(qr.notes) === '["Filter bad( is left out: there\'s no function bad()"]', qr)
  write("Bases test/Query.md", "```block-query\ntitle: Pages\nfrom: Bases test/Books/\nformulas:\n  left: pages - read\ncolumns: [file, pages, formula.left]\nsummaries: {pages: Sum, formula.left: Average}\n```\n")
  ;[, md] = await api("GET", "render?path=Bases test/Query.md")
  check("block-query: a formula column and summaries", md.includes("| [[Emma]] | 300 | 200 |") && md.includes("|  | **Sum** 700 | **Average** 100 |"), md)
}

// Plugins find each other's settings and services through the API, never by reading files or naming ids in the core.
const { settingsProblems } = await import("../core/rules.ts")
check("rules: another plugin's settings or plugins.json read from disk are flagged",
  settingsProblems('const f = JSON.parse(fs.readFileSync(vault.abs(".vaultite/plugins/templates/data.json"), "utf8"))', "x", "query").length === 1
  && settingsProblems('fs.readFileSync(path.join(v, ".vaultite", "plugins.json"), "utf8")', "x", "query").length === 1
  && settingsProblems('plugin.vault.config("plugins/logs/data").areas', "x", "today").length === 1
  && settingsProblems('plugin.vault.config("plugins/today/data")', "x", "today").length === 0
  && settingsProblems('help: "in .vaultite/plugins/workspaces/data.json"', "x", "today").length === 0
  && settingsProblems('const off = plugin.vault.config("plugins").disabled', "x", "today").length === 1)
check("services: the core finds People's geocoder by name", typeof (await import("../core/plugins.ts")).service(app.plugins, "geocode") === "function")
{
  const { geocoder } = await import("../plugins/core/people/geocode.ts")
  let cache: Any = {}, asked: string[] = [], down = true
  const g = geocoder(() => cache, (c) => { cache = c }, async (q) => {
    asked.push(q)
    if (down) throw new Error("offline")
    return q === "Lisbon" ? [38.7223, -9.1393] : null
  }, 0)
  check("geocoder: offline is no pin, and not remembered", (await g.locate("Lisbon")) === null && !("lisbon" in cache), cache)
  down = false
  const [a, b] = await Promise.all([g.locate("Lisbon"), g.locate(" lisbon ")])
  check("geocoder: one lookup for the same place, then the cache", a?.[0] === 38.7223 && b === a && asked.length === 2 && (await g.locate("LISBON")) === a && asked.length === 2, asked)
  check("geocoder: not found is remembered as no pin", (await g.locate("Atlantis")) === null && cache.atlantis === null && g.known("Atlantis") === null && g.known("Paris") === undefined, cache)
}

// The vau CLI (core/cli.ts), in-process: its API calls go to the app, /api/ui to a Live with made-up windows.
const { execute, servers } = await import("../core/cli.ts")
const { normalizeKeys } = await import("../core/coreops/settings.ts")
const uiLive = new Live(vault)
app.ui = uiLive.drive
const cliApi = async (method: string, route: string, body?: unknown) => {
  const u = new URL(route, "http://x/")
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  if (parts.join("/") === "ui") {
    const [b, status] = uiLive.handle(method, body ?? {})
    return { status, body: b }
  }
  const [status, b] = await run(method, parts, Object.fromEntries(u.searchParams), body)
  return { status, body: b }
}
let stdinText = ""
const vau = (...argv: string[]) => execute(argv, { api: cliApi, vault: VAULT, env: {}, stdin: async () => stdinText })
const conf = (name: string) => JSON.parse(read(`.vaultite/${name}.json`))
let cr = await vau("--help")
check("vau: --help lists every command", cr.code === 0 && ["context", "render", "panels", "appearance", "hotkey", "open", "plugin"].every((n) => cr.out.includes(`  ${n} `)), cr.out)
check("vau: plugins' ops and commands are listed, after the core's (where am I first)", ["today", "workspace", "log", "note", "pin", "dashboard", "query", "mcp", "inbox", "clip", "properties", "activity", "perf", "remember", "terminal"].every((n) => cr.out.includes(`  ${n} `))
  && cr.out.indexOf("  context ") < cr.out.indexOf("  render ") && cr.out.indexOf("  render ") < cr.out.indexOf("  pin "), cr.out)
cr = await vau("panels", "--help")
check("vau: a command's --help has examples", cr.code === 0 && cr.out.includes("vau panels move terminals top"), cr.out)
cr = await vau("nope")
check("vau: an unknown command says so", cr.code === 2 && cr.err.includes("no command 'nope'"), cr)
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ disabled: ["random-note"], enabled: ON, order: ["people"], custom: 1 }, null, 2) + "\n")
fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"), { force: true })
// The sidebars' panels: .vaultite/sidebars.json (core/sidebars.ts), a stack per sidebar and the folded ones.
const sb = () => conf("sidebars")
const left = () => sb().left as string[]
cr = await vau("panels", "--json")
const pj = JSON.parse(cr.out)
check("vau panels: the default while sidebars.json is unset (by sort, without the hidden ones)", cr.code === 0 && !exists(".vaultite/sidebars.json") &&
  pj.sidebars.left[0] === "search:search" && !pj.sidebars.left.includes("backlinks:links") && pj.panels.find((x: Any) => x.key === "backlinks:links").side === null, cr.out)
cr = await vau("panels", "move", "terminals", "top")
check("vau panels move: sidebars.json is written whole", cr.code === 0 && left()[0] === "terminal:sessions" && Array.isArray(sb().right) && Array.isArray(sb().collapsed) && left().length === pj.sidebars.left.length, [cr, sb()])
check("vau panels move: plugins.json stays as it was", conf("plugins").custom === 1 && conf("plugins").disabled[0] === "random-note" && conf("plugins").order[0] === "people", conf("plugins"))
await vau("panels", "move", "file tree", "2")
check("vau panels move: friendly names and positions", left()[1] === "files:files", left())
await vau("panels", "move", "files", "down")
check("vau panels move down", left()[2] === "files:files", left())
await vau("panels", "hide", "Search field")
check("vau panels hide", !left().includes("search:search"), sb())
cr = await vau("panels", "--json")
check("vau panels --json marks hidden ones", JSON.parse(cr.out).panels.find((x: Any) => x.key === "search:search").side === null, cr.out)
await vau("panels", "show", "search")
check("vau panels show: at the end of the left sidebar", left()[left().length - 1] === "search:search", left())
await vau("panels", "right", "local graph")
check("vau panels right", sb().right[0] === "graph:local" && !left().includes("graph:local"), sb())
cr = await vau("panels")
check("vau panels: both sidebars listed", cr.code === 0 && /Right sidebar:\n  1\. graph:local/.test(cr.out), cr.out)
await vau("panels", "collapse", "pinned")
check("vau panels collapse", sb().collapsed.includes("pages:pages"), sb())
cr = await vau("panels", "--json")
check("vau panels --json marks collapsed ones", JSON.parse(cr.out).panels.find((x: Any) => x.key === "pages:pages").collapsed === true, cr.out)
await vau("panels", "expand", "pinned")
check("vau panels expand", !sb().collapsed.includes("pages:pages"), sb())
cr = await vau("panels", "hide", "nothing")
check("vau panels: an unknown panel lists the real ones", cr.code === 1 && cr.err.includes("terminal:sessions"), cr)
// A plugin turned on: its panels (not the ones it hides) join the left sidebar.
await vau("panels", "hide", "search")
await vau("plugin", "off", "search")
await vau("plugin", "on", "search")
check("vau plugin on: its panel joins the left sidebar", left()[left().length - 1] === "search:search", left())
fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"), { force: true })
// A new tab's page: .vaultite/newtab.json (core/newtab.ts), its sections and its buttons (palette commands), a key each.
{
  fs.rmSync(path.join(VAULT, ".vaultite/newtab.json"), { force: true })
  const nt = () => conf("newtab")
  cr = await vau("newtab", "--json")
  const nj = JSON.parse(cr.out)
  const shownKeys = (r: Any) => r.sections.filter((x: Any) => x.place).map((x: Any) => x.key)
  check("vau newtab: the default while newtab.json is unset (by sort, without hidden sections; the default buttons)", cr.code === 0 && !exists(".vaultite/newtab.json") &&
    shownKeys(nj).includes("core:actions") && !shownKeys(nj).includes("terminal:sessions") && nj.buttons.map((b: Any) => b.id).join() === "file:new,switcher:open,palette:open" &&
    nj.buttons[0].name === "Create new note" && nj.buttons[0].known, cr.out)
  await vau("newtab", "show", "terminals", "top")
  check("vau newtab show: at a position, by a plain name; only `sections` is written", nt().sections[0] === "terminal:sessions" && !("actions" in nt()), nt())
  await vau("newtab", "hide", "recently changed")
  check("vau newtab hide: by its title", !nt().sections.includes("core:changed"), nt())
  await vau("newtab", "move", "buttons", "top")
  check("vau newtab move", nt().sections[0] === "core:actions" && nt().sections[1] === "terminal:sessions", nt())
  cr = await vau("newtab", "move", "recently changed", "1")
  check("vau newtab move: a hidden section says to show it first", cr.code === 1 && /show/.test(cr.err), cr)
  await vau("newtab", "button", "add", "Open Claude Code", "top")
  check("vau newtab button add: by the command's name, at a position; `sections` stays", nt().actions.join() === "terminal:claude,file:new,switcher:open,palette:open" && nt().sections[0] === "core:actions", nt())
  await vau("newtab", "button", "move", "file:new", "up")
  await vau("newtab", "button", "remove", "palette:open")
  check("vau newtab button move, remove", nt().actions.join() === "file:new,terminal:claude,switcher:open", nt())
  await vau("newtab", "button", "icon", "file:new", "star")
  cr = await vau("newtab")
  check("vau newtab button icon: only `icons` is written, shown in the list", nt().icons["file:new"] === "star" && nt().actions.join() === "file:new,terminal:claude,switcher:open" &&
    cr.out.includes("file:new (Create new note)  (icon: star)"), [nt(), cr.out])
  cr = await vau("newtab", "button", "icon", "file:new", "Not An Icon")
  check("vau newtab button icon: a name that can't be an icon says so", cr.code === 1 && cr.err.includes("isn't an icon's name"), cr)
  await vau("newtab", "button", "icon", "file:new", "")
  check("vau newtab button icon '': back to the command's (the key goes once none is left)", !("icons" in nt()), nt())
  cr = await vau("newtab", "button", "add", "no such thing")
  check("vau newtab button add: an unknown command says so", cr.code === 1 && cr.err.includes("no command"), cr)
  cr = await vau("newtab")
  check("vau newtab: as text", cr.code === 0 && /Sections, top to bottom:\n  1\. core:actions/.test(cr.out) && /Buttons \(core:actions\):\n  1\. file:new/.test(cr.out), cr.out)
  // A plugin turned on: its sections (not the ones it hides) join the page, where newtab.json lists them.
  await vau("newtab", "hide", "pinned pages")
  await vau("plugin", "off", "pages")
  await vau("plugin", "on", "pages")
  check("vau plugin on: its section joins a saved page", nt().sections[nt().sections.length - 1] === "pages:tiles", nt())
  cr = await vau("settings", "newtab")
  check("vau settings newtab", cr.code === 0 && cr.out.includes("terminal:claude"), cr.out)
  fs.rmSync(path.join(VAULT, ".vaultite/newtab.json"), { force: true })
}
await api("PUT", "config/plugins", { disabled: [] })
check("PUT /api/config keeps keys it didn't send", conf("plugins").custom === 1 && !conf("plugins").disabled.length, conf("plugins"))
await vau("plugin", "off", "people")
cr = await vau("plugins", "--json")
check("vau plugin off: out of enabled, and what requires it is off too", !conf("plugins").enabled.includes("people") &&
  JSON.parse(cr.out).find((x: Any) => x.id === "people-map").on === false, conf("plugins"))
await vau("plugin", "on", "People")
check("vau plugin on (by name)", conf("plugins").enabled.includes("people"), conf("plugins"))
cr = await vau("plugins", "--json")
check("vau plugins: an offByDefault plugin is off until turned on", JSON.parse(cr.out).find((x: Any) => x.id === "dock-icon").on === false, cr.out.slice(0, 200))
await vau("plugin", "on", "dock-icon")
cr = await vau("plugins", "--json")
check("vau plugin on: an offByDefault plugin goes in enabled", conf("plugins").enabled.includes("dock-icon") && !conf("plugins").disabled.includes("dock-icon") &&
  JSON.parse(cr.out).find((x: Any) => x.id === "dock-icon").on === true, conf("plugins"))
await vau("plugin", "off", "dock-icon")
check("vau plugin off: and out of it", !conf("plugins").enabled.includes("dock-icon") && !conf("plugins").disabled.includes("dock-icon"), conf("plugins"))
fs.writeFileSync(path.join(VAULT, ".vaultite/appearance.json"), JSON.stringify({ scheme: "default", mine: "x" }, null, 2) + "\n")
cr = await vau("appearance", "theme", "dark")
check("vau appearance: sets one key, keeps the rest", cr.code === 0 && conf("appearance").theme === "dark" && conf("appearance").mine === "x" && conf("appearance").scheme === "default", conf("appearance"))
await vau("appearance", "density", "comfortable")
await vau("appearance", "fileIcons", "off")
await vau("appearance", "lineNumbers", "on")
cr = await vau("appearance", "snippets", "wide, big")
check("vau appearance snippets: ones that aren't there are refused", cr.code === 1 && cr.err.includes("wide"), cr)
write(".vaultite/snippets/wide.css", "")
write(".vaultite/snippets/big.css", "")
await vau("appearance", "snippets", "wide, big")
check("vau appearance: numbers, booleans and lists", conf("appearance").density === "comfortable" && conf("appearance").fileIcons === false && conf("appearance").lineNumbers === true &&
  JSON.stringify(conf("appearance").snippets) === '["wide","big"]', conf("appearance"))
cr = await vau("appearance", "scheme", "tokyo-night")
check("vau appearance scheme: the app's schemes", cr.code === 0 && conf("appearance").scheme === "tokyo-night", cr)
cr = await vau("appearance", "scheme", "theme:Nowhere")
check("vau appearance scheme: an Obsidian theme that isn't in the vault is refused", cr.code === 1 && conf("appearance").scheme === "tokyo-night", cr)
write(".vaultite/themes/Cove/theme.css", ".theme-dark { --background-primary: #111; }")
cr = await vau("appearance", "scheme", "theme:Cove")
check("vau appearance scheme: an Obsidian theme in the vault", cr.code === 0 && conf("appearance").scheme === "theme:Cove", cr)
cr = await vau("appearance", "scheme", "sepia")
check("vau appearance scheme: an unknown one is refused", cr.code === 1 && conf("appearance").scheme === "theme:Cove", cr)
cr = await vau("appearance", "theme", "sepia")
check("vau appearance: a bad value is refused", cr.code === 1 && conf("appearance").theme === "dark", cr)
cr = await vau("appearance", "nope", "1")
check("vau appearance: an unknown key is refused without --force", cr.code === 1 && !("nope" in conf("appearance")), cr)
await vau("appearance", "density", "reset")
check("vau appearance reset: the key goes", !("density" in conf("appearance")), conf("appearance"))
cr = await vau("appearance", "fontSize", "17")
check("vau appearance: no font size setting any more (⌘+ / ⌘- zoom)", cr.code === 1 && !("fontSize" in conf("appearance")), cr)
check("vau hotkeys: keys normalized", normalizeKeys("cmd+shift+t") === "Mod+Shift+T" && normalizeKeys("shift+option+ArrowLeft") === "Alt+Shift+ArrowLeft" &&
  normalizeKeys("Mod+\\") === "Mod+\\", normalizeKeys("cmd+shift+t"))
await vau("hotkey", "terminal:open", "cmd+shift+t", "Mod+Alt+T")
check("vau hotkey: written to hotkeys.json", JSON.stringify(conf("hotkeys")["terminal:open"]) === '["Mod+Shift+T","Mod+Alt+T"]', conf("hotkeys"))
await vau("hotkey", "palette:open", "none")
check("vau hotkey none: no shortcut", JSON.stringify(conf("hotkeys")["palette:open"]) === "[]", conf("hotkeys"))
await vau("hotkey", "palette:open", "reset")
check("vau hotkey reset: back to the default", !("palette:open" in conf("hotkeys")) && "terminal:open" in conf("hotkeys"), conf("hotkeys"))
cr = await vau("hotkeys", "--json")
const hk = JSON.parse(cr.out)
check("vau hotkeys: the app's commands, with defaults and changes", hk.find((x: Any) => x.id === "palette:open")?.keys[0] === "Mod+P" &&
  hk.find((x: Any) => x.id === "terminal:open")?.changed === true, hk.slice(0, 3))
cr = await vau("render", "Today")
check("vau render: by name, blocks filled in", cr.code === 0 && cr.out.includes("# Today") && !cr.out.includes("```block-routines"), cr.out.slice(0, 200))
cr = await vau("today")
check("vau today", cr.code === 0 && cr.out.includes("# Today"), cr)
stdinText = "Written by vau.\n"
cr = await vau("write", "Notes/From vau.md")
check("vau write: from stdin", cr.code === 0 && read("Notes/From vau.md").includes("Written by vau."), cr)
cr = await vau("read", "From vau")
check("vau read: by name", cr.code === 0 && cr.out.includes("Written by vau."), cr)
cr = await vau("search", "written", "vau")
check("vau search", cr.code === 0 && cr.out.includes("Notes/From vau.md"), cr)
await vau("pin", "Notes/From vau.md", "--before", "Dashboards/Today.md")
const cliPins = conf("pages").pinned
check("vau pin --before", cliPins.indexOf("Notes/From vau.md") === cliPins.indexOf("Dashboards/Today.md") - 1, cliPins)
await vau("unpin", "From vau")
check("vau unpin", !conf("pages").pinned.includes("Notes/From vau.md"), conf("pages"))
cr = await vau("dashboard", "new", "Focus", "--icon", "target", "--tint", "orange", "--blocks", "routines,week-goals")
check("vau dashboard new: a dashboard file, pinned", cr.code === 0 && read("Dashboards/Focus.md").startsWith("---\ntype: dashboard\nicon: target\ntint: orange\n---\n") &&
  read("Dashboards/Focus.md").includes("```block-week-goals") && conf("pages").pinned.includes("Dashboards/Focus.md"), cr)
cr = await vau("dashboard", "new", "Focus")
check("vau dashboard new: an existing one is refused", cr.code === 1 && cr.err.includes("already exists"), cr)
cr = await vau("blocks", "--json")
check("vau blocks: every block, from the plugins' manifests", JSON.parse(cr.out).some((b: Any) => b.name === "routines" && b.declared && b.description && b.plugin === "today"), cr.out.slice(0, 200))
cr = await vau("blocks", "query")
check("vau blocks <name>: its options, what each takes", cr.code === 0 && cr.out.includes("view (one of table, cards, list, board, calendar, map, default table)") && cr.out.includes("Every block also takes: wide, stack, file."), cr.out)
cr = await vau("blocks", "qury")
check("vau blocks <name>: a name it doesn't know, and the closest", cr.code === 1 && cr.err.includes("did you mean query?"), cr)
cr = await vau("note", "--title", "Vau idea", "--kind", "idea", "--status", "seed", "--body", "From the CLI.")
check("vau note: a note, upserted by a slug", cr.code === 0 && read("Notes/Vau idea.md").includes("id: idea-vau-idea") && read("Notes/Vau idea.md").includes("From the CLI."), cr)
cr = await vau("log", "--area", "workouts", "--title", "Vau workout", "--date", "2026-09-28", "--duration", "45", "--ext-id", "vau-1", "--sets", "12")
check("vau log: flags, and unknown ones are the area's fields", cr.code === 0 && exists("Logs/Workouts/2026-09-28 Vau workout.md") &&
  read("Logs/Workouts/2026-09-28 Vau workout.md").includes("sets: 12") && read("Logs/Workouts/2026-09-28 Vau workout.md").includes("duration_min: 45"), cr)
cr = await vau("plugin", "new", "garden")
check("vau plugin new: a vault plugin, off", cr.code === 0 && ["manifest.json", "plugin.ts", "index.tsx", "AGENTS.md", "pages/Garden.md"].every((f) => exists(`.vaultite/plugins/garden/${f}`)) &&
  !(conf("plugins").enabled ?? []).includes("garden"), cr)
check("vau plugin new: made by this machine's owner, it's allowed here with its edits (an agent writing it reloads it)", app.vaultPlugins.trust.approval("garden")?.edits === true, app.vaultPlugins.trust.approval("garden"))
{
  const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
  const r = await app.runOp("plugin.new", { id: "strangers" }, { http: stranger })
  check("plugin.new by someone else on the tailnet: made, not allowed", (r.result as Any).edits === false && !app.vaultPlugins.trust.approval("strangers"), r.result)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/strangers"), { recursive: true })
}
cr = await vau("plugin", "new", "people")
check("vau plugin new: an app plugin's id is refused", cr.code === 1, cr)
await vau("plugin", "on", "garden")
cr = await vau("plugins", "check", "--json")
const garden = JSON.parse(cr.out).find((x: Any) => x.id === "garden")
check("vau plugin on: the scaffold loads with no problems", conf("plugins").enabled.includes("garden") && garden?.loaded && !garden.problems.length, garden)
cr = await vau("render", "Dashboards/Garden.md")
check("vau plugin new: its block reads as text", cr.out.includes("Markdown files in the vault:"), cr.out)
await vau("plugin", "off", "garden")
// vau open: no window, then two: only the one used last acts.
cr = await vau("open", "Dashboards/Today.md")
check("vau open: no window open says so", cr.code === 1 && cr.err.includes("no app window is open"), cr)
const fakeWindow = () => {
  const w: Any = { OPEN: 1, readyState: 1, got: [] as Any[], close: () => {} }
  w.send = (t: string) => w.got.push(JSON.parse(t))
  w.on = (ev: string, fn: Any) => { w[`on_${ev}`] = fn }
  w.say = (m: object) => w.on_message(Buffer.from(JSON.stringify(m)))
  return w
}
const w1 = fakeWindow(), w2 = fakeWindow()
uiLive.client(w1)
uiLive.client(w2)
w1.say({ type: "active" })
await sleep(5)
cr = await vau("open", "Today", "--split", "down")
const uiOf = (w: Any) => w.got.filter((m: Any) => m.type === "ui")
check("vau open: the window used last gets it", cr.code === 0 && uiOf(w1).length === 1 && !uiOf(w2).length &&
  uiOf(w1)[0].action === "open" && uiOf(w1)[0].path === "Dashboards/Today.md" && uiOf(w1)[0].split === "down", [cr, w1.got, w2.got])
cr = await vau("open", "Today", "--new-tab", "false")
const nt1 = uiOf(w1).at(-1)
cr = await vau("open", "Today", "--new-tab")
const nt2 = uiOf(w1).at(-1)
check("vau: a switch takes true/false after it, or nothing", nt1.newTab === false && nt2.newTab === true, [nt1, nt2])
w2.say({ type: "active" })
await sleep(5)
await vau("command", "sidebar:toggle")
check("vau command: to the window now in use", uiOf(w2).length === 1 && uiOf(w2)[0].id === "sidebar:toggle" && uiOf(w1).length === 3, [w1.got, w2.got])
cr = await vau("open", "x.md", "--split", "left")
check("vau open: a bad split is refused", cr.code === 1, cr)
// vau notify, with the Inbox on: an event in the inbox (every window toasts it), kept with or without a window.
cr = await vau("notify", "Wrote", "the review", "--action-open", "Today")
let [, inboxNow] = await api("GET", "inbox/events")
check("vau notify: an inbox event, its link a vault path", cr.code === 0 && inboxNow.events[0]?.title === "Wrote the review" && inboxNow.events[0].kind === "info" &&
  inboxNow.events[0].link === "Dashboards/Today.md" && inboxNow.events[0].source === "vau" && !uiOf(w2).some((m: Any) => m.action === "notify"), [cr, inboxNow.events[0]])
await api("DELETE", "inbox/events")
// With the Inbox off: a toast in the window used last, its button opening a vault path.
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: [...(conf("plugins").disabled ?? []), "inbox"] }, null, 2) + "\n")
cr = await vau("notify", "Imported", "12 meals", "--action-label", "See it", "--action-open", "Today")
let toastMsg = uiOf(w2).at(-1)
check("vau notify: to the window in use, with its button", cr.code === 0 && uiOf(w1).length === 3 && toastMsg.action === "notify" &&
  toastMsg.text === "Imported 12 meals" && toastMsg.kind === null && toastMsg.button?.label === "See it" && toastMsg.button?.open === "Dashboards/Today.md", [cr, toastMsg])
cr = await vau("notify", "It broke", "--error")
toastMsg = uiOf(w2).at(-1)
check("vau notify --error: an error toast, no button", cr.code === 0 && toastMsg.kind === "error" && toastMsg.button === null, toastMsg)
cr = await vau("notify", "x", "--action-label", "Open")
check("vau notify: a label without --action-open is refused", cr.code === 1 && cr.err.includes("--action-open"), cr)
cr = await vau("notify")
check("vau notify: the text is required", cr.code === 1 && cr.err.includes("text is missing"), cr)
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: (conf("plugins").disabled ?? []).filter((x: string) => x !== "inbox") }, null, 2) + "\n")
const n = uiOf(w2).length
check("/api/ui notify: empty text, a bad kind or button are refused, nothing sent",
  uiLive.handle("POST", { action: "notify", text: "  " })[1] === 400 && uiLive.handle("POST", { action: "notify", text: "x", kind: "warn" })[1] === 400 &&
  uiLive.handle("POST", { action: "notify", text: "x", button: { label: "Go" } })[1] === 400 && uiOf(w2).length === n)
const [okBody, okStatus] = uiLive.handle("POST", { action: "notify", text: "Hello", button: { open: "Notes/a.md" } }) as [Any, number]
check("/api/ui notify: a button's label defaults to Open", okStatus === 200 && okBody.ok && uiOf(w2).at(-1).button.label === "Open", uiOf(w2).at(-1))
cr = await vau("context", "--json")
const ctxOut = JSON.parse(cr.out)
check("vau context: vault, pinned pages, panels, plugins, appearance, windows", cr.code === 0 && ctxOut.vault === VAULT && ctxOut.windows === 2 &&
  ctxOut.pinned.includes("Dashboards/Today.md") && ctxOut.panels[0].key === "search:search" && ctxOut.panels[0].side === "left" && ctxOut.appearance.theme === "dark", ctxOut)
// vau's own switches: --count and --paths read an answer's list (itself, or its first); a non-list is an error.
cr = await vau("files", "--json")
const allFiles = JSON.parse(cr.out).files.map((f: Any) => f.path)
cr = await vau("files", "--count")
check("vau --count: how many the answer lists", cr.code === 0 && cr.out === String(allFiles.length), [cr, allFiles.length])
cr = await vau("--paths", "files")
check("vau --paths: one path a line, before the command too", cr.code === 0 && cr.out === allFiles.join("\n"), cr)
cr = await vau("item.list", "person", "--paths")
check("vau --paths: an item's id is its file", cr.code === 0 && cr.out.split("\n").includes("People/Alice Park.md"), cr)
cr = await vau("appearance", "theme", "--count")
check("vau --count: an answer that's no list is an error", cr.code === 1 && cr.err.includes("isn't one") && !cr.out, cr)
cr = await vau("ops.list", "--paths")
check("vau --paths: a list of things that aren't files is an error", cr.code === 1 && cr.err.includes("aren't files"), cr)
// stdin: `-` as any value, and a param that takes it (stdin: true) when text is piped in.
stdinText = "Sent from stdin\n"
cr = await vau("notify", "-")
let [, inboxDash] = await api("GET", "inbox/events")
check("vau: - as an argument is stdin", cr.code === 0 && inboxDash.events[0]?.title === "Sent from stdin", [cr, inboxDash.events[0]])
await api("DELETE", "inbox/events")
stdinText = "A body piped in\n"
cr = await vau("note", "Piped", "--json")
check("vau: a stdin param is filled when text is piped in", cr.code === 0 && read(JSON.parse(cr.out).path).includes("\nA body piped in\n"), cr)
stdinText = "  \n"
cr = await vau("note", "Not piped", "--body", "Given", "--json")
check("vau: a stdin param given isn't read", cr.code === 0 && read(JSON.parse(cr.out).path).includes("\nGiven\n"), cr)
stdinText = ""
// The window answers asks (core/live.ts ask): dev tools and its commands, only once it said it answers.
const answers: Record<string, (m: Any) => Any> = {}
w2.send = (t: string) => {
  const m = JSON.parse(t)
  w2.got.push(m)
  const fn = answers[`${m.action}:${m.what ?? ""}`]
  if (m.rid && fn) setTimeout(() => { try { w2.say({ type: "ui-done", rid: m.rid, ran: true, result: fn(m) }) } catch (e) { w2.say({ type: "ui-done", rid: m.rid, ran: false, error: (e as Error).message }) } }, 1)
}
w2.say({ type: "active" })
cr = await vau("dev", "console")
check("vau dev: a window that doesn't answer asks (an older app) says so", cr.code === 1 && cr.err.includes("older version"), cr)
cr = await vau("commands", "--json")
check("vau commands: no window that answers, the app's source", cr.code === 0 && JSON.parse(cr.out).from === "source" && JSON.parse(cr.out).commands.some((c: Any) => c.id === "palette:open"), cr.out.slice(0, 200))
w2.say({ type: "caps", answers: true })
answers["commands:"] = () => [{ id: "z:last", name: "Last", keys: [], available: false }, { id: "a:first", name: "First thing", keys: ["Mod+1"], available: true }]
cr = await vau("commands")
check("vau commands: the window's, sorted, those that can't run now marked", cr.code === 0 && /^a:first\s+First thing\nz:last\s+Last {2}\(not now\)$/.test(cr.out), cr)
cr = await vau("commands", "first", "--count")
const cr2 = await vau("commands", "--available", "--count")
check("vau commands: a word, --available", cr.code === 0 && cr.out === "1" && cr2.out === "1", [cr, cr2])
answers["dev:dom"] = (m) => ({ selector: m.selector, count: 3, matches: m.all ? ["<p>a</p>", "<p>b</p>", "<p>c</p>"] : ["<p>a</p>"] })
cr = await vau("dev", "dom", "p")
check("vau dev dom: the first match, and how many", cr.code === 0 && cr.out === "3 matches (the first shown):\n\n<p>a</p>" && w2.got.at(-1).all === false, cr)
cr = await vau("dev", "dom", "p", "--all", "--count")
check("vau dev dom --all --count", cr.code === 0 && cr.out === "3", cr)
answers["dev:eval"] = (m) => { if (m.code === "bad") throw new Error("bad is not defined"); return { value: { code: m.code } } }
cr = await vau("dev", "eval", "1 + 1")
check("vau dev eval: the value as JSON", cr.code === 0 && JSON.parse(cr.out).code === "1 + 1", cr)
cr = await vau("dev", "eval", "bad")
check("vau dev eval: the window's error, exit 1", cr.code === 1 && cr.err === "vau dev eval: bad is not defined" && !cr.out, cr)
stdinText = "document.title\n"
cr = await vau("dev", "eval")
check("vau dev eval: the code piped in", cr.code === 0 && JSON.parse(cr.out).code === "document.title", cr)
stdinText = ""
const png = Buffer.from("not really a png")
answers["dev:screenshot"] = () => ({ png: png.toString("base64"), width: 2, height: 1 })
const shot = path.join(tmp, "shots", "one.png")
cr = await vau("dev", "screenshot", "--out", shot)
check("vau dev screenshot: saved where asked, its path printed", cr.code === 0 && cr.out === shot && fs.readFileSync(shot).equals(png), cr)
// secret.ask (core/coreops/secret.ts): a hidden field in the window; only the value comes back, printed as is.
answers["secret:"] = (m) => ({ value: `pw for ${m.prompt}`, base64: false })
cr = await vau("secret", "Wi-Fi password")
check("vau secret: the value given, nothing else", cr.code === 0 && cr.out === "pw for Wi-Fi password" && (cr as Any).exact === true && w2.got.findLast((x: Any) => x.action === "secret")?.file === false, cr)
answers["secret:"] = () => null
cr = await vau("secret", "A key", "--file")
check("vau secret: dismissed, it fails and prints nothing", cr.code === 1 && !cr.out && cr.err.includes("didn't give it") && w2.got.findLast((x: Any) => x.action === "secret")?.file === true, cr)
delete answers["secret:"]
const secretEntry = app.catalog().find((e) => e.id === "secret.ask")
check("secret.ask: no MCP tool (secrets stay on the user's machines), printed exactly", secretEntry?.mcp === null && secretEntry?.exact === true, secretEntry)
const mcpRefused = await app.callOp("secret.ask", { prompt: "x" }, { client: "mcp", agent: null, label: "Claude", source: "claude" }).then(() => null, (e: Any) => e)
check("secret.ask: refused over MCP (its call tool too)", mcpRefused?.status === 403, mcpRefused?.message)
const waiting = uiLive.drive({ action: "secret", key: "k1", prompt: "x", timeout: 30 })
await new Promise((r) => setTimeout(r, 20))
await uiLive.drive({ action: "ask-cancel", key: "k1" })
check("ask-cancel: a keyed ask ends with nothing (answered elsewhere), its window told to close it", (await waiting) === null && w2.got.at(-1)?.action === "ask-end", w2.got.at(-1))
delete answers["dev:eval"]
let t0 = Date.now()
cr = await vau("dev", "eval", "1", "--timeout", "1")
check("vau dev eval: no answer in time says so", cr.code === 1 && cr.err.includes("didn't answer within 1 s") && Date.now() - t0 < 3000, cr)
check("POST /api/ui: no dev asks (only the owner's ops)", uiLive.handle("POST", { action: "dev", what: "eval", code: "1" })[1] === 400)
const devOps = app.catalog().filter((e) => e.id.startsWith("dev."))
check("dev ops: four, the owner's only, no MCP tool of their own", devOps.length === 4 && devOps.every((e) => e.owner && !e.mcp), devOps.map((e) => [e.id, e.owner, e.mcp]))
const stranger = { headers: { host: "127.0.0.1:8793", "x-forwarded-for": "100.64.0.9" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage
const devRefused = await app.callOp("dev.eval", { code: "1" }, undefined, { http: stranger }).then(() => null, (e: Any) => e)
check("dev ops: refused to anyone but this machine's owner", devRefused?.status === 403, devRefused?.message)
// The prompt (core/repl.ts): lines split like a shell, Tab from the catalog.
const sameJson = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
const { split, complete } = await import("../core/repl.ts")
const sp = split(`open "People/Alice P`)
check("vau prompt: a line split like a shell, the last word as typed", sameJson(sp.words, ["open", "People/Alice P"]) && sp.partial === "People/Alice P" && sp.quote === "\"" && sp.start === 5, sp)
check("vau prompt: quotes and backslashes", sameJson(split(`note 'a b' c\\ d ""`).words, ["note", "a b", "c d", ""]) && split("files ").partial === "" && split("files ").start === 6)
const src = { ops: app.catalog(), local: ["sandbox", "events"], files: async () => ["People/Alice Park.md", "People/Bob Lee.md", "Notes/My idea.md"], commandIds: async () => ["sidebar:toggle", "palette:open"] }
const tab = (line: string) => complete(line, src)
check("vau prompt: Tab completes names, a group's words, ids once typed", sameJson(await tab("fil"), ["files"]) && (await tab("bundle ")).includes("apply") && (await tab("panels ")).includes("move") && sameJson(await tab("help dev d"), ["dom"]) && sameJson(await tab("dev s"), ["screenshot"]) &&
  (await tab("note.c")).includes("note.create") && (await tab("sand")).includes("sandbox"), [await tab("fil"), await tab("bundle "), await tab("dev s"), await tab("note.c"), await tab("sand")])
check("vau prompt: Tab completes flags", sameJson(await tab("files --l"), ["--limit"]) && (await tab("files --")).includes("--count") && (await tab("open x --")).includes("--new-tab"))
check("vau prompt: Tab completes choices", sameJson(await tab("dev console --level w"), ["warn"]) && sameJson(await tab("open x --split "), ["down", "right"]))
check("vau prompt: Tab completes paths a folder at a time, quoted when they need it", sameJson(await tab("open Peo"), ["People/"]) && sameJson(await tab("open People/A"), ["\"People/Alice Park.md\""]) &&
  sameJson(await tab("open \"Notes/"), ["\"Notes/My idea.md\""]) && sameJson(await tab("open Bob"), ["\"People/Bob Lee.md\""]), [await tab("open Peo"), await tab("open People/A")])
check("vau prompt: Tab completes palette command ids", sameJson(await tab("command side"), ["sidebar:toggle"]))
answers["command:"] = () => null // (the window answers the commands later tests send it)
uiLive.close()
// bin/vau as agents run it, against a made-up server: stdin a socket left open or /dev/null, piped into a reader that
// stops early, errors as a non-zero exit on stderr; --copy through the system's clipboard tool.
{
  const http = await import("node:http")
  const { spawn } = await import("node:child_process")
  const big = "line of text\n".repeat(200_000)
  const entry = (id: string, cli: string, params: Record<string, Any> = {}) => ({ id, plugin: null, summary: id, help: "", kind: "read", params: { type: "object", properties: params }, args: [], cli, mcp: null, result: null, owner: null })
  const stub = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      const send = (status: number, out: unknown, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(typeof out === "string" ? out : JSON.stringify(out)) }
      if (req.url === "/api/ops") return send(200, [entry("big.text", "big"), entry("bad.thing", "boom"), entry("echo.body", "echo", { body: { type: "string", stdin: true, description: "x" } })])
      if (req.url?.startsWith("/api/ops/big.text")) return send(200, big, "text/plain")
      if (req.url?.startsWith("/api/ops/bad.thing")) return send(500, { error: "it broke" })
      if (req.url?.startsWith("/api/ops/echo.body")) return send(200, `body: ${JSON.parse(body || "{}").body ?? "(none)"}`, "text/plain")
      send(404, { error: "not found" })
    })
  })
  await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", ok))
  const url = `http://127.0.0.1:${(stub.address() as Any).port}`
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "vau")
  const run = (args: string[], o: { stdin?: "pipe" | "ignore"; input?: string; stopAfter?: number; env?: Record<string, string> } = {}) => new Promise<{ code: number | null; out: string; err: string; ms: number }>((resolve) => {
    const t = Date.now()
    const p = spawn(process.execPath, [bin, ...args], { stdio: [o.stdin ?? "pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", HOME: tmp, VAULTITE_URL: url, ...o.env } })
    let out = "", err = ""
    p.stdout!.on("data", (c) => {
      out += c
      if (o.stopAfter && out.length >= o.stopAfter) p.stdout!.destroy() // (`| head -c`: the reader goes away)
    })
    p.stderr!.on("data", (c) => { err += c })
    if (o.input !== undefined) p.stdin?.end(o.input)
    const kill = setTimeout(() => p.kill(), 10_000)
    p.on("close", (code) => { clearTimeout(kill); resolve({ code, out, err, ms: Date.now() - t }) })
  })
  let r = await run(["big"], { stopAfter: 10 })
  check("bin/vau: piped into a reader that stops, it ends quietly", r.code === 0 && !r.err, { code: r.code, err: r.err.slice(0, 300) })
  r = await run(["echo"])
  check("bin/vau: stdin an open socket nobody writes to isn't waited for", r.code === 0 && r.out === "body: (none)\n" && r.ms < 5000, r)
  r = await run(["echo"], { input: "piped text\n" })
  check("bin/vau: a stdin param from a socket that writes", r.code === 0 && r.out === "body: piped text\n", r)
  r = await run(["echo", "--body", "-"], { stdin: "ignore" })
  check("bin/vau: - with stdin /dev/null is empty, not a hang", r.code === 0 && r.out === "body: \n", r)
  r = await run(["boom"], { stdin: "ignore" })
  check("bin/vau: a server error is exit 1, on stderr", r.code === 1 && r.out === "" && r.err === "vau boom: it broke\n", r)
  r = await run(["nope"], { stdin: "ignore" })
  check("bin/vau: an unknown command is exit 2, on stderr", r.code === 2 && r.out === "" && r.err.includes("no command 'nope'"), r)
  check("bin/vau: --count on a text-only answer is an error", (await run(["boom", "--count"], { stdin: "ignore" })).code === 1)
  r = await run([], { stdin: "ignore" })
  check("bin/vau: no arguments without a terminal is the help, exit 0", r.code === 0 && r.out.startsWith("vau: drive Vaultite"), r.out.slice(0, 100))
  stub.close()
  const { toClipboard } = await import("../core/cli.ts")
  const fake = path.join(tmp, "fakebin")
  fs.mkdirSync(fake, { recursive: true })
  fs.writeFileSync(path.join(fake, "pbcopy"), `#!/bin/sh\nexec /bin/cat > "${path.join(fake, "clip.txt")}"\n`, { mode: 0o755 })
  const said = await toClipboard("copied text", "darwin", { PATH: fake })
  check("vau --copy: the text through the system's tool", said === "" && fs.readFileSync(path.join(fake, "clip.txt"), "utf8") === "copied text", said)
  check("vau --copy: no tool says which it looked for", (await toClipboard("x", "linux", { PATH: fake })).includes("xclip"))
}

// The core's ops (core/coreops/) through vau: what's around them on this computer (LOCAL), settings key by key, items of
// any kind, bundles, and the ops that are MCP tools answering an MCP client as the tools do.
{
  const a = path.join(tmp, "vau-a.txt"), b = path.join(tmp, "vau-b.txt")
  write("Notes/Vau merge.md", "One\nTwo\nThree\n")
  fs.writeFileSync(a, read("Notes/Vau merge.md"))
  fs.writeFileSync(b, "One\nTwo, changed\nThree\n")
  write("Notes/Vau merge.md", "One\nTwo\nThree\nFour, on disk meanwhile\n")
  cr = await vau("write", "Notes/Vau merge.md", "--from", b, "--base", a)
  check("vau write --from --base: files on this computer; a change on disk meanwhile is merged", cr.code === 0 &&
    read("Notes/Vau merge.md") === "One\nTwo, changed\nThree\nFour, on disk meanwhile\n", [cr, read("Notes/Vau merge.md")])
  cr = await vau("write", "Notes/Vau merge.md", "--from", path.join(tmp, "nowhere.txt"))
  check("vau write --from: a file that isn't there says so", cr.code === 1 && cr.err.includes("can't read"), cr)
  cr = await vau("read", "Vau merge", "--json")
  check("vau read --json: the file as GET /api/file answers it", cr.code === 0 && JSON.parse(cr.out).path === "Notes/Vau merge.md", cr)
  fs.rmSync(path.join(VAULT, "Notes/Vau merge.md"))

  write(".vaultite/appearance.json", JSON.stringify({ theme: "dark", mine: 1 }, null, 4) + "\n")
  cr = await vau("settings", "set", "appearance", JSON.stringify({ density: "comfortable", mine: null }))
  check("vau settings set: only the keys given (null removes one)", cr.code === 0 && JSON.stringify(conf("appearance")) === '{"theme":"dark","density":"comfortable"}', [cr, conf("appearance")])
  cr = await vau("settings", "plugin/nope")
  check("vau settings: a plugin's data.json (none yet: {})", cr.code === 0 && cr.out.includes("{}"), cr)
  cr = await vau("settings", "secrets")
  check("vau settings: only the app's settings files", cr.code === 1 && cr.err.includes("plugin/<id>"), cr)
  write(".vaultite/appearance.json", "{\"theme\": \"da")
  cr = await vau("appearance", "theme", "light")
  check("a settings file that doesn't read (mid-sync) is never overwritten", cr.code === 1 && read(".vaultite/appearance.json") === "{\"theme\": \"da", [cr, read(".vaultite/appearance.json")])
  write(".vaultite/appearance.json", JSON.stringify({ theme: "dark" }) + "\n")
  cr = await vau("appearance", "theme")
  check("vau appearance <key>: its value", cr.code === 0 && cr.out === 'theme: "dark"', cr)

  cr = await vau("item.create", "note", JSON.stringify({ title: "Item op", ext_id: "item-op", body: "From item.create." }))
  check("item.create: a note of any kind's fields", cr.code === 0 && exists("Notes/Item op.md") && read("Notes/Item op.md").includes("From item.create."), cr)
  cr = await vau("item.update", "notes", "item-op", JSON.stringify({ status: "seed" }))
  check("item.update: by its key, by collection", cr.code === 0 && read("Notes/Item op.md").includes("status: seed"), [cr, read("Notes/Item op.md")])
  cr = await vau("item.get", "note", "Item op", "--json")
  check("item.get: by its file name", cr.code === 0 && JSON.parse(cr.out).status === "seed", cr)
  cr = await vau("item.list", "note", "--json")
  check("item.list", cr.code === 0 && JSON.parse(cr.out).some((x: Any) => x.title === "Item op"), cr.out.slice(0, 200))
  cr = await vau("item.list", "pottery")
  check("item.list: an unknown kind lists the kinds", cr.code === 1 && cr.err.includes("person (people)"), cr)
  cr = await vau("item.delete", "note", "Item op")
  check("item.delete: to the trash", cr.code === 0 && !exists("Notes/Item op.md"), cr)

  cr = await vau("bundle", "save", "Vau desk", "--description", "Made by a test")
  const desk = path.join(tmp, "vau-desk.bundle.json")
  const exported = await vau("bundle", "export", "vau-desk", desk)
  const printed = await vau("bundle", "export", "vau-desk", "-")
  check("vau bundle export: to a file on this computer, or printed", cr.code === 0 && exported.code === 0 && fs.existsSync(desk) &&
    JSON.parse(fs.readFileSync(desk, "utf8")).id === "vau-desk" && JSON.parse(printed.out).vaultite === "bundle", [cr, exported, printed.out.slice(0, 100)])
  await vau("bundle", "delete", "vau-desk")
  cr = await vau("bundle", "import", desk)
  check("vau bundle import: from a file on this computer", cr.code === 0 && exists(".vaultite/bundles/vau-desk/bundle.json"), cr)
  cr = await vau("bundle", "list")
  check("vau bundle list: the user's too", cr.code === 0 && /vau-desk +yours +Vau desk/.test(cr.out), cr)
  cr = await vau("bundle", "delete", "vau-desk")
  check("vau bundle delete: each delete kept in the trash", cr.code === 0 && !exists(".vaultite/bundles/vau-desk") &&
    fs.readdirSync(path.join(VAULT, ".trash/.vaultite/bundles")).filter((f) => f.startsWith("vau-desk ")).length === 2, cr)
  write("Scratch/Trashed twice.txt", "one\n")
  await api("GET", "state")
  const [, t1] = await api("DELETE", "file?path=Scratch/Trashed twice.txt")
  write("Scratch/Trashed twice.txt", "two\n")
  await api("GET", "state")
  const [, t2] = await api("DELETE", "file?path=Scratch/Trashed twice.txt")
  check("trash: a file deleted twice keeps both copies", t1.trashed !== t2.trashed && read(t1.trashed) === "one\n" && read(t2.trashed) === "two\n", [t1, t2])
  cr = await vau("bundle")
  check("vau bundle: its subcommands", cr.code === 0 && cr.out.includes("vau bundle apply"), cr)

  cr = await vau("icon.list", "--json")
  check("icon.list: the icons a page can name", cr.code === 0 && JSON.parse(cr.out).includes("target"), cr.out.slice(0, 200))
  cr = await vau("plugins", "check")
  check("vau plugins check", cr.code === 0 && cr.out.includes("garden (off)"), cr)
  cr = await vau("plugin")
  check("vau plugin: its subcommands", cr.code === 0 && cr.out.includes("vau plugin on") && cr.out.includes("vau plugin new"), cr)

  // A folder said as a path stays the folder: its last part never picks a file of that name (a dashboard won ties).
  const { pathAsSaid } = await import("../core/ops.ts")
  const saidTree = { files: [{ path: "Work.md", type: "dashboard" }, { path: "Home/Logs/Work/Run.md" }], others: [], folders: ["Home", "Home/Logs", "Home/Logs/Work"] }
  check("pathAsSaid: a folder is kept, in its own case", pathAsSaid(saidTree, "Home/Logs/Work") === "Home/Logs/Work" && pathAsSaid(saidTree, "home/logs/work/") === "Home/Logs/Work")
  check("pathAsSaid: a web address is its web tab", pathAsSaid(saidTree, " http://localhost:4317/ ") === "view:web/http://localhost:4317/" && pathAsSaid(saidTree, "HTTPS://example.com") === "view:web/HTTPS://example.com")
  check("pathAsSaid: a file's name still finds it", pathAsSaid(saidTree, "work") === "Work.md" && pathAsSaid(saidTree, "Old/Work") === "Work.md")

  // MCP's tools that are ops now: an answer as text for an MCP client (they were checked against the old tools, which
  // are gone, before those went).
  const { whoOf } = await import("../core/ops.ts")
  await vault.synced()
  const asMcp = async (id: string, params: Any) => {
    const { op, params: p, result, who } = await app.runOp(id, params, { who: whoOf("mcp", "claude-code") })
    return op.text!(result, p, who)
  }
  for (const [tool, id, args] of [["search", "file.search", { query: "Written" }], ["read", "file.read", { path: "From vau" }], ["render", "file.render", { path: "Today" }],
    ["list", "file.list", { folder: "Notes" }], ["list", "file.list", {}], ["query", "query.run", { type: "person", columns: ["file", "relation"], sort: "file" }]] as [string, string, Any][]) {
    const got = await asMcp(id, args)
    check(`op ${id}: an MCP client gets its answer as text, as the ${tool} tool (${JSON.stringify(args)})`, typeof got === "string" && got.trim().length > 0 && !got.startsWith("```json"), got.slice(0, 300))
  }
  const entry = (id: string) => app.catalog().find((e) => e.id === id)
  check("ops: MCP's search, read, render, list and query are ops with those tool names, read-only", ["search", "read", "render", "list", "query"]
    .every((n) => app.catalog().some((e) => e.mcp === n && e.kind === "read")) && entry("file.read")?.cli === "read", app.catalog().filter((e) => e.mcp).map((e) => e.mcp))
  // A file's actions: the ops that act on its type, the file filled in.
  const acts = (await app.runOp("file.actions", { path: "People/Alice Park.md" })).result as Any
  const tl = acts.actions.find((a: Any) => a.op === "person.timeline-add")
  check("file.actions: a person's are its kind's ops (and any file's), its name filled in, what's still needed listed", acts.type === "person" && !!tl &&
    tl.params.person === "Alice Park" && tl.needs.join() === "kind,text" && acts.actions.some((a: Any) => a.op === "archive.add") && !acts.actions.some((a: Any) => a.op === "archive.restore" || a.op === "book.progress"), acts)
  const { actionProblems } = await import("../core/actions.ts")
  check("actions: one naming a param the op doesn't have is a problem", actionProblems("x.y", { on: ["person"], param: "who", label: "Do" }, ["person"]).length === 1)
  check("actions: as text, one line each with its op", /- Add to timeline: person\.timeline-add person="Alice Park", needs kind, text/.test(await asMcp("file.actions", { path: "People/Alice Park.md" })))
  cr = await vau("read", "From vau")
  check("vau read: the file's text exactly (no path before it, as an MCP client gets)", cr.code === 0 && cr.out === read("Notes/From vau.md").replace(/\n$/, ""), cr)

  // Agents page through what's long, every cut says where to go on, and a page can't be written back over the file.
  const longText = Array.from({ length: 3000 }, (_, i) => `Line ${i + 1} ${"x".repeat(60)}`).join("\n") + "\n"
  write("Notes/Long read.md", longText)
  await vault.synced()
  const p1 = await asMcp("file.read", { path: "Notes/Long read.md" })
  const m1 = /\(lines 1-(\d+) of 3000; more: offset (\d+); to change it: edit_file/.exec(p1)
  check("read over MCP: a long file in pages, cut at a line, saying where to go on", !!m1 && Number(m1[2]) === Number(m1[1]) + 1 && p1.length < 101_000 && p1.includes(`Line ${m1[1]} `) && !p1.includes(`Line ${m1[2]} `), p1.slice(-200))
  const pages = [p1]
  let at = Number(m1?.[2])
  while (at && pages.length < 10) {
    const p = await asMcp("file.read", { path: "Notes/Long read.md", offset: at })
    pages.push(p)
    at = Number(/; more: offset (\d+)/.exec(p)?.[1] ?? 0)
  }
  const joined = pages.map((p) => p.slice(p.indexOf("\n\n") + 2).replace(/\n\(lines [^\n]*\)$/, "")).join("")
  check("read: offset goes on from there, every line once, to the end", joined === longText && /\(lines \d+-3000 of 3000; to change it/.test(pages.at(-1)!), [pages.length, pages.at(-1)!.slice(-200)])
  const few = (await app.runOp("file.read", { path: "Notes/Long read.md", offset: 10, limit: 2 })).result as Any
  check("read: offset and limit give exactly those lines (the API too)", few.text === `Line 10 ${"x".repeat(60)}\nLine 11 ${"x".repeat(60)}\n` && few.lines === 3000 && few.to === 11, few)
  const opErr = async (id: string, params: Any, who = whoOf("mcp", "claude-code")) => { try { await app.runOp(id, params, { who }); return "" } catch (e) { return (e as Error).message } }
  const pageBody = p1.slice(p1.indexOf("\n\n") + 2)
  check("write_file: a page as read is refused (it would drop the rest)", /drop the rest/.test(await opErr("file.write", { path: "Notes/Long read.md", text: pageBody })) && read("Notes/Long read.md") === longText)
  check("write_file: a file longer than one read needs base over MCP", /longer than one read/.test(await opErr("file.write", { path: "Notes/Long read.md", text: "short\n" })) && read("Notes/Long read.md") === longText)
  const page = few.text
  await app.runOp("file.write", { path: "Notes/Long read.md", text: page.replace("Line 10 ", "Line ten "), base: page }, { who: whoOf("mcp", "claude-code") })
  check("write_file: a page written with base changes it and keeps the rest", read("Notes/Long read.md") === longText.replace("Line 10 ", "Line ten "), read("Notes/Long read.md").slice(0, 300))
  await app.runOp("file.edit", { path: "Notes/Long read.md", old: "Line 2999 ", new: "Line two nine nine nine " }, { who: whoOf("mcp", "claude-code") })
  check("edit_file: replaces just that text, the rest kept", read("Notes/Long read.md") === longText.replace("Line 10 ", "Line ten ").replace("Line 2999 ", "Line two nine nine nine "))
  check("edit_file: text found more than once, or not at all, is refused with what to do", /3000 times.*all: true/.test(await opErr("file.edit", { path: "Notes/Long read.md", old: ` ${"x".repeat(60)}`, new: "y" })) &&
    /isn't in/.test(await opErr("file.edit", { path: "Notes/Long read.md", old: "nowhere to be found", new: "y" })))
  await app.runOp("file.edit", { path: "Notes/Long read.md", old: "x".repeat(60), new: "y", all: true })
  check("edit_file: all replaces every one", !read("Notes/Long read.md").includes("xxxx") && read("Notes/Long read.md").split("\n").length === 3001)
  for (let i = 0; i < 25; i++) write(`Paged search/Hit ${String(i).padStart(2, "0")}.md`, `pagedneedle ${"word ".repeat(80)}\n`)
  await vault.synced()
  const s1 = await asMcp("file.search", { query: "pagedneedle", folder: "Paged search", sort: "name" })
  const s2 = await asMcp("file.search", { query: "pagedneedle", folder: "Paged search", sort: "name", offset: 20 })
  check("search: a page says where the next starts; a long line ends in …", /\(more files match: offset 20\)$/.test(s1) && (s1.match(/^- /gm) ?? []).length === 20 && s1.includes("…") &&
    (s2.match(/^- /gm) ?? []).length === 5 && s2.includes("Hit 24") && !s2.includes("more files match"), [s1.slice(-200), s2])
  const l1 = await asMcp("file.list", { folder: "Paged search", limit: 10, offset: 10 })
  check("list: a page with offset, saying what's left", l1.includes("Hit 10") && !l1.includes("Hit 09") && /\(files 11-20 of 25; more: offset 20/.test(l1), l1)
  write("Paged search/Long cell.md", `---\ntype: longcell\nsummary: ${"y".repeat(300)}\n---\n`)
  await vault.synced()
  const q1 = await asMcp("query.run", { type: "longcell", columns: ["file", "summary"] })
  const q2 = await asMcp("query.run", { from: ["Paged search"], columns: ["file"], sort: "file", limit: 10 })
  check("query: a cut cell ends in … and says how to get it whole; a page says the next offset", q1.includes(`${"y".repeat(200)}…`) && q1.includes("read its file") &&
    q2.startsWith("Rows 1-10 of 26 files; more: offset 10."), [q1.slice(-300), q2.slice(0, 80)])
}

// Appearance: Obsidian themes as colour schemes, CSS snippets, appearance.json keys kept
write(".vaultite/themes/Harbor/manifest.json", JSON.stringify({ name: "Harbor", version: "1.0.0", author: "Bob Lee" }))
write(".vaultite/themes/Harbor/theme.css", `/* @settings
name: Harbor
id: harbor
settings:
  -
    id: harbor-accent
    type: class-select
    default: harbor-teal
*/
body { --accent-h: 200; --harbor-ink: 20, 30, 40; }
.theme-light { --background-primary: #fdfdfd; --background-secondary: #eeeeee; --text-normal: rgb(var(--harbor-ink)); --color-red: #c00; }
.theme-dark, .theme-dark.harbor-teal { --background-primary: #101820; --text-normal: #e0e0e0; }
.theme-dark.harbor-teal { --interactive-accent: #20b2aa; }
.theme-dark.harbor-plum { --interactive-accent: #8e4585; }
.theme-dark .markdown-preview-view { --background-primary: #ff00ff; }
@media (max-width: 400px) { body { --background-primary: #00ff00; } }
.theme-light { --h1-color: inherit; --h2-color: var(--color-red); }
`)
{
  const [s1, themes] = await api("GET", "themes")
  const harbor = themes.find((t: Any) => t.name === "Harbor")
  check("themes: listed with their manifest", s1 === 200 && harbor?.author === "Bob Lee" && harbor.modes.length === 2, themes)
  const [s2, css] = await api("GET", "themes/Harbor.css")
  const light = String(css).split(".dark {")[0], dark = String(css).split(".dark {")[1] ?? ""
  check("themes: converted to a scheme keyed theme:<Name>", s2 === 200 && String(css).includes('[data-scheme="theme:Harbor"]'), String(css).slice(0, 200))
  check("themes: var() resolved, secondary is the light page", light.includes("--foreground: rgb(20, 30, 40);") && light.includes("--background: #eeeeee;"), light)
  check("themes: Style Settings defaults and specificity apply", dark.includes("--primary: #20b2aa;") && !String(css).includes("#8e4585"), dark)
  check("themes: rules for parts of the page and @media are left out", !String(css).includes("#ff00ff") && !String(css).includes("#00ff00"))
  check("themes: headings: inherit falls back, a colour maps", light.includes("--h1: rgb(20, 30, 40);") && light.includes("--h2: #c00;"), light)
  check("themes: Obsidian's defaults fill what it doesn't set", /--red: #fb464c;/.test(dark) && /--green: #08b94e;/.test(light), dark)
  const [s3] = await api("GET", "themes/Nope.css")
  check("themes: a missing one is a 404", s3 === 404, s3)
  write(".vaultite/themes/Night/theme.css", ".theme-dark { --background-primary: #000; --text-normal: #fff; }")
  const [, again] = await api("GET", "themes")
  check("themes: a dark-only theme says so", again.find((t: Any) => t.name === "Night")?.modes.join() === "dark", again)
}
{
  const [s1, made] = await api("POST", "snippets", { name: "Wide lines" })
  check("snippets: a new one is made in .vaultite/snippets", s1 === 200 && made.path === ".vaultite/snippets/Wide lines.css" && exists(made.path), made)
  const [, made2] = await api("POST", "snippets", { name: "Wide lines" })
  check("snippets: a taken name gets a number", made2.name === "Wide lines 1", made2)
  const [s2] = await api("POST", "snippets", { name: "../x" })
  check("snippets: names stay in the folder", s2 === 400, s2)
  write(".vaultite/snippets/Wide lines.css", ".vau-editor { max-width: none; }\n")
  const [s3, css] = await api("GET", "snippets/Wide%20lines.css")
  check("snippets: served as they are", s3 === 200 && css === ".vau-editor { max-width: none; }\n", css)
  const [, list] = await api("GET", "snippets")
  check("snippets: listed with their times", list.some((x: Any) => x.name === "Wide lines 1") && list.every((x: Any) => x.mtime > 0), list)
  const [, state] = await api("GET", "state")
  check("state: themes and snippets in appearance", state.appearance?.themes.some((t: Any) => t.name === "Night") && state.appearance?.snippets.some((x: Any) => x.name === "Wide lines"), state.appearance)
  const [s4, opened] = await api("GET", "file?path=.vaultite/snippets/Wide lines.css")
  check("snippets: open in the editor by path with hidden files off", s4 === 200 && opened.text.includes("max-width"), opened)
}
{
  write(".vaultite/appearance.json", JSON.stringify({ theme: "dark", scheme: "nord", density: "comfortable", fontSize: 18, fromCli: 1 }))
  await api("PUT", "config/appearance", { theme: "light", scheme: "theme:Harbor", snippets: ["Wide lines"] })
  const saved = JSON.parse(read(".vaultite/appearance.json"))
  check("appearance: a PUT keeps keys it doesn't send", saved.fromCli === 1 && saved.density === "comfortable" && saved.scheme === "theme:Harbor" && saved.snippets[0] === "Wide lines", saved)
}

// ---------- workspaces (plugins/core/workspaces): a file per workspace ----------
{
  let [st, body] = await api("GET", "workspaces")
  check("workspaces: none yet", st === 200 && Array.isArray(body.workspaces) && !body.workspaces.length, body)
  ;[st, body] = await api("PUT", "workspaces/2", { sidebars: { left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }, name: "Shells" })
  check("workspaces: a slot is made, the ones before it empty", st === 200 && body.name === "Shells" &&
    JSON.stringify(readWs().workspaces.map((w: Any) => w && w.name)) === JSON.stringify([null, "Shells"]), readWs())
  ;[st, body] = await api("PUT", "workspaces/2", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Mac.md" }], active: "t1" }, focus: "g0" }, name: null })
  check("workspaces: keys merge, null removes one", st === 200 && body.sidebars.left[0] === "terminal:sessions" && body.layout.focus === "g0" && !("name" in body), body)
  ;[st] = await api("PUT", "workspaces/6", { name: "Six" })
  check("workspaces: only 1 to 5", st === 400)
  const s2 = (await api("GET", "state"))[1]
  check("workspaces: in /api/state", s2.workspaces?.[1]?.sidebars?.left[0] === "terminal:sessions", s2.workspaces)
  ;[st] = await api("DELETE", "workspaces/2")
  check("workspaces: deleting empties the slot (trailing empties dropped)", st === 200 && readWs().workspaces.length === 0, readWs())
  // Two devices: a phone writes slot 1 while the file on disk already has another device's slot 2 (written behind the
  // server's back): the write goes into the file as it is then, and slot 2 stays.
  writeWs(({ workspaces: [null, { layout: { root: { id: "g0", tabs: [{ id: "t9", to: "file:Mac.md" }], active: "t9" }, focus: "g0" } }], other: 1 }))
  ;[st] = await api("PUT", "workspaces/1", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Phone.md" }], active: "t1" }, focus: "g0" } })
  const both = readWs()
  check("workspaces: a write to one slot keeps another device's slot and other keys", st === 200 &&
    both.workspaces[0].layout.root.tabs[0].to === "file:Phone.md" && both.workspaces[1].layout.root.tabs[0].to === "file:Mac.md" && both.other === 1, both)
  write(`${WS_DIR}/1.json`, "{\"layout\": {")
  ;[st] = await api("PUT", "workspaces/1", { name: "Half" })
  check("workspaces: an unreadable file (mid-sync) isn't overwritten", st === 409 && read(`${WS_DIR}/1.json`) === "{\"layout\": {", [st, read(`${WS_DIR}/1.json`)])
  clearWs()
  const cw = await vau("workspace")
  check("vau workspace: lists them", cw.code === 0 && cw.out.includes("no workspaces yet"), cw)

  // Moving a tab to another workspace (POST /api/workspaces/move): out of its pane, onto the end of the target's
  // focused pane, applied to the file as it is.
  const g = (id: string, tabs: [string, string][], active = tabs[0]?.[0]) => ({ id, tabs: tabs.map(([i, to]) => ({ id: i, to })), active })
  writeWs(({ workspaces: [
    { name: "Main", layout: { root: { id: "s1", dir: "row", sizes: [0.5, 0.5], kids: [
      g("g0", [["a", "file:Notes/A.md"], ["b", "file:Notes/B.md"]], "b"), g("g1", [["c", "view:terminal/abc"]])] }, focus: "g1" } },
    { sidebars: { left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }, layout: { root: { id: "s2", dir: "col", sizes: [0.5, 0.5], kids: [
      g("h0", [["x", "file:Notes/X.md"]]), g("h1", [["y", "file:Notes/Y.md"]])] }, focus: "h1" } },
    null,
    { layout: { root: g("k0", [["n", "new"]]), focus: "k0" } },
  ], other: 1 }))
  const wsNow = readWs
  ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "b" })
  let w = wsNow().workspaces
  check("workspaces move: the tab leaves its pane (the next one shown) and ends the target's focused pane, not shown there",
    st === 200 && body.from === 1 && body.to === 2 && body.tab.id === "b" &&
    JSON.stringify(w[0].layout.root.kids[0]) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])) &&
    JSON.stringify(w[1].layout.root.kids[1]) === JSON.stringify(g("h1", [["y", "file:Notes/Y.md"], ["b", "file:Notes/B.md"]], "y")) &&
    w[1].layout.focus === "h1" && w[1].sidebars.left[0] === "terminal:sessions" && wsNow().other === 1 && body.workspaces[1].layout.root.kids[1].tabs.length === 2, [st, body, w])
  ;[st, body] = await api("POST", "workspaces/move", { to: 3, path: "view:terminal/abc" })
  w = wsNow().workspaces
  check("workspaces move: a pane's last tab closes the pane; an empty target is made with that tab (no sidebars of its own)",
    st === 200 && body.from === 1 && JSON.stringify(w[0].layout.root) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])) && w[0].layout.focus === "g0" &&
    JSON.stringify(w[2].layout.root) === JSON.stringify(g("g0", [["c", "view:terminal/abc"]])) && !("sidebars" in w[2]), [st, body, w])
  ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 4, path: "Notes/A.md" })
  w = wsNow().workspaces
  check("workspaces move: a workspace's only tab leaves a blank one (kept: it's named); an unused target (a lone blank tab) gets the tab in its place",
    st === 200 && w[0].name === "Main" && w[0].layout.root.tabs.length === 1 && w[0].layout.root.tabs[0].to === "new" && w[0].layout.root.active === w[0].layout.root.tabs[0].id &&
    JSON.stringify(w[3].layout.root) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])), [st, w])
  ;[st, body] = await api("POST", "workspaces/move", { to: 2, path: "Notes/A.md", from: 1 })
  check("workspaces move: a tab that isn't there is a 404", st === 404, [st, body])
  ;[st, body] = await api("POST", "workspaces/move", { to: 4, tab: "a" })
  check("workspaces move: onto its own workspace is refused", st === 400, [st, body])
  ;[st, body] = await api("POST", "workspaces/move", { to: 7, tab: "a" })
  check("workspaces move: only 1 to 5", st === 400, [st, body])
  // The same id taken in the target (ids are made per device): the moved tab gets a new one.
  writeWs(({ workspaces: [{ layout: { root: g("g0", [["t", "file:Notes/A.md"], ["u", "file:Notes/B.md"]]), focus: "g0" } },
    { layout: { root: g("g0", [["t", "file:Notes/Other.md"]]), focus: "g0" } }, { layout: { root: g("g0", [["v", "file:Notes/A.md"]]), focus: "g0" } }] }))
  ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "t" })
  w = wsNow().workspaces
  check("workspaces move: an id taken in the target gets a new one", st === 200 && body.tab.id !== "t" && w[1].layout.root.tabs.map((x: Any) => x.id).join() === `t,${body.tab.id}`, [st, body, w])
  let cm = await vau("workspace", "tabs")
  check("vau workspace tabs: every workspace's panes and tabs", cm.code === 0 && cm.out.includes("1. Workspace 1") && cm.out.includes("    u  Notes/B.md") && cm.out.includes("  pane 1 *"), cm)
  cm = await vau("workspace", "tabs", "3", "--json")
  check("vau workspace tabs <n> --json", cm.code === 0 && JSON.parse(cm.out)[0].panes[0].tabs[0].path === "Notes/A.md", cm)
  cm = await vau("workspace", "move", "Notes/A.md", "4")
  check("vau workspace move: a file open in several workspaces needs --from", cm.code === 1 && cm.err.includes("--from"), cm)
  cm = await vau("workspace", "move", "Notes/A.md", "4", "--from", "2")
  check("vau workspace move --from", cm.code === 0 && wsNow().workspaces[3].layout.root.tabs[0].to === "file:Notes/A.md" && !wsNow().workspaces[1].layout.root.tabs.some((x: Any) => x.to === "file:Notes/A.md"), [cm, wsNow()])
  cm = await vau("workspace", "move", "u", "3")
  check("vau workspace move: by tab id", cm.code === 0 && cm.out.includes("from workspace 1 to workspace 3") && wsNow().workspaces[2].layout.root.tabs.some((x: Any) => x.id === "u"), cm)
  cm = await vau("workspace", "move", "Nowhere.md", "3")
  check("vau workspace move: a file open nowhere", cm.code === 1 && cm.err.includes("isn't open"), cm)
  cm = await vau("workspace", "--help")
  check("vau workspace --help: tabs and move", cm.code === 0 && cm.out.includes("vau workspace tabs") && cm.out.includes("vau workspace move"), cm)
  const before = "{\"layout\""
  write(`${WS_DIR}/1.json`, before)
  ;[st] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "t" })
  check("workspaces move: an unreadable file (mid-sync) isn't overwritten", st === 409 && read(`${WS_DIR}/1.json`) === before, [st, read(`${WS_DIR}/1.json`)])

  // Closing tabs (POST /api/workspaces/close): one by its id, or every tab showing a path, in one workspace or in all.
  writeWs(({ workspaces: [
    { name: "Main", layout: { root: { id: "s1", dir: "row", sizes: [0.5, 0.5], kids: [
      g("g0", [["a", "file:Notes/A.md"], ["b", "view:terminal/claude-k3j2"]], "b"), g("g1", [["c", "view:terminal/claude-k3j2"]])] }, focus: "g1" } },
    { name: "Other", layout: { root: g("h0", [["d", "view:terminal/claude-k3j2"], ["e", "file:Notes/A.md"]]), focus: "h0" } },
  ] }))
  ;[st, body] = await api("POST", "workspaces/close", { path: "view:terminal/claude-k3j2" })
  w = wsNow().workspaces
  check("workspaces close: every tab showing a path, in every workspace; a pane left with none closes, the next tab shows",
    st === 200 && body.closed.map((x: Any) => `${x.workspace}${x.id}`).join() === "1b,1c,2d" &&
    JSON.stringify(w[0].layout.root) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])) && w[0].layout.focus === "g0" &&
    JSON.stringify(w[1].layout.root) === JSON.stringify(g("h0", [["e", "file:Notes/A.md"]])), [st, body, w])
  ;[st, body] = await api("POST", "workspaces/close", { path: "Notes/A.md", from: 2 })
  w = wsNow().workspaces
  check("workspaces close from: only that workspace's; its last tab leaves a blank one",
    st === 200 && w[0].layout.root.tabs[0].to === "file:Notes/A.md" && w[1].layout.root.tabs.length === 1 && w[1].layout.root.tabs[0].to === "new", [st, w])
  ;[st, body] = await api("POST", "workspaces/close", { tab: "zz" })
  check("workspaces close: a tab open nowhere is a 404", st === 404, [st, body])
  ;[st, body] = await api("POST", "workspaces/close", { tab: "a", path: "Notes/A.md" })
  check("workspaces close: a tab or a path, not both", st === 400, [st, body])
  cm = await vau("workspace", "close", "a")
  check("vau workspace close: by tab id", cm.code === 0 && cm.out.includes("Notes/A.md") && wsNow().workspaces[0].layout.root.tabs[0].to === "new", [cm, wsNow()])
  writeWs(({ workspaces: [{ layout: { root: g("g0", [["t", "file:Notes/A.md"], ["u", "file:Notes/B.md"]]), focus: "g0" } },
    { layout: { root: g("g0", [["t", "file:Notes/B.md"], ["v", "file:Notes/A.md"]]), focus: "g0" } }] }))
  ;[st, body] = await api("POST", "workspaces/close", { tab: "t" })
  check("workspaces close: a tab id in several workspaces needs from", st === 409 && String(body.error).includes("from"), [st, body])
  cm = await vau("workspace", "close", "Notes/A.md")
  check("vau workspace close: a file closes everywhere", cm.code === 0 && cm.out.includes("2 tabs") &&
    !wsNow().workspaces.some((x: Any) => x.layout.root.tabs.some((t: Any) => t.to === "file:Notes/A.md")), [cm, wsNow()])

  // Unused is one definition (plugins/core/workspaces/blank.ts): no name, the default sidebars (none of its own, or the
  // same as sidebars.json's) and a lone blank tab. It reads as null, and a write that leaves a slot like that empties it.
  const side = { left: ["files:files"], right: [], collapsed: [], heights: {} }
  write(".vaultite/sidebars.json", JSON.stringify(side))
  writeWs(({ workspaces: [
    { layout: { root: g("g0", [["a", "file:Notes/A.md"], ["b", "file:Notes/B.md"]], "b"), focus: "g0" } },
    { sidebars: side, layout: { root: g("k0", [["n", "new"]]), focus: "k0" } },
    { name: "Named", layout: { root: g("k0", [["n", "new"]]), focus: "k0" } },
    { sidebars: { left: ["terminal:sessions"] } },
  ] }))
  ;[st, body] = await api("GET", "workspaces")
  check("workspaces unused: a lone blank tab with the default sidebars reads as null; a name or its own sidebars is a workspace (read leniently)",
    body.workspaces[0]?.layout && body.workspaces[1] === null && body.workspaces[2]?.name === "Named" &&
    JSON.stringify(body.workspaces[3]?.sidebars) === JSON.stringify({ left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }), body)
  ;[st, body] = await api("PUT", "workspaces/3", { name: null })
  check("workspaces unused: a write that leaves a slot unused empties it (and the others like it)",
    st === 200 && body === null && JSON.stringify(readWs().workspaces.map((x: Any) => !!x)) === "[true,false,false,true]", [body, readWs()])
  ;[st, body] = await api("PUT", "workspaces/5", { layout: { root: g("x", [["y", "new"]]), focus: "x" } })
  check("workspaces unused: a blank tab written to an unused slot isn't kept", st === 200 && body === null && readWs().workspaces.length === 4, readWs())
  ;[st, body] = await api("PUT", "workspaces/2", { name: "Fresh" })
  check("workspaces unused: a slot made by a write has no sidebars of its own", st === 200 && body.name === "Fresh" && !("sidebars" in body), body)
  fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"))

  // A whole pane moved (`group`): it leaves as its tabs would, and becomes a pane of its own on the right of the target's.
  writeWs(({ workspaces: [
    { layout: { root: { id: "s1", dir: "row", sizes: [0.5, 0.5], kids: [g("g0", [["a", "file:Notes/A.md"], ["b", "file:Notes/B.md"]], "b"), g("g1", [["c", "view:terminal/abc"]])] }, focus: "g1" } },
    { name: "Two", layout: { root: g("g0", [["x", "file:Notes/X.md"]]), focus: "g0" } },
  ] }))
  ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, group: "g0" })
  w = wsNow().workspaces
  check("workspaces move pane: its tabs leave together (the pane closes; the focus stays on the other)",
    st === 200 && JSON.stringify(w[0].layout.root) === JSON.stringify(g("g1", [["c", "view:terminal/abc"]])) && w[0].layout.focus === "g1", [st, body, w])
  check("workspaces move pane: a pane of its own on the right of the target's (a new id where its own is taken), shown tab kept, focus unchanged",
    w[1].layout.root.dir === "row" && w[1].layout.root.kids.length === 2 && JSON.stringify(w[1].layout.root.sizes) === "[0.5,0.5]" &&
    w[1].layout.root.kids[0].id === "g0" && body.group !== "g0" && w[1].layout.root.kids[1].id === body.group &&
    w[1].layout.root.kids[1].tabs.map((x: Any) => x.id).join() === "a,b" && w[1].layout.root.kids[1].active === "b" && w[1].layout.focus === "g0" &&
    body.tabs.length === 2, [body, w])
  ;[st, body] = await api("POST", "workspaces/move", { to: 2, group: "g1" })
  w = wsNow().workspaces
  check("workspaces move pane: a workspace's last pane leaves it unused (null); the target's row gets a third, evenly",
    st === 200 && w[0] === null && w[1].layout.root.kids.length === 3 && w[1].layout.root.sizes.every((x: number) => Math.abs(x - 1 / 3) < 1e-9), [st, w])
  ;[st, body] = await api("POST", "workspaces/move", { from: 2, to: 4, group: "g1" })
  w = wsNow().workspaces
  check("workspaces move pane: into an unused workspace it's the whole layout", st === 200 && JSON.stringify(w[3].layout.root) === JSON.stringify(g("g1", [["c", "view:terminal/abc"]])) && w[3].layout.focus === "g1", [st, w])
  ;[st] = await api("POST", "workspaces/move", { from: 2, to: 3, group: "nope" })
  check("workspaces move pane: a pane that isn't there is a 404", st === 404)
  ;[st] = await api("POST", "workspaces/move", { from: 2, to: 3, group: "g0", tab: "x" })
  check("workspaces move: one thing at a time", st === 400)

  // Files opened in another workspace (`open`: a file dragged from the tree onto a number): new tabs at the end of its
  // pane focused last, not shown; one already open there is left alone.
  write("Notes/Qa ws open.md", "Opened elsewhere.\n")
  ;[st, body] = await api("POST", "workspaces/move", { to: 4, open: ["Notes/Qa ws open.md"] })
  w = wsNow().workspaces
  check("workspaces open: a new tab at the end of the focused pane, not shown", st === 200 && body.tabs.length === 1 &&
    w[3].layout.root.tabs.map((x: Any) => x.to).join() === "view:terminal/abc,file:Notes/Qa ws open.md" && w[3].layout.root.active === "c", [body, w])
  ;[st, body] = await api("POST", "workspaces/move", { to: 4, open: "Notes/Qa ws open.md" })
  check("workspaces open: already open there: nothing changes", st === 200 && !body.tabs.length && wsNow().workspaces[3].layout.root.tabs.length === 2, [body, wsNow()])
  ;[st, body] = await api("POST", "workspaces/move", { to: 5, open: ["Notes/Qa ws open.md"] })
  check("workspaces open: an unused workspace gets it as its only tab", st === 200 && wsNow().workspaces[4].layout.root.tabs.map((x: Any) => x.to).join() === "file:Notes/Qa ws open.md", wsNow())
  ;[st] = await api("POST", "workspaces/move", { to: 5, open: ["Notes/Nowhere.md"] })
  check("workspaces open: a file that isn't there is a 404", st === 404)
  cm = await vau("workspace", "open", "Notes/Qa ws open.md", "1")
  check("vau workspace open", cm.code === 0 && cm.out.includes("Opened") && wsNow().workspaces[0].layout.root.tabs[0].to === "file:Notes/Qa ws open.md", [cm, wsNow()])
  cm = await vau("workspace", "move", "Notes/Qa ws open.md", "3", "--from", "4", "--pane")
  check("vau workspace move --pane: the whole pane that has it", cm.code === 0 && cm.out.includes("2 tabs") &&
    wsNow().workspaces[3] === null && wsNow().workspaces[2].layout.root.tabs.length === 2, [cm, wsNow()])
  cm = await vau("workspace")
  check("vau workspace: unused ones say so", cm.code === 0 && cm.out.includes("4. (unused)"), cm)
  fs.rmSync(path.join(VAULT, "Notes/Qa ws open.md"))
  clearWs()

  // A workspace's pinned pages (its own list once it changes one: a copy of pages.json's) and state (what the app
  // keeps per workspace). A home page is no longer a thing: an old `home` is dropped on the next write.
  write("Notes/Qa desk a.md", "A\n")
  write("Notes/Qa desk b.md", "B\n")
  const pagesWas = read(".vaultite/pages.json")
  const vaultPins: string[] = conf("pages").pinned
  ;[st, body] = await api("POST", "workspaces/2/pins", { path: "Notes/Qa desk a.md", pinned: true })
  check("workspace pins: the first pin copies the vault's list (pins make the workspace used)", st === 200 &&
    body.pinned.join() === [...vaultPins, "Notes/Qa desk a.md"].join() && readWs().workspaces[1].pinned.join() === body.pinned.join() &&
    read(".vaultite/pages.json") === pagesWas, [body, readWs()])
  ;[st, body] = await api("POST", "workspaces/2/pins", { path: "Notes/Qa desk b.md", pinned: true, before: "Notes/Qa desk a.md" })
  check("workspace pins: before another", st === 200 && body.pinned.slice(-2).join() === "Notes/Qa desk b.md,Notes/Qa desk a.md", body)
  ;[st] = await api("POST", "workspaces/2/pins", { path: "Notes/Nowhere.md", pinned: true })
  check("workspace pins: a file that isn't there is a 404", st === 404)
  ;[st, body] = await api("POST", "workspaces/3/pins", { path: vaultPins[0], pinned: false })
  check("workspace pins: an unpin copies the vault's list too, pages.json untouched", st === 200 && body.pinned.join() === vaultPins.slice(1).join() &&
    wsNow().workspaces[2].pinned.join() === vaultPins.slice(1).join() && read(".vaultite/pages.json") === pagesWas, [body, wsNow()])
  ;[st, body] = await api("POST", "workspaces/3/pins", { path: "Notes/Nowhere.md", pinned: false })
  check("workspace pins: unpinning what isn't there changes nothing", st === 200 && body.pinned.join() === vaultPins.slice(1).join(), body)
  ;[st, body] = await api("POST", "workspaces/3/pins/default", {})
  check("workspace pins: its list for new workspaces (pages.json's)", st === 200 && conf("pages").pinned.join() === vaultPins.slice(1).join(), [body, conf("pages")])
  write(".vaultite/pages.json", pagesWas)
  ;[st] = await api("PUT", "workspaces/3", { pinned: null })
  check("workspace pins: none of its own again (the vault's)", st === 200 && !wsNow().workspaces[2], wsNow())
  ;[st, body] = await api("PUT", "workspaces/2", { state: { "files:open": ["Notes"], "core:recent": ["Notes/Qa desk b.md"] } })
  check("workspaces: state saved", st === 200 && body.state["files:open"][0] === "Notes", body)
  ;[st, body] = await api("PUT", "workspaces/2", { state: { "files:open": null, "graph:depth": 2 } })
  check("workspaces: state merges key by key (null removes one)", st === 200 && !("files:open" in body.state) &&
    body.state["core:recent"][0] === "Notes/Qa desk b.md" && body.state["graph:depth"] === 2, body)
  ;[st, body] = await api("PUT", "workspaces/3", { state: { "files:open": ["Notes"] } })
  check("workspaces: state alone doesn't make a workspace used", st === 200 && body === null && !wsNow().workspaces[2], [body, wsNow()])
  await api("PUT", "workspaces/2", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Notes/Qa desk b.md" }, { id: "t2", to: "view:terminal/qadesk1" }], active: "t1" }, focus: "g0" } })
  const tabsOpen = (await import("../core/plugins.ts")).service(app.plugins, "tabs:open") as () => string[]
  check("workspaces: every workspace's tabs, for Terminal (tabs:open)", tabsOpen().includes("view:terminal/qadesk1") && tabsOpen().includes("file:Notes/Qa desk b.md"), tabsOpen())
  ;[st] = await api("POST", "file/move", { from: "Notes/Qa desk b.md", to: "Notes/Qa desk moved.md" })
  w = wsNow().workspaces
  check("workspaces: a moved file's pins and tabs follow it", st === 200 && w[1].pinned.slice(-2).join() === "Notes/Qa desk moved.md,Notes/Qa desk a.md" &&
    w[1].layout.root.tabs[0].to === "file:Notes/Qa desk moved.md", w)
  ;[st] = await api("DELETE", "file?path=Notes/Qa desk a.md")
  w = wsNow().workspaces
  check("workspaces: a trashed file's pin goes", st === 200 && w[1].pinned.join() === [...vaultPins, "Notes/Qa desk moved.md"].join(), w)
  cm = await vau("pin", "Notes/Qa desk moved.md", "--workspace", "4")
  check("vau pin --workspace: a copy of the vault's list, with it", cm.code === 0 && cm.out.includes("workspace 4") &&
    wsNow().workspaces[3].pinned.join() === [...vaultPins, "Notes/Qa desk moved.md"].join(), [cm, wsNow()])
  cm = await vau("unpin", "Notes/Qa desk moved.md", "--workspace", "4")
  check("vau unpin --workspace", cm.code === 0 && wsNow().workspaces[3].pinned.join() === vaultPins.join(), [cm, wsNow()])
  cm = await vau("pages", "--workspace", "2")
  check("vau pages --workspace", cm.code === 0 && cm.out.includes("Qa desk moved"), cm)
  const sidebarsWas = exists(".vaultite/sidebars.json") ? read(".vaultite/sidebars.json") : null
  cm = await vau("panels", "hide", "search", "--workspace", "2")
  check("vau panels --workspace: that workspace's panels (the service sidebars:of), sidebars.json untouched", cm.code === 0 && cm.out.startsWith("Workspace 2") &&
    Array.isArray(wsNow().workspaces[1].sidebars?.left) && !wsNow().workspaces[1].sidebars.left.includes("search:search") &&
    (exists(".vaultite/sidebars.json") ? read(".vaultite/sidebars.json") : null) === sidebarsWas, [cm, wsNow().workspaces[1]])
  cm = await vau("workspace", "2")
  check("vau workspace <n>: the window used last switches (the command workspace:<n>)", cm.code === 0 && cm.out === "Sent workspace:2." && uiOf(w2).at(-1)?.id === "workspace:2", [cm, uiOf(w2).at(-1)])
  cm = await vau("workspace", "list", "--json")
  check("vau workspace list", cm.code === 0 && JSON.parse(cm.out).workspaces[1].pinned.length > 0, cm)
  cm = await vau("workspace", "home", "none", "2")
  check("vau workspace home: gone", cm.code !== 0 || !cm.out.includes("blank"), cm)
  fs.rmSync(path.join(VAULT, "Notes/Qa desk moved.md"))
  clearWs()
}

// Claude Code: one session's conversation (plugins/core/claude-code/transcript.ts), from the fixture.
{
  const sid = "0a1b2c3d-1111-4222-8333-444455556666"
  const tfile = path.join(CLAUDE_DIR, "projects", "-Users-sam-lighthouse", `${sid}.jsonl`)
  let [c, t] = await api("GET", `claude-code/session/${sid}`)
  check("claude session: found by id, with title, folder, model and times", c === 200 && t.title === "Upload test fix" &&
    t.cwd === "/Users/sam/lighthouse" && t.model === "Opus 5.5" && t.project === "lighthouse" && t.branch === "main" &&
    t.first === "2026-09-28T09:00:01.000Z" && t.last === "2026-09-28T09:01:01.000Z", [c, { ...t, entries: undefined }])
  const kinds = t.entries?.map((e: Any) => e.kind).join(",")
  check("claude session: what was said and each tool call, nothing else (thinking, meta, sidechain, attachments)",
    kinds === "user,assistant,tool,tool,assistant,user" && t.total === 6 && t.start === 0, kinds)
  check("claude session: system reminders left out, a slash command as a command", t.entries[0].text === "Fix the flaky upload test" &&
    t.entries[5].text === "`/review upload`", [t.entries[0].text, t.entries[5]?.text])
  const [bash, read] = [t.entries[2], t.entries[3]]
  check("claude session: a tool call is one line with its result", bash.name === "Bash" && bash.summary === "Run the upload tests" &&
    bash.error === true && bash.result === "1 failing: upload retries" && JSON.parse(bash.input).command === "npm test -- upload" &&
    read.summary === "/Users/sam/lighthouse/test/upload.test.ts" && read.result === "it('retries', ...)" && !read.error, [bash, read])
  ;[, t] = await api("GET", `claude-code/session/${sid}?limit=2`)
  check("claude session: a page is the newest entries, and says where it starts", t.start === 4 && t.entries.length === 2 &&
    t.entries[0].kind === "assistant", [t.start, t.entries?.length])
  ;[, t] = await api("GET", `claude-code/session/${sid}?limit=2&before=4`)
  check("claude session: earlier pages", t.start === 2 && t.entries[0].name === "Bash", [t.start])
  // A running session: lines appended are read on from where it stopped; a long output is cut.
  fs.appendFileSync(tfile, JSON.stringify({ type: "assistant", sessionId: sid, cwd: "/Users/sam/lighthouse", timestamp: "2026-09-28T09:02:00.000Z",
    message: { model: "claude-opus-5-5", id: "msg_9", role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "Grep", input: { pattern: "retry", path: "src" } }] } }) + "\n" +
    JSON.stringify({ type: "user", sessionId: sid, timestamp: "2026-09-28T09:02:01.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "x".repeat(9000) }] } }) + "\n")
  ;[, t] = await api("GET", `claude-code/session/${sid}`)
  const g = t.entries.at(-1)
  check("claude session: a growing transcript is read on", t.total === 7 && g.name === "Grep" && g.summary === "retry in src" &&
    g.result.length < 4200 && g.result.includes("more characters"), [t.total, g?.summary, g?.result?.length])
  ;[c] = await api("GET", "claude-code/session/nope")
  check("claude session: an unknown session is a 404", c === 404, c)
  ;[c] = await api("GET", "claude-code/session/..%2F..%2Fetc")
  check("claude session: not a path", c === 404, c)
  const [, cr] = await api("GET", "render?path=Dashboards/Claude.md")
  check("the Claude page has projects and models as two blocks", typeof cr === "string" && cr.includes("## Claude Code by project") &&
    cr.includes("## Claude Code by model") && cr.includes("lighthouse"), String(cr).slice(0, 400))
  const tpl = fs.readFileSync(path.join(import.meta.dirname, "..", "plugins", "core", "claude-code", "pages", "Claude.md"), "utf8")
  check("the Claude page template has both blocks", tpl.includes("```block-claude-projects\n```") && tpl.includes("```block-claude-models\n```"), tpl)
}

// Claude Code accounts: a sibling of the config folder with sessions is an account; a private one's usage counts, but
// not its titles, folders or conversations; Terminal starts Claude Code in an account (its profile).
{
  const WORK = path.join(tmp, "claude-work")
  const sid = "0d1e2f3a-4444-4555-8666-777788889999"
  const at = new Date(fixtureNow() - 60_000).toISOString()
  fs.mkdirSync(path.join(WORK, "projects", "-Users-sam-acme"), { recursive: true })
  fs.writeFileSync(path.join(WORK, "projects", "-Users-sam-acme", `${sid}.jsonl`), [
    { type: "user", uuid: "w0", sessionId: sid, cwd: "/Users/sam/acme", timestamp: at, message: { role: "user", content: "Migrate the billing tables" } },
    { type: "assistant", uuid: "w1", sessionId: sid, cwd: "/Users/sam/acme", timestamp: at, requestId: "req_w1",
      message: { model: "claude-opus-5-5", id: "msg_w1", role: "assistant", content: [{ type: "text", text: "Done." }],
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: "ai-title", sessionId: sid, aiTitle: "Billing tables migration" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n")
  let [c, accts] = await api("GET", "claude-code/accounts")
  check("claude accounts: the config folder and a sibling with sessions", c === 200 &&
    JSON.stringify(accts.map((a: Any) => a.id)) === JSON.stringify(["default", "work"]) && accts[1].label === "Work", accts)
  let [, u] = await api("GET", "claude-code?days=7")
  let s = u.sessions?.find((x: Any) => x.id === sid)
  check("claude accounts: all of them at once, each session with its account", s?.account === "work" && s.accountLabel === "Work" &&
    s.title === "Billing tables migration" && s.project === "acme" && u.accounts?.length === 2 && Array.isArray(u.servers), [s, u.accounts])
  ;[, u] = await api("GET", "claude-code?days=7&account=default")
  check("claude accounts: one account", !u.sessions.some((x: Any) => x.id === sid) && u.accounts.length === 1, u.accounts)
  ;[c] = await api("GET", "claude-code?account=nope")
  check("claude accounts: an unknown one is a 404", c === 404, c)
  ;[c] = await api("GET", `claude-code/session/${sid}`)
  check("claude accounts: another account's conversation reads", c === 200, c)
  write(".vaultite/plugins/claude-code/data.json", JSON.stringify({ accounts: { work: { label: "Job", private: true }, default: { label: "Mine" } } }))
  ;[, u] = await api("GET", "claude-code?days=7")
  s = u.sessions.find((x: Any) => x.id === sid)
  check("claude accounts: a private one's sessions have no title or folder, its projects are one, named after it",
    s?.private === true && s.title === "" && s.cwd === "" && s.root === "" && s.project === "Job" && s.cost > 0 &&
    u.projects.some((p: Any) => p.name === "Job" && p.root === "") && !u.projects.some((p: Any) => p.name === "acme"), [s, u.projects])
  ;[c] = await api("GET", `claude-code/session/${sid}`)
  check("claude accounts: a private one's conversation isn't read", c === 404, c)
  const [, rendered] = await api("GET", "render?path=Dashboards/Claude.md")
  check("claude accounts: blocks as text say nothing of a private session", !String(rendered).includes("Billing") && !String(rendered).includes("acme"), String(rendered).slice(0, 300))
  const cc = await import("../plugins/core/claude-code/plugin.ts")
  const start = cc.plugin.services["agent:claude"]
  let run = await start({ resume: null, context: "", state: null, profile: "work" })
  check("claude accounts: a new session in an account runs with its folder", run.command.startsWith(`CLAUDE_CONFIG_DIR='${WORK}' claude`), run)
  run = await start({ resume: sid, context: "", state: null, profile: null })
  check("claude accounts: resuming finds the session's account (a private one too) and its folder", run.command.startsWith(`CLAUDE_CONFIG_DIR='${WORK}' claude --resume`) &&
    run.cwd === "/Users/sam/acme", run)
  run = await start({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "", state: null, profile: null })
  check("claude: a session that isn't on this machine isn't resumed (a note, then a plain shell)", !run.command.includes("claude") && run.command.startsWith("printf") &&
    run.command.includes("no Claude Code session 0000aaaa-1111-4222-8333-444455556666 on this machine"), run)
  write(".vaultite/plugins/claude-code/data.json", JSON.stringify({ accounts: { work: { hidden: true } } }))
  ;[, accts] = await api("GET", "claude-code/accounts")
  check("claude accounts: a hidden one isn't read", accts.length === 1 && accts[0].id === "default", accts)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/claude-code/data.json"))
  fs.rmSync(WORK, { recursive: true })
}

// vau terminal (plugins/core/terminal/ops.ts) on a stand-in API and window (no shells): sessions and their tabs,
// opening, resuming by title, typing, ending, tidying gone agents' tabs.
{
  const calls: string[] = []
  const tabs = [["t1", "claude-live1"], ["t2", "claude-gone1"], ["t3", "k3j2h1g0"], ["t4", "claude-far@m1"]].map(([id, t]) => ({ id, to: `view:terminal/${t}` }))
  const termApi = async (m: string, r: string, b?: unknown) => {
    calls.push(`${m} ${r}${b === undefined ? "" : ` ${JSON.stringify(b)}`}`)
    if (r === "terminals/sessions") return { status: 200, body: { sessions: [{ id: "claude-live1", agent: "claude", process: "claude", clients: 1, started: Date.now() - 120000, title: "Fixing the build", state: "working" }] } }
    if (r === "workspaces") return { status: 200, body: { workspaces: [{ layout: { root: { id: "g0", tabs, active: "t1" }, focus: "g0" } }] } }
    if (r === "workspaces/close") return { status: 200, body: { closed: [{ workspace: 1, id: "t2", to: (b as Any).path }] } }
    if (r === "claude-code?days=30") return { status: 200, body: { sessions: [{ id: "3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f", title: "Left sidebar scrollbar" }, { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", title: "Sidebar tweaks" }] } }
    if (m === "DELETE") return { status: 200, body: { id: r.split("/")[1], ended: true } }
    if (m === "POST" && /^terminals\/[^/]+$/.test(r)) return { status: 200, body: { id: r.split("/")[1], started: true, agent: r.includes("claude") ? "claude" : null } }
    if (m === "POST" && r.endsWith("/send")) return { status: 200, body: { id: r.split("/")[1], ...(b as Any) } }
    if (r === "ui") return { status: 200, body: { ok: true } }
    return { status: 404, body: { error: "not found" } }
  }
  const { plugin: termPlugin } = await import("../plugins/core/terminal/plugin.ts")
  const { checkParams, OpError: OpErr, whoOf } = await import("../core/ops.ts")
  const termCtx = { vault, who: whoOf("cli", null), plugin: "terminal", op: async () => null,
    api: async (m: string, r: string, b?: unknown) => { const x = await termApi(m, r, b); if (x.status >= 400) throw new OpErr(String((x.body as Any)?.error ?? x.status), x.status); return x.body },
    ui: async (msg: Any) => (await termApi("POST", "ui", msg)).body }
  const term = async (verb: string, given: Record<string, unknown> = {}) => {
    const op = termPlugin.ops.find((o) => o.id === `terminal.${verb}`)!
    try {
      const p = checkParams(op, given)
      const r = await op.run(p, termCtx)
      return { code: 0, out: op.text!(r, p), err: "" }
    } catch (e) {
      if (e instanceof OpErr) return { code: 1, out: "", err: e.message }
      throw e
    }
  }
  let tr = await term("list")
  check("vau terminal: the sessions, what runs in them and their tabs; then the tabs whose session is gone (another machine's aren't)",
    tr.code === 0 && tr.out.includes('claude-live1  claude (working)  "Fixing the build"  2m ago, tab in workspace 1') &&
    tr.out.includes("claude-gone1  gone, tab in workspace 1 (an agent's") && tr.out.includes("k3j2h1g0  gone, tab in workspace 1 (a new shell") && !tr.out.includes("claude-far"), tr)
  calls.length = 0
  tr = await term("tidy")
  check("vau terminal tidy: closes the tabs of agents' sessions that are gone, not shells'",
    tr.code === 0 && calls.filter((x) => x.startsWith("POST workspaces/close")).join() === 'POST workspaces/close {"path":"view:terminal/claude-gone1"}', [tr, calls])
  calls.length = 0
  tr = await term("open", { agent: "claude", split: "right" })
  const opened = /^POST terminals\/(claude-[a-z0-9]{8})$/.exec(calls[0] ?? "")?.[1]
  check("vau terminal open <agent>: starts the session, then shows it", tr.code === 0 && !!opened &&
    calls[1] === `POST ui {"action":"open","path":"view:terminal/${opened}","split":"right","newTab":false}`, [tr, calls])
  calls.length = 0
  tr = await term("open", { agent: "nope" })
  check("vau terminal open: an agent no plugin brings is refused (and its shell ended)", tr.code === 1 && tr.err.includes("no agent 'nope'") && calls.some((x) => x.startsWith("DELETE terminals/nope-")), [tr, calls])
  calls.length = 0
  tr = await term("resume", { session: "left sidebar" })
  check("vau terminal resume <title>: the one session with those words, resumed in a tab", tr.code === 0 &&
    calls.includes("POST terminals/resume-claude-3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f") && calls.some((x) => x.includes('"path":"view:terminal/resume-claude-3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f"')), [tr, calls])
  tr = await term("resume", { session: "sidebar" })
  check("vau terminal resume: words in several titles list them", tr.code === 1 && tr.err.includes("2 sessions"), tr)
  calls.length = 0
  tr = await term("send", { id: "k3j2h1g0", text: "npm test" })
  check("vau terminal send: the text, then Enter", tr.code === 0 && calls[0] === 'POST terminals/k3j2h1g0/send {"text":"npm test","enter":true}', [tr, calls])
  calls.length = 0
  tr = await term("end", { id: "claude-live1" })
  check("vau terminal end: ends it and closes its tabs", tr.code === 0 && calls[0] === "DELETE terminals/claude-live1" &&
    calls[1] === 'POST workspaces/close {"path":"view:terminal/claude-live1"}' && tr.out.includes("closed its tab"), [tr, calls])
  tr = await term("end")
  check("vau terminal end: without an id (no VAULTITE_TERMINAL) asks which", tr.code === 1 && tr.err.includes("which terminal"), tr)
  tr = await term("screen", { id: "claude-far@m1" })
  check("vau terminal: another machine's id goes to that machine", tr.code === 1 && tr.err.includes("another machine's"), tr)
  // From the command line (the real routes: a session that isn't there is said, nothing starts): its words as the op's.
  tr = await vau("terminal", "send", "nosuch1", "npm", "test")
  check("vau terminal send: the id, then the rest of the words as the text", tr.code === 1 && tr.err.includes("no terminal session 'nosuch1'"), tr)
  tr = await execute(["terminal", "end"], { api: cliApi, vault: VAULT, env: { VAULTITE_TERMINAL: "nosuch2" }, stdin: async () => "" })
  check("vau terminal end: without an id, the terminal it runs in (VAULTITE_TERMINAL)", tr.code === 1 && tr.err.includes("no terminal session 'nosuch2'"), tr)
  tr = await vau("terminal", "screen", "claude-far@m1")
  check("vau terminal screen: another machine's id, from the command line", tr.code === 1 && tr.err.includes("another machine's"), tr)
}

// vau finds the server when VAULTITE_URL doesn't say: the desktop app's (vaults.json: a port per vault) for the vault
// it's run in, then the default port, then the app's other open vaults, most recent first.
{
  const ud = path.join(tmp, "userdata")
  fs.mkdirSync(ud, { recursive: true })
  fs.writeFileSync(path.join(ud, "vaults.json"), JSON.stringify({ vaults: [{ path: VAULT, port: 21001, open: true, last: 1 },
    { path: path.join(tmp, "other"), port: 21002, open: true, last: 3 }, { path: path.join(tmp, "closed"), port: 21003, open: false, last: 5 }] }))
  const found = servers({ VAULTITE_USER_DATA: ud }, VAULT), outside = servers({ VAULTITE_USER_DATA: ud }, tmp)
  check("vau: the server is the desktop app's for the vault it's run in, then the default, then other open vaults",
    found.join() === "http://127.0.0.1:21001,http://127.0.0.1:8793,http://127.0.0.1:21002" &&
    outside.join() === "http://127.0.0.1:8793,http://127.0.0.1:21002,http://127.0.0.1:21001" &&
    servers({ VAULTITE_USER_DATA: ud, VAULTITE_VAULT: VAULT }, tmp)[0] === "http://127.0.0.1:21001" &&
    servers({ VAULTITE_USER_DATA: path.join(tmp, "none") }, VAULT).join() === "http://127.0.0.1:8793", [found, outside])
}

// Terminal ids: an agent in one of its accounts, and another machine's.
{
  const term = await import("../plugins/core/terminal/plugin.ts")
  const { splitMachine } = await import("../core/plugins.ts")
  check("terminal: an agent's id may name its account", JSON.stringify(term.agentOf("claude_work-k3j2h1g0")) === JSON.stringify({ name: "claude", resume: null, profile: "work" }) &&
    term.agentOf("claude-k3j2h1g0")?.profile === null && term.agentOf("resume-claude-0d1e2f3a-4444")?.resume === "0d1e2f3a-4444", term.agentOf("claude_work-k3j2h1g0"))
  check("terminal: @<machine> is another machine's", JSON.stringify(splitMachine("claude-k3j2@studio")) === JSON.stringify(["claude-k3j2", "studio"]) &&
    JSON.stringify(splitMachine("k3j2h1g0")) === JSON.stringify(["k3j2h1g0", ""]) && term.TERMINAL_ID.test("claude_work-k3@box-2") &&
    !term.TERMINAL_ID.test("a@B") && !term.TERMINAL_ID.test("a@b@c"), splitMachine("claude-k3j2@studio"))
  // What a page gets back from a backend without pictures: the last `scrollback` lines, whole chunks, and a line
  // redrawn without end (a progress bar) held to its share.
  const { Tail } = await import("../plugins/core/terminal/backend.ts")
  const tail = new Tail(100)
  for (let i = 0; i < 500; i++) tail.push(`line ${i}\r\n`)
  const kept = tail.text().split("\r\n").filter(Boolean)
  check("terminal: the replay is the last scrollback lines", kept.length === 100 && kept[0] === "line 400" && kept.at(-1) === "line 499", kept.length)
  for (let i = 0; i < 2000; i++) tail.push(`\r${"#".repeat(50)} ${i}%`)
  check("terminal: output with no line breaks is held to about 200 characters a line", tail.text().length <= 100 * 200 + 60, tail.text().length)
}

// Routes: * is one segment, a last ** the rest.
{
  const { match, Plugin: P } = await import("../core/plugins.ts")
  const fake = Object.create(P.prototype) as InstanceType<typeof P>
  fake.routes = [["GET", "machines/*/**".split("/"), () => 1, {}], ["GET", "machines/self".split("/"), () => 2, {}]]
  const hit = match([fake], "GET", ["machines", "studio", "claude-code", "session", "x"])
  check("routes: ** takes the rest", hit?.[1].join("|") === "studio|claude-code/session/x", hit?.[1])
  check("routes: ** needs one segment at least", match([fake], "GET", ["machines", "studio"]) === null && match([fake], "GET", ["machines", "self"])?.[0]({} as never) === 2)
}

// Machines: the list from the settings, each asked what it is; another machine's API through this one (GET only).
{
  const seen: string[] = []
  let peerVault: string | null = null // this vault's, else its own
  const peer = (await import("node:http")).createServer((req, res) => {
    seen.push(`${req.url} ${req.headers["x-vaultite-client"]}`)
    const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
    if (req.url === "/api/machines/self") return json(200, { instance: "peer-1", host: "box", platform: "linux", version: "0.1.0", commit: "abc1234", plugins: ["terminal", "harbor", "dispatch"],
      vault: peerVault ?? JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins/machines/vault.json"), "utf8")).id })
    if (req.url === "/api/file?path=Notes%2FQa%20there.md") return json(200, { path: "Notes/Qa there.md", text: "Over there.\n" })
    if (req.url === "/api/ops/dispatch.run" && req.method === "POST") {
      let b = ""
      req.on("data", (d) => { b += d })
      req.on("end", () => { seen.push(`dispatch ${b}`); json(200, { id: "claude-qa1", action: "claude", path: "Notes/Qa there.md", shown: false }) })
      return
    }
    if (req.url?.startsWith("/api/harbor/tides")) return json(200, [{ at: "06:10", label: "High" }])
    if (req.url === "/api/claude-code/session/a%20b?limit=2") return json(200, { id: "a b" })
    if (req.url?.startsWith("/api/render/block?")) {
      const q = new URL(req.url, "http://x").searchParams
      res.writeHead(200, { "Content-Type": "text/markdown" })
      return res.end(`## From box: ${q.get("name")} ${q.get("path")} ${q.get("options")}`)
    }
    json(404, { error: "no such thing" })
  })
  await new Promise<void>((r) => peer.listen(0, "127.0.0.1", () => r()))
  const port = (peer.address() as { port: number }).port
  write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [
    { id: "box", label: "Box", url: `http://127.0.0.1:${port}/` }, { id: "gone", url: "http://127.0.0.1:9" }, { id: "Not ok!", url: "x" }, { id: "box", url: "http://other" },
  ] }))
  let [c, ms] = await api("GET", "machines")
  const box = ms.find?.((m: Any) => m.id === "box"), gone = ms.find?.((m: Any) => m.id === "gone")
  check("machines: the listed ones (a usable id and url, each id once), each asked what it is", c === 200 && ms.length === 2 &&
    box?.online && box.label === "Box" && box.host === "box" && box.platform === "linux" && box.commit === "abc1234" && !box.self &&
    box.plugins.includes("terminal") && gone && !gone.online && gone.label === "gone" && gone.error, ms)
  check("machines: asked as a machine", seen.some((x) => x.startsWith("/api/machines/self machine/")), seen)
  const vid = JSON.parse(read(".vaultite/plugins/machines/vault.json")).id
  check("machines: this vault's id, made once, and each machine's", /^[\w-]{36}$/.test(vid) && box?.vault === vid, [vid, box?.vault])
  const [, me] = await api("GET", "machines/self")
  check("machines: what this one says of itself", typeof me.instance === "string" && me.host && me.version && me.plugins.includes("machines"), me)
  let body: Any
  ;[c, body] = await api("GET", "machines/box/harbor/tides")
  check("machines: another machine's API through this one", c === 200 && JSON.parse(String(body))[0].label === "High", [c, body])
  ;[c, body] = await api("GET", "machines/box/claude-code/session/a b?limit=2")
  check("machines: its path encoded and its query kept", c === 200 && JSON.parse(String(body)).id === "a b", [c, body, seen.at(-1)])
  ;[c, body] = await api("GET", "machines/box/nothing")
  check("machines: its errors come back as they are", c === 404 && body.error === "no such thing", [c, body])
  ;[c] = await api("GET", "machines/nope/state")
  check("machines: an unknown machine is a 404", c === 404, c)
  ;[c] = await api("GET", "machines/gone/state")
  check("machines: one that doesn't answer is a 502", c === 502, c)
  ;[c] = await api("POST", "machines/box/notes", {})
  check("machines: only GET goes through", c !== 200, c)
  // Dispatch on another machine: passed on to its server once its copy matches, the terminal named with its machine.
  write("Notes/Qa there.md", "Over there.\n")
  ;[c, body] = await api("POST", "ops/dispatch.run", { path: "Notes/Qa there.md", machine: "box", open: false })
  check("dispatch: on another machine, its terminal there", c === 200 && body.id === "claude-qa1@box" && body.machine === "box" &&
    seen.includes(`dispatch ${JSON.stringify({ path: "Notes/Qa there.md", action: "claude", open: false })}`), [c, body, seen.slice(-3)])
  const passed = await app.runOp("dispatch.run", { path: "Notes/Qa there.md", machine: "box" }, { who: { client: "machine/other", agent: null, label: "other", source: "other" } }).then(() => null, (e: Any) => e)
  check("dispatch: one passed on from another machine isn't passed on again", passed?.status === 409, passed?.message)
  ;[c, body] = await api("POST", "ops/dispatch.run", { path: "Notes/Qa there.md", machine: "nope" })
  check("dispatch: an unknown machine says which there are", c === 404 && String(body.error).includes("box"), [c, body])
  peerVault = "another"
  app.plugins.find((p) => p.id === "machines")!.forget() // (the list is kept 20 s)
  const t0 = Date.now()
  ;[c, body] = await api("POST", "ops/dispatch.run", { path: "Notes/Qa there.md", machine: "box" })
  check("dispatch: a machine with another vault is refused at once", c === 409 && String(body.error).includes("vault of its own") && Date.now() - t0 < 5000, [c, body])
  peerVault = null
  ;[c, body] = await api("POST", "ops/dispatch.run", { path: "Notes/Qa there.md", machine: "gone" })
  check("dispatch: an offline machine says so", c === 502 && String(body.error).includes("offline"), [c, body])
  fs.rmSync(path.join(VAULT, "Notes/Qa there.md"))
  const [, text] = await api("GET", "render?path=Dashboards/Design.md")
  check("machines: its block as text", String(text).includes("## Machines") && String(text).includes("Box: online, box"), String(text).slice(String(text).indexOf("## Machines"), String(text).indexOf("## Machines") + 300))
  write("Dashboards/Qa machines.md", "---\ntype: dashboard\n---\n\n```block-claude-sessions\nmachine: box\nrecent: 2\n```\n\n```block-claude-sessions\nmachine: gone\n```\n\n```block-claude-sessions\nmachine: nope\n```\n")
  const [, page] = await api("GET", "render?path=Dashboards/Qa machines.md")
  check("machines: a block with machine: is drawn by that machine (its options without machine:)",
    String(page).includes('## From box: claude-sessions Dashboards/Qa machines.md {"recent":2}') && String(page).includes("_(gone isn't answering)_") &&
    String(page).includes("_(no machine nope)_"), page)
  // (this test's api() passes the query as it's written: the server decodes it)
  const [c2, one] = await api("GET", 'render/block?name=claude-sessions&path=Dashboards/Qa machines.md&options={"recent":1,"machine":"box"}')
  check("machines: one block drawn here for another machine, never passed on", c2 === 200 && String(one).startsWith("## Claude Code sessions"), [c2, String(one).slice(0, 100)])
  fs.rmSync(path.join(VAULT, "Dashboards/Qa machines.md"))
  peer.close()
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/vault.json"))
  {
    const join = app.plugins.find((x: Any) => x.id === "machines")!.exports.join
    const conf = () => JSON.parse(read(".vaultite/plugins/machines/data.json"))
    join("https://here.example.ts.net")
    const one = conf()
    join("https://here.example.ts.net")
    check("machines: this one adds itself once", one.machines.length === 1 && one.added.length === 1 && JSON.stringify(conf()) === JSON.stringify(one), one)
    write(".vaultite/plugins/machines/data.json", JSON.stringify({ ...one, machines: [] }))
    join("https://here.example.ts.net")
    check("machines: removed by the user, it stays removed", conf().machines.length === 0, conf())
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
  }
}

// Terminal tabs on several machines: saved with their shell's machine (`<id>@<machine>`), shown to each app as its own
// or the other's; a vault without machines unchanged.
{
  const { service } = await import("../core/plugins.ts")
  const tabsOf = (l: Any) => (l.root.tabs as Any[]).map((t) => t.to).join()
  const layout = (...tos: string[]) => ({ root: { id: "g0", tabs: tos.map((to, i) => ({ id: `t${i}`, to })), active: "t0" }, focus: "g0" })
  write("Notes/Qa host.md", "Host.\n")
  // No machines: nothing changes.
  let [st, body] = await api("PUT", "workspaces/1", { layout: layout("view:terminal/qaone1", "file:Notes/Qa host.md") })
  check("terminal machines: without machines a terminal tab is saved as it is", st === 200 && tabsOf(readWs().workspaces[0].layout) === "view:terminal/qaone1,file:Notes/Qa host.md", readWs())
  clearWs()
  // This server listed (by a loopback address on its port: it knows itself without asking) and another one.
  const port = Number(process.env.PORT || 8793)
  write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [
    { id: "here", label: "Here", url: `http://127.0.0.1:${port}` }, { id: "box", label: "Box", url: "http://127.0.0.1:9" }] }))
  const [, ms] = await api("GET", "machines")
  const self = service(app.plugins, "machines:self") as () => Promise<string | null>
  check("machines: this server is the one at its own address", (await self()) === "here", await self())
  check("machines: it's self and online without asking itself", ms.find((m: Any) => m.id === "here")?.self === true && ms.find((m: Any) => m.id === "here")?.online === true, ms)
  await api("GET", "workspaces")
  ;[st, body] = await api("PUT", "workspaces/1", { layout: layout("view:terminal/qanew1", "view:terminal/claude_work-qa2@box", "file:Notes/Qa host.md") })
  let raw = readWs().workspaces[0].layout
  check("terminal machines: a new terminal tab is saved with this machine, another's as it is", st === 200 &&
    tabsOf(raw) === "view:terminal/qanew1@here,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", raw)
  check("terminal machines: the answer is as this machine's app has it", tabsOf(body.layout) === "view:terminal/qanew1,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", body)
  ;[, body] = await api("GET", "workspaces")
  check("terminal machines: read back without this machine's id", tabsOf(body.workspaces[0].layout) === "view:terminal/qanew1,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", body)
  const st8 = await app.state()
  check("terminal machines: /api/state too", tabsOf((st8.workspaces as Any)[0].layout) === "view:terminal/qanew1,view:terminal/claude_work-qa2@box,file:Notes/Qa host.md", st8.workspaces)
  const tabsOpen = service(app.plugins, "tabs:open") as () => string[]
  check("terminal machines: tabs:open has this machine's terminals as its own", tabsOpen().includes("view:terminal/qanew1") && tabsOpen().includes("view:terminal/claude_work-qa2@box"), tabsOpen())
  // Another machine's id for this one: shown as saved (it's that machine's shell).
  ;[st, body] = await api("PUT", "workspaces/2", { layout: layout("view:terminal/qaelse@box") })
  check("terminal machines: another machine's tab stays its", tabsOf(readWs().workspaces[1].layout) === "view:terminal/qaelse@box" && tabsOf(body.layout) === "view:terminal/qaelse@box", body)
  // Moving by the place, as the app or vau names it (this machine's without its id).
  ;[st, body] = await api("POST", "workspaces/move", { to: 3, path: "view:terminal/qanew1" })
  raw = readWs().workspaces
  check("terminal machines: a move finds a tab by the place as shown, and keeps its machine", st === 200 && body.tab.to === "view:terminal/qanew1" &&
    tabsOf(raw[2].layout) === "view:terminal/qanew1@here" && !tabsOf(raw[0].layout).includes("qanew1"), [body, raw])
  ;[st, body] = await api("POST", "workspaces/move", { to: 2, open: ["view:terminal/qaopen1"] })
  check("terminal machines: a terminal opened in a workspace is this machine's", st === 200 && tabsOf(readWs().workspaces[1].layout) === "view:terminal/qaelse@box,view:terminal/qaopen1@here" &&
    body.tab.to === "view:terminal/qaopen1", [body, readWs()])
  ;[st] = await api("PUT", "workspaces/4", { layout: layout("view:terminal/qaold1@box", "view:terminal/qaold2", "view:terminal/qanew4") })
  const term = app.plugins.find((p) => p.id === "terminal")!
  const locate = term.services["terminal:locate"]
  ;[st, body] = await api("POST", "workspaces/close", { path: "view:terminal/qaold2" })
  check("terminal machines: close finds this machine's terminal by the place as shown (saved with its machine)", st === 200 &&
    body.closed.length === 1 && body.closed[0].to === "view:terminal/qaold2" && !tabsOf(readWs().workspaces[3].layout).includes("qaold2") &&
    tabsOf(readWs().workspaces[3].layout).includes("qaold1@box"), [st, body, readWs()])
  check("terminal machines: locate knows no shell nobody runs", (await (locate as (id: string) => Promise<string | null>)("qanosuch9")) === null)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
  clearWs()
  fs.rmSync(path.join(VAULT, "Notes/Qa host.md"))
  await api("GET", "workspaces") // forgets this machine's id (none listed now)
}

// Codex: a session's conversation in both rollout shapes (plugins/core/codex/rollout.ts), and its tokens counted once.
{
  const [a, b] = ["0b1c2d3e-2222-4333-8444-555566667777", "0c1d2e3f-3333-4444-8555-666677778888"]
  let [c, t] = await api("GET", `codex/session/${a}`)
  check("codex session: found by id, with title, folder, model and branch", c === 200 && t.title === "Fix the date parsing" &&
    t.cwd === "/Users/sam/lighthouse" && t.model === "GPT-6.1 Sol" && t.project === "lighthouse" && t.branch === "main", [c, { ...t, entries: undefined }])
  const kinds = t.entries?.map((e: Any) => e.kind + (e.name ? `:${e.name}` : "")).join(",")
  check("codex session: what was said, each command and edit, not the model's raw tool calls or instructions",
    kinds === "user,assistant,tool:Shell,tool:Edit,assistant", kinds)
  const [sh, ed] = [t.entries[2], t.entries[3]]
  check("codex session: a command is one line with its output", sh.summary === "npm test" && sh.result === "1 failing: dates" && sh.error === true &&
    ed.summary === "date.ts" && ed.input.includes("+parse(s, 'UTC')") && !ed.error, [sh, ed])
  ;[c, t] = await api("GET", `codex/session/${b}`)
  check("codex session, older shape: the request after an IDE's context, a named session, a shell call with its output",
    c === 200 && t.title === "Changelog" && t.entries[0].text.includes("Add a changelog") && t.entries[1].name === "Shell" &&
    t.entries[1].summary === "ls" && t.entries[1].result === "README.md" && t.entries[2].text === "Done." && t.model === "GPT-5.1 Codex",
    [t.title, t.entries])
  ;[c] = await api("GET", "codex/session/..%2F..%2Fetc")
  check("codex session: not a path", c === 404, c)
  {
    const agent = (await import("../core/plugins.ts")).service(app.plugins, "agent:codex")!
    const [back, gone] = await Promise.all([agent({ resume: a, context: "", state: null }), agent({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "", state: null })])
    check("codex agent: a session on this machine is resumed; one that isn't, a note", back.command === `codex resume '${a}'` && gone.command.startsWith("printf") && gone.command.includes("no Codex session"), [back, gone])
  }
  // Today's tokens: a session written now, and a fork of it replaying the same counts (counted once); the same total
  // again (a rate limit update) doesn't count.
  const now = fixtureNow()
  const at = (s: number) => new Date(now - 120000 + s * 1000).toISOString()
  const day = path.join(CODEX_DIR, "sessions", "today")
  fs.mkdirSync(day, { recursive: true })
  const src = fs.readFileSync(path.join(CODEX_DIR, "sessions", "2026", "09", "28", `rollout-2026-09-28T09-00-00-${a}.jsonl`), "utf8")
  const lines = src.trim().split("\n").map((l: string, i: number) => { const d = JSON.parse(l); d.timestamp = at(i); if (d.payload?.turn_id) d.payload.turn_id = "today-t1"; return d })
  const today = "1d1d1d1d-4444-4555-8666-777788889999"
  lines[0].payload.id = today
  fs.writeFileSync(path.join(day, `rollout-2026-09-29T09-00-00-${today}.jsonl`), lines.map((d: Any) => JSON.stringify(d)).join("\n") + "\n")
  const fork = "2e2e2e2e-5555-4666-8777-888899990000"
  fs.writeFileSync(path.join(day, `rollout-2026-09-29T09-00-01-${fork}.jsonl`), [JSON.stringify({ ...lines[0], payload: { ...lines[0].payload, id: fork } }),
    ...lines.slice(1).map((d: Any) => JSON.stringify(d))].join("\n") + "\n")
  await new Promise((r) => setTimeout(r, 5100)) // the scan reads new files at most every 5 s
  const [, u] = await api("GET", "codex?days=1")
  const d0 = u.days?.at(-1)
  check("codex usage: tokens counted once across a fork, the repeated total skipped, uncached input and cached priced apart",
    d0?.tokens === 2800 && Math.abs(d0.cost - 0.0042) < 1e-6 && u.models?.[0]?.name === "GPT-6.1 Sol" && u.total.cache_hit === 0.8, [d0, u.models, u.total])
  check("codex usage: a turn's time, the project, the plan and limits the sessions saw", d0?.active_min === 1 && u.projects?.[0]?.name === "lighthouse" &&
    u.plan?.name === "Plus" && u.limits?.windows?.map((w: Any) => w.label).join() === "Current session,This week", [d0, u.projects, u.plan, u.limits])
  const [, cr] = await api("GET", "render?path=Dashboards/Codex.md")
  check("the Codex page as text", typeof cr === "string" && cr.includes("## Codex by project") && cr.includes("lighthouse") &&
    cr.includes("## Codex plan limits"), String(cr).slice(0, 400))
}

{
  const [c, ins] = await api("GET", "terminals/instructions")
  check("terminal: what agents are told, word for word: inside Vaultite, then the plugins' lines", c === 200 && ins.text.startsWith("You're running in a terminal inside Vaultite") &&
    ins.text.includes("- `.vaultite/AGENTS.md` is the vault's rules"), [c, ins])
}

// Cursor (plugins/core/cursor): chats from the fixture's IDE and CLI files, usage from the fake Cursor API.
{
  const ide = "c0ffee00-1111-4222-8333-444455556666", cli = "5a5a5a5a-2222-4333-8444-555566667777"
  let [c, u] = await api("GET", "cursor?days=30")
  check("cursor: the account isn't read until the user allows it, chats are", c === 200 && !u.limits && cursorSeen.length === 0 && u.sessions.length === 2, [c, u?.limits, cursorSeen])
  write(".vaultite/plugins/cursor/data.json", JSON.stringify({ account: true }))
  ;[c, u] = await api("GET", "cursor?days=30")
  check("cursor: the plan and its allowances from Cursor's dashboard", c === 200 && u.plan?.name === "Pro" && u.plan.monthly === 20 &&
    u.limits?.windows.map((w: Any) => `${w.id}:${w.used}`).join() === "month:46.5,grok-bot:12" && !!u.limits.windows[0].resets_at, [c, u?.plan, u?.limits])
  check("cursor: usage totals from the metered requests (a request with no tokens is worth what it charged)",
    u.total.cost === 0.55 && u.total.tokens === 17250 && u.total.unpriced === 0 && u.total.cache_hit === 0.723, u.total)
  const ses = Object.fromEntries(u.sessions.map((s: Any) => [s.id, s]))
  check("cursor: the IDE's and the CLI's chats are sessions (no drafts, no empty chats), with their project from the folder",
    u.sessions.length === 2 && ses[ide]?.title === "Search box debounce" && ses[ide].project === "lighthouse" && ses[ide].cwd === "/Users/alice/lighthouse" &&
    ses[cli]?.title === "Flaky upload test" && ses[cli].project === "lighthouse", u.sessions)
  check("cursor: a chat gets its conversation's tokens, value, model and time working", ses[ide].cost === 0.2 && ses[ide].tokens === 13800 &&
    ses[ide].model === "Claude 4.5 Sonnet" && ses[ide].active_min === 2 && ses[cli].cost === 0.3 && ses[cli].model === "GPT-5", [ses[ide], ses[cli]])
  check("cursor: conversations not on this machine are a project of their own, not sessions",
    u.projects.map((p: Any) => `${p.name}:${p.sessions}`).join() === "lighthouse:2,Grok Bot:1" && !u.sessions.some((s: Any) => s.id.startsWith("9b9b")), u.projects)
  check("cursor: by model", u.models.map((m: Any) => m.name).join() === "GPT-5,Claude 4.5 Sonnet,Grok Bot,Grok Bot automation", u.models)
  check("cursor: days end today and count its conversations", u.days.length === 30 && u.days.at(-1).sessions >= 1 && u.days.reduce((a: number, d: Any) => a + d.tokens, 0) === 17250, u.days.at(-1))
  const posts = cursorSeen.filter((s) => s.path !== "/api/usage-summary")
  check("cursor: asks with the IDE's session as the dashboard's cookie, with an Origin on POSTs", cursorSeen.length >= 3 &&
    cursorSeen.every((s) => /^WorkosCursorSessionToken=user_ana%3A%3AeyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(s.cookie)) &&
    posts.every((s) => s.origin === new URL(process.env.CURSOR_API_URL!).origin), cursorSeen.map((s) => s.path))
  check("cursor: the token never reaches an answer", !JSON.stringify(u).includes("eyJ"))
  const asked = cursorSeen.length
  await api("GET", "cursor?days=7")
  check("cursor: the account is kept in memory, not asked again on every request", cursorSeen.length === asked, cursorSeen.length)

  let t: Any
  ;[c, t] = await api("GET", `cursor/session/${ide}`)
  check("cursor session: an IDE chat's conversation, a tool call as one line with its result", c === 200 && t.title === "Search box debounce" &&
    t.cwd === "/Users/alice/lighthouse" && t.project === "lighthouse" && t.model === "Claude 4.5 Sonnet" &&
    t.entries.map((e: Any) => e.kind).join() === "user,tool,assistant" && t.entries[1].name === "read_file" && t.entries[1].summary === "src/search.ts" &&
    t.entries[1].result.includes("export function search") && t.entries[0].at === "2026-09-28T09:00:00.000Z", [c, t])
  ;[c, t] = await api("GET", `cursor/session/${cli}`)
  check("cursor session: a CLI chat's conversation in the order it was written, the prompt without Cursor's context",
    c === 200 && t.title === "Flaky upload test" && t.model === "GPT-5" && t.entries.map((e: Any) => e.kind).join() === "user,assistant,tool,assistant" &&
    t.entries[0].text === "Why does the upload test fail?" && t.entries[2].name === "Shell" && t.entries[2].summary === "npm test -- upload" &&
    t.entries[2].error === true && t.entries[2].result === "1 failing: upload retries", [c, t])
  ;[, t] = await api("GET", `cursor/session/${cli}?limit=2&before=3`)
  check("cursor session: pages", t.start === 1 && t.entries.length === 2 && t.total === 4 && t.entries[0].kind === "assistant", t)
  ;[c] = await api("GET", "cursor/session/9b9b9b9b-3333-4444-8555-666677778888")
  check("cursor session: a conversation that isn't on this machine is a 404", c === 404, c)
  ;[c] = await api("GET", "cursor/session/..%2F..%2Fetc")
  check("cursor session: not a path", c === 404, c)

  const agent = (await import("../core/plugins.ts")).service(app.plugins, "agent:cursor")!
  const [fresh, back, fromIde] = await Promise.all([agent({ resume: null, context: "x", state: null }), agent({ resume: cli, context: "x", state: null }),
    agent({ resume: ide, context: "x", state: null })])
  const gone = await agent({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "x", state: null })
  check("cursor agent: a chat that isn't on this machine isn't resumed", gone.command.startsWith("printf") && !/(^|\s)agent(\s|$)/.test(gone.command.replace(/'.*'/, "")), gone)
  check("cursor agent: `agent`, resumed in its chat's folder; an IDE chat gets a new CLI chat in its folder",
    fresh.command === "agent" && !fresh.cwd && back.command === `agent --resume '${cli}'` && back.cwd === "/Users/alice/lighthouse" &&
    fromIde.command === "agent" && fromIde.cwd === "/Users/alice/lighthouse", [fresh, back, fromIde])
  const [, page] = await api("GET", "render?path=Dashboards/Cursor.md")
  check("cursor: its page as text", typeof page === "string" && page.includes("Included usage: 46.5% used") && page.includes("Search box debounce") &&
    page.includes("## Cursor by project") && page.includes("- Grok Bot: $0.05"), String(page).slice(0, 600))
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/cursor/data.json"))
  cursorApi.close()
}

// OpenCode (plugins/core/opencode): usage from its database, and one session's conversation, from the fixture.
{
  let [c, u] = await api("GET", "opencode?days=7")
  check("opencode: usage as OpenCode recorded it, a fork's copied reply once, a subagent's in its parent, a streaming reply left out",
    c === 200 && u.total.cost === 0.14 && u.total.tokens === 17100 && u.total.unpriced === 0 && u.total.cache_hit === 0.675 &&
    u.plan === null && u.limits === null && Array.isArray(u.live) && u.days.length === 7, [c, u?.total])
  check("opencode: a worktree next to its repository is the same project", u.projects.length === 1 && u.projects[0].name === "lighthouse" &&
    u.projects[0].sessions === 3, u.projects)
  check("opencode: models by name from OpenCode's catalogue, else the id", u.models.map((m: Any) => m.name).join(",") ===
    "Claude Sonnet 5,gpt-5.4,Claude Haiku 4.5,Big Pickle", u.models)
  const [a, b] = [u.sessions.find((s: Any) => s.id === "ses_fixtureA001"), u.sessions.find((s: Any) => s.id === "ses_fixtureB001")]
  check("opencode: sessions: titles (the first prompt for a placeholder), cost, model, time working, top-level only",
    u.sessions.length === 3 && a?.title === "Upload retry fix" && a.cost === 0.1 && a.tokens === 14000 && a.model === "Claude Sonnet 5" &&
    Math.abs(a.active_min - 149 / 60) < 0.01 && a.cwd === "/Users/sam/lighthouse" && b?.title === "Make the header sticky" &&
    b.project === "lighthouse" && u.sessions[0].id === "ses_fixtureB001", u.sessions)
  let t: Any
  ;[c, t] = await api("GET", "opencode/session/ses_fixtureA001")
  check("opencode session: found by id, with title, folder, model and times", c === 200 && t.title === "Upload retry fix" &&
    t.cwd === "/Users/sam/lighthouse" && t.model === "Claude Sonnet 5" && t.project === "lighthouse" && t.first && t.last > t.first,
    [c, { ...t, entries: undefined }])
  const kinds = t.entries?.map((e: Any) => e.kind).join(",")
  check("opencode session: what was said and each tool call, nothing else (reasoning, steps, synthetic text)",
    kinds === "user,assistant,tool,tool,tool,assistant" && t.total === 6 && t.entries[0].text === "Fix the flaky upload test", kinds)
  const [bash, task, readf] = [t.entries[2], t.entries[3], t.entries[4]]
  check("opencode session: a tool call is one line with its result", bash.name === "bash" && bash.summary === "Run the upload tests" &&
    bash.error === true && bash.result === "1 failing: upload retries" && JSON.parse(bash.input).command === "npm test -- upload" &&
    task.summary === "Find the retry code" && readf.summary === "/Users/sam/lighthouse/test/upload.test.ts" && readf.result === "it('retries', ...)" &&
    t.entries[5].text === "Fixed: the retry **waits** now.", [bash, task, readf, t.entries[5]])
  ;[, t] = await api("GET", "opencode/session/ses_fixtureA001?limit=2&before=4")
  check("opencode session: pages", t.start === 2 && t.entries.length === 2 && t.entries[0].name === "bash", [t.start, t.entries?.length])
  ;[, t] = await api("GET", "opencode/session/ses_fixtureB001")
  check("opencode session: an untitled one is its first prompt", t.title === "Make the header sticky" && t.model === "gpt-5.4", t.title)
  ;[c] = await api("GET", "opencode/session/nope")
  check("opencode session: an unknown session is a 404", c === 404, c)
  ;[c] = await api("GET", "opencode/session/..%2F..%2Fetc")
  check("opencode session: not a path", c === 404, c)
  const agent = (await import("../core/plugins.ts")).service(app.plugins, "agent:opencode")!
  const gone = await agent({ resume: "ses_notOnThisMac", context: "", state: null })
  check("opencode in a terminal: a session that isn't on this machine isn't resumed", gone.command.startsWith("printf") && gone.command.includes("no OpenCode session"), gone)
  const run = await agent({ resume: "ses_fixtureA001", context: "Inside Vaultite.", state: (s: string) => `echo ${s}` })
  const cfg = JSON.parse(/OPENCODE_CONFIG_CONTENT='([^']*)'/.exec(run.command)?.[1] ?? "{}")
  check("opencode in a terminal: resumes in the session's folder, told where it runs (instructions) and marking its state (a plugin)",
    run.command.endsWith("opencode --session 'ses_fixtureA001'") && run.cwd === "/Users/sam/lighthouse" &&
    fs.readFileSync(cfg.instructions[0], "utf8") === "Inside Vaultite." && fs.readFileSync(new URL(cfg.plugin[0]), "utf8").includes('"working":"echo working"'), [run, cfg])
  const [, oc] = await api("GET", "render?path=Dashboards/OpenCode.md")
  check("the OpenCode page: sessions, usage, projects and models as text", typeof oc === "string" && oc.includes("## OpenCode sessions") &&
    oc.includes("Make the header sticky") && oc.includes("## OpenCode by project") && oc.includes("lighthouse: $0.14") &&
    oc.includes("## OpenCode by model") && oc.includes("Big Pickle: $0.00"), String(oc).slice(0, 600))
}

// OpenClaw (plugins/core/openclaw): usage from its agents' databases, a conversation (compressed events too), memory,
// scheduled jobs, its terminal, and connecting it to the vault (a fake openclaw that records what it was asked).
{
  const A = "a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a", B = "b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b", C = "c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c"
  const { DatabaseSync } = await import("node:sqlite")
  const packed = new DatabaseSync(path.join(OPENCLAW_DIR, "agents/main/agent/openclaw-agent.sqlite"), { readOnly: true })
  const zstdRows = Number((packed.prepare("SELECT count(*) AS n FROM transcript_events WHERE event_zstd IS NOT NULL").get() as Any).n)
  packed.close()
  let [c, u] = await api("GET", "openclaw?days=7")
  check("openclaw: usage as OpenClaw recorded it (compressed replies too), a fork's copied reply once, a subagent's in its parent, no cost unpriced",
    zstdRows === 3 && c === 200 && u.total.cost === 0.2 && u.total.tokens === 32000 && u.total.unpriced === 1 && u.total.cache_hit === 0.603 &&
    u.plan === null && u.limits === null && u.days.length === 7, [zstdRows, c, u?.total])
  check("openclaw: projects by folder (a worktree next to its repository is the same one), models by id",
    u.projects?.map((p: Any) => `${p.name}:${p.sessions}`).join(",") === "lighthouse:2,notes:1,workspace:1" &&
    u.models?.map((m: Any) => m.name).join(",") === "claude-sonnet-5,gpt-5.4-mini,claude-haiku-4-5", [u.projects, u.models])
  const a = u.sessions?.find((s: Any) => s.id === A)
  check("openclaw: sessions: names (a label, a generated title, else the first prompt), cost, model, time working, each agent's",
    u.sessions?.length === 4 && u.sessions[0].id === A && a.title === "Upload retry fix" && a.cost === 0.12 && a.tokens === 25000 &&
    a.model === "claude-sonnet-5" && Math.abs(a.active_min - 102.5 / 60) < 0.01 && a.cwd === "/Users/alice/lighthouse" && a.accountLabel === "main" &&
    u.sessions.find((s: Any) => s.id === B)?.title === "Lighthouse notes" && u.sessions.find((s: Any) => s.id === C)?.title === "Write my morning brief", u.sessions)
  check("openclaw: running now, from OpenClaw's own state", u.live?.length === 1 && u.live[0].id === A && u.live[0].status === "busy" &&
    u.live[0].name === "agent:main:main" && u.live[0].cost === 0.12 && u.live[0].project === "lighthouse", u.live)
  ;[c, u] = await api("GET", "openclaw?days=7&account=scout")
  check("openclaw: one agent's (account)", c === 200 && u.sessions.length === 1 && u.sessions[0].title === "Reading list" && u.total.cost === 0.05 && !u.live.length, u)
  ;[c] = await api("GET", "openclaw?account=nobody")
  check("openclaw: an agent that isn't here is a 404", c === 404, c)
  let t: Any
  ;[c, t] = await api("GET", `openclaw/session/${A}`)
  const kinds = t.entries?.map((e: Any) => e.kind).join(",")
  check("openclaw session: its name, folder, key and model, and what was said on its active branch (no runtime context, no rewound turn)",
    c === 200 && t.title === "Upload retry fix" && t.cwd === "/Users/alice/lighthouse" && t.key === "agent:main:main" && t.model === "claude-sonnet-5" &&
    t.project === "lighthouse" && t.first && t.last > t.first && kinds === "user,assistant,tool,assistant,user,assistant" &&
    t.entries[0].text === "Fix the flaky upload test" && t.entries[4].text === "Thanks, that works", [c, kinds, { ...t, entries: undefined }])
  const [, tool, fixed] = [t.entries?.[1], t.entries?.[2], t.entries?.[3]]
  check("openclaw session: a tool call with its result, and an answer, both read from zstd-compressed events",
    tool?.name === "exec" && tool.summary === "npm test -- upload" && tool.error === true && tool.result?.startsWith("1 failing: upload retries") &&
    fixed?.text.startsWith("Fixed: the retry **waits** now."), [tool, fixed])
  ;[, t] = await api("GET", `openclaw/session/${A}?limit=2&before=4`)
  check("openclaw session: pages", t.start === 2 && t.entries.length === 2 && t.entries[0].name === "exec", [t.start, t.entries?.length])
  ;[c] = await api("GET", "openclaw/session/nope-0000")
  check("openclaw session: an unknown session is a 404", c === 404, c)
  ;[c] = await api("GET", "openclaw/session/..%2F..%2Fetc")
  check("openclaw session: not a path", c === 404, c)
  let [, m] = await api("GET", "openclaw/memory")
  check("openclaw memory: main's identity, soul, user and memory files, its two latest daily notes (not its instructions)",
    m.agent === "main" && m.files.map((f: Any) => f.name).join(",") === "IDENTITY.md,SOUL.md,USER.md,MEMORY.md" && m.files[2].text.includes("Alice Park") &&
    m.notes.map((n: Any) => n.date).join(",") === "2026-10-04,2026-10-03", m)
  ;[, m] = await api("GET", "openclaw/memory?account=scout&notes=0")
  check("openclaw memory: another agent's workspace (workspace-<id>)", m.dir.endsWith("workspace-scout") && m.files.map((f: Any) => f.name).join(",") === "SOUL.md" &&
    !m.notes.length, m)
  let [, jobs] = await api("GET", "openclaw/cron")
  const [brief, weekly] = jobs
  check("openclaw cron: its jobs, when each runs, the last run and the next", jobs.length === 3 && brief.name === "Morning brief" &&
    brief.schedule === "cron 0 7 * * * (America/Los_Angeles)" && brief.status === "ok" && Date.parse(brief.next) > Date.now() && brief.task === "Write my morning brief" &&
    weekly.enabled === false && weekly.next === null && weekly.schedule === "every 7 days" && weekly.status === "error" && weekly.error === "model timed out", jobs)
  ;[, jobs] = await api("GET", "openclaw/cron?account=scout")
  check("openclaw cron: one agent's", jobs.length === 1 && jobs[0].schedule === "once, 2026-12-01T09:00:00Z", jobs)
  const [, accts] = await api("GET", "openclaw/accounts")
  check("openclaw: its agents, to open it as one", accts.map((x: Any) => x.id).join(",") === "main,scout", accts)
  const agent = (await import("../core/plugins.ts")).service(app.plugins, "agent:openclaw")!
  const gone = await agent({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "", state: null })
  check("openclaw in a terminal: a session that isn't here isn't resumed", gone.command.startsWith("printf") && gone.command.includes("no OpenClaw session"), gone)
  // A gateway listening (a made-up one on a free port), then none: its embedded runtime.
  const { createServer } = await import("node:net")
  const gw = createServer((s) => s.destroy())
  await new Promise<void>((ok) => gw.listen(0, "127.0.0.1", ok))
  process.env.OPENCLAW_GATEWAY_PORT = String((gw.address() as { port: number }).port)
  const [back, fresh, scout] = await Promise.all([agent({ resume: A, context: "", state: null, prompt: "Go on" }), agent({ resume: null, context: "", state: null }),
    agent({ resume: null, context: "", state: null, profile: "scout" })])
  await new Promise((ok) => gw.close(ok))
  const alone = await agent({ resume: null, context: "", state: null })
  delete process.env.OPENCLAW_GATEWAY_PORT
  check("openclaw in a terminal: its TUI on the session's key (the prompt sent first), or on an agent's main session",
    back.command === "OPENCLAW_TUI_SESSION='agent:main:main' openclaw tui --session 'agent:main:main' --message 'Go on'" && back.cwd === null &&
    fresh.command === "OPENCLAW_TUI_SESSION='agent:main:main' openclaw tui" &&
    scout.command === "OPENCLAW_TUI_SESSION='agent:scout:main' openclaw tui --session 'agent:scout:main'", [back, fresh, scout])
  check("openclaw in a terminal: --local when no gateway answers", alone.command === "OPENCLAW_TUI_SESSION='agent:main:main' openclaw tui --local", alone)
  // An open TUI (a stand-in named openclaw, on a session's key) lists that session as open, idle, after any working one.
  const fakeBin = path.join(tmp, "openclaw-tui-bin")
  fs.mkdirSync(fakeBin, { recursive: true })
  fs.writeFileSync(path.join(fakeBin, "openclaw"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 })
  const tui = (await import("node:child_process")).spawn(path.join(fakeBin, "openclaw"), ["tui", "--local", "--session", "agent:scout:main"], { stdio: "ignore" })
  await new Promise((ok) => setTimeout(ok, 6000)) // the usage read is kept 5 s
  const [, withTui] = await api("GET", "openclaw?days=7")
  tui.kill()
  const openRow = withTui.live.find((x: Any) => x.name === "agent:scout:main")
  check("openclaw: a TUI open on a session lists it as open (idle), with its pid", openRow?.status === "idle" && openRow.pid > 0 &&
    withTui.live.findIndex((x: Any) => x.status === "busy") < withTui.live.indexOf(openRow), withTui.live)
  // Connecting: OpenClaw's own CLI saves the server (a fake here, which records its arguments); only this machine's owner.
  const bin = path.join(tmp, "openclaw-bin"), calls = path.join(bin, "calls"), PATH = process.env.PATH
  fs.mkdirSync(bin)
  // (npm -g puts it beside Node, where the plugin looks too)
  const installed = [".local/bin", ".npm-global/bin"].map((d) => path.join(os.homedir(), d)).concat(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.dirname(fs.realpathSync(process.execPath))])
    .some((d) => fs.existsSync(path.join(d, "openclaw")))
  if (!installed) {
    process.env.PATH = bin
    const missing = await app.runOp("openclaw.connect", {}).then(() => null, (e: Any) => e)
    check("openclaw connect: a clear error when OpenClaw isn't installed", missing?.status === 409 && /isn't installed/.test(missing.message), missing?.message)
  }
  fs.writeFileSync(path.join(bin, "openclaw"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${calls}"\necho 'Saved MCP server "vaultite" to /tmp/openclaw.json.'\n`, { mode: 0o755 })
  process.env.PATH = `${bin}${path.delimiter}${PATH}`
  const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
  const refused = await app.runOp("openclaw.connect", {}, { http: stranger }).then(() => null, (e: Any) => e)
  check("openclaw connect: only this machine's owner", refused?.status === 403 && !fs.existsSync(calls), refused?.status)
  const [r1, r2] = [await app.runOp("openclaw.connect", {}), await app.runOp("openclaw.connect", {})]
  const lines = fs.readFileSync(calls, "utf8").trim().split("\n")
  const saved = JSON.parse(lines[3] ?? "{}")
  check("openclaw connect: runs openclaw mcp set vaultite with vau mcp over stdio, the same again the second time",
    lines.length === 8 && lines.slice(0, 3).join(" ") === "mcp set vaultite" && lines.slice(4).join("\n") === lines.slice(0, 4).join("\n") &&
    JSON.stringify(saved.args) === JSON.stringify([path.join(path.dirname(import.meta.dirname), "bin", "vau"), "mcp"]) && saved.env?.VAULTITE_URL === "http://127.0.0.1:8793" &&
    (r1.result as Any).saved.startsWith("Saved MCP server") && (r2.result as Any).server.command === saved.command, [lines, r1.result])
  process.env.PATH = PATH
  const [, oc] = await api("GET", "render?path=Dashboards/OpenClaw.md")
  check("the OpenClaw page: what runs now first, usage, memory, scheduled jobs, projects and models as text", typeof oc === "string" &&
    oc.indexOf("Working: Upload retry fix") > 0 && oc.indexOf("Working: Upload retry fix") < oc.indexOf("### Recent") && oc.includes("## OpenClaw usage") &&
    oc.includes("### USER.md") && oc.includes("Daily note, 2026-10-04") && oc.includes("Weekly review: every 7 days, off") && oc.includes("lighthouse: $0.15") &&
    oc.includes("## OpenClaw by model"), String(oc).slice(0, 1500))
}

// Hermes (plugins/core/hermes): usage from its databases (the main home and a profile), a session's conversation,
// its memory and jobs, its terminal and hermes.connect, from the fixture.
{
  let [c, u] = await api("GET", "hermes?days=7&account=default")
  check("hermes: usage as Hermes recorded it: per model (an aux call too), a chat's totals, a subagent's and a compression's in their session, an old one left out",
    c === 200 && u.total.cost === 0.09 && u.total.tokens === 17770 && u.total.unpriced === 0 && u.total.cache_hit === 0.723 &&
    u.plan === null && u.limits === null && Array.isArray(u.live) && u.days.length === 7, [c, u?.total])
  check("hermes: projects: a worktree next to its repository is the same project, a chat app's sessions under the app",
    u.projects.map((p: Any) => `${p.name}:${p.sessions}`).join() === "lighthouse:2,Telegram:1", u.projects)
  check("hermes: models by their name, most cost first", u.models.map((m: Any) => m.name).join() ===
    "claude-sonnet-4.6,hermes-4-405b,gpt-5.4-mini,gemini-3-flash", u.models)
  const [a, b, cc] = ["20260929_090000_aaaa01", "20260928_100000_bbbb01", "20260929_102000_cccc01"].map((id) => u.sessions.find((s: Any) => s.id === id))
  check("hermes: sessions: titles (the first prompt when untitled), cost, model, time working, top-level only",
    u.sessions.length === 3 && u.sessions[0].id === a?.id && a.title === "Fix the map tiles" && a.cost === 0.074 && a.tokens === 15420 &&
    a.model === "claude-sonnet-4.6" && Math.abs(a.active_min - 5) < 0.01 && a.cwd === "/Users/alice/lighthouse" && a.account === "default" &&
    b?.title === "What's on my calendar tomorrow?" && b.project === "Telegram" && cc?.project === "lighthouse" && Math.abs(cc.active_min - 50 / 60) < 0.01, u.sessions)
  ;[c, u] = await api("GET", "hermes?days=7")
  const r = u.sessions?.find((s: Any) => s.id === "20260929_080000_rrrr01")
  check("hermes: every home when no account is named, each session saying which", c === 200 && u.total.tokens === 18270 && u.total.cost === 0.09 &&
    r?.account === "research" && r.accountLabel === "Research" && r.project === "notes" && u.sessions.find((s: Any) => s.id === a.id)?.accountLabel === "Default", [c, u?.total, r])
  ;[c] = await api("GET", "hermes?account=nope")
  check("hermes: an unknown profile is a 404", c === 404, c)
  ;[, u] = await api("GET", "hermes/accounts")
  check("hermes: its homes", JSON.stringify(u) === JSON.stringify([{ id: "default", label: "Default" }, { id: "research", label: "Research" }]), u)
  let t: Any
  ;[c, t] = await api("GET", "hermes/session/20260929_090000_aaaa01")
  check("hermes session: found by id, with title, folder, branch, model and times", c === 200 && t.title === "Fix the map tiles" &&
    t.cwd === "/Users/alice/lighthouse" && t.branch === "tiles" && t.model === "claude-sonnet-4.6" && t.project === "lighthouse" && t.first && t.last > t.first,
    [c, { ...t, entries: undefined }])
  const kinds = t.entries?.map((e: Any) => e.kind).join(",")
  check("hermes session: what was said and each tool call, with the part compression continued it in (not its summary, a rewound or a system row)",
    kinds === "user,assistant,tool,tool,assistant,user,assistant" && t.total === 7 && t.entries[0].text === "The map tiles flicker when zooming" &&
    t.entries[6].text === "Lint is clean.", kinds)
  const [term, readf] = [t.entries[2], t.entries[3]]
  check("hermes session: a tool call is one line with its result (an error when Hermes says one)", term.name === "terminal" &&
    term.summary === "npm test -- tiles" && term.result === "1 failing: tiles cache" && term.error === false && JSON.parse(term.input).command === "npm test -- tiles" &&
    readf.name === "read_file" && readf.summary === "src/tile.ts" && readf.error === true && readf.result === "No such file: src/tile.ts" &&
    t.entries[4].text === "Fixed: tiles are cached **per zoom** now.", [term, readf, t.entries[4]])
  ;[, t] = await api("GET", "hermes/session/20260929_090000_aaaa01?limit=2&before=4")
  check("hermes session: pages", t.start === 2 && t.entries.length === 2 && t.entries[0].name === "terminal", [t.start, t.entries?.length])
  ;[, t] = await api("GET", "hermes/session/20260929_102000_cccc01")
  check("hermes session: a message with an image", t.entries?.[0]?.text === "Make the header sticky\n\n_(image)_", t.entries?.[0])
  ;[, t] = await api("GET", "hermes/session/20260928_100000_bbbb01")
  check("hermes session: an untitled one is its first prompt, a chat app's under the app", t.title === "What's on my calendar tomorrow?" && t.project === "Telegram", t.title)
  ;[c, t] = await api("GET", "hermes/session/20260929_080000_rrrr01")
  check("hermes session: found in a profile", c === 200 && t.account === "research" && t.entries.length === 2, [c, t?.account])
  ;[c] = await api("GET", "hermes/session/nope")
  check("hermes session: an unknown session is a 404", c === 404, c)
  ;[c] = await api("GET", "hermes/session/..%2F..%2Fetc")
  check("hermes session: not a path", c === 404, c)
  const agent = (await import("../core/plugins.ts")).service(app.plugins, "agent:hermes")!
  const gone = await agent({ resume: "20260101_000000_gone00", context: "", state: null })
  check("hermes in a terminal: a session that isn't on this machine isn't resumed", gone.command.startsWith("printf") && gone.command.includes("no Hermes session"), gone)
  let run = await agent({ resume: "20260929_090000_aaaa01", context: "Inside Vaultite.", state: null })
  check("hermes in a terminal: resumes in the session's folder", run.command === `HERMES_HOME='${HERMES_DIR}' hermes -r '20260929_090000_aaaa01'` &&
    run.cwd === "/Users/alice/lighthouse", run)
  run = await agent({ resume: "20260929_080000_rrrr01", context: "", state: null })
  check("hermes in a terminal: a profile's session resumes in its profile", run.command.endsWith("hermes -p 'research' -r '20260929_080000_rrrr01'") && run.cwd === "/Users/alice/notes", run)
  run = await agent({ resume: null, context: "", state: null, profile: "research", prompt: "Hi there" })
  check("hermes in a terminal: a new one in a profile, with its first prompt", run.command.endsWith("hermes -p 'research' chat -q 'Hi there'") && run.cwd === null, run)
  let m: Any
  ;[c, m] = await api("GET", "hermes/memory")
  check("hermes memory: its soul, and each entry of what it noted and knows about the user", c === 200 && m.soul.includes("You are Hermes, a careful assistant for Alice Park.") &&
    m.memory.length === 2 && m.memory[1] === "The map tiles cache lives in src/tiles.ts.\nIt is keyed by zoom." &&
    JSON.stringify(m.user) === JSON.stringify(["Alice Park prefers metric units.", "Works on Lighthouse, an app for tide tables."]), m)
  ;[, m] = await api("GET", "hermes/memory?account=research")
  check("hermes memory: a profile without any", m.account === "research" && m.soul === null && m.memory === null && m.user === null, m)
  ;[c, m] = await api("GET", "hermes/cron")
  const [morning, weekly] = m.jobs ?? []
  check("hermes cron: each job, its schedule, whether it's on and how its last run went", c === 200 && m.jobs.length === 2 &&
    morning.name === "Morning tide summary" && morning.schedule === "0 7 * * *" && morning.enabled && morning.status === "ok" && morning.next &&
    weekly.name === "Weekly cleanup" && !weekly.enabled && weekly.status === "error" && weekly.error === "Provider timeout", m.jobs)
  const [, page] = await api("GET", "render?path=Dashboards/Hermes.md")
  check("the Hermes page: sessions, usage, projects, models, jobs and memory as text", typeof page === "string" && page.includes("## Hermes sessions") &&
    page.includes("Fix the map tiles") && page.includes("## Hermes by project") && page.includes("Telegram: $0.01") && page.includes("## Hermes by model") &&
    page.includes("- Weekly cleanup: every 10080m (paused), last ran") && page.includes("(error): Provider timeout") &&
    page.includes("- The map tiles cache lives in src/tiles.ts.\n  It is keyed by zoom.") && page.includes("> You are Hermes"), String(page).slice(0, 1500))

  // hermes.connect: Vaultite's MCP server in Hermes' config.yaml, as a small edit; only this machine's owner may.
  const cfg = path.join(HERMES_DIR, "config.yaml"), was = fs.readFileSync(cfg, "utf8")
  const outsider = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
  const refused = await app.runOp("hermes.connect", {}, { http: outsider }).then(() => null, (e: Any) => e)
  check("hermes connect: refused to anyone but this machine's owner, nothing written", refused?.status === 403 && fs.readFileSync(cfg, "utf8") === was, refused?.message)
  const vauNode = (await import("../core/service.ts")).stableNode(process.execPath, process.env.PATH)
  const entry = `  vaultite:\n    command: ${JSON.stringify(vauNode)}\n    args: [${JSON.stringify(path.resolve(import.meta.dirname, "..", "bin", "vau"))}, "mcp"]\n    env:\n      VAULTITE_URL: "http://127.0.0.1:8793"\n      VAULTITE_AGENT: "hermes"\n`
  let [code, said] = await api("POST", "ops/hermes.connect?as=text", {})
  const now = fs.readFileSync(cfg, "utf8")
  check("hermes connect: adds vaultite under mcp_servers (vau mcp, by the server's Node), every other line as it was",
    code === 200 && now === was.replace(`    args: ["mcp-server-time"]\n`, `    args: ["mcp-server-time"]\n${entry}`) && String(said).startsWith("Added Vaultite's MCP server in"), [code, said, now])
  ;[code, said] = await api("POST", "ops/hermes.connect?as=text", {})
  check("hermes connect: again, nothing changes", code === 200 && fs.readFileSync(cfg, "utf8") === now && String(said).includes("nothing changed"), said)
  fs.writeFileSync(cfg, now.replace(JSON.stringify(vauNode), '"/old/node"'))
  let res = await app.runOp("hermes.connect", {})
  check("hermes connect: a stale entry is updated", (res.result as Any).changed === "updated" && fs.readFileSync(cfg, "utf8") === now, fs.readFileSync(cfg, "utf8"))
  res = await app.runOp("hermes.connect", { account: "research" })
  const rcfg = fs.readFileSync(path.join(HERMES_DIR, "profiles", "research", "config.yaml"), "utf8")
  check("hermes connect: a profile without mcp_servers gets it at the end", (res.result as Any).changed === "added" &&
    rcfg === `model:\n  default: openai/gpt-5.4\n\nmcp_servers:\n${entry}`, rcfg)
  const blank = path.join(HERMES_DIR, "profiles", "blank", "config.yaml")
  fs.mkdirSync(path.dirname(blank))
  fs.writeFileSync(blank, "mcp_servers:\n# none yet\nmodel: x\n")
  await app.runOp("hermes.connect", { account: "blank" })
  check("hermes connect: an empty mcp_servers gets it under", fs.readFileSync(blank, "utf8") === `mcp_servers:\n${entry}# none yet\nmodel: x\n`, fs.readFileSync(blank, "utf8"))
  fs.writeFileSync(blank, "mcp_servers: [oops\n")
  const bad = await app.runOp("hermes.connect", { account: "blank" }).then(() => null, (e: Any) => e)
  check("hermes connect: a config.yaml that isn't YAML is left alone", bad?.status === 400 && fs.readFileSync(blank, "utf8") === "mcp_servers: [oops\n", bad?.message)
  fs.rmSync(path.dirname(blank), { recursive: true })
}

// Links (plugins/core/backlinks): unlinked mentions, and linking one as a small edit.
{
  write("Links test/Theo Marsh.md", "A made-up person.\n")
  write("Links test/Weekend.md", "---\ntype: note\n---\n\nClimbing with theo marsh on Saturday.\n`Theo Marsh` in code, [[Theo Marsh]] already linked, [Theo Marsh](https://example.com)\n" +
    "```\nTheo Marsh in a fence\n```\nTheo Marshs isn't a name. Lunch with Theo Marsh.\n")
  write("Links test/Crlf.md", "First line\r\nSaw Theo Marsh today\r\nLast line\r\n")
  let [c, un] = await api("GET", "backlinks/unlinked?path=Links test/Theo Marsh.md")
  const mine = (f: string) => (un as Any[]).filter((m) => m.path === f)
  check("unlinked mentions: plain text only (not links, code, fences or longer words), any case",
    c === 200 && mine("Links test/Weekend.md").map((m: Any) => m.text).join("|") === "theo marsh|Theo Marsh" && mine("Links test/Crlf.md").length === 1, un)
  const [first, second] = mine("Links test/Weekend.md")
  ;[c] = await api("POST", "backlinks/link", { ...first, target: "Links test/Theo Marsh.md" })
  let t = read("Links test/Weekend.md")
  check("Link: written differently, it keeps the text ([[Name|as written]]), and only that line changes",
    c === 200 && t.replace(/^---\n[\s\S]*?\n---\n/, "") === "\nClimbing with [[Theo Marsh|theo marsh]] on Saturday.\n`Theo Marsh` in code, [[Theo Marsh]] already linked, [Theo Marsh](https://example.com)\n" +
    "```\nTheo Marsh in a fence\n```\nTheo Marshs isn't a name. Lunch with Theo Marsh.\n", t)
  ;[c] = await api("POST", "backlinks/link", { ...second, target: "Links test/Theo Marsh.md" })
  check("Link: written like the name, a plain [[Name]]", c === 200 && read("Links test/Weekend.md").includes("Lunch with [[Theo Marsh]].\n"), read("Links test/Weekend.md"))
  ;[c] = await api("POST", "backlinks/link", { ...second, target: "Links test/Theo Marsh.md" })
  check("Link: again, when the file changed there since, is a 409", c === 409, c)
  ;[, un] = await api("GET", "backlinks/unlinked?path=Links test/Theo Marsh.md")
  check("unlinked mentions: linked ones are gone", !mine("Links test/Weekend.md").length, un)
  ;[c] = await api("POST", "backlinks/link", { ...mine("Links test/Crlf.md")[0], target: "Links test/Theo Marsh.md" })
  check("Link: a file with CRLF keeps them", c === 200 && fs.readFileSync(path.join(VAULT, "Links test/Crlf.md"), "utf8") === "First line\r\nSaw [[Theo Marsh]] today\r\nLast line\r\n",
    fs.readFileSync(path.join(VAULT, "Links test/Crlf.md"), "utf8"))
  ;[c] = await api("POST", "backlinks/link", { path: "Links test/Crlf.md", target: "Links test/Theo Marsh.md", line: "Last line", nth: 0, col: 0, len: 4, text: "Last" })
  check("Link: only a name of the file it links to", c === 400, c)
  const { findMentions } = await import("../plugins/core/backlinks/mentions.ts")
  check("mentions: aliases, longest name first, unicode words", JSON.stringify(findMentions("Met Zoë and Zoë Souza; zoëlle no", ["Zoë Souza", "Zoë"]).map((m) => m.text)) ===
    JSON.stringify(["Zoë", "Zoë Souza"]), findMentions("Met Zoë and Zoë Souza; zoëlle no", ["Zoë Souza", "Zoë"]))
}
// ---------- duplicate, delete with undo, file history ----------
let cp: Any
;[code, cp] = await api("POST", "notes", { ext_id: "note-dup-source", title: "Dup source", body: "Original text" })
await sleep(20)
;[code, cp] = await api("POST", "file/copy", { path: "Notes/Dup source.md" })
check("duplicate: the file as it is, next to it, named like Obsidian's", code === 201 && cp.path === "Notes/Dup source 1.md" && read("Notes/Dup source 1.md") === read("Notes/Dup source.md"), [code, cp])
let [, dupNotes] = await api("GET", "notes")
const idOf = (t: string) => dupNotes.find((n: Any) => n.title === t)?.ext_id
const dupPath = (t: string) => dupNotes.find((n: Any) => n.title === t)?.id + ".md"
check("a duplicated note keeps the original's id until it's edited", idOf("Dup source 1") === "note-dup-source", [idOf("Dup source"), idOf("Dup source 1")])
await api("PUT", "file", { path: dupPath("Dup source 1"), text: read(dupPath("Dup source 1")).replace("Original text", "Copied text") })
;[, dupNotes] = await api("GET", "notes")
check("...edited in the app, it gets its own id; the original keeps its", idOf("Dup source") === "note-dup-source" && idOf("Dup source 1") && idOf("Dup source 1") !== "note-dup-source",
  [idOf("Dup source"), idOf("Dup source 1")])
;[code, cp] = await api("POST", "file/copy", { path: "Notes/Dup source 1.md" })
check("a copy of 'Name 1' is 'Name 2'", cp.path === "Notes/Dup source 2.md", cp)
await api("PUT", "file", { path: "Notes/Dup source 2.md", text: read("Notes/Dup source 2.md") + "More.\n" })
;[, dupNotes] = await api("GET", "notes")
check("three copies, three ids", new Set(dupNotes.filter((n: Any) => n.title.startsWith("Dup source")).map((n: Any) => n.ext_id)).size === 3)
;[code] = await api("POST", "file/copy", { path: "Notes" })
check("a folder isn't duplicated", code === 400, code)
write("Notes/Dup claims.md", "---\ntype: person\nname: Alice Park\naliases: [Alice]\nid: dup-claims\ncontext: Met at a course\n---\n\nText\n")
await api("GET", "state")
;[code, cp] = await api("POST", "file/copy", { path: "Notes/Dup claims.md" })
check("a duplicate is byte for byte the original, as in Obsidian", read(cp.path) === read("Notes/Dup claims.md"), read(cp.path))
del = undefined
;[code, del] = await api("DELETE", "file?path=Notes/Dup source 2.md")
check("delete says where it went in the trash", code === 200 && typeof del.trashed === "string" && del.trashed.startsWith(".trash/Notes/Dup source 2 ") && exists(del.trashed), del)
;[code, del] = await api("POST", "file/restore", { path: del.trashed })
check("...so it can be undone", code === 200 && del.path === "Notes/Dup source 2.md" && exists("Notes/Dup source 2.md"), del)

const hist = await import("../plugins/core/history/plugin.ts")
const histSettings = (o: object) => write(".vaultite/plugins/history/data.json", JSON.stringify(o))
const versionsOf = async (p: string) => (await api("GET", `history?path=${p}`))[1].versions as Any[]
const versionText = async (p: string, t: number) => (await api("GET", `history/version?path=${p}&t=${t}`))[1]
let allHist: Any
histSettings({ interval_min: 0, keep_days: 7 })
write("Hist/a.md", "one\n")
await api("GET", "state")
check("history: nothing kept for a new file", !(await versionsOf("Hist/a.md")).length)
write("Hist/a.md", "one\ntwo\n")
let hv = await versionsOf("Hist/a.md")
check("history: a change on disk keeps the previous content", hv.length === 1 && await versionText("Hist/a.md", hv[0].t) === "one\n", hv)
histSettings({ interval_min: 5, keep_days: 7 })
write("Hist/a.md", "one\ntwo\nthree\n")
hv = await versionsOf("Hist/a.md")
check("history: at most one snapshot per interval", hv.length === 1, hv)
histSettings({ interval_min: 0, keep_days: 7 })
await api("PUT", "file", { path: "Hist/a.md", text: "four\n", base: read("Hist/a.md") })
hv = await versionsOf("Hist/a.md")
check("history: an API write keeps what was there", hv.length === 2 && await versionText("Hist/a.md", hv[0].t) === "one\ntwo\nthree\n", hv)
fs.utimesSync(path.join(VAULT, "Hist/a.md"), new Date(), new Date(Date.now() + 5000))
hv = await versionsOf("Hist/a.md")
check("history: a touch without a change keeps nothing", hv.length === 2, hv)
write("Hist/pic.png", "not really a png")
write("Hist/code.py", "print(1)\n")
await api("GET", "state")
await versionsOf("Hist/code.py") // (History looks after the sync, off it: its route waits for that look)
write("Hist/code.py", "print(2)\n")
hv = await versionsOf("Hist/code.py")
check("history: code files too", hv.length === 1, hv)
write("Hist/pic.png", "still not a png")
check("history: not images", !(await versionsOf("Hist/pic.png")).length)
write(".vaultite/secret.md", "hidden\n")
await api("GET", "state")
write(".vaultite/secret.md", "hidden 2\n")
check("history: not hidden files", !(await versionsOf(".vaultite/secret.md")).length)
// Any size: a file growing past a megabyte is followed on, never taken for gone.
const bigLine = "a line of a big file\n".repeat(60_000)
write("Hist/big.md", bigLine)
await versionsOf("Hist/big.md")
write("Hist/big.md", bigLine + "one more\n")
hv = await versionsOf("Hist/big.md")
check("history: a file over a megabyte", hv.length === 1 && await versionText("Hist/big.md", hv[0].t) === bigLine, hv.length)
write("Hist/big.md", bigLine.repeat(2))
hv = await versionsOf("Hist/big.md")
;[, allHist] = await api("GET", "history")
check("history: grown bigger, still followed", hv.length === 2 && await versionText("Hist/big.md", hv[0].t) === bigLine + "one more\n" &&
  !allHist.find((f: Any) => f.path === "Hist/big.md")?.gone, allHist.find((f: Any) => f.path === "Hist/big.md"))
await api("POST", "file/move", { from: "Hist/a.md", to: "Hist/b.md" })
check("history: a renamed file takes its versions along", (await versionsOf("Hist/b.md")).length === 2 && !(await versionsOf("Hist/a.md")).length)
await api("DELETE", "file?path=Hist/b.md")
hv = await versionsOf("Hist/b.md")
check("history: a deleted file keeps its last content", hv.length === 3 && await versionText("Hist/b.md", hv[0].t) === "four\n", hv)
;[, allHist] = await api("GET", "history")
check("history: the list of files says which are gone", allHist.some((f: Any) => f.path === "Hist/b.md" && f.gone && f.versions === 3), allHist)
;[code] = await api("GET", "history/version?path=Hist/b.md&t=1")
check("history: a version that isn't there is a 404", code === 404, code)
hist.prune(vault, Date.now() + 8 * 86400_000)
check("history: pruned after keep_days", !(await versionsOf("Hist/b.md")).length && !(await versionsOf("Hist/code.py")).length)
;[, allHist] = await api("GET", "history")
check("history: a gone file's history goes once it's pruned", !allHist.some((f: Any) => f.path === "Hist/b.md"), allHist)
check("history: kept outside the vault", !fs.readdirSync(VAULT).includes("history") && fs.existsSync(path.join(tmp, "local", "history")))

// ---------- Graph view: files and [[links]] as a graph; a local graph; its block as text ----------
write("Graph test/Hub.md", "---\ntype: note\ntags: [Lab]\naliases: [Centre]\n---\n\nSee [[Spoke one]], [[Graph test/Spoke two|two]] and ![[Board.canvas]].\n\n```\n[[Not a link]]\n```\n")
write("Graph test/Spoke one.md", "Back to [[Centre]]. Also [[Far]] and [[Nobody here]].\n")
write("Graph test/Spoke two.md", "---\nsee: \"[[Hub]]\"\n---\n\nNothing else.\n")
write("Graph test/Far.md", "The end of the line.\n")
write("Graph test/Alone.md", "No links at all.\n")
const board = { nodes: [
  { id: "g1", type: "group", label: "Plan", x: -20, y: -20, width: 600, height: 300, color: "4", mine: "kept" },
  { id: "t1", type: "text", text: "Start with [[Far]]", x: 0, y: 0, width: 250, height: 60, color: "1" },
  { id: "f1", type: "file", file: "Graph test/Spoke one.md", x: 300, y: 0, width: 250, height: 200 },
  { id: "l1", type: "link", url: "https://example.com", x: 0, y: 400, width: 250, height: 100 },
], edges: [{ id: "e1", fromNode: "t1", fromSide: "right", toNode: "f1", toSide: "left", label: "then", extra: 1 }], custom: { keep: true } }
write("Graph test/Board.canvas", JSON.stringify(board, null, "\t") + "\n")
let [gc, graph] = await api("GET", "graph")
const gnode = (p: string) => graph.nodes.find((n: Any) => n.path === p)
const gedge = (a: string, b: string) => graph.edges.some((e: Any) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
check("graph: every Markdown file is a node", gc === 200 && !!gnode("Graph test/Hub.md") && !!gnode("Graph test/Alone.md"), gc)
check("graph: links by name, path and alias are edges", gedge("Graph test/Hub.md", "Graph test/Spoke one.md") && gedge("Graph test/Hub.md", "Graph test/Spoke two.md") && gedge("Graph test/Spoke one.md", "Graph test/Far.md"), graph.edges.filter((e: Any) => e.from.startsWith("Graph")))
check("graph: a pair linked both ways is one edge", graph.edges.filter((e: Any) => [e.from, e.to].sort().join() === ["Graph test/Hub.md", "Graph test/Spoke one.md"].sort().join()).length === 1)
check("graph: links in code and to nothing aren't edges", !graph.nodes.some((n: Any) => /Not a link|Nobody here/.test(n.path)))
check("graph: degree, folder, tags", gnode("Graph test/Hub.md").degree === 3 && gnode("Graph test/Hub.md").folder === "Graph test" && gnode("Graph test/Hub.md").tags.includes("Lab") && gnode("Graph test/Alone.md").degree === 0, gnode("Graph test/Hub.md"))
check("graph: an embedded canvas is a node, and its cards link to files", !!gnode("Graph test/Board.canvas") && gedge("Graph test/Board.canvas", "Graph test/Spoke one.md") && gedge("Graph test/Board.canvas", "Graph test/Far.md"), gnode("Graph test/Board.canvas"))
// First names resolve like the app's links: a person's, when only one person has it (People's `link-names`).
write("People/Theo Park.md", "---\ntype: person\nrelation: friend\n---\n\nA friend.\n")
write("People/Mia Chen.md", "---\ntype: person\nrelation: friend\n---\n\nA friend.\n")
write("People/Mia Lopes.md", "---\ntype: person\nrelation: friend\n---\n\nA friend.\n")
write("Graph test/Met.md", "Met [[Theo]] and [[Mia]].\n")
;[, graph] = await api("GET", "graph")
check("graph: a first name only one person has links to them", gedge("Graph test/Met.md", "People/Theo Park.md"), graph.edges.filter((e: Any) => e.from === "Graph test/Met.md"))
check("graph: a first name two people share links to nobody", !graph.edges.some((e: Any) => e.from === "Graph test/Met.md" && e.to.startsWith("People/Mia")))
const { linkResolver } = await import("../core/links.ts")
const lr = linkResolver([{ path: "Notes/Idea.md", aliases: ["Big idea"] }, { path: "People/Bob Lee.md", weak: ["Sam"] }, { path: "Idea.md" }])
check("links: path, name, alias, heading and weak names resolve", lr("Notes/Idea") === "Notes/Idea.md" && lr("idea") === "Idea.md" && lr("Big idea#Part") === "Notes/Idea.md" && lr("sam") === "People/Bob Lee.md" && lr("Nobody") === null)
let [, localG] = await api("GET", "graph?path=Graph test/Far.md&depth=1")
const lp = (g: Any) => g.nodes.map((n: Any) => n.path).sort()
check("graph: a local graph is the file and its neighbours", JSON.stringify(lp(localG)) === JSON.stringify(["Graph test/Board.canvas", "Graph test/Far.md", "Graph test/Spoke one.md"]), lp(localG))
;[, localG] = await api("GET", "graph?path=Graph test/Far.md&depth=2")
check("graph: depth 2 reaches two links away, with dist", lp(localG).includes("Graph test/Hub.md") && localG.nodes.find((n: Any) => n.path === "Graph test/Hub.md").dist === 2, lp(localG))
check("graph: a local graph of nothing is a 404", (await api("GET", "graph?path=Graph test/Missing.md"))[0] === 404)
write("Graph test/Far.md", "The end of the line, now with [[Alone]].\n")
;[, graph] = await api("GET", "graph")
check("graph: follows a file changed on disk", gedge("Graph test/Far.md", "Graph test/Alone.md"))
write("Graph test/With graph.md", "Links to [[Hub]].\n\n```block-graph\ndepth: 2\n```\n")
let [, gtext] = await api("GET", "render?path=Graph test/With graph.md")
check("graph: the block as text lists neighbours as links", gtext.includes("- [[Hub]] (links to it)") && gtext.includes("**Two links away") && gtext.includes("[[Spoke one]]") && !gtext.includes("```block-graph"), gtext)
let [, gset] = await api("PUT", "graph/settings", { colorBy: "type", hidden: ["folder:Logs"] })
check("graph: settings saved in its data.json", gset.colorBy === "type" && JSON.parse(read(".vaultite/plugins/graph/data.json")).hidden[0] === "folder:Logs", gset)
check("graph: unknown settings refused", (await api("PUT", "graph/settings", { nope: 1 }))[0] === 400)

// ---------- One type per file, and archiving (core/fileprops.ts) ----------
write("People/No Type.md", "---\nrelation: friend\n---\n\nNo type line.\n")
write("People/Odd Type.md", "---\ntype: persn\nrelation: friend\n---\n\nA type no kind has.\n")
write("People/Wrong Type.md", "---\ntype: idea-board\n---\n\nNot a kind's type.\n")
write("People/A Note.md", "---\ntype: note\n---\n\nSays it's a note, among people.\n")
write("Elsewhere/Loose person.md", "---\ntype: Person\nrelation: friend\n---\n\nOutside People.\n")
let [, atree] = await api("GET", "files")
const frow = (p: string) => atree.files.find((f: Any) => f.path === p)
check("type: a kind's folder never decides a file's type", frow("People/No Type.md")?.type === null && frow("People/No Type.md")?.kind === null, frow("People/No Type.md"))
check("type: a file's `type` decides its kind, whatever its folder", frow("People/A Note.md")?.kind === "notes" && frow("Elsewhere/Loose person.md")?.kind === "people" &&
  frow("Elsewhere/Loose person.md")?.type === "person" && frow("Dashboards/Design.md")?.type === "dashboard", [frow("People/A Note.md"), frow("Elsewhere/Loose person.md")])
;[, s] = await api("GET", "state")
check("type: one no kind has, in a kind's folder, is a plain file of that type", frow("People/Odd Type.md")?.kind === null && frow("People/Odd Type.md")?.type === "persn", frow("People/Odd Type.md"))
let [, aqt] = await api("POST", "query", { type: "person", from: "People/", columns: ["file", "type"] })
const qpaths = (r: Any) => r.groups.flatMap((g: Any) => g.rows.map((x: Any) => x.path))
check("type: a query's `type` is the file's type", qpaths(aqt).includes("People/Alice Park.md") && !qpaths(aqt).includes("People/No Type.md") && !qpaths(aqt).includes("People/A Note.md") && aqt.groups[0].rows.find((x: Any) => x.path === "People/Alice Park.md").values.type === "person", qpaths(aqt))
;[, graph] = await api("GET", "graph")
check("type: the graph colours by the file's type", gnode("People/No Type.md")?.type === null && gnode("People/A Note.md")?.type === "note", gnode("People/A Note.md"))
for (const f of ["People/Wrong Type.md", "People/Odd Type.md", "People/A Note.md"]) fs.rmSync(path.join(VAULT, f))
fs.rmSync(path.join(VAULT, "Elsewhere"), { recursive: true })

// ---------- Folders are the user's (core/vault.ts kindFor and home): kinds by type, new files where their kind's are ----------
{
  write("Personal/People/Moved Person.md", "---\ntype: person\nrelation: friend\n---\n\nMoved with the others.\n")
  write("Personal/People/Typeless.md", "---\nrelation: family\n---\n\nNo type, among people.\n")
  write("Personal/Logs/Study/2026-09-01 Verbs.md", "---\ntype: log\narea: study\ndate: 2026-09-01\ntitle: Verbs\n---\n")
  write("Archive/Books/Not a book.md", "---\nstatus: done\n---\n\nIn a folder only named like Books'.\n")
  write("Templates/A person.md", "---\ntype: person\nrelation: friend\n---\n")
  let [, ft] = await api("GET", "files")
  const row = (p: string) => ft.files.find((f: Any) => f.path === p)
  check("folders: a typed file is its kind in any folder", row("Personal/People/Moved Person.md")?.kind === "people" &&
    (await api("GET", "people/Moved Person"))[1]?.id === "Personal/People/Moved Person", row("Personal/People/Moved Person.md"))
  check("folders: no type, even among people, is a plain file", row("Personal/People/Typeless.md")?.kind === null, row("Personal/People/Typeless.md"))
  check("folders: a folder only named like a kind's isn't one", row("Archive/Books/Not a book.md")?.kind === null, row("Archive/Books/Not a book.md"))
  check("folders: templates are never items, whatever their type", row("Templates/A person.md")?.kind === null && row("Templates/A person.md")?.type === "person" &&
    !(await api("GET", "people"))[1].some((p: Any) => p.id === "Templates/A person"), row("Templates/A person.md"))
  await api("POST", "logs", [{ area: "study", date: "2026-09-02", source: "claude", ext_id: "folders-study", title: "Nouns" }])
  check("folders: a new log goes where its area's logs are", exists("Personal/Logs/Study/2026-09-02 Nouns.md"), ft.folders)
  write("Notes/Met.md", "Met [[Moved Person]].\n")
  await api("GET", "state")
  await api("PUT", "people/Moved Person", { name: "Moved Again" })
  check("folders: a renamed item stays in its folder", exists("Personal/People/Moved Again.md") && !exists("People/Moved Again.md"))
  check("a renamed item's links follow it", read("Notes/Met.md") === "Met [[Moved Again]].\n", read("Notes/Met.md"))
  const inPeople = (await api("GET", "people"))[1].filter((p: Any) => p.id.startsWith("People/")).length
  for (let i = 0; i <= inPeople; i++) write(`Personal/People/Extra ${i}.md`, "---\ntype: person\nrelation: contact\n---\n")
  await api("POST", "people", { name: "Newly Met", relation: "contact" })
  check("folders: a new person goes where most people are", exists("Personal/People/Newly Met.md"), inPeople)
  const { homeFolder } = await import("../core/fileprops.ts")
  check("folders: homeFolder prefers folders named like the kind's", homeFolder(["Clippings/a.md", "Clippings/b.md", "Personal/Notes/c.md"], "Notes") === "Personal/Notes" &&
    homeFolder(["Personal/Logs/Gym/a.md", "Personal/Logs/Gym/b.md", "Logs/Sleep/c.md"], "Logs", true) === "Personal/Logs/Gym" &&
    homeFolder(["Friends/a.md", "Friends/b.md", "c.md"], "People") === "Friends" && homeFolder([], "People") === null)
  for (const d of ["Personal", "Archive"]) fs.rmSync(path.join(VAULT, d), { recursive: true })
  fs.rmSync(path.join(VAULT, "Templates/A person.md"))
}

// Archiving: one key, any file.
write("People/Kai Old.md", "---\ntype: person\nrelation: friend\narchived: true\n---\n\nAn old friend.\n")
write("People/Kai New.md", "---\ntype: person\nrelation: friend\n---\n\nA new friend.\n")
write("People/Remy Gone.md", "---\ntype: person\nrelation: friend\narchived: true\n---\n\nMoved away.\n")
write("Arch/Links.md", "[[Kai]], [[Remy]], [[Kai Old]] and [[Shared]].\n")
write("Arch/Old note.md", "---\ntype: note\naliases: [Shared]\narchived: true\n---\n\nAn archived note about quokkas.\n")
write("Arch/New note.md", "---\ntype: note\naliases: [Shared]\n---\n\nA current note about quokkas.\n")
;[, atree] = await api("GET", "files")
check("archived: the file row says so (and only then)", frow("Arch/Old note.md")?.archived === true && !("archived" in frow("Arch/New note.md")), frow("Arch/Old note.md"))
;[, s] = await api("GET", "state")
const kaiOld = s.people.find((p: Any) => p.id === "People/Kai Old"), kaiNew = s.people.find((p: Any) => p.id === "People/Kai New")
check("archived: every kind's item says so", kaiOld?.archived === true && !kaiNew?.archived, [kaiOld?.archived, kaiNew?.archived])
;[, graph] = await api("GET", "graph?archived=true")
check("archived: a first name goes to the one not archived", gedge("Arch/Links.md", "People/Kai New.md"), graph.edges.filter((e: Any) => e.from === "Arch/Links.md"))
check("archived: a full name, and a first name nobody else has, still find it", gedge("Arch/Links.md", "People/Kai Old.md") && gedge("Arch/Links.md", "People/Remy Gone.md"))
check("archived: an alias goes to the one not archived", gedge("Arch/Links.md", "Arch/New note.md") && !gedge("Arch/Links.md", "Arch/Old note.md"))
const lra = linkResolver([{ path: "People/Kai Old.md", weak: ["Kai"], archived: true }, { path: "People/Kai New.md", weak: ["Kai"] },
  { path: "A/Old.md", aliases: ["Twin"], archived: true }, { path: "B/New.md", aliases: ["Twin"] }, { path: "People/Remy Gone.md", weak: ["Remy"], archived: true }])
check("links: archived files lose ties, and keep what's theirs alone", lra("Kai") === "People/Kai New.md" && lra("Twin") === "B/New.md" && lra("Remy") === "People/Remy Gone.md" && lra("Kai Old") === "People/Kai Old.md" && lra("A/Old") === "A/Old.md", [lra("Kai"), lra("Twin"), lra("Remy"), lra("Kai Old")])
;[, graph] = await api("GET", "graph")
check("archived: left out of the graph", !gnode("People/Kai Old.md") && !gnode("Arch/Old note.md") && !!gnode("People/Kai New.md"))
;[, localG] = await api("GET", "graph?path=Arch/Old note.md&depth=1")
check("archived: its own local graph keeps it", lp(localG).includes("Arch/Old note.md"), lp(localG))
await api("PUT", "graph/settings", { archived: true })
;[, graph] = await api("GET", "graph")
check("archived: a graph setting brings them back", !!gnode("People/Kai Old.md"))
await api("PUT", "graph/settings", { archived: null })
let [, aq] = await api("POST", "query", { from: "Arch/" })
check("archived: left out of database views", JSON.stringify(qpaths(aq)) === JSON.stringify(["Arch/Links.md", "Arch/New note.md"]), qpaths(aq))
;[, aq] = await api("POST", "query", { from: "Arch/", archived: true })
check("archived: `archived: true` brings them in", qpaths(aq).length === 3, qpaths(aq))
;[, aq] = await api("POST", "query", { from: "Arch/", archived: "only" })
check("archived: `archived: only` lists only them", JSON.stringify(qpaths(aq)) === JSON.stringify(["Arch/Old note.md"]), qpaths(aq))
check("archived: another value is a 400", (await api("POST", "query", { archived: "maybe" }))[0] === 400)
const [, asr] = await api("GET", "search?q=quokkas")
check("archived: search finds it last, marked", asr.length === 2 && asr[0].path === "Arch/New note.md" && asr[1].archived === true, asr)
write("Arch/Due.md", "```block-people-group\ntitle: Friends\nrelations: [friend]\n```\n")
let [, adue] = await api("GET", "render?path=Arch/Due.md")
check("archived: left out of People's blocks", adue.includes("Kai New") && !adue.includes("Kai Old") && !adue.includes("Remy Gone"), adue)
// Through the API: set on any kind's item, written as `archived: true` and moved into .archive/ (the Archive plugin);
// unset, the key is removed (never `false`) and it moves back. Links follow both ways.
write("Arch/To Kai.md", "[[People/Kai New]] and [[Kai New]].\n")
let [, kaiPut] = await api("PUT", "people/Kai New", { archived: true })
check("archive: an API write adds only that key, and moves it into .archive/", !exists("People/Kai New.md") && kaiPut.id === "People/.archive/Kai New" &&
  read("People/.archive/Kai New.md") === "---\ntype: person\nrelation: friend\narchived: true\n---\n\nA new friend.\n", kaiPut)
check("archive: a path link follows it, a name link still finds it", read("Arch/To Kai.md") === "[[People/.archive/Kai New]] and [[Kai New]].\n", read("Arch/To Kai.md"))
;[, s] = await api("GET", "state")
check("archive: still a person, archived", s.people.find((p: Any) => p.id === "People/.archive/Kai New")?.archived === true)
check("archive: its id from before still finds it", (await api("GET", "people/People/Kai New"))[1]?.id === "People/.archive/Kai New")
;[, adue] = await api("GET", "render?path=Arch/Due.md")
check("archive: left out of lists", !adue.includes("Kai New"), adue)
;[, graph] = await api("GET", "graph?archived=true")
check("archive: links to it resolve", gedge("Arch/To Kai.md", "People/.archive/Kai New.md"), graph.edges.filter((e: Any) => e.from === "Arch/To Kai.md"))
;[, atree] = await api("GET", "files")
check("archive: in the tree's files and folders, archived", frow("People/.archive/Kai New.md")?.archived === true && atree.folders.includes("People/.archive"))
kaiPut = (await api("PUT", "people/People/Kai New", { archived: false }))[1]
check("archive: unarchiving removes the key and moves it back", kaiPut.id === "People/Kai New" && !exists("People/.archive/Kai New.md") &&
  read("People/Kai New.md") === "---\ntype: person\nrelation: friend\n---\n\nA new friend.\n", kaiPut)
check("archive: links follow it back", read("Arch/To Kai.md") === "[[People/Kai New]] and [[Kai New]].\n", read("Arch/To Kai.md"))
// The ops: any file, Markdown or not; a name taken on the way back gets " 1".
write("Arch/Plain.md", "Plain text.\n")
write("Arch/Chart.png", "not really a png")
write("Arch/See.md", "[[Arch/Plain]] ![[Arch/Chart.png]]\n")
let [, aop] = await api("POST", "ops/archive.add", { path: "Arch/Plain.md" })
check("archive.add: moved, and the key added", aop.path === "Arch/.archive/Plain.md" && read("Arch/.archive/Plain.md") === "---\narchived: true\n---\n\nPlain text.\n", aop)
;[, aop] = await api("POST", "ops/archive.add", { path: "Arch/Chart.png" })
check("archive.add: a file that isn't Markdown just moves", aop.path === "Arch/.archive/Chart.png" && read("Arch/See.md") === "[[Arch/.archive/Plain]] ![[Arch/.archive/Chart.png]]\n", read("Arch/See.md"))
;[, atree] = await api("GET", "files")
check("archive.add: in an archive folder counts as archived", atree.others.find((f: Any) => f.path === "Arch/.archive/Chart.png")?.archived === true)
write("Arch/Plain.md", "A new plain.\n")
;[, aop] = await api("POST", "ops/archive.restore", { path: "Arch/.archive/Plain.md" })
check("archive.restore: back, key gone, a free name when taken", aop.path === "Arch/Plain 1.md" && read("Arch/Plain 1.md") === "Plain text.\n" && read("Arch/See.md").startsWith("[[Arch/Plain 1]]"), aop)
check("archive.add: a hidden file or a folder is refused", (await api("POST", "ops/archive.add", { path: "Arch" }))[0] === 400)
// By hand, the key alone doesn't move a file; archive.tidy moves those, once.
write("Arch/By hand.md", "---\narchived: true\n---\n\nTyped.\n")
;[, aop] = await api("POST", "ops/archive.tidy", { dry: true })
check("archive.tidy --dry: lists what's marked but not moved", exists("Arch/By hand.md") && aop.files.includes("Arch/By hand.md") && aop.files.includes("People/Kai Old.md") && !aop.moved.length, aop)
;[, aop] = await api("POST", "ops/archive.tidy", {})
check("archive.tidy: moves each into its folder's .archive", !aop.failed.length && exists("Arch/.archive/By hand.md") && exists("People/.archive/Kai Old.md") &&
  (await api("POST", "ops/archive.tidy", { dry: true }))[1].files.length === 0, aop)
;[, graph] = await api("GET", "graph?archived=true")
check("archive.tidy: names still resolve to the archived file", gedge("Arch/Links.md", "People/.archive/Kai Old.md") && gedge("Arch/Links.md", "People/.archive/Remy Gone.md"),
  graph.edges.filter((e: Any) => e.from === "Arch/Links.md"))
// New files never go into an archive folder.
const anote = (await api("POST", "notes", { ext_id: "idea-archive-test", title: "Archive me", body: "Soon gone.", kind: "idea", status: "seed" }))[1]
const anow = (await api("PUT", `notes/${encodeURIComponent(anote.id)}`, { archived: true }))[1]
check("archived: notes too", anow.id.includes("/.archive/") && /\narchived: true\n/.test(read(`${anow.id}.md`)) && !(await api("GET", "notes"))[1].some((n: Any) => n.id === anow.id) && (await api("GET", "notes?archived=true"))[1].some((n: Any) => n.id === anow.id), anow)
await api("POST", "books", { title: "Shelved book", author: "Bob Lee", status: "reading" })
await api("PUT", "books/Shelved book", { archived: true })
write("Arch/Books.md", "```block-books\n```\n")
check("archived: left out of Books' list", !(await api("GET", "render?path=Arch/Books.md"))[1].includes("Shelved book"))
await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "archived-meal", title: "Old meal", data: { kcal: 100 } }])
let [, alogs] = await api("GET", "logs?area=nutrition")
let alog = alogs.find((l: Any) => l.ext_id === "archived-meal")
fs.writeFileSync(path.join(VAULT, `${alog.id}.md`), read(`${alog.id}.md`).replace(/\n---\n/, "\narchived: true\n---\n"))
;[, alogs] = await api("GET", "logs?area=nutrition")
check("archived: GET /api/logs leaves it out", !alogs.some((l: Any) => l.ext_id === "archived-meal"))
;[, alogs] = await api("GET", "logs?area=nutrition&archived=true")
alog = alogs.find((l: Any) => l.ext_id === "archived-meal")
check("archived: a log's `archived` is the core's, not its data", alog.archived === true && !("archived" in alog.data), alog)
await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "archived-meal", title: "Old meal", data: { kcal: 120 } }])
check("archived: a log's upsert keeps it archived", /\narchived: true\n/.test(read(`${alog.id}.md`)) && /\nkcal: 120\n/.test(read(`${alog.id}.md`)), read(`${alog.id}.md`))
const { archivedValue, isArchived, archiveTwin, unarchived, isHiddenPath, inArchive, homeFolder: homeOf } = await import("../core/fileprops.ts")
check("archive: paths", archiveTwin("People/Kai.md") === "People/.archive/Kai.md" && archiveTwin("Top.md") === ".archive/Top.md" && archiveTwin("A/.archive/B.md") === "A/B.md" &&
  unarchived("A/.archive/B/.archive/c.md") === "A/B/c.md" && inArchive(".archive/x.md") && !inArchive("A/.archive") && !isHiddenPath("A/.archive/b.md") && isHiddenPath(".trash/a.md") &&
  homeOf(["People/.archive/a.md", "People/.archive/b.md", "People/c.md"], "People") === "People")
check("archived: what counts", [true, "yes", "2026-09-01", 1].every(archivedValue) && ![false, "false", "no", 0, "", null, undefined].some(archivedValue) && isArchived({ archived: true }) && !isArchived(null))

// ---------- Books' created, journal entries as a tag, people's sort ----------
await api("POST", "books", { title: "New created", author: "Alice Park", status: "want" })
check("books: a new book gets `created`", /\ncreated: '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'\n/.test(read("Books/New created.md")), read("Books/New created.md"))
write("Notes/Tagged journal.md", "---\ntype: note\ntags: [journal]\n---\n\nAnother day.\n")
write("Notes/Inline journal.md", "---\ntype: note\n---\n\nA third day. #Journal\n")
;[, s] = await api("GET", "state")
const nj = (t: string) => s.notes.find((n: Any) => n.title === t)
check("notes: a journal tag or #journal is a journal entry", nj("Tagged journal")?.journal === true &&
  nj("Inline journal")?.journal === true && nj("Hand written")?.journal === false, [nj("Tagged journal"), nj("Inline journal")])
const jn = (await api("POST", "notes", { ext_id: "journal-api-test", title: "Api journal", body: "Today.", kind: "journal", tags: "Travel" }))[1]
check("notes: the API's kind journal writes a Journal tag instead", /\nkind: note\n/.test(read(`${jn.id}.md`)) && /\ntags: \[Travel, Journal\]\n/.test(read(`${jn.id}.md`)) && jn.journal === true, read(`${jn.id}.md`))
const jn2 = (await api("POST", "notes", { ext_id: "journal-api-test-2", title: "Api journal two", body: "Today.", kind: "journal", tags: "journal" }))[1]
check("notes: and doesn't duplicate one it has", /\ntags: \[journal\]\n/.test(read(`${jn2.id}.md`)), read(`${jn2.id}.md`))
check("notes: kind journal in GET /api/notes means journal entries", (await api("GET", "notes?kind=journal"))[1].every((n: Any) => n.journal) &&
  (await api("GET", "notes?kind=journal"))[1].some((n: Any) => n.title === "Inline journal"))
check("notes: another kind is a problem", (write("Notes/Odd kind.md", "---\ntype: note\nkind: memo\n---\n\nx\n"), (await api("GET", "state"))[1].vault.problems.some((x: Any) => x.file === "Notes/Odd kind.md" && x.problem.includes("['idea', 'note']"))))
fs.rmSync(path.join(VAULT, "Notes/Odd kind.md"))
await api("POST", "people", { name: "Zed Nosort", relation: "friend" })
write("People/Aaron Nosort.md", "---\ntype: person\nrelation: friend\n---\n\nHand made.\n")
;[, s] = await api("GET", "state")
check("people: no `sort` is written, on a new person or on read", !/sort/.test(read("People/Zed Nosort.md")) && !/sort/.test(read("People/Aaron Nosort.md")), read("People/Zed Nosort.md"))
const pOrder = s.people.map((p: Any) => p.name)
check("people: those with a sort first, by it; the rest after, by name", pOrder.indexOf("Hand Made") < pOrder.indexOf("Aaron Nosort") && pOrder.indexOf("Aaron Nosort") < pOrder.indexOf("Zed Nosort"), pOrder)

// ---------- Canvas: JSON Canvas files; read as text; written back keeping what the app doesn't know ----------
const { parseCanvas, writeCanvas, canvasMarkdown } = await import("../plugins/core/canvas/codec.ts")
const [, ctext] = await api("GET", "render?path=Graph test/Board.canvas")
check("canvas: render gives its cards, files as links, and connections", ctext.startsWith("# Board\n") && ctext.includes("- Web page: <https://example.com>") && ctext.includes("### Plan (green)") && ctext.includes("- Card (red): Start with [[Far]]") && ctext.includes("- File: [[Graph test/Spoke one]]") && ctext.includes('"Start with [[Far]]" → [[Graph test/Spoke one]]: then'), ctext)
write("Graph test/Embeds a board.md", "Look:\n\n![[Board.canvas]]\n")
const [, etext] = await api("GET", "render?path=Graph test/Embeds a board.md")
check("canvas: an embedded canvas reads as its text", etext.includes("**Graph test/Board.canvas**") && etext.includes("Start with [[Far]]"), etext)
const boardText = read("Graph test/Board.canvas")
const cdoc = parseCanvas(boardText)
check("canvas: written back unchanged when nothing changed", writeCanvas(cdoc, boardText) === boardText)
cdoc.nodes[1] = { ...cdoc.nodes[1], x: 40.4 }
const moved = JSON.parse(writeCanvas(cdoc, boardText))
check("canvas: a change keeps unknown keys on the file, nodes and edges", moved.custom.keep === true && moved.nodes[0].mine === "kept" && moved.edges[0].extra === 1 && moved.nodes[1].x === 40, moved)
check("canvas: keeps the file's indent (tabs)", writeCanvas(cdoc, boardText).includes('\n\t"nodes"') && writeCanvas(cdoc, JSON.stringify(board, null, 2)).includes('\n  "nodes"'))
check("canvas: an empty file is an empty canvas; not JSON throws", parseCanvas("").nodes.length === 0 && (() => { try { parseCanvas("{nope"); return false } catch { return true } })())
check("canvas: an empty canvas as text says so", canvasMarkdown('{"nodes":[],"edges":[]}') === "_An empty canvas._")
const [cmade] = await api("POST", "file", { path: "Canvases/New.canvas", text: '{\n\t"nodes": [],\n\t"edges": []\n}\n' })
const [, cread] = await api("GET", "file?path=Canvases/New.canvas")
check("canvas: a .canvas is a JSON text file", cmade < 300 && cread.kind === null && cread.text.includes('"nodes"'), cread)

// Link cards' previews (plugins/core/canvas/preview.ts): what a page's HTML says, and the addresses never fetched.
const { parsePreview, decodeEntities } = await import("../plugins/core/canvas/preview.ts")
const { blockedHost, blockedAddress, publicUrl: previewable } = await import("../core/web.ts")
const pageHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>Lighthouse &amp; friends</title>
<!-- <meta property="og:title" content="Commented out"> -->
<meta property="og:title" content="Lighthouse &#8212; a plant reminder">
<meta property='og:site_name' content='Lighthouse'>
<meta name="description" content="Plain description">
<meta property="og:description" content="See   which plants
 need water &quot;at a glance&quot;">
<meta property="og:image" content="/img/card.png">
<link rel="apple-touch-icon" href="/touch.png">
<link rel="icon" type="image/png" sizes="16x16" href="/fav16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/fav32.png">
<script>document.title = "<title>Not this</title>"</script>
</head><body><svg><title>Icon title</title></svg></body></html>`
const pv = parsePreview(pageHtml, "https://lighthouse.example.com/docs/intro")
check("link preview: og tags over <title>, entities decoded, whitespace folded", pv.title === "Lighthouse — a plant reminder" && pv.site === "Lighthouse" && pv.description === 'See which plants need water "at a glance"', pv)
check("link preview: image and icon made absolute; a 32 px icon over 16 px and the touch icon", pv.image === "https://lighthouse.example.com/img/card.png" && pv.icon === "https://lighthouse.example.com/fav32.png", pv)
const bare = parsePreview(`<html><head><base href="https://cdn.example.org/x/"><TITLE>  Just a   title </TITLE><meta name=twitter:image content=pic.jpg></head><body><p>Hi</p></body></html>`, "http://plain.example.org/a")
check("link preview: <title> when no og:title; <base href>; twitter:image; /favicon.ico when no icon", bare.title === "Just a title" && bare.image === "https://cdn.example.org/x/pic.jpg" && bare.icon === "http://plain.example.org/favicon.ico" && !bare.site && !bare.description, bare)
check("link preview: a page that says nothing has only its favicon", JSON.stringify(parsePreview("not html at all", "https://example.org/")) === '{"icon":"https://example.org/favicon.ico"}')
check("link preview: images that aren't http(s) are left out", !parsePreview(`<meta property="og:image" content="javascript:alert(1)">`, "https://example.org/").image)
const ents = decodeEntities("a &amp; b &lt;c&gt; &#39;d&#x27; &nbsp;&bogus; &#0;")
check("link preview: entities", ents === "a & b <c> 'd'  &bogus; &#0;", ents)
const localHosts = ["localhost", "app.localhost", "printer.local", "box.tail1234.ts.net", "nas", "router.lan", "127.0.0.1", "10.1.2.3",
  "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.100.100.100", "100.64.0.1", "0.0.0.0", "[::1]", "[::]", "[fe80::1]",
  "[fd7a:115c:a1e0::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[64:ff9b::a00:1]", "[2002:c0a8:101::1]", "224.0.0.1", "255.255.255.255", "localhost."]
const leaked = localHosts.filter((h) => !blockedHost(h))
check("link preview: local, private and tailnet hosts are refused", leaked.length === 0, leaked)
const publicHosts = ["example.com", "www.example.org", "93.184.215.14", "[2606:4700::6810:84e5]", "100.128.0.1", "172.32.0.1"]
const refused = publicHosts.filter((h) => blockedHost(h))
check("link preview: public hosts are fetched", refused.length === 0, refused)
check("link preview: DNS answers are checked as addresses", blockedAddress("10.0.0.5") && blockedAddress("fd00::5") && blockedAddress("::ffff:192.168.0.1") && blockedAddress("not an ip") && !blockedAddress("8.8.8.8") && !blockedAddress("2001:4860:4860::8888"))
check("link preview: only http(s), no logins", typeof previewable("ftp://example.com/") === "string" && typeof previewable("https://ana:pw@example.com/") === "string" && typeof previewable("file:///etc/hosts") === "string" && previewable("https://example.com/a#b") instanceof URL)
const [lbad] = await api("GET", "canvas/link?url=ftp://example.com/x") // (this helper doesn't decode the query)
const [lnone] = await api("GET", "canvas/link")
const [llocal, llocalBody] = await api("GET", "canvas/link?url=http://127.0.0.1:8793/api/state")
check("link preview route: not http(s) or no url is a 400; a local address answers just the url, unfetched", lbad === 400 && lnone === 400 && llocal === 200 && JSON.stringify(llocalBody) === JSON.stringify({ url: "http://127.0.0.1:8793/api/state" }), [lbad, lnone, llocal, llocalBody])

// The board's edits (plugins/core/canvas/edit.ts) and snapping (geometry.ts): pure, on a made-up canvas.
{
  const ed = await import("../plugins/core/canvas/edit.ts")
  const geo = await import("../plugins/core/canvas/geometry.ts")
  const base = {
    nodes: [
      { id: "g", type: "group", label: "G", x: 0, y: 0, width: 400, height: 300 },
      { id: "a", type: "text", text: "A", x: 20, y: 20, width: 100, height: 60, mine: 1 },
      { id: "b", type: "text", text: "B", x: 200, y: 100, width: 100, height: 60 },
      { id: "c", type: "text", text: "C", x: 600, y: 0, width: 100, height: 60 },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "x" }, { id: "e2", fromNode: "b", toNode: "c" }],
    extra: true,
  }
  const dup = ed.duplicate(base, new Set(["g"]))
  const copies = dup.doc.nodes.filter((n) => dup.ids.has(n.id))
  check("canvas edit: duplicating a group copies what's in it and the arrows between them, with new ids",
    copies.length === 3 && dup.doc.nodes[0].type === "group" && dup.doc.edges.length === 3 && copies.some((n) => n.mine === 1 && n.x === 50) &&
    !copies.some((n) => ["g", "a", "b"].includes(n.id)) && dup.doc.extra === true, dup.doc)
  const text = ed.copyText(ed.slice(base, new Set(["a", "b"])))
  const back = ed.pastedCanvas(text)!
  const ins = ed.insert(base, back, 1000, 0)
  check("canvas edit: a copy pastes back as JSON Canvas, moved, with its arrow", back.nodes.length === 2 && back.edges.length === 1 &&
    ins.doc.nodes.length === 6 && ins.doc.edges.length === 3 && ins.doc.nodes.some((n) => ins.ids.has(n.id) && n.x === 1020), ins.doc)
  check("canvas edit: text that isn't a piece of a canvas doesn't paste as one", ed.pastedCanvas("hello") === null && ed.pastedCanvas('{"nodes": []}') === null && ed.pastedCanvas("{nope") === null)
  const rm = ed.remove(base, new Set(["b"]))
  check("canvas edit: removing a card removes its arrows", rm.nodes.length === 3 && rm.edges.length === 0)
  const ug = ed.ungroup(base, new Set(["g", "a"]))
  check("canvas edit: ungroup removes only the group", ug.nodes.length === 3 && ug.nodes.some((n) => n.id === "a") && ug.edges.length === 2)
  const al = ed.align(base, new Set(["a", "c"]), "left")
  check("canvas edit: align lines cards up on the selection's edge", al.nodes.find((n) => n.id === "c")!.x === 20 && al.nodes.find((n) => n.id === "b")!.x === 200)
  const e = base.edges[0]
  check("canvas edit: arrow directions write only what isn't the default", JSON.stringify(ed.setDirection(e, "both")) === JSON.stringify({ ...e, fromEnd: "arrow" }) &&
    JSON.stringify(ed.setDirection({ ...e, fromEnd: "arrow" }, "forward")) === JSON.stringify(e) && ed.setDirection(e, "none").toEnd === "none" &&
    ed.directionOf(ed.setDirection(e, "none")) === "none" && ed.directionOf(e) === "forward")
  const rv = ed.reverse({ ...e, fromSide: "right", toSide: "left" })
  check("canvas edit: reverse swaps the cards and their sides", rv.fromNode === "b" && rv.toNode === "a" && rv.fromSide === "left" && rv.toSide === "right", rv)
  check("canvas edit: a note's name from a card's first line", ed.nameFromText("## Plan: the [[Alice Park|launch]]\nmore") === "Plan the launch" && ed.nameFromText("   \n") === "Untitled" && ed.nameFromText("- [ ] Buy *milk*") === "Buy milk")
  const others = [{ x: 300, y: 0, width: 100, height: 100 }]
  const sm = geo.snapMove({ x: 197, y: 23, width: 100, height: 40 }, others, { grid: true, objects: true, tol: 6 })
  check("canvas snap: a box near another's edge snaps to it, with a guide; else to the grid", sm.dx === 3 && sm.guides.length === 1 && sm.guides[0].axis === "x" && sm.dy === -3, sm)
  const off = geo.snapMove({ x: 197, y: 50, width: 100, height: 40 }, others, { grid: false, objects: false, tol: 6 })
  check("canvas snap: off, nothing moves", off.dx === 0 && off.dy === 0 && !off.guides.length)
  const rs = geo.resizeBox({ x: 0, y: 0, width: 200, height: 100 }, "nw", 150, 90, [], { grid: false, objects: false, tol: 6 })
  check("canvas resize: never smaller than the minimum, the far corner stays", rs.box.width === geo.MIN_W && rs.box.height === geo.MIN_H && rs.box.x + rs.box.width === 200 && rs.box.y + rs.box.height === 100, rs.box)
  const keep = geo.resizeBox({ x: 0, y: 0, width: 200, height: 100 }, "se", 200, 0, [], { grid: false, objects: false, tol: 6, keep: true })
  check("canvas resize: a corner with Shift keeps the proportions", keep.box.width === 400 && keep.box.height === 200, keep.box)
  const pf = geo.placeFrom({ x: 500, y: 100 }, { x: 300, y: 100 }, 250, 60)
  check("canvas connect: a card made where an arrow was let go faces where it came from", pf.side === "left" && pf.box.x === 500 && pf.box.y === 70, pf)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
// ---------- Obsidian vaults: embeds, heading and block links, tags, comments, .obsidian settings ----------
write("Obs/Obs A.md", "---\ntags: [compat]\n---\n# Top\n\nIntro with #obs/inline and `#notatag` %%a secret%% ^intro\n\n## Plans\n\n- first ^li1\n  - under it\n- second\n\n%%\nhidden lines\n%%\n\n## After\n\nEnd.\n")
write("Obs/Obs B.md", "See [[Obs A#Plans]] and [[Obs A#^intro]], [md](Obs%20A.md#Top), [[#Mine]].\n\n## Mine\n\n![[Obs A#Plans]]\n\n![[Obs A#^intro]]\n\n![[Obs B]]\n\n![[Obs A#Nowhere]]\n\n![[photo.png]]\n")
write("Obs/Obs C.md", "![[Obs D]]\n")
write("Obs/Obs D.md", "D says hi.\n\n![[Obs C]]\n")
let [, obsFiles] = await api("GET", "files")
const obsB = obsFiles.files.find((f: Any) => f.path === "Obs/Obs B.md")
check("obsidian: [[Note#Heading]], [[Note#^id]], Markdown links and embeds all link the note", obsB.links.filter(([t]: [string]) => t === "Obs/Obs A" || t === "Obs A").length >= 5, obsB.links)
const obsA = obsFiles.files.find((f: Any) => f.path === "Obs/Obs A.md")
check("obsidian: a file's tags are its frontmatter's and its inline #tags (not in code or comments)", same(obsA.tags, ["compat", "obs/inline"]), obsA.tags)
let [, obsR] = await api("GET", "render?path=Obs/Obs B.md")
check("obsidian: render inlines an embedded section under its link", obsR.includes("> [[Obs A#Plans]]") && obsR.includes(">\n> ## Plans") && obsR.includes("> - first\n>   - under it") && !obsR.includes("## After"), obsR)
check("obsidian: render inlines an embedded block, its id and comments taken out", obsR.includes("> Intro with #obs/inline and `#notatag`") && !obsR.includes("a secret") && !obsR.includes(" ^intro") && !obsR.includes("hidden lines") && !obsR.includes("> - second\n>\n"), obsR)
check("obsidian: a note embedding itself, a missing heading and an image are left as they are or said", obsR.includes("[[Obs B]] embeds itself") && obsR.includes("no heading Nowhere in [[Obs A]]") && obsR.includes("![[photo.png]]"), obsR)
;[, obsR] = await api("GET", "render?path=Obs/Obs C.md")
check("obsidian: embeds that embed each other stop", obsR.includes("D says hi.") && obsR.includes("[[Obs C]] embeds itself"), obsR)
const tagQ = await api("POST", "query", { options: { tags: ["obs"], columns: ["file", "tags"] } })
check("obsidian: database views match inline #tags, nested ones for their parents", tagQ[0] === 200 && tagQ[1].total === 1 && tagQ[1].groups[0].rows[0].path === "Obs/Obs A.md", tagQ)
const tagQ2 = await api("POST", "query", { options: { where: "tags contains obs/inline" } })
check("obsidian: `tags contains` sees inline tags", tagQ2[1].total === 1, tagQ2[1])
const [, tagList] = await api("GET", "tags")
check("obsidian: /api/tags counts tags and their parents", tagList.some((t: Any) => t.tag === "obs" && t.count === 1) && tagList.some((t: Any) => t.tag === "obs/inline"), tagList)
const [, tagFiles] = await api("GET", "tags?tag=obs")
check("obsidian: /api/tags?tag= lists its files", same(tagFiles.map((f: Any) => f.path), ["Obs/Obs A.md"]), tagFiles)
{
  // Renaming a tag: frontmatter (a list or text, as written; merged once) and #tags, nested ones too; not in code or links.
  write("Tagged/Rename A.md", "---\ntags: [project, other]\n---\n#project/lighthouse and `#project` in code, [[#project]] and #projector.\n")
  write("Tagged/Rename B.md", "---\ntags: project, work\n---\nPlain #Project here.\n")
  await app.vault.sync()
  const [rc, ro] = await api("POST", "ops/tag.rename", { from: "#project", to: "work" })
  await app.vault.sync()
  check("tag rename: every file with it, nested tags too, only the tags' own text", rc === 200 && ro.changed.length === 2 &&
    read("Tagged/Rename A.md") === "---\ntags: [work, other]\n---\n#work/lighthouse and `#project` in code, [[#project]] and #projector.\n", read("Tagged/Rename A.md"))
  check("tag rename: into one that's there, merged, text kept text", read("Tagged/Rename B.md") === "---\ntags: work\n---\nPlain #work here.\n", read("Tagged/Rename B.md"))
  // plugin.editLine: one line, refused when it changed since it was read.
  const tp = app.plugins.find((p) => p.id === "tags")!
  write("Tagged/Lines.md", "---\r\na: 1\r\n---\r\n- [ ] one\r\n- [ ] two\r\n")
  tp.editLine("Tagged/Lines.md", 3, "- [ ] one", ["- [x] one", "- [ ] one again"])
  let stale = 0
  try { tp.editLine("Tagged/Lines.md", 3, "- [ ] one", null) } catch (e) { stale = (e as Any).status }
  check("plugin.editLine: a small edit of one line, 409 once it changed", read("Tagged/Lines.md") === "---\r\na: 1\r\n---\r\n- [x] one\r\n- [ ] one again\r\n- [ ] two\r\n" && stale === 409, [read("Tagged/Lines.md"), stale])
  const [bc] = await api("POST", "ops/tag.rename", { from: "work", to: "123" })
  check("tag rename: a name that isn't a tag is refused", bc === 400 || bc === 422, bc)
  fs.rmSync(path.join(VAULT, "Tagged"), { recursive: true })
  await app.vault.sync()
}
;[, s] = await api("GET", "state")
const hadObsidian = s.obsidian
write(".obsidian/app.json", JSON.stringify({ newFileLocation: "folder", newFileFolderPath: "Inbox/", attachmentFolderPath: "./assets", useMarkdownLinks: true, theme: "moonstone" }))
;[, s] = await api("GET", "state")
check("obsidian: .obsidian/app.json's settings that apply are in the state", same(s.obsidian, { newFileLocation: "folder", newFileFolderPath: "Inbox", attachmentFolderPath: "./assets", useMarkdownLinks: true }) && hadObsidian === null, [hadObsidian, s.obsidian])
write(".obsidian/app.json", "{}")
;[, s] = await api("GET", "state")
check("obsidian: an empty app.json changes nothing", same(s.obsidian, {}), s.obsidian)
{
  // Its plugins: what stands in for each here (manifests' `replaces`), from the app's and the directory's.
  write(".obsidian/community-plugins.json", JSON.stringify(["recent-files-obsidian", "obsidian-made-up", "made-up-elsewhere"]))
  write(".obsidian/plugins/recent-files-obsidian/manifest.json", JSON.stringify({ id: "recent-files-obsidian", name: "Recent Files" }))
  const INDEX = path.join(tmp, "obsidian-index.json")
  fs.writeFileSync(INDEX, JSON.stringify({ plugins: [{ id: "harbor", name: "Harbor", repo: "alicepark/plugins", dir: "harbor", version: "1.0.0", replaces: { obsidian: ["made-up-elsewhere"] } }] }))
  process.env.VAULTITE_PLUGIN_INDEX = INDEX
  const [oc, rows] = await api("POST", "ops/other-apps.plugins", {})
  const by = (id: string) => (rows as Any[]).find((r) => r.id === id)
  check("obsidian plugins: each with the app's plugin that stands in for it, on or off", oc === 200 && by("recent-files-obsidian").name === "Recent Files" &&
    by("recent-files-obsidian").here[0]?.id === "recent" && by("obsidian-made-up").here.length === 0 && by("obsidian-made-up").directory.length === 0, rows)
  check("obsidian plugins: or the directory's, to install by its source", by("made-up-elsewhere").directory[0]?.source === "alicepark/plugins/harbor", by("made-up-elsewhere"))
  delete process.env.VAULTITE_PLUGIN_INDEX
  fs.rmSync(path.join(VAULT, ".obsidian/community-plugins.json"))
  fs.rmSync(path.join(VAULT, ".obsidian/plugins"), { recursive: true })
  fs.rmSync(path.join(VAULT, ".vaultite/cache/plugin-index.json"), { force: true })
  const meta = await import("../core/rules.ts")
  check("replaces: a manifest's is other apps' plugins by app", meta.metaProblems({ replaces: ["dataview"] }).length === 1 && !meta.metaProblems({ replaces: { obsidian: ["dataview"] } }).length)
}

// Property types (core/proptypes.ts): .vaultite/types.json, Obsidian's under it; the editor's notes, render, the ops,
// and database views sorting by them.
{
  const pt = await import("../core/proptypes.ts")
  const read1 = pt.readTypes({ types: { Due: "Date", tags: "tags", css: "multitext", bad: "colour", n: 3 } })
  check("types: read leniently (any case, Obsidian's multitext a list, unknown ones left out)", same(read1, { Due: "date", tags: "tags", css: "list" }), read1)
  check("types: a key's in any case, tags and aliases implied, else none", pt.typeOf(read1, "due") === "date" && pt.typeOf({}, "aliases") === "aliases" && pt.typeOf({ tags: "list" }, "tags") === "list" && pt.typeOf(read1, "x") === null)
  check("types: a value that isn't of its type says so, empty ones are fine", pt.typeProblem("date", "next week") === "is a date (YYYY-MM-DD), not 'next week'"
    && pt.typeProblem("number", "4") === "is a number, not '4' (written without quotes)" && pt.typeProblem("date", "2026-09-01") === null && pt.typeProblem("number", null) === null
    && pt.typeProblem("list", "a") !== null && pt.typeProblem("tags", "a b") === null && pt.typeProblem("checkbox", "yes") !== null && pt.typeProblem("datetime", "2026-09-01 18:00") === null)
  check("types: values as their type compares them", pt.typedValue("number", "10") === 10 && pt.typedValue("date", "Oct 3, 2026") === new Date(2026, 9, 3).getTime()
    && pt.typedValue("checkbox", "yes") === true && pt.typedValue("number", "n/a") === null && pt.typedValue("list", "x") === undefined)

  fs.rmSync(path.join(VAULT, ".vaultite/types.json"), { force: true })
  write("Types test/A.md", "---\ndue: Oct 3, 2026\nrating: 4\nversion: '1.10'\n---\n")
  write("Types test/B.md", "---\ndue: 2026-09-30\nrating: '12'\nversion: '1.9'\n---\n")
  write("Types test/C.md", "---\ndue: next week\nrating: 7\nversion: '1.2'\n---\n")
  const sortBy = async (key: string) => (await api("POST", "query", { from: "Types test/", sort: key }))[1].groups[0].rows.map((r: Any) => r.title).join()
  check("types: without one, values sort by how they look", await sortBy("due") === "B,C,A" && await sortBy("version") === "A,C,B", [await sortBy("due"), await sortBy("version")])
  let [code, r] = await api("POST", "ops/property.type", { key: "due", type: "date" })
  check("property.type: writes that one key into .vaultite/types.json", code === 200 && read(".vaultite/types.json").includes('"due": "date"') && r.type === "date", [code, r])
  await api("POST", "ops/property.type", { key: "version", type: "text" })
  await api("POST", "ops/property.type", { key: "tags", type: "tags" })
  check("property.type: a type every vault has anyway isn't written", same(JSON.parse(read(".vaultite/types.json")), { types: { due: "date", version: "text" } }), read(".vaultite/types.json"))
  check("types: dates sort by time (one that isn't a date last), text as text (1.10 after 1.9)", await sortBy("due") === "B,A,C" && await sortBy("version") === "C,B,A", [await sortBy("due"), await sortBy("version")])
  ;[, r] = await api("POST", "query", { from: "Types test/", where: "due < 2026-10-15", columns: ["file", "due"] })
  check("types: a where compares dates by time, and the answer says its keys' types", r.groups[0].rows.map((x: Any) => x.title).join() === "A,B" && same(r.types, { due: "date" }), r)
  let [, md] = await api("GET", "render?path=Types test/C.md")
  check("types: render notes a value that isn't of its type", md.includes("_(properties: `due` is a date (YYYY-MM-DD), not 'next week')_"), md)
  ;[, md] = await api("POST", "ops/property.types?as=text", { check: true })
  check("property.types: the types, and with check the values that aren't", md.includes("due      date") && md.includes("- Types test/A.md: `due` is a date (YYYY-MM-DD), not 'Oct 3, 2026'")
    && md.includes("- Types test/C.md:"), md)
  let [, st] = await api("GET", "state")
  check("state: the property types, and which the vault's file has", same(st.propertyTypes, { types: { due: "date", version: "text" }, own: ["due", "version"] }), st.propertyTypes)

  write(".obsidian/types.json", JSON.stringify({ types: { score: "number", due: "datetime", cssclasses: "multitext" } }))
  const obsBefore = read(".obsidian/types.json")
  ;[, st] = await api("GET", "state")
  check("types: Obsidian's types.json under the vault's own", same(st.propertyTypes.types, { score: "number", due: "date", cssclasses: "list", version: "text" }), st.propertyTypes)
  await api("POST", "ops/property.type", { key: "score", type: "number" })
  check("property.type: Obsidian's type again writes nothing", !read(".vaultite/types.json").includes("score") && read(".obsidian/types.json") === obsBefore, read(".vaultite/types.json"))
  await api("POST", "ops/property.type", { key: "due", type: "none" })
  ;[, r] = await api("POST", "ops/property.types", {})
  check("property.type none: back to Obsidian's, .obsidian/ never written", r.types.find((t: Any) => t.key === "due")?.type === "datetime" && r.types.find((t: Any) => t.key === "due")?.from === "other"
    && read(".obsidian/types.json") === obsBefore, r.types)
  ;[code] = await api("POST", "ops/property.type", { key: "due", type: "colour" })
  check("property.type: an unknown type is a 400", code === 400, code)
  await api("POST", "ops/property.type", { key: "version", type: "none" })
  check("property.type: the last one gone, so is the file", !exists(".vaultite/types.json"))
  fs.rmSync(path.join(VAULT, ".obsidian/types.json"), { force: true })
  fs.rmSync(path.join(VAULT, ".vaultite/types.json"), { force: true })
  fs.rmSync(path.join(VAULT, "Types test"), { recursive: true, force: true })
}

// `this` in database views: the note a view is drawn in, or the one embedding it (the nearest), alike in the block's
// text, /api/query and the where's words.
{
  const { run } = await import("../plugins/core/query/query.ts")
  const here = { path: "P/Lighthouse.md", fm: { status: "live" }, mtime: 1, links: () => [] }
  const recs = [
    { path: "N/A.md", fm: { project: "[[Lighthouse]]", status: "live" }, mtime: 1, links: () => ["Lighthouse"] },
    { path: "N/B.md", fm: { project: "[[P/Lighthouse|LH]]", status: "idea" }, mtime: 1, links: () => [] },
    { path: "N/C.md", fm: { status: "live" }, mtime: 1, links: () => ["P/Lighthouse#Goals"] },
  ]
  const names = (o: Any, self: Any = here) => run(o, recs, new Date(), { self }).groups.flatMap((g: Any) => g.rows.map((x: Any) => x.title)).join()
  check("this: a property naming the note (by name, path or with other text)", names({ where: "project = this" }) === "A,B" && names({ where: "project != this" }) === "C"
    && names({ where: { project: "this" } }) === "A,B", names({ where: "project = this" }))
  check("this: file.links contains this (what links to it), this.<key> its value", names({ where: "file.links contains this" }) === "A,C" && names({ where: "status = this.status" }) === "A,C"
    && names({ where: "status = 'this'" }) === "", names({ where: "file.links contains this" }))
  const none = run({ where: "project = this" }, recs)
  check("this: none there, it matches nothing and says so", none.total === 0 && /`this` is the note the view is in/.test(none.notes?.[0] ?? ""), none)

  write("This test/Beacon.md", "---\nstatus: live\n---\n\n![[Related]]\n")
  write("This test/Related.md", "```block-query\ntitle: Linked here\nfrom: This test/\nwhere: \"file.links contains this\"\n```\n\n```base\nfilters: file.hasLink(this)\nviews:\n  - type: list\n    name: Base here\n```\n")
  write("This test/Note.md", "See [[Beacon]].\n")
  write("This test/Other.md", "---\nstatus: live\n---\n\nAbout [[Related]].\n")
  let [, md] = await api("GET", "render?path=This test/Beacon.md")
  const quoted = md.slice(md.indexOf("> [[Related]]"))
  check("this: embedded, a block's text is about the note embedding it", quoted.includes("## Linked here") && /> \| \[\[Note\]\] \|/.test(quoted) && !quoted.includes("[[Other]]"), md)
  check("this: embedded, a ```base fence's too", /### Base here\n>\n> \| Name \|\n> \| --- \|\n> \| \[\[Note\]\] \|/.test(quoted), quoted)
  ;[, md] = await api("GET", "render?path=This test/Related.md")
  check("this: not embedded, the note it's in", md.includes("[[Other]]") && !md.includes("[[Note]]"), md)
  let [code, r] = await api("GET", 'query?q={"from":"This test/","where":"file.links contains this"}&self=This test/Related.md&this=This test/Beacon.md')
  check("this: /api/query's this, as the app asks for an embedded block", code === 200 && r.groups[0].rows.map((x: Any) => x.title).join() === "Note", r)
  ;[code, r] = await api("POST", "ops/query.run", { where: "status = this.status", from: ["This test/"], this: "Beacon" })
  check("query.run: this (the note itself not listed)", code === 200 && r.groups[0].rows.map((x: Any) => x.title).join() === "Other", r)
  fs.rmSync(path.join(VAULT, "This test"), { recursive: true, force: true })
}

// What the API sends has no private keys (_src...) and no records left empty; what had none is sent as it is, not copied.
const plain = { a: [1, { b: 2 }], c: { d: "x" } }
const mixed = { a: 1, _p: 2, list: [{ _raw: "l" }, { k: 1, _s: "s" }, plain, {}], plain }
const pub = publicOf(mixed) as Any
check("publicOf drops private keys and records left empty", same(pub, { a: 1, list: [{ k: 1 }, plain], plain }), pub)
check("publicOf leaves what it doesn't change as it is", pub.plain === plain && pub.list[1] === plain && publicOf(plain) === plain && mixed._p === 2)

// /api/state is worked out again only when something changed: a file, or a setting written by hand.
const stateNow = async () => { await vault.synced(); return (await app.run("GET", ["state"], {}, {})).body as Any }
const st1 = await stateNow()
check("state: the same answer while nothing changed", (await stateNow()) === st1 && Object.isFrozen(st1))
const hotkeys = fs.existsSync(path.join(VAULT, ".vaultite/hotkeys.json")) ? read(".vaultite/hotkeys.json") : null
write(".vaultite/hotkeys.json", JSON.stringify({ "files:new": ["Mod+Shift+N"] }))
const st2 = await stateNow()
check("state: a setting written by hand is in the next one", st2 !== st1 && same(st2.config.hotkeys, { "files:new": ["Mod+Shift+N"] }), st2.config.hotkeys)
if (hotkeys === null) fs.rmSync(path.join(VAULT, ".vaultite/hotkeys.json")); else write(".vaultite/hotkeys.json", hotkeys)
write("Notes/State check.md", "---\ntype: note\n---\n\nNew.\n")
const st3 = await stateNow()
check("state: a new file is in the next one", st3.files.files.some((f: Any) => f.path === "Notes/State check.md"))
fs.rmSync(path.join(VAULT, "Notes/State check.md"))

// The web app's refresh: GET /api/state?since=<v> answers what changed since state v (core/statepatch.ts), and the whole
// state for a v it doesn't have. Applied to what the app had, a patch makes the same state as a full load.
{
  const { applyPatch } = await import("../core/statepatch.ts")
  const since = async (v: string) => { await vault.synced(); return JSON.parse(String(((await app.run("GET", ["state"], { since: v }, {})).body as { text: string }).text)) }
  const full = async () => JSON.parse(JSON.stringify(publicOf(await stateNow())))
  const a0 = await since("0")
  check("state since 0: the whole state, with its version", typeof a0.v === "string" && same(a0.state, await full()), Object.keys(a0))
  const a1 = await since(a0.v)
  check("state since now: nothing changed", a1.v === a0.v && a1.patch === null, a1)
  write("Notes/Patch check.md", "---\ntype: note\n---\n\nFirst [[Alice Park]].\n")
  const a2 = await since(a0.v)
  const had = a0.state, got = applyPatch(had, a2.patch) as Any
  check("state since: a new note comes as a patch that makes the same state", a2.v !== a0.v && a2.since === a0.v && same(got, await full()), a2)
  check("state since: only what changed travels, the rest is the app's objects", JSON.stringify(a2.patch).length < 3000 && got.people === had.people && got.config === had.config, JSON.stringify(a2.patch).slice(0, 300))
  write("Notes/Patch check.md", "---\ntype: note\n---\n\nSecond.\n")
  const a3 = await since(a2.v)
  check("state since: a note's text changed", same(applyPatch(got, a3.patch), await full()), a3.patch)
  check("state since: from an older state still kept, too", same(applyPatch(had, (await since(a0.v)).patch), await full()))
  check("state since: a state it doesn't have (another server's, before a restart) gets the whole state", same((await since("other.1")).state, await full()))
  const ws = `${WS_DIR}/1.json`, wsWas = exists(ws) ? read(ws) : null
  write(ws, JSON.stringify({ name: "Patch", panels: [], layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Notes/Patch check.md" }], active: "t1" } } }))
  const a4 = await since(a3.v)
  // (A new settings file also adds "workspaces" to `pluginSettings`, the plugins with a settings file, which Settings lists.)
  const keys = Object.keys(a4.patch.keys).filter((k) => !(wsWas === null && k === "pluginSettings"))
  check("state since: a workspace saved is only the workspaces", same(keys, ["workspaces"]) && JSON.stringify(a4.patch).length < 450, a4.patch)
  check("state: pluginSettings lists the plugins with a settings file", ((await full()).pluginSettings ?? []).includes("agent-files"), (await full()).pluginSettings)
  if (wsWas === null) fs.rmSync(path.join(VAULT, ws)); else write(ws, wsWas)
  fs.rmSync(path.join(VAULT, "Notes/Patch check.md"))
  const a5 = await since(a4.v)
  check("state since: a file gone", same(applyPatch(applyPatch(applyPatch(got, a3.patch), a4.patch), a5.patch), await full()))
}

// Reads arriving together share one sync (Vault.synced, what server.ts does for a GET), which still reads a file
// written just before them.
let syncs = 0
const offSync = vault.afterSync(() => { syncs++ })
write("Notes/Burst.md", "---\ntype: note\n---\n\nWritten just before the reads.\n")
const burst = await Promise.all([1, 2, 3, 4, 5].map(() => vault.synced().then(() => app.run("GET", ["files"], {}, {}))))
check("reads asked together share one sync", syncs === 1, syncs)
check("a shared sync reads a file written before the reads came", burst.every((r) => (r.body as Any).files.some((f: Any) => f.path === "Notes/Burst.md")))
await vault.synced()
check("a read after a sync gets a sync of its own", syncs === 2, syncs)
offSync()
fs.rmSync(path.join(VAULT, "Notes/Burst.md"))
// The file tree is kept between requests (by the vault's version): a new or changed file that isn't Markdown, or a new
// folder, is still in the next one.
let [, filesNow] = await api("GET", "files")
fs.mkdirSync(path.join(VAULT, "Burst/Empty"), { recursive: true })
write("Burst/data.bin", "one")
;[, filesNow] = await api("GET", "files")
const bin = () => filesNow.others.find((f: Any) => f.path === "Burst/data.bin")
check("the file tree has a new file that isn't Markdown, and a new folder", bin()?.size === 3 && filesNow.folders.includes("Burst/Empty"), filesNow.folders)
write("Burst/data.bin", "three")
;[, filesNow] = await api("GET", "files")
check("the file tree has a changed file that isn't Markdown", bin()?.size === 5, bin())
fs.rmSync(path.join(VAULT, "Burst"), { recursive: true })
;[, filesNow] = await api("GET", "files")
check("the file tree lets go of a deleted folder", !bin() && !filesNow.folders.includes("Burst/Empty"), filesNow.folders)

// ---------- Audio recorder: transcripts as jobs, written under the recording's embed ----------
{
  const fake = path.join(tmp, "fake-transcriber.sh") // (outside the vault: a program in it is never run)
  fs.writeFileSync(fake, '#!/bin/sh\necho "Heard $(basename "$1")."\necho\necho "Second paragraph."\n', { mode: 0o755 })
  const settings = ".vaultite/plugins/audio-recorder/data.json"
  // Which program runs is this machine's (data/config.json), never the vault's.
  const config = path.join(process.env.VAULTITE_LOCAL!, "config.json")
  const configWas = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : null
  const local = (command: string) => {
    fs.mkdirSync(path.dirname(config), { recursive: true })
    fs.writeFileSync(config, JSON.stringify({ ...(configWas ? JSON.parse(configWas) : {}), "audio-recorder": { command } }))
  }
  write(settings, JSON.stringify({ command: "/bin/echo {file}", whisper: "/bin/echo" }))
  local(`${fake} {file}`)
  write("Attachments/memo.m4a", "not really audio")
  write("Notes/Memo.md", "---\ntype: note\n---\n\nBefore\n![[memo.m4a]]\nAfter\n")
  let [st, tr] = await api("GET", "audio-recorder/transcriber")
  check("audio: a transcriber from this machine's config, not the vault's settings", st === 200 && tr.available && tr.name === "fake-transcriber.sh" && tr.auto === true, tr)
  const [s1, job] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/memo.m4a" })
  check("audio: a transcript is a job, for the note that embeds the file", s1 === 202 && job.note === "Notes/Memo.md" && ["queued", "running"].includes(job.state), job)
  let j = job
  for (let i = 0; i < 50 && (j.state === "queued" || j.state === "running"); i++) { await sleep(100); [, j] = await api("GET", `audio-recorder/jobs/${job.id}`) }
  check("audio: the job is done", j.state === "done", j)
  check("audio: the transcript is under the embed, as a folded callout", read("Notes/Memo.md").endsWith(
    "Before\n![[memo.m4a]]\n> [!quote]- Transcript\n> Heard memo.m4a.\n>\n> Second paragraph.\n\nAfter\n"), read("Notes/Memo.md"))
  const [s2] = await api("POST", "audio-recorder/transcribe", { path: "Notes/Memo.md" })
  const [s3] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/memo.m4a", note: "Notes/Nope.md" })
  write("Attachments/loose.m4a", "x")
  const [s4, e4] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/loose.m4a" })
  check("audio: only audio, into a note that's there; a file no note embeds needs one named", s2 === 400 && s3 === 404 && s4 === 400 && /no note embeds/.test(e4.error), [s2, s3, s4, e4])
  // A voice note (Record a voice note for your inbox): transcribed, then inbox.voice, the recording kept above its words.
  // (the recording as the body, any size, as the app sends it)
  const { Readable } = await import("node:stream")
  const sent = (b: Buffer) => Object.assign(Readable.from([b]), { headers: { "content-type": "audio/webm" } }) as unknown as IncomingMessage
  const [s6, vj] = await api("POST", "audio-recorder/voice?ext=webm&from=Computer", {}, sent(Buffer.from("not really audio")))
  let v = vj
  for (let i = 0; i < 50 && (v.state === "queued" || v.state === "running"); i++) { await sleep(100); [, v] = await api("GET", `audio-recorder/jobs/${vj.id}`) }
  check("audio: a voice note is transcribed into the inbox, from where it was said", s6 === 202 && v.state === "done" && v.note.startsWith("Inbox/Heard voice") &&
    read(v.note).includes("from: Computer") && read(v.note).includes("Heard voice.webm.\n\nSecond paragraph."), [v, v.note && read(v.note)])
  const heard = v.note ? /^!\[\[(Voice note [^\]]+\.webm)\]\]$/m.exec(read(v.note))?.[1] : undefined
  check("audio: a voice note's recording is kept, embedded above its words", !!heard && read(`Attachments/${heard}`) === "not really audio" &&
    read(v.note).includes(`![[${heard}]]\n\nHeard voice.webm.`), v.note && read(v.note))
  if (heard) fs.rmSync(path.join(VAULT, "Attachments", heard))
  check("audio: a voice note leaves no temporary copy", !fs.readdirSync(os.tmpdir()).some((f) => f.startsWith("vaultite-voice-")), fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("vaultite-voice-")))
  const [s7] = await api("POST", "audio-recorder/voice", {}, sent(Buffer.alloc(0)))
  check("audio: a voice note needs its recording", s7 === 400, s7)
  if (v.note) fs.rmSync(path.join(VAULT, v.note))
  fs.copyFileSync(fake, path.join(VAULT, "fake.sh")); fs.chmodSync(path.join(VAULT, "fake.sh"), 0o755)
  local(`${path.join(VAULT, "fake.sh")} {file}`)
  ;[, tr] = await api("GET", "audio-recorder/transcriber")
  check("audio: a program inside the vault is never run", !tr.available && /inside the vault/.test(tr.why), tr)
  if (configWas === null) fs.rmSync(config); else fs.writeFileSync(config, configWas)
  write(settings, JSON.stringify({ model: "../Attachments/model.pt", engine: "whisper" }))
  ;[, tr] = await api("GET", "audio-recorder/transcriber")
  check("audio: a model is a name, never a path (whisper would load it)", !tr.available, tr)
  write(settings, JSON.stringify({ transcribe: false }))
  ;[, tr] = await api("GET", "audio-recorder/transcriber")
  const [s5] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/memo.m4a" })
  check("audio: transcribe: false turns it off", !tr.available && s5 === 409, [tr, s5])
  // A voice note this machine can't transcribe is kept in the inbox as the recording, saying why.
  write(settings, JSON.stringify({ engine: "apple", language: "xx" }))
  ;[, tr] = await api("GET", "audio-recorder/transcriber")
  check("audio: no transcriber says why, not what to install", !tr.available && !/install/i.test(tr.why) && /Apple/.test(tr.why), tr)
  {
    const [sk, kj] = await api("POST", "audio-recorder/voice?ext=m4a&from=Computer", {}, sent(Buffer.from("not really audio")))
    let k = kj
    for (let i = 0; i < 50 && (k.state === "queued" || k.state === "running"); i++) { await sleep(100); [, k] = await api("GET", `audio-recorder/jobs/${kj.id}`) }
    const kept = k.note ? read(k.note) : ""
    const audio = /!\[\[(Voice note [^\]]+\.m4a)\]\]/.exec(kept)?.[1]
    check("audio: a voice note it can't transcribe is kept in the inbox, the recording embedded", sk === 202 && k.state === "done" && !!k.kept &&
      k.note.startsWith("Inbox/Voice note ") && kept.includes("_Not transcribed: ") && !!audio && exists(`Attachments/${audio}`), [k, kept])
    if (k.note) fs.rmSync(path.join(VAULT, k.note))
    if (audio) fs.rmSync(path.join(VAULT, "Attachments", audio))
  }
  // Apple's speech recognition (macOS 26): nothing to install; a recording transcribed under its embed.
  write(settings, JSON.stringify({ engine: "apple", language: "en" }))
  ;[, tr] = await api("GET", "audio-recorder/transcriber")
  if (process.platform === "darwin" && Number(os.release().split(".")[0]) >= 25) {
    check("audio: Apple's speech recognition on macOS 26", tr.available && tr.name === "Apple's speech recognition", tr)
    const { execFileSync } = await import("node:child_process")
    execFileSync("/usr/bin/say", ["-o", path.join(VAULT, "Attachments", "said.m4a"), "--file-format=m4af", "--data-format=aac", "Water the plants on Sunday."])
    write("Notes/Said.md", "---\ntype: note\n---\n\n![[said.m4a]]\n")
    const [, sj] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/said.m4a" })
    let sd = sj
    for (let i = 0; i < 300 && (sd.state === "queued" || sd.state === "running"); i++) { await sleep(100); [, sd] = await api("GET", `audio-recorder/jobs/${sj.id}`) }
    check("audio: Apple's transcript under the embed", sd.state === "done" && /water the plants on sunday/i.test(read("Notes/Said.md")), [sd, read("Notes/Said.md")])
    for (const f of ["Attachments/said.m4a", "Notes/Said.md"]) fs.rmSync(path.join(VAULT, f))
  } else check("audio: Apple's needs macOS 26, and says so", !tr.available && /macOS 26/.test(tr.why), tr)
  if (process.platform !== "darwin") {
    write(settings, "{}")
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    check("audio: off a Mac, Apple's isn't tried, and it says what to install", tr.available || (/pipx install openai-whisper|ffmpeg/.test(tr.why) && !/Apple/.test(tr.why)), tr)
  }
  for (const f of [settings, "Attachments/memo.m4a", "Attachments/loose.m4a", "Notes/Memo.md", "fake.sh"]) fs.rmSync(path.join(VAULT, f))
}

// ---------- Activity: who did what (plugin.onRequest, plugin.onChange), timings ----------
const act = await import("../plugins/core/activity/plugin.ts")
/** A request as server.ts reports it: started, run, ended. */
async function actHeard(method: string, p: string, body: unknown, client: string | null, agent: string | null = null) {
  const [route, qs] = p.split("?")
  const end = app.requestStarted({ t: Date.now(), method, route, query: qs ? Object.fromEntries(new URLSearchParams(qs)) : {}, client, agent, command: null,
    ua: client ? "" : "curl/8.7.1", remote: "203.0.113.9", port: 1, forwarded: false })
  const t = performance.now()
  const r = await api(method, p, body)
  end({ status: r[0], ms: performance.now() - t, body })
  return r
}
const actEvents = async (q = "") => (await api("GET", `activity?limit=50${q}`))[1].events as Any[]
await actHeard("PUT", "file", { path: "Act/a.md", text: "one\n" }, "app/desktop")
await actHeard("PUT", "file", { path: "Act/a.md", text: "one two\n" }, "app/desktop")
let ev = (await actEvents()).filter((e: Any) => e.paths?.includes("Act/a.md"))
check("activity: the app's edits are yours, a run of them one event with a count", ev.length === 1 && ev[0].actor.kind === "you" && ev[0].actor.device === "desktop" && ev[0].count === 2 && ev[0].text === "Edited Act/a.md", ev)
await actHeard("POST", "logs", [{ area: "workouts", date: "2026-09-20", source: "claude", ext_id: "act-1", title: "Push day" }], "cli", "claude-code")
ev = await actEvents("&actor=agent")
check("activity: the CLI under a coding agent is that agent, its log worded", ev.some((e: Any) => e.actor.name === "Claude Code" && e.text === "Logged Push day" && e.route === "logs"), ev)
await actHeard("GET", "render?path=ME.md", undefined, null)
check("activity: reads aren't recorded unless asked", !(await actEvents("&actor=script")).some((e: Any) => e.action === "read"))
write(".vaultite/plugins/activity/data.json", JSON.stringify({ reads: true }))
await actHeard("GET", "render?path=ME.md", undefined, null)
ev = await actEvents("&actor=script")
check("activity: asked, reads by others are kept, the app's aren't", ev.some((e: Any) => e.action === "read" && e.paths?.includes("ME.md") && e.actor.name === "curl"), ev)
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
  fs.writeFileSync(pj, JSON.stringify({ ...base, disabled: [...(base.disabled ?? []), "activity"] }, null, 2) + "\n")
  await api("GET", "state") // a sync: plugins.json read with Activity off
  fs.writeFileSync(pj, JSON.stringify({ ...base, disabled: (base.disabled ?? []).filter((x: string) => x !== "activity") }, null, 2) + "\n")
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
await actHeard("POST", "ops/nope.thing", { path: "Act/a.md" }, "cli")
ev = await actEvents()
check("activity: an op is worded, as who asked", ev.some((e: Any) => e.actor.name === "Claude Code" && e.text === "Saved the note Act op note" && e.route === "ops/note.create" && e.action === "save") &&
  ev.some((e: Any) => e.actor.name === "Codex" && e.text === "Added to Alice Park's timeline (call)"), ev.slice(0, 4))
check("activity: a read op is a read; one it doesn't know, by its id", ev.some((e: Any) => e.action === "read" && e.text === "Read property.list" && e.actor.name === "curl") &&
  ev.some((e: Any) => e.text === "Ran nope.thing (Act/a.md)" && e.status === 404), ev.slice(0, 4))
const [, pf2] = await api("GET", "activity/perf")
check("activity: ops are timed one by one", act.routeOf("ops/note.create") === "ops/note.create" && pf2.routes.some((r: Any) => r.route === "POST ops/note.create"), pf2.routes.map((r: Any) => r.route))
const [, blk] = await api("GET", "render?path=Act/a.md")
write("Act/feed.md", "```block-activity\npath: Act/a.md\n```\n")
const [, feedText] = await api("GET", "render?path=Act/feed.md")
check("activity: its block as text links files", /Edited \[\[Act\/a\]\]/.test(feedText) && typeof blk === "string", feedText)
fs.rmSync(path.join(VAULT, ".vaultite/plugins/activity/data.json"))
check("activity: kept outside the vault", fs.existsSync(path.join(tmp, "local", "activity")) && !fs.existsSync(path.join(VAULT, "activity")))

// ---------- Activity's recaps (Recaps/<date>.md): what you did each day, from File history's versions and the events ----------
{
const rc = await import("../plugins/core/activity/recap.ts")
const bq = await import("../plugins/core/activity/build.ts")
check("recap: a task's text without the Tasks plugin's fields, Dataview's or a block id", rc.taskLine("- [x] Pay rent 🔼 📅 2026-10-05 ✅ 2026-10-06 ^ab1")?.title === "Pay rent" &&
  rc.taskLine("  * [ ] Pay [due:: 2026-10-05] the rent")?.title === "Pay the rent" && rc.taskLine("- plain") === null, rc.taskLine("- [x] Pay rent 🔼 📅 2026-10-05 ✅ 2026-10-06 ^ab1"))
check("recap: a quoted line keeps links and images, not tags, embeds or callout heads", bq.quoteLine("A #tag and ![[Note]] and ![[pic.png]]") === "A \\#tag and [[Note]] and ![[pic.png]]" &&
  bq.quoteLine("> [!quote]+ Updated on today") === "" && bq.quoteLine("## Plan") === "**Plan**" && bq.quoteLine("```js") === "", bq.quoteLine("A #tag and ![[Note]] and ![[pic.png]]"))
const md = "Mine above\n\n- 09:12 Captured [[A/B|B]] · Raindrop\n  > quoted\n- 9:30 Edited [[C]] · 1 change\n  - item\n\nMine below\n"
const pr = rc.parseRecap(md)
check("recap: parsed leniently, your own lines kept around the entries", pr.entries.length === 2 && pr.entries[0].kind === "captured" && pr.entries[1].time === "09:30" &&
  pr.entries[1].items[0] === "item" && rc.renderRecap(pr.entries, pr) === md.replace("- 9:30", "- 09:30"), rc.renderRecap(pr.entries, pr))

const HOUR = 3_600_000
const localDay = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
const Y = +midnight - 2 * HOUR, Y2 = +midnight - 26 * HOUR // yesterday 22:00, the day before's
const at = (rel: string, text: string, t: number) => { write(rel, text); fs.utimesSync(path.join(VAULT, rel), t / 1000, t / 1000) }
// A sync, and File history done reading what it found (it reads after the sync answers).
const settled = async () => { await api("GET", "state"); await api("GET", "history?path=Rc/Idea.md") }
write(".vaultite/plugins/activity/data.json", JSON.stringify({ capture_folders: ["Rc/Transcripts"] }))
write(".obsidian/plugins/obsidian-tasks-plugin/data.json", JSON.stringify({ statusSettings: { coreStatuses: [], customStatuses: [{ symbol: "d", name: "Delegated", type: "DONE" }] } }))
at("Rc/Open.md", "- [ ] Call the bank 📅 2026-10-05\n- [ ] Print the flyers\n  - Reason: the venue has screens\n- [ ] Take out the trash 🔁 every week 📅 2026-10-06\n- [ ] Ask Alice\n", Y2)
at("Rc/Closed.md", "# Closed\n", Y2)
at("Rc/Idea.md", "# Idea\n\nFirst thought\n", Y2)
at("Rc/Phone.md", "Old\n", Y2)
at("Rc/Props.md", "---\nstatus: a\n---\nBody\n", Y2)
at("Rc/Gone.md", "bye\n", Y2)
at("Rc/Away.md", "moving\n", Y2)
at("Rc/Done.md", "done\n", Y2)
await settled()
at("Rc/Idea.md", "# Idea\n\nFirst thought\nYesterday's line\n", Y)
await settled()
// Today: an edit in the app, tasks done, moved, dropped, recurring and in a status of the Tasks plugin's own.
await actHeard("PUT", "file", { path: "Rc/Idea.md", text: "# Idea\n\nFirst thought\nYesterday's line\nToday's #line about [[Lighthouse]]\n" }, "app/desktop")
write("Rc/Open.md", "- [-] Print the flyers ❌ 2026-10-06\n  - Reason: the venue has screens\n- [ ] Take out the trash 🔁 every week 📅 2026-10-13\n- [x] Take out the trash 🔁 every week 📅 2026-10-06 ✅ 2026-10-06\n- [d] Ask Alice\n")
write("Rc/Closed.md", "# Closed\n- [x] Call the bank 📅 2026-10-05 ✅ 2026-10-06\n")
write("Rc/Phone.md", "Old\nTyped on the phone\n") // arrives on disk, like iCloud
write("Rc/Props.md", "---\nstatus: b\n---\nBody\n")
for (let i = 0; i < 5; i++) write(`Rc/Raindrop/Bookmark ${i}.md`, `---\nraindrop_id: ${100 + i}\nlink: https://example.com/${i}\n---\n# Metadata\nSource URL:: https://example.com/${i}\n# Bookmark ${i}\nWhat page ${i} says.\n`)
write("Rc/Clip.md", "---\nsource: https://example.org/a-page\n---\nThe page's text.\n")
write("Rc/Transcripts/Call.md", "Hello, this is the call.\n")
write("Rc/Agent.md", "An agent's note\n")
write("Rc/Report.md", "---\ntype: inbox\nfrom: Claude Code\nagent: claude\n---\n\nWhat it did.\n") // an agent's report, from another machine
write("Rc/Scratch.md", "a scratch\n")
app.changed(["Rc/Phone.md", "Rc/Agent.md"])
await api("POST", "activity/hook?agent=claude&terminal=claude-rc", { tool_name: "Write", tool_input: { file_path: path.join(VAULT, "Rc/Agent.md") } })
await actHeard("POST", "logs", [{ area: "workouts", date: localDay(), source: "claude", ext_id: "rc-1", title: "Recap run" }], "cli", "claude-code")
const logFile = (fs.readdirSync(path.join(VAULT, "Logs"), { recursive: true }) as string[]).find((f) => f.endsWith(".md") && read(`Logs/${f}`).includes("ext_id: rc-1"))
app.changed([`Logs/${logFile}`]) // (the watcher's news, which ties it to the request that wrote it)
await actHeard("DELETE", "file?path=Rc/Gone.md", undefined, "app/desktop")
await settled()
await actHeard("DELETE", "file?path=Rc/Scratch.md", undefined, "app/desktop")
at("Rc/.archive/Done.md", "done\n", Y2) // an inbox item marked done: archived, not deleted
await actHeard("DELETE", "file?path=Rc/Done.md", undefined, "app/desktop")
await actHeard("POST", "file/move", { from: "Rc/Away.md", to: "Rc/Moved/Away.md" }, "app/desktop")
await settled()
await new Promise((r) => setTimeout(r, 2800))
const recap = async (body: object = {}) => (await api("POST", "ops/activity.recap", body))[1]
let [today] = (await recap()).days
const texts = today.entries.map((e: Any) => e.text) as string[]
const has = (re: RegExp) => today.entries.find((e: Any) => re.test(e.text))
check("recap: an edit in the app, with the text it added quoted", has(/^Edited \[\[Rc\/Idea\|Idea\]\] · 1 change$/)?.quote.join() === "Today's \\#line about [[Lighthouse]]", texts)
check("recap: a task done in one file and moved to another is one, from and to", has(/^Completed "Call the bank" · \[\[Rc\/Open\|Open\]\] → \[\[Rc\/Closed\|Closed\]\]$/), texts)
check("recap: a recurring task done once, its next copy not new", texts.filter((t) => /Take out the trash/.test(t)).length === 1 && has(/^Completed "Take out the trash" · \[\[Rc\/Open/), texts)
check("recap: a task cancelled, with its reason", has(/^Cancelled "Print the flyers"/)?.quote[0] === "Reason: the venue has screens", texts)
check("recap: a Tasks plugin status of its own", has(/^Completed "Ask Alice"/), texts)
check("recap: an edit that arrived on disk is yours", has(/^Edited \[\[Rc\/Phone\|Phone\]\]/)?.quote[0] === "Typed on the phone", texts)
check("recap: only properties changed is nothing", !texts.some((t) => t.includes("Props")) && !has(/Edited \[\[Rc\/Open/) && !has(/Edited \[\[Rc\/Closed/), texts)
const batch = has(/^Captured 5 notes · Raindrop$/)
check("recap: a bookmarks sync is one capture, its files listed", batch?.items.length === 5 && batch.items[0] === "[[Rc/Raindrop/Bookmark 0|Bookmark 0]]", texts)
check("recap: a page saved from the web, and a capture folder's file", has(/^Captured \[\[Rc\/Clip\|Clip\]\] · example\.org$/)?.quote[0] === "The page's text." &&
  has(/^Captured \[\[Rc\/Transcripts\/Call\|Call\]\] · Transcripts$/), texts)
const agent = has(/^Claude Code changed \d+ files?/)
check("recap: an agent's edits are one line for its session, listed", agent?.kind === "agent" && agent.items.includes("[[Rc/Agent|Agent]]") && !has(/^Created \[\[Rc\/Agent/), texts)
check("recap: a log an agent made is yours to remember, by it", has(/^Logged \[\[.*Recap run.*\]\] · by Claude Code$/), texts)
check("recap: a report that names its agent is the agent's; a scratch made and deleted, an archived file, aren't told",
  today.entries.some((e: Any) => e.kind === "agent" && e.items.includes("[[Rc/Report|Report]]")) && !texts.some((t) => /Scratch|Deleted Done/.test(t)), texts)
check("recap: deleted and moved", has(/^Deleted Gone$/) && has(/^Moved \[\[Rc\/Moved\/Away\|Away\]\] · from Rc\/Away$/), texts)
check("recap: oldest first", today.entries.every((e: Any, i: number) => !i || today.entries[i - 1].time <= e.time), today.entries.map((e: Any) => e.time))
const [yday] = (await recap({ date: "yesterday" })).days
check("recap: a file changed on two days is on both (not only its last change)", yday.entries.some((e: Any) => /^Edited \[\[Rc\/Idea/.test(e.text) && e.quote[0] === "Yesterday's line") &&
  !yday.entries.some((e: Any) => /Phone|Bank/.test(e.text)), yday.entries)
// Written to the vault, your own lines kept; the recap isn't in itself.
const file = `Recaps/${localDay()}.md`
await recap({ write: true })
check("recap: written as a recap file", read(file).startsWith("---\ntype: recap\n---\n") && read(file).includes(`Completed "Call the bank"`), read(file))
fs.writeFileSync(path.join(VAULT, file), read(file).replace("---\n\n", "---\n\nA good day.\n\n"))
write("Rc/Idea.md", read("Rc/Idea.md") + "One more\n")
await settled()
await recap({ write: true })
check("recap: written again, your own line stays and it isn't itself in it", read(file).includes("A good day.\n\n- ") && !read(file).includes("Recaps/") && read(file).includes("> One more"), read(file))
const [, rt] = await api("GET", `render?path=${file}`)
check("recap: its file reads as text", typeof rt === "string" && rt.includes("Call the bank"), rt)
write("Rc/Yesterday.md", "```block-recap\ndate: yesterday\n```\n")
const [, dt] = await api("GET", "render?path=Rc/Yesterday.md")
check("recap: its block, for a day", typeof dt === "string" && dt.includes("Yesterday's line") && !dt.includes("Call the bank"), dt)
const [, counts] = await api("GET", "activity/recap/counts?weeks=2")
check("recap: each day's count by kind", counts.days[localDay()].tasks >= 3 && counts.days[localDay()].captures >= 7, counts.days[localDay()])
// The job: yesterday's written once; deleted, it isn't made again.
const yfile = `Recaps/${localDay(Date.now() - 86_400_000)}.md`
await act.recapsDue()
check("recap: the days before are written once", exists(yfile) && read(yfile).includes("Yesterday's line"), exists(yfile) && read(yfile))
fs.rmSync(path.join(VAULT, yfile))
await api("GET", "state")
await act.recapsDue()
check("recap: one you deleted isn't made again", !exists(yfile))
fs.rmSync(path.join(VAULT, ".obsidian/plugins/obsidian-tasks-plugin"), { recursive: true })
fs.rmSync(path.join(VAULT, ".vaultite/plugins/activity/data.json"))
for (const d of ["Rc", "Recaps"]) fs.rmSync(path.join(VAULT, d), { recursive: true, force: true })
for (const f of fs.readdirSync(path.join(VAULT, "Logs"), { recursive: true }) as string[]) {
  const p = path.join(VAULT, "Logs", f)
  if (f.endsWith(".md") && fs.readFileSync(p, "utf8").includes("ext_id: rc-1")) fs.rmSync(p)
}
await api("GET", "state")
}

// ---------- Errors (plugins/core/errors): the app's and the server's, grouped by kind, kept on this machine ----------
{
write(".vaultite/plugins/errors/data.json", JSON.stringify({ notify: false })) // (a toast would be an inbox event, which the Inbox's tests count)
const { errorOf } = await import("../core/serverlog.ts")
const logged = errorOf(["terminal: couldn't start:", new Error("posix_spawnp failed.")])
check("errors: console.error's words and its error's message are one line, with the stack", logged.message === "terminal: couldn't start: posix_spawnp failed." && !!logged.stack?.includes("test_vault"), logged)
const stack = "TypeError: x is undefined\n    at Card (http://h:8793/assets/index-AbC123xY.js:10:5)"
await api("POST", "errors", { device: "phone", errors: [
  { t: Date.now() - 2000, kind: "stopped", fatal: true, message: "TypeError: x is undefined", stack, url: "/#/a", build: "index-AbC123xY.js", trail: ["Ran Open graph"] },
  { t: Date.now() - 1000, kind: "stopped", fatal: true, message: "TypeError: x is undefined", stack: stack.replace("AbC123xY.js:10:5", "ZzZ999qq.js:11:7") },
  { kind: "boundary", message: "Timed out after 300 ms" }, { kind: "boundary", message: "Timed out after 4000 ms" }, { kind: "boundary", message: "" }] })
let [, errs] = await api("GET", "errors?source=app")
const stopped = errs.groups.find((g: Any) => g.kind === "stopped"), timeout = errs.groups.find((g: Any) => g.message.startsWith("Timed out"))
check("errors: the same error from two builds is one kind, counted; numbers don't split a kind", errs.groups.length === 2 && stopped?.count === 2 && stopped.fatal === 2 && timeout?.count === 2 && stopped.devices[0] === "phone", errs)
const [, one] = await api("GET", `errors/${stopped.id.slice(0, 6)}`)
check("errors: one kind by its id's start, with each time (trail, build)", one.group.id === stopped.id && one.events.length === 2 && one.events.some((e: Any) => e.trail?.[0] === "Ran Open graph" && e.build === "index-AbC123xY.js"), one)
app.serverError({ t: Date.now(), message: "calendar: feed failed: ENOTFOUND", stack: "Error: ENOTFOUND\n    at x (y.ts:1:2)", where: "GET /api/calendar" })
;[, errs] = await api("GET", "errors?source=server")
check("errors: the server's, with the request it was in", errs.groups.length === 1 && errs.groups[0].latest.where === "GET /api/calendar", errs)
const [, listText] = await api("POST", "ops/errors.list?as=text", {})
check("errors: vau errors lists each kind", typeof listText === "string" && listText.includes("calendar: feed failed") && listText.includes("TypeError: x is undefined"), listText)
write("Errs/page.md", "```block-errors\nsource: server\n```\n")
const [, errText] = await api("GET", "render?path=Errs/page.md")
check("errors: its block as text", errText.includes("calendar: feed failed") && !errText.includes("TypeError"), errText)
await api("DELETE", `errors/${stopped.id}`)
;[, errs] = await api("GET", "errors")
check("errors: forgetting one kind leaves the rest", !errs.groups.some((g: Any) => g.id === stopped.id) && errs.groups.length === 2, errs)
check("errors: kept outside the vault", fs.readdirSync(path.join(tmp, "local", "errors")).length === 1 && !fs.existsSync(path.join(VAULT, "errors")))
await api("DELETE", "errors")
fs.rmSync(path.join(VAULT, ".vaultite/plugins/errors/data.json"))
}

// ---------- All properties (plugins/core/properties): every key, renamed or retyped everywhere ----------
{
write("Props/A.md", "---\nqa_stage: draft   # kept\nqa_n: '3'\nqa_tags: one\n---\n\nBody A.\n")
write("Props/B.md", "---\nqa_stage: done\nqa_n: 4\nqa_phase: x\n---\n\nBody B.\n")
write("Props/C.md", "---\nqa_n: lots\n---\n")
let [, props] = await api("GET", "properties")
const stage = props.find((p: Any) => p.key === "qa_stage"), qn = props.find((p: Any) => p.key === "qa_n")
check("properties: every key with its count and type", stage?.count === 2 && stage.type === "text" && qn?.count === 3 && qn.types.number === 1 && qn.types.text === 2, [stage, qn])
check("properties: most used first", props.findIndex((p: Any) => p.key === "qa_n") < props.findIndex((p: Any) => p.key === "qa_stage"))
check("properties: in the store too", (await api("GET", "state"))[1].properties?.some((p: Any) => p.key === "qa_stage"))
const [, withStage] = await api("GET", "properties?key=qa_stage")
check("properties: ?key= lists its files and values", same(withStage, [{ path: "Props/A.md", value: "draft" }, { path: "Props/B.md", value: "done" }]), withStage)
let [code, ren] = await api("POST", "properties/rename", { from: "qa_stage", to: "qa_phase" })
check("properties: rename changes only the key's text", code === 200 && read("Props/A.md") === "---\nqa_phase: draft   # kept\nqa_n: '3'\nqa_tags: one\n---\n\nBody A.\n", read("Props/A.md"))
check("properties: a file that has the new name already is left alone", same(ren.changed, ["Props/A.md"]) && ren.skipped[0]?.path === "Props/B.md" && read("Props/B.md").includes("qa_stage: done"), ren)
;[code] = await api("POST", "properties/rename", { from: "qa_phase", to: "" })
check("properties: rename needs a name", code === 400)
;[, ren] = await api("POST", "properties/retype", { key: "qa_n", type: "number" })
check("properties: change type converts what converts", read("Props/A.md").includes("qa_n: 3\n") && ren.changed.length === 1 && ren.changed[0].value === "3"
  && ren.skipped.length === 1 && ren.skipped[0].path === "Props/C.md" && read("Props/C.md") === "---\nqa_n: lots\n---\n", ren)
await api("POST", "properties/restore", { key: "qa_n", values: ren.changed })
check("properties: restore puts the old values back (Undo)", read("Props/A.md").includes("qa_n: '3'\n"), read("Props/A.md"))
;[, ren] = await api("POST", "properties/retype", { key: "qa_tags", type: "list" })
check("properties: text to a list", read("Props/A.md").includes("qa_tags: [one]\n") && read("Props/A.md").includes("# kept"), read("Props/A.md"))
;[code] = await api("POST", "properties/retype", { key: "qa_tags", type: "colour" })
check("properties: an unknown type is refused", code === 400)
}

// MCP (plugins/core/mcp): tools generated from the operations (catalog.ts), run in-process like the plugin runs them, the
// protocol, and the routes; and the Web clipper (POST /api/clip).
{
  const { addUnder } = await import("../plugins/core/people/ops.ts")
  const { handle, handleBody, PROTOCOL_VERSIONS, clientOf } = await import("../plugins/core/mcp/protocol.ts")
  const { toolsOf, toolOf, RESERVED } = await import("../plugins/core/mcp/catalog.ts")
  const { service } = await import("../core/plugins.ts")
  const { eventsOf } = await import("../core/events.ts")
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
      ins.includes("`.vaultite/AGENTS.md` is the vault's rules") && !ins.includes("People/") && ins.length < 1400, ins)
    await api("PUT", "config/plugins", { ...vault.config("plugins"), disabled: ["me", "agent-files"] })
    const off = String((await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } })).result.instructions)
    check("mcp: a plugin turned off takes its line out", !off.includes("ME.md") && !off.includes(".vaultite/AGENTS.md") && off.includes("`remember`"), off)
    await api("PUT", "config/plugins", { ...vault.config("plugins"), disabled: [] })
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
  check("mcp: hints from the op's kind (read only; a write isn't destructive; call may be)", listed.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort().join() === "actions,calendar,cards_due,choose,docs,events_wait,history,inbox,links,list,ops,query,read,read_version,render,routines,search,tags,today"
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
  check("mcp docs: one topic", !t.error && t.text.startsWith("## Database views") && t.text.includes("- `query`:"), t.text?.slice(0, 200))
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
  await app.callOp("log.create", { area: "nutrition", title: "Rice bowl", date: "2026-09-30", data: { fat: 12 } }, (await import("../core/ops.ts")).whoOf("cli", "codex"))
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
  const { PublicMcp } = await import("../plugins/core/mcp/public.ts")
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
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: [...(conf("plugins").disabled ?? []), "mcp", "clipper"] }, null, 2) + "\n")
  ;[ms] = await api("POST", "mcp", { jsonrpc: "2.0", id: 9, method: "ping" })
  ;[cs] = await api("POST", "clip", { url: "https://example.com/x", html: page })
  check("mcp and clip: off, they're 404s", ms === 404 && cs === 404, [ms, cs])
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: (conf("plugins").disabled ?? []).filter((x: string) => x !== "mcp" && x !== "clipper") }, null, 2) + "\n")
}

// The data plugins' operations (core/ops.ts), in-process as an agent would call them (MCP's tools have the same names and
// parameters): defaults made once on the server (ids, the date, the source: who asked), the same answers as the tools'.
{
  const { whoOf } = await import("../core/ops.ts")
  const claude = whoOf("mcp", "claude-code")
  const run = async (id: string, params: Record<string, unknown>) => {
    const hit = app.opNamed(id)!
    const go = () => app.runOp(id, params, { who: claude })
    try {
      const r = hit.op.kind === "read" || hit.op.lock === false ? await vault.synced().then(go) : await vault.lock(async () => { await vault.sync(); return go() })
      return { error: false, text: r.op.text ? r.op.text(r.result, r.params) : JSON.stringify(r.result), result: r.result as Any }
    } catch (e) {
      return { error: true, text: (e as Error).message, result: null }
    }
  }
  await api("GET", "state") // (the plugins turned back on above)
  const tools = app.catalog().filter((e) => e.mcp).map((e) => e.mcp)
  check("ops: the MCP tools the data plugins bring", ["write_note", "write_log", "add_timeline", "remember", "clip", "inbox_add"].every((t) => tools.includes(t)), tools)
  let t = await run("note.create", { title: "Op idea: one list", body: "Every surface from it.", kind: "idea", status: "seed", tags: ["Product"] })
  const opIdea = "Notes/Op idea - one list.md"
  check("note.create: a note, its id from the title, said like write_note", !t.error && t.text === `Saved ${opIdea} (id: idea-op-idea-one-list).` && read(opIdea).includes("id: idea-op-idea-one-list") && read(opIdea).includes("tags: [Product]"), t)
  t = await run("note.create", { title: "Op idea: one list", body: "Changed.", kind: "idea" })
  check("note.create: the same title and kind again updates it", !t.error && read(opIdea).includes("Changed.") && !exists("Notes/Op idea - one list 2.md"), read(opIdea))
  t = await run("note.create", { title: "Op day", body: "Fine.", journal: true })
  check("note.create: a journal entry", !t.error && read("Notes/Op day.md").includes("tags: [Journal]"), t)
  t = await run("note.create", { title: '{"title": "Op from JSON", "body": "Given whole.", "kind": "idea"}' })
  check("note.create: the API's JSON as its one argument (vau note '<json>')", !t.error && read("Notes/Op from JSON.md").includes("Given whole.") && read("Notes/Op from JSON.md").includes("id: idea-op-from-json"), t)
  t = await run("log.create", { area: "nutrition", date: "2026-09-29", title: "Op bowl", kcal: 500 })
  const opBowl = "Logs/Nutrition/2026-09-29 Op bowl.md"
  check("log.create: its id from the area, date and title, the source who asked, a field given on its own", !t.error && t.text === `Logged ${opBowl} (id: nutrition-2026-09-29-op-bowl).` &&
    read(opBowl).includes("kcal: 500") && read(opBowl).includes("source: claude"), [t, exists(opBowl) && read(opBowl)])
  t = await run("log.create", { area: "nutrition", date: "2026-09-29", title: "Op bowl", data: { protein: 30 } })
  check("log.create: again corrects it, data merged", !t.error && read(opBowl).includes("kcal: 500") && read(opBowl).includes("protein: 30"), read(opBowl))
  t = await run("log.create", { date: "2026-09-29", title: "No area" })
  check("log.create: an area is needed", t.error && t.text.includes("area is missing"), t)
  t = await run("log.create", { title: JSON.stringify([{ area: "nutrition", date: "2026-09-29", title: "Op snack" }, { area: "nutrition", date: "2026-09-29", title: "Op tea" }]) })
  check("log.create: a list of logs as JSON", !t.error && t.text.startsWith("Logged 2: ") && exists("Logs/Nutrition/2026-09-29 Op tea.md"), t)
  t = await run("person.timeline-add", { person: "Sammy", kind: "call", text: "Talked about ops", date: "2026-09-27", duration_min: 15 })
  check("person.timeline-add: by an alias, placed by date, said like add_timeline", !t.error && t.text === "Added to Sam Reyes's timeline: 2026-09-27 · call · Talked about ops" &&
    read("People/Sam Reyes.md").includes("- 2026-09-27 · call · 15 min · Talked about ops"), [t, read("People/Sam Reyes.md")])
  t = await run("person.timeline-add", { person: "Sam", kind: "call", text: "x" })
  check("person.timeline-add: a first name two people have is asked about", t.error && t.text.includes("Sam Park") && t.text.includes("Sam Reyes"), t)
  t = await run("person.timeline-add", { person: "Sam Park", kind: "chat", text: "x" })
  check("person.timeline-add: a kind it doesn't know is refused with the kinds", t.error && t.text.includes("kind") && t.text.includes("hang out"), t)
  t = await run("people.remember", { fact: "Keeps bees." })
  check("people.remember: about the user, under About me", !t.error && /## About me\n[\s\S]*- Keeps bees\./.test(read("ME.md")) && t.text.startsWith("Remembered in ME.md under About me"), [t, read("ME.md")])
  t = await run("people.remember", { fact: "Keeps bees." })
  check("people.remember: twice is once", !t.error && t.text === "ME.md already says that." && read("ME.md").split("Keeps bees.").length === 2, t)
  t = await run("people.remember", { fact: "Runs a bakery.", about: "Sam Park" })
  check("people.remember: about a person, from who asked", !t.error && /Runs a bakery\. \(from Claude Code, \d{4}-\d\d-\d\d\)/.test(read("People/Sam Park.md")) && t.result.person === "Sam Park", [t, read("People/Sam Park.md")])
  t = await run("people.remember", { fact: "x", about: "Nobody" })
  check("people.remember: no one by that name is an error", t.error && t.text.includes("No one called 'Nobody'"), t)
  const page = `<!doctype html><html><head><title>Beacon: a field guide</title></head><body><article><h1>Beacon: a field guide</h1>
<p>Beacon lists the birds of a park, by season, with where to look for each one and what they sound like at dawn.</p></article></body></html>`
  t = await run("clipper.save", { url: "https://beacon.example.com/guide", html: page, tags: ["Reading"] })
  check("clipper.save: a clip, said like clip", !t.error && t.text.startsWith('Clipped "Beacon: a field guide" to Clippings/Beacon - a field guide.md') && read("Clippings/Beacon - a field guide.md").includes("tags: [Reading]"), t)
  t = await run("clipper.save", { url: "https://beacon.example.com/guide", html: page })
  check("clipper.save: the same address again", !t.error && t.text.startsWith("Already clipped: Clippings/Beacon - a field guide.md"), t)
  t = await run("clipper.save", { url: "https://beacon.example.com/other", html: "~/Downloads/page.html" })
  check("clipper.save: html that's a file's name is refused, saying how", t.error && t.text.includes("--html - < page.html"), t)
  t = await run("inbox.add", { title: "Op findings", body: "## Birds\n- Wren", tldr: "Wrens, mostly." })
  check("inbox.add: from who asked, said like inbox_add", !t.error && t.text === "In the user's inbox: Inbox/Op findings.md (they'll see it marked new)." && read("Inbox/Op findings.md").includes("from: Claude Code") &&
    read("Inbox/Op findings.md").includes("> [!tldr] In short\n> Wrens, mostly.\n\n## Birds"), t)
  t = await run("inbox.list", {})
  check("inbox.list: what's new", !t.error && t.text.includes("To review:") && t.text.includes("Inbox/Op findings.md  (from Claude Code)"), t)
  // From the command line: positional words and flags as the ops' parameters, stdin for a dash.
  stdinText = "From stdin.\n"
  let c = await vau("note", "Op from vau", "--body", "-", "--ext-id", "op-vau-1")
  check("vau note <title> --body -: the title by position, the body from stdin, --ext-id", c.code === 0 && read("Notes/Op from vau.md").includes("From stdin.") && read("Notes/Op from vau.md").includes("id: op-vau-1"), c)
  c = await vau("person", "timeline", "Sam Park", "note", "Moved", "to Lisbon", "--date", "2026-09-26")
  check("vau person timeline <who> <kind> <text...>", c.code === 0 && read("People/Sam Park.md").includes("- 2026-09-26 · note · Moved to Lisbon"), [c, read("People/Sam Park.md")])
  c = await vau("remember", "Prefers", "tea.", "--about", "preference")
  check("vau remember --about preference", c.code === 0 && /## How to work with me\n[\s\S]*- Prefers tea\./.test(read("ME.md")), [c, read("ME.md")])
  stdinText = page
  c = await vau("clip", "https://beacon.example.com/stdin", "--html", "-", "--folder", "Notes/Reading")
  check("vau clip --html -: the page from stdin, into a folder", c.code === 0 && c.out.includes("to Notes/Reading/Beacon - a field guide.md"), c)
  stdinText = ""
  c = await vau("note", "--json", "Op json out", "--body", "x")
  check("vau note --json: the op's answer as JSON", c.code === 0 && JSON.parse(c.out).path === "Notes/Op json out.md", c)
  // The other plugins' few ops: reads that were only routes, and a few common writes.
  t = await run("routine.check", { routine: "stretch", date: "2026-09-25" })
  check("routine.check: ticked in the day's note, by its name in any case", !t.error && t.text === "Ticked Stretch for 2026-09-25." && read("Daily/2026-09-25.md").includes("done: [Stretch]"), t)
  t = await run("routine.check", { routine: "Stretch", date: "2026-09-25", done: false })
  check("routine.check: done false unticks it", !t.error && !exists("Daily/2026-09-25.md"), t)
  t = await run("routine.check", { routine: "Juggle" })
  check("routine.check: a routine that isn't there is said, with the routines", t.error && t.text.includes("Stretch"), t)
  await run("routine.check", { routine: "Stretch", date: "2026-09-25" })
  t = await run("routine.list", { date: "2026-09-25" })
  check("routine.list: the routines, which are done that day and that week", !t.error && t.result.date === "2026-09-25" && t.result.week_start === "2026-09-21" &&
    t.result.routines.some((x: Any) => x.name === "Stretch" && x.done === true && x.auto === false && x.on === true && x.ticked === true && x.week[4] === true && x.week[5] === false && x.target === 7), t)
  await run("routine.check", { routine: "Stretch", date: "2026-09-25", done: false })
  write("Ops/Link a.md", "Links [[Link b]] and #topic/one.\n")
  write("Ops/Link b.md", "---\ntags: [topic]\n---\n\nLinks [[Link c]].\n")
  write("Ops/Link c.md", "Nothing.\n")
  t = await run("graph.links", { path: "Link b" })
  check("graph.links: a file by its name, what links to it and what it links to", !t.error && same(t.result.in, ["Ops/Link a.md"]) && same(t.result.out, ["Ops/Link c.md"]) && t.text.startsWith("Links to Ops/Link b.md (1):"), t)
  t = await run("graph.links", { path: "Ops/Link a.md", depth: 2 })
  check("graph.links: with depth, what's further out", !t.error && t.result.further.some((x: Any) => x.path === "Ops/Link c.md" && x.dist === 2), t)
  t = await run("tag.list", {})
  check("tag.list: every tag with its count, nested ones counting for their parents", !t.error && t.result.tags.some((x: Any) => x.tag === "topic" && x.count >= 2) && t.text.includes("- #topic/one: 1"), t.result?.tags?.slice(0, 5))
  t = await run("tag.list", { tag: "#topic" })
  check("tag.list: one tag's files", !t.error && t.result.files.length === 2, t)
  t = await run("history.list", { path: "Ops/Link a.md" })
  check("history.list: a file's versions (none yet)", !t.error && t.text === "No earlier versions of Ops/Link a.md.", t)
  t = await run("calendar.events", { from: "2026-10-05" })
  check("calendar.events: with no calendars, says so", !t.error && t.text.startsWith("No calendars connected yet"), t)
  t = await run("calendar.events", { from: "2026-10-05", to: "2026-10-01" })
  check("calendar.events: a range backwards is refused", t.error, t)
  await api("POST", "books", { title: "Op book", total_pages: 300, status: "want" })
  t = await run("book.progress", { book: "op book", page: 120 })
  check("book.progress: the page, reading from now", !t.error && t.text === "Op book: reading, page 120 of 300." && read("Books/Op book.md").includes("current_page: 120") && read("Books/Op book.md").includes("started:"), [t, read("Books/Op book.md")])
  const en: string[] = vault.config("plugins").enabled
  vault.setConfig("plugins", { ...vault.config("plugins"), enabled: en.filter((x) => x !== "books") })
  check("ops: an offByDefault plugin's aren't there until it's turned on", !app.opNamed("book.progress"), app.opNamed("book.progress")?.op.id)
  vault.setConfig("plugins", { ...vault.config("plugins"), enabled: en })
  c = await vau("properties")
  check("vau properties: every key, counted", c.code === 0 && /^tags\s+\d+\s+list/m.test(c.out), c)
  c = await vau("tags", "topic")
  check("vau tags <tag>", c.code === 0 && c.out.includes("Ops/Link b.md"), c)
}

// Inbox (plugins/core/inbox): results are files in Inbox/, events are kept on this machine (VAULTITE_LOCAL), hooks become events.
{
  const { fromHook, prune, waitsOnYou } = await import("../plugins/core/inbox/plugin.ts")
  check("inbox push: by default only what waits on you (an agent asking, a report), not a finished turn, an error or news",
    waitsOnYou({ kind: "waiting" }) && waitsOnYou({ kind: "done", link: "Inbox/Report.md" }) && !waitsOnYou({ kind: "done" }) &&
    !waitsOnYou({ kind: "error" }) && !waitsOnYou({ kind: "info", link: "Notes/a.md" }))
  let [st, b] = await api("POST", "inbox", { title: "Plant care apps compared", body: "## Findings\n- One", from: "Claude", source: "https://example.com/tools" })
  check("inbox: a result is a file in Inbox/, new", st === 201 && read("Inbox/Plant care apps compared.md").startsWith("---\ntype: inbox\nstatus: new\nfrom: Claude\nsource: https://example.com/tools\ncreated: '") &&
    read("Inbox/Plant care apps compared.md").includes("## Findings"), [st, b])
  ;[st, b] = await api("POST", "inbox", { title: "Plant care apps, again", body: "Updated", source: "https://example.com/tools" })
  check("inbox: the same source again updates it", st === 201 && b.id === "Inbox/Plant care apps, again" && !exists("Inbox/Plant care apps compared.md") && read("Inbox/Plant care apps, again.md").includes("Updated"), [st, b])
  ;[st, b] = await api("PUT", "inbox/Plant care apps, again", { status: "done" })
  check("inbox: marked done, archived: into Inbox/.archive/", st === 200 && b.status === "done" && b.id === "Inbox/.archive/Plant care apps, again" && !exists("Inbox/Plant care apps, again.md") &&
    /status: done[\s\S]*archived: true/.test(read("Inbox/.archive/Plant care apps, again.md")) && read("Inbox/.archive/Plant care apps, again.md").includes("from: Claude"), b)
  ;[st, b] = await api("PUT", "inbox/Inbox/.archive/Plant care apps, again", { status: "new" })
  check("inbox: new again is out of the archive", st === 200 && b.id === "Inbox/Plant care apps, again" && !exists("Inbox/.archive/Plant care apps, again.md") &&
    read("Inbox/Plant care apps, again.md").includes("status: new") && !read("Inbox/Plant care apps, again.md").includes("archived"), b)
  ;[st, b] = await api("PUT", "inbox/Plant care apps, again", { archived: true })
  check("inbox: archived is done", st === 200 && b.status === "done" && read("Inbox/.archive/Plant care apps, again.md").includes("status: done"), b)
  ;[st, b] = await api("PUT", "inbox/Inbox/.archive/Plant care apps, again", { archived: false })
  check("inbox: unarchived is new", st === 200 && b.status === "new" && exists("Inbox/Plant care apps, again.md"), b)
  write("Inbox/Written by hand.md", "---\ntype: inbox\nstatus: maybe\n---\n\nA file.\n")
  ;[, b] = await api("GET", "inbox/Written by hand")
  const [, v] = await api("GET", "vault")
  check("inbox: a file written there is one, its bad status reported", b.title === "Written by hand" && v.problems.some((p: Any) => p.file === "Inbox/Written by hand.md" && /status/.test(p.problem)), [b, v.problems])
  write("Inbox/Written by hand.md", "---\ntype: inbox\nstatus: new\n---\n\nA file.\n")

  ;[st, b] = await api("POST", "inbox/events", { source: "backup", kind: "done", title: "Backup finished", body: "12 GB", link: "Notes/Backup.md" })
  check("inbox events: posted", st === 201 && b.event.id && b.event.kind === "done" && b.event.link === "Notes/Backup.md", [st, b])
  {
    const [, heard] = await api("POST", "ops/events.list", { types: ["inbox.event"] })
    const evs = (heard.events ?? heard) as Any[]
    check("inbox events: the vault's events hear of it (inbox.event)", evs.some((e: Any) => e.type === "inbox.event" && e.id === b.event.id && e.kind === "done" && e.link === "Notes/Backup.md"), heard)
  }
  ;[st, b] = await api("POST", "inbox/events", { source: "backup", kind: "done", title: "Backup finished", body: "13 GB" })
  let [, list] = await api("GET", "inbox/events")
  check("inbox events: the same thing again soon after is one event, updated", list.events.length === 1 && list.events[0].body === "13 GB" && list.events[0].link === "Notes/Backup.md" && list.unread === 1, list)
  {
    // Messages (vau notify) from one terminal in a row: each different one is its own event; the same words again merge.
    const msg = (title: string) => api("POST", "inbox/events", { source: "vau", kind: "info", title, terminal: "claude-m3ss4ges" })
    const ids = new Set<string>()
    for (const t of ["Imported 12 meals", "Wrote the weekly review", "Imported 12 meals"]) ids.add((await msg(t))[1].event.id)
    const [, l] = await api("GET", "inbox/events")
    check("inbox events: different messages from one terminal stay apart, the same one merges", ids.size === 2 &&
      l.events.filter((e: Any) => e.terminal === "claude-m3ss4ges").length === 2, l.events)
    for (const id of ids) await api("DELETE", `inbox/events/${id}`)
  }
  {
    // One of a kind (a key): a new one takes the place of its source's event with that key; inbox:drop takes it away.
    await api("POST", "inbox/events", { source: "lessons", kind: "info", title: "3 cards to review", key: "cards-due" })
    await api("POST", "inbox/events", { source: "lessons", kind: "info", title: "5 cards to review", key: "cards-due", link: "detail:review" })
    let [, l] = await api("GET", "inbox/events")
    const mine = (x: Any) => x.events.filter((e: Any) => e.source === "lessons")
    check("inbox events: a key keeps one of a kind, the newest", mine(l).length === 1 && mine(l)[0].title === "5 cards to review" && mine(l)[0].link === "detail:review", mine(l))
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...(vault.config("plugins").enabled ?? []), "lessons"] })
    write(".vaultite/plugins/lessons/data.json", JSON.stringify({ remind_at: "00:00" }))
    write("Cards/Reminder test.md", "---\ntype: cards\n---\n## What's two and two?\nFour.\n\n## What's the capital of France?\nParis.\n\n## What's the capital of Italy?\nRome.\n")
    await vault.synced()
    let [st2] = await api("POST", "ops/schedule.run", { id: "lessons/reminder" })
    ;[, l] = await api("GET", "inbox/events")
    check("lessons: no reminder for someone who never reviewed a card", st2 === 200 && mine(l).length === 0, mine(l))
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/lessons/reminded.json"), { force: true })
    const [, first] = await api("POST", "ops/cards.due", { limit: 1 })
    await api("POST", "ops/cards.review", { source: first.cards[0].source, card: first.cards[0].card, rating: "again" })
    ;[st2] = await api("POST", "ops/schedule.run", { id: "lessons/reminder" })
    ;[, l] = await api("GET", "inbox/events")
    check("lessons: the day's reminder says how many cards are due, in place of the last", st2 === 200 && mine(l).length === 1 && /^\d+ cards to review$/.test(mine(l)[0].title) && mine(l)[0].title !== "5 cards to review", [st2, mine(l)])
    const [, due] = await api("POST", "ops/cards.due", { limit: 100 })
    for (const c of due.cards) await api("POST", "ops/cards.review", { source: c.source, card: c.card, rating: "good" })
    ;[, l] = await api("GET", "inbox/events")
    check("lessons: the last due card reviewed takes the reminder away", mine(l).length === 0, mine(l))
    ;[st2] = await api("POST", "ops/schedule.run", { id: "lessons/reminder" })
    ;[, l] = await api("GET", "inbox/events")
    check("lessons: once a day only", mine(l).length === 0, mine(l))
  }
  ;[st] = await api("POST", "inbox/events", { source: "x" })
  check("inbox events: a title is required", st === 400, st)
  ;[st, b] = await api("POST", "inbox/events", { title: "Odd", kind: "Not A Kind", terminal: "../x" })
  check("inbox events: an unknown kind is info, a bad terminal left out", b.event.kind === "info" && !("terminal" in b.event) && b.event.source === "vau", b)
  {
    const title = "A long title ".repeat(40).trim(), body = "First line.\n\n" + "word ".repeat(400) + "\nLast line."
    ;[st, b] = await api("POST", "inbox/events", { title, body })
    check("inbox events: the title and body are kept whole (the body's lines too)", st === 201 && b.event.title === title && b.event.body === body.trim(), b.event)
    await api("DELETE", `inbox/events/${b.event.id}`)
    const day = 86_400_000, now = Date.now()
    const ev = (i: number, read: boolean, ago: number) => ({ id: `p${i}`, t: now - ago, source: "vau", kind: "info", title: `${i}`, read })
    const kept = prune([ev(0, false, 30 * day), ev(1, true, 30 * day), ...Array.from({ length: 500 }, (_, i) => ev(i + 2, i % 2 === 0, i * 1000))])
    check("inbox events: pruning keeps every unread one, old or past the cap; read ones go after the days, past 200",
      kept.some((e) => e.id === "p0") && !kept.some((e) => e.id === "p1") && kept.filter((e) => !e.read).length === 251 && kept.filter((e) => e.read).length === 200, kept.length)
  }
  // Hooks: Terminal's state command (state and prev), Claude Code's and Codex's JSON.
  check("hook: working -> idle is done, idle at start isn't news", (fromHook({ state: "idle", prev: "working" }, {}) as Any)?.kind === "done" && fromHook({ state: "idle", prev: "" }, {}) === null)
  check("hook: into waiting says what it asks", (fromHook({ state: "waiting", prev: "working" }, { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which port?" }] } }) as Any)?.body === "Asks: Which port?")
  check("hook: waiting -> working resolves", (fromHook({ state: "working", prev: "waiting" }, { session_id: "s1" }) as Any)?.resolve === true)
  check("hook: Claude Code's Notification, but not its idle prompt", (fromHook({}, { hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }) as Any)?.body === "Claude needs your permission to use Bash" &&
    fromHook({}, { hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" }) === null)
  check("hook: Codex's notify is done, with its last words", (fromHook({}, { type: "agent-turn-complete", "thread-id": "t1", "last-assistant-message": "**Merged** and pushed.\nMore" }) as Any)?.body === "Merged and pushed.")
  ;[st, b] = await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0&state=waiting&prev=working", { hook_event_name: "Notification", session_id: "abc", message: "Claude needs your permission to use Bash" })
  check("hook route: an event named after the agent's plugin, with its terminal", st === 200 && b.event?.title === "Claude Code is waiting for you" && b.event.terminal === "claude-k3j2h1g0" && b.event.session === "abc" && b.event.source === "claude", [st, b])
  await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0&state=working&prev=waiting", {})
  ;[, list] = await api("GET", "inbox/events")
  check("hook route: answered, its waiting event is read", list.events.find((e: Any) => e.kind === "waiting")?.read === true, list.events)
  ;[st, b] = await api("POST", "inbox/hook?agent=codex", { type: "agent-turn-complete", "thread-id": "t9", cwd: "/tmp/lighthouse" })
  check("hook route: outside the app, the folder names it", b.event?.title === "Codex finished" && b.event.body === "lighthouse" && b.event.session === "t9", b)
  check("hook route: a turn that ends is kept read (no toast, no push)", b.event?.read === true, b)
  write(".vaultite/plugins/inbox/data.json", JSON.stringify({ turns: "notify" }))
  ;[st, b] = await api("POST", "inbox/hook?agent=codex", { type: "agent-turn-complete", "thread-id": "t10", cwd: "/tmp/beacon" })
  check("hook route: with turns notify, a turn that ends is news", b.event?.title === "Codex finished" && !b.event.read, b)
  write(".vaultite/plugins/inbox/data.json", "{}")
  ;[st, b] = await api("POST", "inbox/hook?agent=claude", { hook_event_name: "PostToolUse" })
  check("hook route: anything else isn't news", st === 200 && !b.event, b)
  check("hook: what a waiting agent asks", (fromHook({}, { hook_event_name: "Notification", notification_type: "permission_prompt", message: "x" }) as Any)?.ask === "permission" &&
    (fromHook({ state: "waiting", prev: "working" }, { tool_name: "AskUserQuestion" }) as Any)?.ask === "question" &&
    (fromHook({ state: "waiting", prev: "working" }, { tool_name: "ExitPlanMode" }) as Any)?.ask === "plan")
  ;[st, b] = await api("POST", "inbox/hook?agent=claude&terminal=claude-p9p9p9p9&state=waiting&prev=working", { hook_event_name: "Notification", notification_type: "permission_prompt", session_id: "perm", message: "Claude needs your permission to use Bash" })
  check("hook route: a permission is asked as one", b.event?.ask === "permission", b)
  ;[st, b] = await api("POST", "ops/inbox.answer", { id: b.event.id, answer: "approve" })
  check("answer: approving needs the terminal running (its question on screen)", st >= 400, [st, b])
  ;[, list] = await api("GET", "inbox/events")
  const done = list.events.find((e: Any) => e.kind === "done")
  ;[st, b] = await api("POST", "ops/inbox.answer", { id: done.id, answer: "approve" })
  check("answer: only a permission is approved", st === 409, [st, b])
  ;[st, b] = await api("POST", "ops/inbox.answer", { id: done.id, answer: "read" })
  ;[, list] = await api("GET", "inbox/events")
  check("answer: read marks it read", st === 200 && list.events.find((e: Any) => e.id === done.id)?.read === true, [st, b])
  {
    const push = await import("../plugins/core/inbox/push.ts")
    const p = push.payload({ title: "Claude Code is waiting for you", body: "Bash", category: "permission", thread: "claude-x", urgent: true, data: { event: "e1" } }) as Any
    check("push: the payload carries its buttons' category and the event", p.aps.category === "permission" && p.aps["interruption-level"] === "time-sensitive" && p.aps["thread-id"] === "claude-x" && p.event === "e1" && p.aps.alert.body === "Bash", p)
    ;[st, b] = await api("POST", "inbox/devices", { token: "nothex", topic: "app.example.ios" })
    check("push: a device needs a token", st === 400, [st, b])
    ;[st, b] = await api("POST", "inbox/devices", { token: "AB".repeat(32), topic: "app.example.ios", env: "sandbox", name: "Sam's iPhone" })
    const [, devs] = await api("GET", "inbox/devices")
    check("push: a device registers, kept on this machine, not ready without a key", st === 201 && b.ready === false && devs.devices.length === 1 && devs.devices[0].token === "abababab…" && devs.devices[0].name === "Sam's iPhone", [b, devs])
    ;[st, b] = await api("POST", "ops/inbox.push", { title: "Hi" })
    check("push: sending without a key says so", st === 409, [st, b])
    const key = (await import("node:crypto")).generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    fs.writeFileSync(path.join(process.env.VAULTITE_LOCAL!, "apns-test.p8"), key.privateKey.export({ type: "pkcs8", format: "pem" }))
    check("push: a key in data/ makes it ready", push.configured({ key_id: "K1", team_id: "T1", key: "apns-test.p8" }))
    await api("DELETE", `inbox/devices/${"ab".repeat(32)}`)
    const [, after] = await api("GET", "inbox/devices")
    check("push: a device is forgotten", after.devices.length === 0, after)
    await api("POST", "inbox/devices", { token: "cd".repeat(32), topic: "app.example.ios", name: "Sam's iPhone", widgets: true })
    await api("POST", "inbox/devices", { token: "ef".repeat(32), topic: "app.example.ios", name: "Sam's iPhone", widgets: true })
    const [, widgets] = await api("GET", "inbox/devices")
    check("push: a phone's widgets keep one token, the newest", widgets.devices.length === 1 && widgets.devices[0].widgets === true && widgets.devices[0].token === "efefefef…", widgets)
    await api("DELETE", `inbox/devices/${"ef".repeat(32)}`)
  }
  ;[st, b] = await api("POST", "ops/inbox.voice", { text: "Remind me to call Alice about the trip on Friday please, thanks", from: "Apple Watch" })
  check("voice: kept in the inbox, named by its first words", st === 200 && b.path === "Inbox/Remind me to call Alice about the trip…" + ".md" &&
    read("Inbox/Remind me to call Alice about the trip….md").includes("from: Apple Watch") && b.terminal === null, [st, b])
  {
    // From the phone: its words and the recording, kept as an attachment above them (unless voice_audio is off).
    const audio = Buffer.from("a phone's recording").toString("base64")
    const [as, ab] = await api("POST", "ops/inbox.voice", { text: "Buy oat milk", from: "iPhone", audio, ext: "m4a" })
    const embed = /^!\[\[(Voice note [^\]]+\.m4a)\]\]\n\nBuy oat milk$/m.exec(as === 200 ? read(ab.path) : "")
    check("voice: the recording is kept, embedded above what was said", !!embed && read(`Attachments/${embed[1]}`) === "a phone's recording", [as, ab, as === 200 && read(ab.path)])
    if (embed) fs.rmSync(path.join(VAULT, "Attachments", embed[1]))
    if (as === 200) fs.rmSync(path.join(VAULT, ab.path))
    const conf = path.join(VAULT, ".vaultite/plugins/inbox/data.json"), was = exists(".vaultite/plugins/inbox/data.json") ? fs.readFileSync(conf, "utf8") : null
    fs.writeFileSync(conf, JSON.stringify({ ...(was ? JSON.parse(was) : {}), voice_audio: false }))
    const [ws, wb] = await api("POST", "ops/inbox.voice", { text: "Buy rye bread", from: "iPhone", audio, ext: "m4a" })
    check("voice: voice_audio off keeps only the words", ws === 200 && !read(wb.path).includes("![[") && read(wb.path).includes("Buy rye bread"), [ws, wb])
    if (was === null) fs.rmSync(conf); else fs.writeFileSync(conf, was)
    if (ws === 200) fs.rmSync(path.join(VAULT, wb.path))
  }
  {
    const conf = path.join(VAULT, ".vaultite/plugins/inbox/data.json"), was = exists(".vaultite/plugins/inbox/data.json") ? fs.readFileSync(conf, "utf8") : null
    fs.writeFileSync(conf, JSON.stringify({ ...(was ? JSON.parse(was) : {}), dispatch: "claude" }))
    const [vs, vb] = await api("POST", "ops/inbox.voice", { text: "word ".repeat(1600), from: "Apple Watch" })
    check("voice: a recording left running is kept, not handed to the front door", vs === 200 && vb.terminal === null && vb.why.includes("1600 words") && exists(vb.path), [vs, vb])
    if (was === null) fs.rmSync(conf); else fs.writeFileSync(conf, was)
    fs.rmSync(path.join(VAULT, vb.path))
  }
  ;[st, b] = await api("POST", "ops/inbox.done", { path: "Inbox/Remind me to call Alice about the trip….md", title: "Call Alice about the trip" })
  check("inbox.done: named anew and archived", st === 200 && b.path === "Inbox/.archive/Call Alice about the trip.md" &&
    read("Inbox/.archive/Call Alice about the trip.md").includes("status: done") && !exists("Inbox/Remind me to call Alice about the trip….md"), [st, b])
  ;[st] = await api("POST", "ops/inbox.done", { path: "Inbox/Nothing here.md" })
  check("inbox.done: a result that isn't there", st === 404, st)
  const id = list.events.at(-1).id
  ;[, b] = await api("POST", "inbox/events/read", { ids: [id] })
  ;[, list] = await api("GET", "inbox/events")
  check("inbox events: read by id", list.events.find((e: Any) => e.id === id)?.read === true && b.unread === list.unread, [b, list.unread])
  ;[st, b] = await api("POST", "inbox/events/unread", { ids: [id] })
  ;[, list] = await api("GET", "inbox/events")
  let one = list.events.find((e: Any) => e.id === id)
  check("inbox events: unread by hand, kept so", st === 200 && one?.read === false && one.kept === true && b.unread === list.unread, [st, b, one])
  ;[st] = await api("POST", "inbox/events/unread", {})
  check("inbox events: unread needs ids", st === 400, st)
  ;[, b] = await api("POST", "inbox/events/read", { ids: [id] })
  ;[, list] = await api("GET", "inbox/events")
  one = list.events.find((e: Any) => e.id === id)
  check("inbox events: read again, no longer kept", one?.read === true && !("kept" in one), one)
  await sleep(300)
  const kept = fs.readdirSync(path.join(tmp, "local", "inbox"))
  check("inbox events: kept on this machine, not in the vault", kept.length === 1 && fs.existsSync(path.join(tmp, "local", "inbox", kept[0], "events.json")) && !exists("Inbox/events.json"), kept)
  let [, r] = await api("GET", "render?path=Dashboards/Design.md")
  check("inbox block: as text, results and events", r.includes("## Inbox") && r.includes("[[Inbox/Written by hand|Written by hand]]") && r.includes("Codex finished: lighthouse"), r.slice(r.indexOf("## Inbox"), r.indexOf("## Inbox") + 600))
  ;[st] = await api("DELETE", `inbox/events/${id}`)
  ;[, list] = await api("GET", "inbox/events")
  check("inbox events: forgotten one by one", st === 200 && !list.events.some((e: Any) => e.id === id), list.events.length)
  // An agent's report: its session named for the reply, questions and a reply box; an event links it, and the agent's
  // turn ending right after keeps its words.
  ;[st, b] = await api("POST", "ops/inbox.report", { title: "Lighthouse docs updated", work: "change", tldr: "The setup page is rewritten.\nPublish it?", summary: "Rewrote the **setup** page.\n- New screenshots",
    questions: ["Publish it?"], session: "sess-report-1", agent: "claude" })
  let rep = read("Inbox/Change needs you · Lighthouse docs updated.md")
  check("report: a result naming its session, with its questions and a reply box", st === 200 && b.path === "Inbox/Change needs you · Lighthouse docs updated.md" &&
    rep.includes("agent: claude") && rep.includes("session: sess-report-1") && rep.includes("## Open questions\n\n- Publish it?") &&
    rep.trimEnd().endsWith("```block-reply\n```") && rep.includes("from: Claude Code"), [st, b, rep])
  check("report: its tl;dr on top, a callout", rep.split("---\n")[2]?.startsWith("\n> [!tldr] In short\n> The setup page is rewritten.\n> Publish it?\n\nRewrote"), rep)
  ;[, list] = await api("GET", "inbox/events")
  const repEvent = list.events.find((e: Any) => e.session === "sess-report-1")
  check("report: an event links it", repEvent?.link === "Inbox/Change needs you · Lighthouse docs updated.md" && repEvent.title === "Claude Code: Change needs you · Lighthouse docs updated" && repEvent.kind === "done" &&
    repEvent.body === "The setup page is rewritten. Publish it?", repEvent)
  await api("POST", "inbox/hook?agent=claude", { hook_event_name: "Stop", session_id: "sess-report-1", last_assistant_message: "Done." })
  ;[, list] = await api("GET", "inbox/events")
  const merged = list.events.filter((e: Any) => e.session === "sess-report-1")
  check("report: the turn ending after it keeps its words", merged.length === 1 && merged[0].title === "Claude Code: Change needs you · Lighthouse docs updated", merged)
  ;[st, b] = await api("POST", "ops/inbox.report", { title: "No summary", work: "fix", tldr: "x", summary: " " })
  check("report: needs a summary", st === 400, [st, b])
  ;[st, b] = await api("POST", "ops/inbox.report", { title: "No tldr", work: "fix", summary: "x" })
  check("report: needs a tldr and its work", st === 400 && /tldr/.test(b.error) && (await api("POST", "ops/inbox.report", { title: "No work", tldr: "x", summary: "x" }))[0] === 400, [st, b])
  ;[st, b] = await api("POST", "ops/inbox.report", { title: "Half the docs", work: "research", state: "stuck", tldr: "x", summary: "x" })
  check("report: the state said", b.path === "Inbox/Research stuck · Half the docs.md", b)
  ;[st, b] = await api("POST", "ops/inbox.report", { title: "Bad shot", work: "fix", tldr: "x", summary: "x", images: ["/tmp/notes.txt"] })
  check("report: screenshots are images", st === 400 && /png, jpg/.test(b.error), [st, b])
  const cliOut = await vau("inbox", "report", "From the command line", "--work", "feature", "--tldr", "Did it", "--summary", "Did it", "--questions", "First?", "Second?", "--session", "sess-cli")
  rep = read("Inbox/Feature needs you · From the command line.md")
  check("report: vau takes a list's values after its flag", cliOut.code === 0 && rep.includes("- First?\n- Second?") && rep.includes("session: sess-cli"), [cliOut, rep])
  ;[st, b] = await api("POST", "ops/inbox.report", { title: "One question", work: "fix", tldr: "x", summary: "x", questions: "Ship it, or wait?" })
  check("report: a question given as text keeps its commas", st === 200 && read("Inbox/Fix needs you · One question.md").includes("- Ship it, or wait?\n"), [st, b])
  ;[st, b] = await api("POST", "ops/inbox.reply", { path: "Inbox/Written by hand.md", text: "hi" })
  check("reply: only to a report that names its session", st === 409, [st, b])
  ;[st, b] = await api("POST", "ops/inbox.reply", { path: "Inbox/Nope.md", text: "hi" })
  check("reply: to a report that's there", st === 404, [st, b])
  // Where a reply goes once the session ended: resumed while its prompt cache lasts (the TTL its transcript wrote with),
  // else a new session; a handed terminal ends when the turn that reported does.
  {
    const { service } = await import("../core/plugins.ts")
    const sid = "7c1d2e3f-4a5b-4c6d-8e7f-901234567890"
    const tfile = path.join(CLAUDE_DIR, "projects", "-Users-sam-beacon", `${sid}.jsonl`)
    fs.mkdirSync(path.dirname(tfile), { recursive: true })
    fs.writeFileSync(tfile, JSON.stringify({ type: "assistant", sessionId: sid, cwd: "/Users/sam/beacon", message: { role: "assistant", content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 3, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 812 } } } }) + "\n")
    const look = service(app.plugins, "agent-session:claude") as (id: string) => Any
    const info = look(sid)
    check("agent session: a transcript written with the hour-long cache", info?.ttl === 3600 && info.transcript === tfile && info.account === "default" && Date.now() - info.last < 60_000, info)
    check("agent session: else five minutes, and none for a session that isn't here", look("0a1b2c3d-1111-4222-8333-444455556666")?.ttl === 300 && look("9f9f9f9f-0000-4000-8000-000000000000") === null)
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Beacon fixed", work: "fix", tldr: "Fixed it.", summary: "Fixed it.", session: sid, agent: "claude" })
    ;[st, b] = await api("POST", "ops/inbox.reply-plan", { path: "Inbox/Fix done · Beacon fixed.md" })
    check("reply plan: its session resumed while it's cached", st === 200 && b.how === "resume" && b.ttl === 3600 && b.ago < 60, [st, b])
    const old = (Date.now() - 2 * 3600_000) / 1000
    fs.utimesSync(tfile, old, old)
    ;[st, b] = await api("POST", "ops/inbox.reply-plan", { path: "Inbox/Fix done · Beacon fixed.md" })
    check("reply plan: a new session once it isn't", st === 200 && b.how === "new" && b.ago >= 7200, [st, b])
    fs.utimesSync(tfile, Date.now() / 1000 - 56 * 60, Date.now() / 1000 - 56 * 60)
    ;[st, b] = await api("POST", "ops/inbox.reply-plan", { path: "Inbox/Fix done · Beacon fixed.md" })
    check("reply plan: with five minutes to spare", b.how === "new", b)
    const handedOf = () => { const d = fs.readdirSync(path.join(tmp, "local", "inbox"))[0]; try { return JSON.parse(fs.readFileSync(path.join(tmp, "local", "inbox", d, "handed.json"), "utf8")) } catch { return [] } }
    ;(service(app.plugins, "inbox:handed") as (t: string) => void)("claude-handed1")
    check("handed: dispatch marks its terminal", handedOf().includes("claude-handed1"), handedOf())
    const out = await vau("inbox", "report", "Handed off", "--work", "fix", "--tldr", "Did it.", "--summary", "Did it.", "--terminal", "claude-handed1")
    check("handed: its report says the terminal ends with the turn", out.code === 0 && out.out.includes("this terminal ends when this turn does"), out)
    await api("POST", "inbox/hook?agent=claude&terminal=claude-handed1&state=idle&prev=working", { hook_event_name: "Stop" })
    check("handed: the turn that reported ends it", !handedOf().includes("claude-handed1"), handedOf())
    await api("POST", "ops/inbox.report", { title: "Not handed", work: "fix", tldr: "Did it.", summary: "Did it.", terminal: "claude-mine1", agent: "claude" })
    await api("POST", "inbox/hook?agent=claude&terminal=claude-mine1&state=idle&prev=working", { hook_event_name: "Stop" })
    check("handed: a terminal nobody handed a task stays", !handedOf().includes("claude-mine1"))
    // The same session's next report goes on in its file (after the reply, which archived it): one file per exchange.
    await api("POST", "ops/inbox.report", { title: "Thread start", work: "fix", tldr: "Ship it?", summary: "First round.", questions: ["Ship it?"], terminal: "claude-thread1", agent: "claude" })
    await api("POST", "ops/inbox.done", { path: "Inbox/Fix needs you · Thread start.md" })
    await sleep(1100) // (times are to the second)
    await api("POST", "ops/inbox.report", { title: "Came between", work: "fix", tldr: "x", summary: "x", terminal: "claude-between1", agent: "claude" })
    await sleep(1100)
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Shipped", work: "fix", tldr: "Shipped it.", summary: "Second round.", terminal: "claude-thread1", agent: "claude" })
    const thread = read("Inbox/Fix done · Thread start.md")
    check("thread: the next report goes on in the same file, back to new, its title saying where it stands", st === 200 && b.path === "Inbox/Fix done · Thread start.md" && b.thread === true &&
      !exists("Inbox/.archive/Fix needs you · Thread start.md") && thread.includes("status: new") &&
      /First round\.[\s\S]*## Fix done · Shipped\n\n> \[!tldr\] In short\n> Shipped it\.\n\nSecond round\.\n\n```block-reply\n```\n?$/.test(thread) &&
      thread.split("```block-reply").length === 2 && /\nupdated: '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'\n/.test(thread), [st, b, thread])
    {
      const [, items] = await api("GET", "inbox")
      const newOnes = items.filter((x: Any) => x.status === "new").map((x: Any) => x.id)
      check("thread: its latest report puts it before a result that came after it started", newOnes.indexOf("Inbox/Fix done · Thread start") > -1 &&
        newOnes.indexOf("Inbox/Fix done · Thread start") < newOnes.indexOf("Inbox/Fix done · Came between"), newOnes.slice(0, 5))
    }
    await api("POST", "ops/inbox.report", { title: "Elsewhere", work: "fix", tldr: "x", summary: "x", terminal: "claude-thread2", agent: "claude" })
    check("thread: another session's report is a file of its own", exists("Inbox/Fix done · Elsewhere.md"))
  }
  const [, r0] = await api("GET", "render?path=Inbox/Change needs you · Lighthouse docs updated.md")
  check("reply block: as text, how to reply", r0.includes(`vau inbox reply "Inbox/Change needs you · Lighthouse docs updated.md"`), r0)
  // vau inbox
  cr = await vau("inbox")
  check("vau inbox: what's new", cr.code === 0 && cr.out.includes("To review:") && cr.out.includes("Inbox/Written by hand.md") && cr.out.includes("unread"), cr)
  {
    const [, l] = await api("GET", "inbox/events")
    const eid = l.events[0].id
    check("vau inbox: events with their ids", cr.out.includes(`(${eid})`), cr.out)
    cr = await vau("inbox", "unread", eid)
    let [, l2] = await api("GET", "inbox/events")
    check("vau inbox unread <id>", cr.code === 0 && l2.events[0].read === false && l2.events[0].kept === true, [cr, l2.events[0]])
    cr = await vau("inbox", "read", eid)
    ;[, l2] = await api("GET", "inbox/events")
    check("vau inbox read <id>", cr.code === 0 && l2.events[0].read === true, [cr, l2.events[0]])
    cr = await vau("inbox", "unread")
    check("vau inbox unread: needs ids", cr.code !== 0, cr)
  }
  stdinText = ""
  cr = await vau("inbox", "add", "From", "the CLI", "--body", "Some text", "--from", "Sam")
  check("vau inbox add: a result", cr.code === 0 && read("Inbox/From the CLI.md").includes("from: Sam") && read("Inbox/From the CLI.md").includes("Some text"), cr)
  cr = await vau("inbox", "hook", "codex", JSON.stringify({ type: "agent-turn-complete", "thread-id": "t10", cwd: "/x/beacon" }))
  ;[, list] = await api("GET", "inbox/events")
  check("vau inbox hook: Codex's JSON as its last argument", cr.code === 0 && list.events[0].session === "t10" && list.events[0].body === "beacon", list.events[0])
  cr = await vau("inbox", "clear")
  ;[, list] = await api("GET", "inbox/events")
  check("vau inbox clear", cr.code === 0 && !list.events.length, list)
  // Terminal's state command, with the Inbox's: told only of the changes that are news, the hook's JSON passed on.
  {
    const { stateCommand } = await import("../plugins/core/terminal/plugin.ts")
    const { execFileSync } = await import("node:child_process")
    const dir = path.join(tmp, "statecmd")
    fs.mkdirSync(dir)
    const set = stateCommand(path.join(dir, "state"), (st: string) => `cat > "${dir}/told-${st}-$prev.json"`)
    const run = (st: "working" | "waiting" | "idle", json = "{}") => execFileSync("/bin/sh", ["-c", set(st)], { input: json, env: { PATH: process.env.PATH } })
    run("idle"); run("working"); run("working"); run("waiting", '{"message":"May I?"}'); run("working"); run("idle", '{"hook_event_name":"Stop"}')
    const told = fs.readdirSync(dir).filter((f) => f.startsWith("told-")).sort()
    check("terminal state command: marks the terminal, tells the inbox of news only", fs.readFileSync(path.join(dir, "state"), "utf8").trim() === "idle" &&
      JSON.stringify(told) === JSON.stringify(["told-idle-working.json", "told-waiting-working.json", "told-working-waiting.json"]) &&
      fs.readFileSync(path.join(dir, "told-waiting-working.json"), "utf8") === '{"message":"May I?"}', told)
    check("terminal state command: without the Inbox, only the mark", !stateCommand("/x/state", null)("idle").includes("prev="))
  }
  // One inbox on several machines: another machine's events followed and shown here (`<id>@<machine>`), and reading,
  // dismissing or answering one is done on that machine, which keeps it.
  {
    const { followMachines } = await import("../plugins/core/inbox/plugin.ts")
    const { WebSocketServer } = await import("ws")
    const seen: string[] = []
    let theirs: Any[] = [
      { id: "p1", t: Date.now() - 1000, source: "claude", kind: "done", title: "Claude Code finished", terminal: "claude-aa11bb22", session: "s-box" },
      { id: "p2", t: Date.now() - 5000, source: "vau", kind: "info", title: "Backup finished", read: true },
      { id: "p9@else", t: Date.now() - 6000, source: "vau", kind: "info", title: "Followed from a third machine" },
    ]
    const peer = (await import("node:http")).createServer((req, res) => {
      let raw = ""
      req.on("data", (c) => { raw += c })
      req.on("end", () => {
        seen.push(`${req.method} ${req.url} ${raw}`)
        const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
        if (req.url === "/api/machines/self") return json(200, { instance: "peer-inbox", host: "box", platform: "darwin", version: "0.1.0", plugins: ["inbox"] })
        if (req.url?.startsWith("/api/inbox/events")) return json(200, { ok: true, unread: 0 })
        json(404, { error: "no such thing" })
      })
    })
    const wss = new WebSocketServer({ server: peer })
    const socks: Any[] = []
    wss.on("connection", (ws, req) => { seen.push(`WS ${req.url}`); socks.push(ws); ws.send(JSON.stringify({ t: "events", events: theirs })) })
    await new Promise<void>((r) => peer.listen(0, "127.0.0.1", () => r()))
    const port = (peer.address() as { port: number }).port
    write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [{ id: "box", label: "Box", url: `http://127.0.0.1:${port}` }] }))
    await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Here, not there" })
    await followMachines()
    let [, l] = await api("GET", "inbox/events")
    const p1 = l.events.find((e: Any) => e.id === "p1@box")
    check("inbox machines: another machine's events followed (its own only), named by machine, its terminal there",
      seen.includes("WS /api/inbox/live?local=1") && p1?.machine === "box" && p1.machineLabel === "Box" && p1.terminal === "claude-aa11bb22@box" &&
      l.events.some((e: Any) => e.title === "Here, not there") && !l.events.some((e: Any) => e.id.startsWith("p9")) &&
      l.unread === l.events.filter((e: Any) => !e.read).length, l)
    ;[, l] = await api("GET", "inbox/events?local=1")
    check("inbox machines: ?local=1 is this machine's events only", !l.events.some((e: Any) => e.machine) && l.events.some((e: Any) => e.title === "Here, not there"), l.events)
    let [st2, b2] = await api("POST", "inbox/events/read", { ids: ["p1@box"] })
    ;[, l] = await api("GET", "inbox/events")
    check("inbox machines: one read here is read there (and here at once)", st2 === 200 && seen.includes(`POST /api/inbox/events/read?local=1 {"ids":["p1"]}`) &&
      l.events.find((e: Any) => e.id === "p1@box")?.read === true, [st2, b2, seen])
    theirs = [{ ...theirs[0], read: true }, { id: "p3", t: Date.now(), source: "claude", kind: "waiting", title: "Claude Code is waiting for you" }, theirs[1]]
    for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
    await sleep(100)
    ;[, l] = await api("GET", "inbox/events")
    check("inbox machines: its changes arrive live", l.events[0]?.id === "p3@box" && l.events[0].read !== true, l.events.slice(0, 2))
    {
      // Another machine following this one (local=1) isn't told of the followed machines' changes: two machines that
      // follow each other would echo forever (the M1 and M4 sent 17 lists a second, and ran out of memory).
      const { EventEmitter } = await import("node:events")
      const { matchSocket } = await import("../core/plugins.ts")
      const watcher = (local: boolean) => {
        const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got: [] as string[], send(m: string) { ws.got.push(m) }, close() {} })
        matchSocket(app.plugins, ["inbox", "live"])![1].fn(ws as Any, {} as IncomingMessage, { wild: [], query: local ? { local: "1" } : {} })
        return ws
      }
      const there = watcher(true), here = watcher(false)
      await sleep(100)
      there.got.length = here.got.length = 0
      theirs = [...theirs, { id: "p4", t: Date.now() - 100, source: "vau", kind: "info", title: "Another there" }]
      for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
      await sleep(150)
      const after = here.got.length
      for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
      await sleep(150)
      check("inbox machines: their changes go to this machine's apps, not back to the machines (no echo); the same list again is nothing",
        !there.got.length && after === 1 && here.got.length === 1, [there.got.length, after, here.got.length])
      await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Mine, for the machines" })
      await sleep(100)
      check("inbox machines: this machine's own changes still go to the machines", there.got.length === 1, there.got.length)
      there.emit("close"); here.emit("close")
    }
    ;[st2] = await api("POST", "inbox/events/unread", { ids: ["p2@box"] })
    check("inbox machines: unread there", st2 === 200 && seen.includes(`POST /api/inbox/events/unread?local=1 {"ids":["p2"]}`), seen)
    ;[st2] = await api("POST", "inbox/events/p3@box/answer", { answer: "deny" })
    check("inbox machines: a gate answered on its machine (where it waits)", st2 === 200 && seen.includes(`POST /api/inbox/events/p3/answer {"answer":"deny"}`), seen)
    ;[st2] = await api("DELETE", "inbox/events/p3@box")
    ;[, l] = await api("GET", "inbox/events")
    check("inbox machines: dismissed there, gone here", st2 === 200 && seen.includes("DELETE /api/inbox/events/p3 ") && !l.events.some((e: Any) => e.id === "p3@box"), [seen, l.events])
    seen.length = 0
    ;[st2] = await api("POST", "inbox/events/read", {})
    ;[, l] = await api("GET", "inbox/events")
    check("inbox machines: all read is every machine's", st2 === 200 && seen.includes("POST /api/inbox/events/read?local=1 {}") && l.unread === 0, [seen, l.unread])
    ;[st2] = await api("POST", "inbox/events/read?local=1", { ids: ["p1@box"] })
    check("inbox machines: a change asked of one machine is never passed on", st2 === 200 && !seen.some((x) => x.includes('"p1"')), seen)
    for (const s of socks) s.terminate()
    wss.close()
    await new Promise<void>((r) => peer.close(() => r()))
    await sleep(100)
    ;[st2] = await api("POST", "inbox/events/read", { ids: ["p1@box"] })
    ;[, l] = await api("GET", "inbox/events")
    check("inbox machines: one that doesn't answer says so; its events go with it", st2 === 502 && !l.events.some((e: Any) => e.machine), [st2, l.events])
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
    await followMachines()
  }
  // Off: its routes are 404s.
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: [...(conf("plugins").disabled ?? []), "inbox"] }, null, 2) + "\n")
  ;[st] = await api("POST", "inbox/events", { title: "x" })
  check("inbox off: events are 404s", st === 404, st)
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: (conf("plugins").disabled ?? []).filter((x: string) => x !== "inbox") }, null, 2) + "\n")
}

// AI import (plugins/core/ai-import): ChatGPT's and Claude's exports (made up: tools/fixtures/ai-import/make.ts) into chats,
// projects and a review list of memories; streaming, branches, idempotent re-imports, and adding ticked memories.
{
  const { jsonItems } = await import("../plugins/core/ai-import/jsonstream.ts")
  const { zipEntries, entryBytes, zipFiles } = await import("../plugins/core/ai-import/zip.ts")
  const chatgpt = await import("../plugins/core/ai-import/chatgpt.ts")
  const claude = await import("../plugins/core/ai-import/claude.ts")
  const { chatNote, reviewItems, afterApply, shiftHeadings, fenced } = await import("../plugins/core/ai-import/note.ts")
  const { applyReview } = await import("../plugins/core/ai-import/plugin.ts")
  const fx = await import("./fixtures/ai-import/make.ts")
  const { Readable } = await import("node:stream")

  // Streaming JSON: items whole whatever the chunks cut through (strings, escapes, multi-byte letters).
  const src = JSON.stringify([{ a: "x,]}\"{[", b: [1, { c: "Ünïcödé ✓" }] }, "str]", 42, null, { d: "\\" }])
  const bytes = Buffer.from(src, "utf8")
  const items: unknown[] = []
  for await (const it of jsonItems(Readable.from(Array.from({ length: bytes.length }, (_, i) => bytes.subarray(i, i + 1))))) items.push(it)
  check("ai-import json: items one by one, byte by byte", JSON.stringify(items) === src, items)
  let threw = ""
  try { for await (const _ of jsonItems(Readable.from([Buffer.from('[{"a": 1}, {"b": ')]))) { /* reading */ } } catch (e) { threw = String(e) }
  check("ai-import json: a file cut off is an error", /ends in the middle/.test(threw), threw)
  const whole: unknown[] = []
  for await (const it of jsonItems(Readable.from([Buffer.from(' {"conversations_memory": "x"}')]))) whole.push(it)
  check("ai-import json: an object is one item", whole.length === 1 && (whole[0] as Any).conversations_memory === "x", whole)

  // Zips: read back what zipFiles wrote.
  const zf = path.join(tmp, "t.zip")
  fs.writeFileSync(zf, zipFiles({ "a.txt": "hello", "dir/b.json": JSON.stringify({ x: 1 }) }))
  const es = zipEntries(zf)
  check("ai-import zip: entries and their bytes", es.map((e) => e.name).join() === "a.txt,dir/b.json" && (await entryBytes(zf, es[0])).toString() === "hello", es)

  // ChatGPT: the branch last seen, models, images, thinking, memories from bio, custom instructions and the memory list.
  const [trip, py, lonely] = fx.chatgptConversations()
  const r = chatgpt.readConversation(trip)!
  const says = (m: Any) => m.parts.map((p: Any) => p.text ?? "").join(" ")
  check("chatgpt: the transcript is the branch to current_node (an edited prompt, a retried answer)",
    r.chat.messages.some((m) => says(m).includes("Sintra makes a good day trip")) && !r.chat.messages.some((m) => /Porto is|first try/.test(says(m))) && r.chat.otherBranches === 2, r.chat.messages.map(says))
  check("chatgpt: models in order, hidden context left out", r.chat.models.join() === "gpt-4o,o3" && !r.chat.messages.some((m) => /User profile|Model set context/.test(says(m))), r.chat.models)
  check("chatgpt: an image and thinking", r.chat.messages[0].parts[0].kind === "image" && (r.chat.messages[0].parts[0] as Any).ref === "file-Img001" && r.chat.messages.some((m) => m.parts.some((p) => p.kind === "thinking")))
  check("chatgpt: memories from bio and the custom instructions", r.memories.some((m) => m.text === "Is planning a trip to Lisbon in October." && m.from === "ChatGPT's memory") &&
    r.memories.some((m) => m.text === "I have a dog named Biscuit." && m.about === "me") && r.memories.some((m) => m.text === "Prefer concise answers with bullet points." && m.about === "preference"), r.memories)
  check("chatgpt: the memory list, numbers and dates off", r.memoryList?.facts.join("|") === "Prefers metric units.|Works as a product designer at Lighthouse.", r.memoryList)
  const p2 = chatgpt.readConversation(py)!
  check("chatgpt: no title or current_node: the first prompt names it, the newest leaf ends it", p2.chat.title === "What's 2 to the 20th?" && says(p2.chat.messages.at(-1)).includes("1,048,576") && p2.chat.messages.some((m) => m.parts.some((p) => p.kind === "code")), p2.chat)
  check("chatgpt: not a conversation is null", chatgpt.readConversation({ foo: 1 }) === null && chatgpt.readConversation(lonely)!.chat.messages.length === 1)

  // Claude: the newest leaf, artifacts, attachments, files without bytes, models, a name from the first prompt.
  const [recipes, old] = fx.claudeConversations()
  const c1 = claude.readConversation(recipes)!
  check("claude: the newest branch, one other", says(c1.messages.at(-1)).includes("Added chili") && !c1.messages.some((m) => says(m).includes("first try")) && c1.otherBranches === 1, c1.messages.map(says))
  check("claude: models, an artifact, a change to it, a web search, an attachment's text, an image without bytes", c1.models.join() === "claude-sonnet-4-5,claude-opus-4-1" &&
    c1.messages[1].parts.some((p) => p.kind === "code" && p.title === "Shopping list") && c1.messages.at(-1)!.parts.some((p) => p.kind === "code" && p.lang === "diff") &&
    c1.messages[1].parts.some((p) => p.kind === "note" && p.text.includes("rice bowl recipes")) && c1.messages[0].parts.some((p) => p.kind === "file" && p.text?.includes("beans")) &&
    c1.messages[0].parts.some((p) => p.kind === "image" && p.ref === null), c1.messages)
  const c2 = claude.readConversation(old)!
  check("claude: an old chat (text only, no name, no parents) in a project", c2.title === "When do I plant tomatoes?" && c2.messages.length === 2 && c2.project?.startsWith("p1000000"), c2)
  const mems = claude.readMemories([{ conversations_memory: "**Work**\n\nThe user designs. The user prefers short answers.\n\n- Lives in Porto", project_memories: { p1: "Sunny." } }], new Map([["p1", "Garden"]]))
  check("claude memories: sentences and items, headings off, a project's named", mems.map((m) => `${m.about}:${m.text}`).join("|") === "me:The user designs.|preference:The user prefers short answers.|me:Lives in Porto|me:Sunny." && mems[3].from.includes("Garden"), mems)
  const { factsOf } = await import("../plugins/core/ai-import/chat.ts")
  check("memories: a long fact kept whole", factsOf(`- ${"word ".repeat(200)}end`)[0]?.endsWith("end"))
  check("claude memories: memory as files", claude.readMemories({ memories: [{ path: "/preferences.md", content: "- Answer in English" }] })[0]?.about === "preference")

  // Markdown: headings moved under the turns (not in code), fences that can't close early.
  check("ai-import note: headings shifted, code left alone", shiftHeadings("# A\n```\n# b\n```\n###### C") === "### A\n```\n# b\n```\n###### C")
  check("ai-import note: a fence longer than the text's", fenced("a ``` b") === "````\na ``` b\n````")
  const n1 = chatNote(r.chat, new Map([["file-Img001", "file-Img001-beach.png"]]))
  check("ai-import note: turns as ## headings, the image embedded, the branches said", n1.body.startsWith("## You · 2026-09-20") && n1.body.includes("![[file-Img001-beach.png]]") &&
    n1.body.includes("### Day 1") && n1.body.includes("#### Day 2") && n1.body.includes("```\n# not a heading") && n1.body.includes("2 other branches") && n1.fm.messages === 6 && n1.fm.ext_id === `chatgpt-${(trip as Any).id}`, n1)

  // The import, through the API: the zip in the vault (an upload is the same file, written as it comes).
  write("Imports/chatgpt-export.zip", "")
  fs.writeFileSync(path.join(VAULT, "Imports/chatgpt-export.zip"), fx.chatgptExport())
  fs.writeFileSync(path.join(VAULT, "Imports/claude-export.dms"), fx.claudeExport())
  const runJob = async (body: unknown, q = "") => {
    const [st, job] = await api("POST", `ai-import${q}`, body)
    if (st !== 202) return { state: "refused", status: st, job }
    for (let i = 0; i < 3000; i++) {
      const [, j] = await api("GET", `ai-import/jobs/${job.id}`)
      if (j.state === "done" || j.state === "failed") return j
      await sleep(20)
    }
    return { state: "timeout" }
  }
  let j = await runJob({ path: "Imports/chatgpt-export.zip" })
  const tripRel = "Chats/ChatGPT/2026-09-20 Trip to Lisbon.md"
  check("ai-import chatgpt: done, every chat made (a one-message one too), the broken item said", j.state === "done" && j.source === "chatgpt" && j.created === 3 && j.skipped === 0 && j.problems.length === 1 && j.read === j.total, j)
  check("ai-import chatgpt: the chat note", exists(tripRel) && read(tripRel).startsWith("---\ntype: chat\nsource: chatgpt\next_id: chatgpt-") && read(tripRel).includes("models: [gpt-4o, o3]"), exists(tripRel) && read(tripRel))
  check("ai-import chatgpt: an image, once, in Attachments", j.images === 1 && exists("Chats/ChatGPT/Attachments/file-Img001-beach.png"), j)
  check("ai-import chatgpt: memories to review, none written to ME.md", j.memories === 6 && j.review === "Chats/ChatGPT/Memories to review.md" && !read("ME.md").includes("Biscuit") &&
    reviewItems(read(j.review)).length === 6 && reviewItems(read(j.review)).every((i) => !i.done), j)
  let [, rendered] = await api("GET", `render?path=${j.review}`)
  check("ai-import review block: as text, the count", String(rendered).includes("6 memories to review, 0 ticked"), rendered)

  // Again: nothing changes, nothing doubles.
  const before = read(tripRel)
  j = await runJob({ path: "Imports/chatgpt-export.zip" })
  check("ai-import again: unchanged, no second file, no new memories", j.state === "done" && j.created === 0 && j.unchanged === 3 && j.memories === 0 && read(tripRel) === before &&
    fs.readdirSync(path.join(VAULT, "Chats/ChatGPT")).filter((f) => f.endsWith(".md")).length === 4, j)
  // The user writes above the transcript and adds a key; the chat goes on in ChatGPT; importing again updates it in place.
  write(tripRel, before.replace("---\n\n## You", "rating: 5\n---\n\nMy notes: book the train.\n\n## You"))
  fs.writeFileSync(path.join(VAULT, "Imports/chatgpt-export.zip"), fx.chatgptExport(120))
  j = await runJob({ path: "Imports/chatgpt-export.zip" })
  const after = read(tripRel)
  check("ai-import update: in place, the user's text and keys kept, updated changed", j.updated === 1 && j.unchanged === 2 && after.includes("My notes: book the train.\n\n## You") &&
    after.includes("rating: 5") && after.includes("updated: '2026-09-20 16:12:00'") && after.split("## You").length === 3, [j, after])

  // Claude's (named .dms), with a project and memories.
  j = await runJob({ path: "Imports/claude-export.dms" }, "?minMessages=1")
  const proj = "Chats/Claude/Projects/Garden planning.md"
  check("ai-import claude: chats, a project, the empty one skipped", j.state === "done" && j.source === "claude" && j.created === 2 && j.skipped === 1 && j.projects === 1 && exists(proj) &&
    read(proj).includes("## Instructions") && read(proj).includes("#### Beds"), j)
  {
    const recipes = read(`Chats/Claude/${fs.readdirSync(path.join(VAULT, "Chats/Claude")).find((f) => f.endsWith("Recipe ideas.md"))}`)
    check("ai-import claude: a long attachment is a file of its own, whole, linked; a long tool result kept whole", j.files === 1 &&
      read("Chats/Claude/Attachments/cookbook.pdf.txt") === "A long cookbook page. ".repeat(300) && recipes.includes("*Attached* [[cookbook.pdf.txt]]") &&
      recipes.includes("The end of the page.") && recipes.includes("Attached pantry.txt"), [j, recipes.slice(0, 1500)])
  }
  check("ai-import claude: a chat links its project", read("Chats/Claude/2026-09-21 When do I plant tomatoes.md").includes("project: '[[Chats/Claude/Projects/Garden planning|Garden planning]]'"))
  check("ai-import claude: memories to review", j.memories === 5 && reviewItems(read("Chats/Claude/Memories to review.md")).some((i) => i.fact === "Has a dog named Biscuit"), j)
  j = await runJob({ path: "Imports/claude-export.dms" })
  check("ai-import claude again: unchanged, its attachment's file not doubled", j.created === 0 && j.projects === 0 && j.unchanged === 2 && j.memories === 0 &&
    fs.readdirSync(path.join(VAULT, "Chats/Claude/Attachments")).length === 1, j)
  j = await runJob({ path: "People/Sam Park.md" })
  check("ai-import: something that isn't an export fails, saying why", j.state === "failed" && /conversations/.test(j.error), j)
  const [bs] = await api("POST", "ai-import", {})
  check("ai-import: no export is a 400", bs === 400)

  // Adding ticked memories: through the op MCP's remember is (in-process here), then off the list and under Added.
  const rememberOp = app.catalog().find((e) => e.mcp === "remember")!.id
  const remember = async (args: Any) => (await app.callOp(rememberOp, args, { client: "mcp", agent: "ai-import", label: "ChatGPT", source: "chatgpt" })).text
  const rel = "Chats/ChatGPT/Memories to review.md"
  let list = read(rel)
  list = list.replace("- [ ] **Me** · I have a dog named Biscuit.", "- [x] **Me** · I have a dog named Biscuit.")
    .replace("- [ ] **How to work with me** · Prefer concise answers with bullet points.", "- [x] **How to work with me** · Prefer concise answers with bullet points.")
    .replace("- [ ] **Me** · Works as a product designer at Lighthouse.", "- [x] **Sam Park** · Works as a product designer at Lighthouse.")
    .replace("- [ ] **Me** · Is planning a trip to Lisbon in October.", "- [x] **Nobody Here** · Is planning a trip to Lisbon in October.")
  write(rel, list)
  const results = await applyReview(list, "ChatGPT", remember)
  write(rel, afterApply(read(rel), results))
  const me = read("ME.md"), sam = read("People/Sam Park.md"), done = read(rel)
  check("ai-import apply: a fact in ME.md under About me, a preference under How to work with me", /## About me\n[\s\S]*- I have a dog named Biscuit\./.test(me) && /## How to work with me\n[\s\S]*- Prefer concise answers with bullet points\./.test(me), me)
  check("ai-import apply: a person's in their file, with its source", /Works as a product designer at Lighthouse\. \(from ChatGPT, \d{4}-\d\d-\d\d\)/.test(sam), sam)
  check("ai-import apply: added ones leave the list for Added, a failed one stays ticked with why", results.filter((x) => x.error).length === 1 &&
    done.includes("## Added\n\n- ") && done.includes("\n- ME.md, About me · I have a dog named Biscuit.") && done.includes("\n- ME.md, How to work with me · Prefer concise answers") &&
    done.includes("\n- [[Sam Park]] · Works as a product designer") && !done.includes("### From ChatGPT's custom instructions\n\n- [ ] **Me** · I have a dog") &&
    /- \[x\] \*\*Nobody Here\*\* · Is planning a trip to Lisbon in October\.\n {4}- Couldn't add it: No one called 'Nobody Here'/.test(done) && reviewItems(done).length === 3, done.slice(done.indexOf("## To review")))
  const again = await applyReview(done.replace("**Nobody Here**", "**Me**"), "ChatGPT", remember)
  const done2 = afterApply(done.replace("**Nobody Here**", "**Me**"), again)
  check("ai-import apply: fixed and applied again, its error line goes", !done2.includes("Couldn't add") && done2.includes("- ME.md, About me · Is planning a trip") && reviewItems(done2).length === 2, done2)
  // Re-importing never brings an added memory back.
  write(rel, done2)
  fs.writeFileSync(path.join(VAULT, "Imports/chatgpt-export.zip"), fx.chatgptExport(240))
  j = await runJob({ path: "Imports/chatgpt-export.zip" })
  check("ai-import again after adding: no memory comes back", j.memories === 0 && reviewItems(read(rel)).length === 2, [j, read(rel)])
  // The ops: apply (the app's Add) through people.remember, in-process; run on an export in the vault, waiting for it.
  write(rel, read(rel).replace(/- \[ \] \*\*/, "- [x] **"))
  const [as, ab] = await api("POST", "ops/ai-import.apply", { path: rel })
  check("ai-import.apply: the ticked memory added, off the list", as === 200 && ab.added === 1 && !ab.failed && !reviewItems(read(rel)).some((i) => i.done) && reviewItems(read(rel)).length === 1, [as, ab, read(rel)])
  const [ns, nb] = await api("POST", "ops/ai-import.apply?as=text", { path: rel })
  check("ai-import.apply: nothing ticked, says so", ns === 200 && nb === "Nothing ticked to add.", [ns, nb])
  const [rs, rb] = await api("POST", "ops/ai-import.run?as=text", { path: "chatgpt-export.zip", wait: true })
  check("ai-import.run: an export in the vault (by its name), waited for, said like vau import", rs === 200 && /^ChatGPT: \d+ chats in Chats\/ChatGPT\/: 0 new/.test(rb), [rs, rb])
  const [js, jb] = await api("POST", "ops/ai-import.job", {})
  check("ai-import.job: the latest import", js === 200 && jb.state === "done" && jb.name === "chatgpt-export.zip", [js, jb])
  check("ai-import routes: upload and import aren't held, the op run neither; apply is (it writes the vault)", app.unlocked("POST", ["ai-import"]) && app.streams("POST", ["ai-import"]) && app.streams("POST", ["ai-import", "upload"])
    // (an op route holds the vault itself, for a write that doesn't say lock: false: App.callOp)
    && app.opNamed("ai-import.run")?.op.lock === false && app.opNamed("ai-import.apply")?.op.kind === "write" && app.opNamed("ai-import.apply")?.op.lock !== false)

  // Big: 1500 chats stream through without holding the server (the event loop keeps turning).
  const many = Array.from({ length: 1500 }, (_, i) => ({ uuid: `b16b16b1-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Chat ${i}`, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:05:00Z",
    chat_messages: [{ uuid: `${i}a`, text: `Question ${i} ${"x".repeat(2000)}`, sender: "human", created_at: "2026-09-01T10:00:00Z" }, { uuid: `${i}b`, text: `Answer ${i}`, sender: "assistant", created_at: "2026-09-01T10:01:00Z" }] }))
  fs.writeFileSync(path.join(VAULT, "Imports/big.zip"), zipFiles({ "conversations.json": JSON.stringify(many) }))
  let ticks = 0
  const timer = setInterval(() => ticks++, 5)
  const t0 = Date.now()
  j = await runJob({ path: "Imports/big.zip" }, "?folder=Big")
  clearInterval(timer)
  check("ai-import big: 1500 chats, in their folder", j.state === "done" && j.created === 1500 && fs.readdirSync(path.join(VAULT, "Big/Claude")).length === 1500, j)
  check("ai-import big: the server kept turning meanwhile (not one long block)", ticks >= 20, { ticks, ms: Date.now() - t0 })
}

// ---------- Provenance: an agent's new notes are `origin: ai` (plugin.onCreate, from the request's writer) ----------
{
  const as = (client: string | null, agent: string | null, method: string, p: string, body: unknown) => api(method, p, body, sentBy(client, agent))
  const origin = (rel: string) => /^origin: (.*)$/m.exec(read(rel))?.[1] ?? null
  await as("mcp", null, "POST", "notes", { title: "Prov by mcp", body: "Hello.", ext_id: "prov-mcp" })
  check("provenance: a note an MCP client makes is origin: ai", origin("Notes/Prov by mcp.md") === "ai", read("Notes/Prov by mcp.md"))
  await as(null, null, "PUT", "file", { path: "Prov/Curl.md", text: "Just text.\n" })
  check("provenance: a plain note from curl gets a header with origin: ai, its text kept", read("Prov/Curl.md") === "---\norigin: ai\n---\n\nJust text.\n", read("Prov/Curl.md"))
  await as("cli", "claude-code", "PUT", "file", { path: "Prov/Agent.md", text: "---\ntags: [A]   # mine\n---\nBody\n" })
  check("provenance: the CLI under an agent too, the header's own lines kept", read("Prov/Agent.md") === "---\ntags: [A]   # mine\norigin: ai\n---\nBody\n", read("Prov/Agent.md"))
  await as("cli", "claude-code", "PUT", "file", { path: "Prov spaced/Header.md", text: "---\n\nkind: drawing\ntags: [x]\n\n---\nBody\n" })
  check("provenance: a header's blank lines stay where they were, the new key after the last value", read("Prov spaced/Header.md") === "---\n\nkind: drawing\ntags: [x]\norigin: ai\n\n---\nBody\n", read("Prov spaced/Header.md"))
  fs.rmSync(path.join(VAULT, "Prov spaced"), { recursive: true })
  await as("app/desktop", null, "PUT", "file", { path: "Prov/Default mine.md", text: "Mine.\n" })
  check("provenance: the user's own notes aren't labelled unless label_user is on (no label is theirs)", read("Prov/Default mine.md") === "Mine.\n", read("Prov/Default mine.md"))
  check("provenance: the store says so, for the header", (await app.state()).provenance?.labelUser === false)
  fs.rmSync(path.join(VAULT, "Prov/Default mine.md"))
  vault.setConfig("plugins/provenance/data", { label_user: true })
  await as("app/desktop", null, "POST", "notes", { title: "Prov by app", body: "Mine.", ext_id: "prov-app" })
  await as("cli", null, "PUT", "file", { path: "Prov/Typed.md", text: "By hand.\n" })
  await as("app/phone", null, "POST", "file", { path: "Prov/Untitled.md", text: "", unique: true })
  check("provenance: the app's and the CLI typed by hand are the user's: origin: human", origin("Notes/Prov by app.md") === "human" && origin("Prov/Typed.md") === "human" && read("Prov/Untitled.md") === "---\norigin: human\n---\n", [read("Notes/Prov by app.md"), read("Prov/Typed.md"), read("Prov/Untitled.md")])
  await as("mcp", null, "PUT", "file", { path: "Prov/Mine.md", text: "---\norigin: human\n---\nHers.\n" })
  await as("mcp", null, "PUT", "file", { path: "Prov/Curl.md", text: "---\norigin: ai\n---\n\nJust text, edited.\n", base: read("Prov/Curl.md") })
  await as("mcp", null, "POST", "notes", { title: "Prov by app", body: "Mine, edited by an agent.", ext_id: "prov-app" })
  check("provenance: a label it's given stays; edits never add or change one", origin("Prov/Mine.md") === "human" && origin("Notes/Prov by app.md") === "human" && read("Notes/Prov by app.md").includes("edited by an agent"), [read("Prov/Mine.md"), read("Notes/Prov by app.md")])
  await as("mcp", null, "POST", "people", { name: "Prov Person", relation: "friend" })
  await as("mcp", null, "PUT", "file", { path: "Prov/Board.md", text: "---\ntype: dashboard\n---\n" })
  check("provenance: only notes (not people, not dashboards)", origin("People/Prov Person.md") === null && origin("Prov/Board.md") === null, read("People/Prov Person.md"))
  vault.setConfig("plugins", { ...vault.config("plugins"), disabled: [...(vault.config("plugins").disabled ?? []), "provenance"] })
  await as("mcp", null, "PUT", "file", { path: "Prov/Off.md", text: "Off.\n" })
  check("provenance: off, nothing is added", read("Prov/Off.md") === "Off.\n", read("Prov/Off.md"))
  vault.setConfig("plugins", { ...vault.config("plugins"), disabled: (vault.config("plugins").disabled as string[]).filter((x) => x !== "provenance") })
  const [, st] = await api("GET", "state")
  check("provenance: its values in the store, the defaults when none are set", (st.provenance?.values as Any[] ?? []).map((v: Any) => v.value).join() === "human,reviewed,mixed,ai", st.provenance)
  vault.setConfig("plugins/provenance/data", { values: [{ value: "mine" }, { value: "bot", label: "Bot" }], agent: "bot" })
  await as("mcp", null, "PUT", "file", { path: "Prov/Own.md", text: "Own.\n" })
  const [, st2] = await api("GET", "state")
  check("provenance: a vault's own values, and the label agents get", origin("Prov/Own.md") === "bot" && (st2.provenance?.values as Any[]).length === 2, [read("Prov/Own.md"), st2.provenance])
  vault.setConfig("plugins/provenance/data", { label_agents: false, label_user: false })
  await as("mcp", null, "PUT", "file", { path: "Prov/Unasked.md", text: "Unasked.\n" })
  await as("app/desktop", null, "PUT", "file", { path: "Prov/Unasked mine.md", text: "Mine.\n" })
  check("provenance: with label_agents and label_user off, new notes aren't labelled", read("Prov/Unasked.md") === "Unasked.\n" && read("Prov/Unasked mine.md") === "Mine.\n", read("Prov/Unasked.md"))
  let [, voice] = await as("iphone", null, "POST", "ops/inbox.voice", { text: "Prov voice unlabelled", from: "iPhone" })
  check("provenance: a voice note isn't labelled with label_user off", origin(voice.path) === null, read(voice.path))
  fs.rmSync(path.join(VAULT, voice.path))
  vault.setConfig("plugins/provenance/data", { label_user: true })
  ;[, voice] = await as("iphone", null, "POST", "ops/inbox.voice", { text: "Prov voice from the phone", from: "iPhone" })
  check("provenance: a voice note is the user's own words: origin: human (from the phone, an agent's client)", origin(voice.path) === "human" && read(voice.path).includes("type: inbox"), read(voice.path))
  await as("mcp", null, "PUT", "inbox/Prov voice from the phone", { status: "done" })
  const doneVoice = "Inbox/.archive/Prov voice from the phone.md"
  check("provenance: a voice note marked done (archived) keeps its label", origin(doneVoice) === "human" && /status: done/.test(read(doneVoice)), read(doneVoice))
  fs.rmSync(path.join(VAULT, doneVoice))
  ;[, voice] = await as("mcp", null, "POST", "ops/inbox.voice", { text: "Prov voice from an AI app", from: "ChatGPT" })
  check("provenance: inbox.voice from an AI app (MCP) is its words, not the user's: origin: ai", origin(voice.path) === "ai", read(voice.path))
  fs.rmSync(path.join(VAULT, voice.path))
  const [, q] = await api("POST", "query", { from: "Prov/", where: "origin = ai" })
  check("provenance: database views filter on it", (q.groups as Any[]).flatMap((g: Any) => g.rows.map((r: Any) => r.path)).sort().join() === "Prov/Agent.md,Prov/Curl.md", q)
  for (const f of ["Prov", "Notes/Prov by mcp.md", "Notes/Prov by app.md", "People/Prov Person.md"]) fs.rmSync(path.join(VAULT, f), { recursive: true, force: true })
}

// ---------- Provenance for files that aren't notes: its list (files.json), their bytes never changed ----------
{
  const zlib = await import("node:zlib")
  const { saysAi, AI_SOURCE } = await import("../plugins/core/provenance/xmp.ts")
  const chunk = (type: string, data: Buffer) => {
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1"); data.copy(b, 8)
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length)
    return b
  }
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]) // 2x2, 8-bit RGB
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))])
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==", "base64")
  const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" data-x="a>b"><rect width="2" height="2"/></svg>\n'

  // (an image an AI app marked: an XMP iTXt chunk after IHDR)
  const p2 = Buffer.concat([png.subarray(0, 33), chunk("iTXt", Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta><Iptc4xmpExt:DigitalSourceType>${AI_SOURCE}</Iptc4xmpExt:DigitalSourceType></x:xmpmeta>`, "latin1")), png.subarray(33)])
  check("provenance xmp: read in an XMP chunk, not in an image without one", saysAi(p2) && !saysAi(png) && !saysAi(jpeg))
  const composite = zlib.deflateSync(Buffer.from(`<x:xmpmeta><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></x:xmpmeta>`))
  const zpng = Buffer.concat([png.subarray(0, 33), chunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\x01\0\0\0", "latin1"), composite])), png.subarray(33)])
  check("provenance xmp: read in a compressed XMP chunk (composite with AI counts), in a tail, not in a camera's",
    saysAi(zpng) && saysAi(Buffer.alloc(10), Buffer.from(`"digitalSourceType":"${AI_SOURCE}"`)) && !saysAi(Buffer.from("digitalsourcetype/digitalCapture")))

  const as = (client: string | null, agent: string | null, method: string, p: string, body: unknown, query: Record<string, string> = {}) =>
    run(method, p.split("/"), query, body, sentBy(client, agent))
  const list = () => (exists(".vaultite/plugins/provenance/files.json") ? JSON.parse(read(".vaultite/plugins/provenance/files.json")) : {})
  const bytes = (rel: string) => fs.readFileSync(path.join(VAULT, rel))
  const b64 = (b: Buffer) => b.toString("base64")
  await as("mcp", null, "POST", "ops/file.upload", { data: b64(png), name: "Prov chart.png", folder: "ProvM" })
  await as("cli", "claude-code", "POST", "ops/file.upload", { data: b64(jpeg), name: "Prov photo.jpg", folder: "ProvM" })
  {
    const [, cam] = await as("mcp", null, "POST", "ops/file.upload", { data: b64(jpeg), name: "image.jpg", folder: "ProvM" })
    check("upload: a phone's nameless image.jpg is named as Obsidian names a pasted one", /^ProvM\/Pasted image \d{14}\.jpg$/.test(cam.path), cam)
    fs.rmSync(path.join(VAULT, cam.path))
  }
  check("provenance files: an agent's upload is labelled ai in the list, its bytes as they came", list()["ProvM/Prov chart.png"] === "ai" && list()["ProvM/Prov photo.jpg"] === "ai"
    && bytes("ProvM/Prov chart.png").equals(png) && bytes("ProvM/Prov photo.jpg").equals(jpeg), list())
  vault.setConfig("plugins/provenance/data", { label_user: true })
  await as("app/desktop", null, "POST", "upload", { path: "ProvM/Mine.png", bytes: png })
  check("provenance files: the user's upload from the app is human, its bytes untouched", list()["ProvM/Mine.png"] === "human" && bytes("ProvM/Mine.png").equals(png), list())
  await as("cli", "codex", "POST", "ops/file.upload", { data: b64(Buffer.from(svg)), name: "Drawing.svg", folder: "ProvM" })
  await as("cli", "codex", "POST", "ops/file.write", { path: "ProvM/Data.csv", text: "a,b\n1,2\n" })
  check("provenance files: an agent's SVG and a CSV through file.write labelled, not changed", list()["ProvM/Drawing.svg"] === "ai" && read("ProvM/Drawing.svg") === svg
    && list()["ProvM/Data.csv"] === "ai" && read("ProvM/Data.csv") === "a,b\n1,2\n", [list(), read("ProvM/Drawing.svg")])
  await as("cli", "codex", "PUT", "file", { path: "ProvM/Drawing.svg", text: read("ProvM/Drawing.svg").replace("<rect", "<circle"), base: read("ProvM/Drawing.svg") })
  check("provenance files: an edit leaves the label and adds nothing", list()["ProvM/Drawing.svg"] === "ai" && read("ProvM/Drawing.svg") === svg.replace("<rect", "<circle"), read("ProvM/Drawing.svg"))
  await as("app/desktop", null, "POST", "upload", { path: "ProvM/From ChatGPT.png", bytes: p2 })
  let [, o] = await as("cli", null, "POST", "ops/provenance.get", { path: "ProvM/From ChatGPT.png" })
  check("provenance files: an upload whose bytes say an AI made it isn't labelled the user's: it reads as ai, from the file", !("ProvM/From ChatGPT.png" in list()) && o.origin === "ai" && o.from === "file", [o, list()])
  write("ProvM/Dropped.png", png.toString("latin1"))
  ;[, o] = await as("cli", null, "POST", "ops/provenance.get", { path: "ProvM/Dropped.png" })
  check("provenance files: a file put there by hand, saying nothing, is unlabelled", o.origin === null && o.from === null, o)
  ;[, o] = await as("app/desktop", null, "POST", "ops/provenance.set", { path: "ProvM/Dropped.png", origin: "Reviewed" })
  check("provenance files: the user labels any file (the value as the settings write it); its bytes don't change", o.origin === "reviewed" && list()["ProvM/Dropped.png"] === "reviewed" && read("ProvM/Dropped.png") === png.toString("latin1"), [o, list()])
  let [code] = await as("mcp", null, "POST", "ops/provenance.set", { path: "ProvM/Dropped.png", origin: "human" })
  const [code2] = await as("cli", "claude-code", "POST", "ops/provenance.set", { path: "ProvM/Dropped.png" })
  const [code3] = await as("cli", null, "POST", "ops/provenance.set", { path: "ProvM/Dropped.png", origin: "robot" })
  check("provenance files: an agent can't label human or remove a label; a value that isn't one is refused", code === 403 && code2 === 403 && code3 === 400 && list()["ProvM/Dropped.png"] === "reviewed", [code, code2, code3])
  ;[code, o] = await as("mcp", null, "POST", "ops/provenance.set", { path: "Prov chart.png", origin: "ai" })
  check("provenance files: an agent labels ai, a file named as the user says it", code === 200 && o.path === "ProvM/Prov chart.png" && o.origin === "ai", o)
  write("ProvM/Note.md", "Text.\n")
  ;[, o] = await as("app/desktop", null, "POST", "ops/provenance.set", { path: "ProvM/Note.md", origin: "mixed" })
  check("provenance files: a note's label is its frontmatter, as a small edit", read("ProvM/Note.md") === "---\norigin: mixed\n---\n\nText.\n" && o.from === "frontmatter" && !("ProvM/Note.md" in list()), read("ProvM/Note.md"))
  ;[, o] = await as("app/desktop", null, "GET", "provenance/origin", {}, { path: "ProvM/Mine.png" })
  check("provenance files: the app's chip reads it at /api/provenance/origin", o.origin === "human" && o.from === "list", o)

  await as("app/desktop", null, "POST", "file/move", { from: "ProvM/Mine.png", to: "ProvM/Sub/Renamed.png" })
  check("provenance files: a label follows its file moved and renamed", list()["ProvM/Sub/Renamed.png"] === "human" && !("ProvM/Mine.png" in list()), list())
  await as("cli", null, "POST", "ops/file.move", { from: "ProvM/Sub", to: "ProvM/Moved" })
  check("provenance files: and its folder moved (vau move)", list()["ProvM/Moved/Renamed.png"] === "human" && !Object.keys(list()).some((k) => k.startsWith("ProvM/Sub/")), list())
  const [, del] = await as("app/desktop", null, "DELETE", "file", { path: "ProvM/Moved/Renamed.png" })
  check("provenance files: deleted, it goes into the trash with it", list()[del.trashed] === "human" && !("ProvM/Moved/Renamed.png" in list()), [del, list()])
  await as("app/desktop", null, "POST", "file/restore", { path: del.trashed })
  check("provenance files: restored (Undo), it comes back", list()["ProvM/Moved/Renamed.png"] === "human" && !(del.trashed in list()), list())
  const [, del2] = await as("app/desktop", null, "DELETE", "file", { path: "ProvM/Moved/Renamed.png" })
  fs.rmSync(path.join(VAULT, del2.trashed))
  await api("GET", "files")
  check("provenance files: gone for good from the trash, it's gone from the list", !(del2.trashed in list()) && !Object.keys(list()).some((k) => k.startsWith(".trash/")), list())

  write("ProvM/All.base", "filters: file.inFolder(\"ProvM\")\nviews:\n  - type: table\n    name: AI\n    filters: 'origin == \"ai\"'\n    order: [file.name]\n")
  const [, qr] = await api("GET", "query?base=ProvM/All.base")
  check("provenance files: a base filters attachments on origin (the list's, and what their bytes say)",
    JSON.stringify(qr.groups?.[0]?.rows.map((r: Any) => r.path).sort()) === JSON.stringify(["ProvM/Data.csv", "ProvM/Drawing.svg", "ProvM/From ChatGPT.png", "ProvM/Prov chart.png", "ProvM/Prov photo.jpg"]), qr.groups?.[0]?.rows.map((r: Any) => r.path))
  vault.setConfig("plugins", { ...vault.config("plugins"), disabled: [...(vault.config("plugins").disabled ?? []), "provenance"] })
  await as("mcp", null, "POST", "ops/file.upload", { data: b64(png), name: "Off.png", folder: "ProvM" })
  check("provenance files: off, an agent's upload is neither listed nor changed", !("ProvM/Off.png" in list()) && bytes("ProvM/Off.png").equals(png), list())
  vault.setConfig("plugins", { ...vault.config("plugins"), disabled: (vault.config("plugins").disabled as string[]).filter((x) => x !== "provenance") })
  vault.setConfig("plugins/provenance/data", { label_agents: false })
  await as("mcp", null, "POST", "ops/file.upload", { data: b64(png), name: "Unasked.png", folder: "ProvM" })
  check("provenance files: with label_agents off, an agent's upload isn't labelled or changed", !("ProvM/Unasked.png" in list()) && bytes("ProvM/Unasked.png").equals(png), list())
  vault.setConfig("plugins/provenance/data", {})
  fs.rmSync(path.join(VAULT, "ProvM"), { recursive: true, force: true })
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/provenance/files.json"), { force: true })
}

// Bundles (core/bundles.ts): applying is small edits that leave unrelated keys alone, and restoring is a round trip.
{
  app.installPages()
  const conf = (name: string) => { try { return JSON.parse(read(`.vaultite/${name}.json`)) } catch { return null } }
  const setConf = (name: string, o: unknown) => write(`.vaultite/${name}.json`, JSON.stringify(o))
  setConf("plugins", { disabled: ["recent"], enabled: ON, collapsedCategories: ["core:navigation"], order: ["people"] })
  setConf("appearance", { theme: "light", textFont: "Georgia", scheme: "nord" })
  setConf("pages", { pinned: ["People/Alice Park.md", "Dashboards/Today.md"] })
  setConf("plugins/page-preview/data", { delay: 300 })
  setConf("plugins/terminal/data", { allowRemote: true })
  for (const f of ["sidebars", "hotkeys"]) { try { fs.unlinkSync(path.join(VAULT, `.vaultite/${f}.json`)) } catch { /* none */ } }
  const desk = { name: "Desk", sidebars: { left: ["files:files"], right: [], collapsed: [] }, pinned: ["People/Alice Park.md", "Dashboards/Today.md"] }
  writeWs({ workspaces: [desk] })
  const NAMES = ["plugins", "appearance", "pages", "sidebars", "hotkeys", "plugins/page-preview/data", "plugins/terminal/data", "plugins/history/data", "plugins/activity/data"]
  const before = Object.fromEntries(NAMES.map((n) => [n, conf(n)]))
  const slot1 = async () => (await api("GET", "workspaces"))[1].workspaces[0]
  const deskBefore = await slot1()

  let [code, r] = await api("GET", "bundles")
  check("bundles: the app's six, readable", ["minimal", "pages", "life-os", "agent-cockpit", "self-hosted", "everything"].every((id) => r.bundles.some((b: Any) => b.id === id && b.source === "app" && !b.problems.length)), r.bundles)
  check("bundles: three up front, the rest under More", r.bundles.filter((b: Any) => b.source === "app" && !b.more).map((b: Any) => b.id).join() === "minimal,life-os,agent-cockpit", r.bundles.map((b: Any) => [b.id, b.more]))
  ;[code, r] = await api("GET", "bundles/pages?workspace=1")
  const plan = r.plan
  check("bundles: the preview says what changes", code === 200 && plan.plugins.off.includes("today") && plan.settings.some((s: Any) => s.plugin === "page-preview" && s.key === "trigger" && s.to === "hover") &&
    plan.pins.list.join() === "Dashboards/Home.md,Dashboards/Projects.md,People/Alice Park.md" && plan.pins.workspace?.join() === plan.pins.list.join() && plan.panels.workspace === 1 &&
    plan.files.add.includes("Dashboards/Home.md") && !plan.empty, plan)
  ;[code, r] = await api("POST", "bundles/pages/apply", { workspace: 1 })
  check("bundles: apply", code === 200 && r.applied === "Pages and databases", r)
  const pj = conf("plugins"), look = conf("appearance")
  check("bundles: plugins.json keeps its other keys", pj.collapsedCategories?.[0] === "core:navigation" && pj.order?.[0] === "people" && !pj.enabled.includes("today") && pj.enabled.includes("books"), pj)
  check("bundles: appearance keeps the keys the bundle doesn't set; one it sets to the default is removed", look.textFont === "Georgia" && !("theme" in look) && look.scheme === "paper" &&
    look.density === "comfortable", look)
  check("bundles: a plugin's settings: the key set, the others kept", JSON.stringify(conf("plugins/page-preview/data")) === JSON.stringify({ delay: 300, trigger: "hover" }), conf("plugins/page-preview/data"))
  check("bundles: pins are the bundle's, then the user's own; a plugin's page it doesn't pin is unpinned", conf("pages").pinned.join() === "Dashboards/Home.md,Dashboards/Projects.md,People/Alice Park.md", conf("pages"))
  check("bundles: its dashboard is added", exists("Dashboards/Home.md") && read("Dashboards/Home.md").includes("block-query"))
  check("bundles: sidebars.json is the bundle's", JSON.stringify(conf("sidebars").left) === JSON.stringify(["search:search", "pages:pages", "files:files"]), conf("sidebars"))
  let d = await slot1()
  check("bundles: the current workspace follows: its own panels go, its pins get the same edits, the rest stays", d.name === "Desk" && !d.sidebars && d.pinned?.join() === "Dashboards/Home.md,Dashboards/Projects.md,People/Alice Park.md", d)
  ;[, s] = await api("GET", "state")
  check("bundles: /api/state says what can be restored", s.bundles?.previous?.name === "Pages and databases" && s.bundles.onboarding === false, s.bundles)
  ;[, r] = await api("GET", "bundles/pages?workspace=1")
  check("bundles: applied again it changes nothing", r.plan.empty === true, r.plan)
  ;[code, r] = await api("POST", "bundles/restore")
  check("bundles: restore", code === 200 && r.restored === "Pages and databases" && r.trashed.includes("Dashboards/Home.md"), r)
  const after = Object.fromEntries(NAMES.map((n) => [n, conf(n)]))
  check("bundles: apply then restore is a round trip (every settings file as it was, absent ones absent)", JSON.stringify(after) === JSON.stringify(before),
    NAMES.filter((n) => JSON.stringify(after[n]) !== JSON.stringify(before[n])).map((n) => [n, before[n], after[n]]))
  d = await slot1()
  check("bundles: the workspace is as it was", JSON.stringify({ n: d.name, s: d.sidebars, p: d.pinned }) === JSON.stringify({ n: deskBefore.name, s: deskBefore.sidebars, p: deskBefore.pinned }), [d, deskBefore])
  check("bundles: the dashboard it added is in the trash, and nothing to restore any more", !exists("Dashboards/Home.md") && !exists(".vaultite/bundles/previous.json"))
  ;[code] = await api("POST", "bundles/restore")
  check("bundles: restore twice is a 404", code === 404, code)

  // A bundle of the user's that brings a vault plugin (runs code) and tries to set a `local` setting.
  write(".vaultite/bundles/coder/bundle.json", JSON.stringify({ name: "Coder" }))
  write(".vaultite/bundles/coder/plugins.json", JSON.stringify({ enabled: ["hello"] }))
  write(".vaultite/bundles/coder/plugins/hello/manifest.json", JSON.stringify({ id: "hello", name: "Hello", description: "Says hello", category: "other" }))
  write(".vaultite/bundles/coder/plugins/terminal/data.json", JSON.stringify({ allowRemote: false, allowUsers: ["x@example.com"] }))
  ;[code, r] = await api("GET", "bundles/coder")
  check("bundles: a local setting is skipped, never set", r.plan.skipped.length === 2 && !r.plan.settings.length && r.plan.code[0]?.id === "hello", r.plan)
  ;[code, r] = await api("POST", "bundles/coder/apply", {})
  check("bundles: code needs allowCode", code === 409 && !exists(".vaultite/plugins/hello/manifest.json"), [code, r])
  ;[code] = await api("POST", "bundles/coder/apply", { allowCode: true })
  check("bundles: with allowCode, the vault plugin is copied in and turned on", code === 200 && exists(".vaultite/plugins/hello/manifest.json") && conf("plugins").enabled.includes("hello") &&
    conf("plugins/terminal/data").allowRemote === true, conf("plugins"))
  const hello = ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "hello")
  check("bundles: a vault plugin it brought with allowCode is allowed on this machine", hello?.loaded && !hello.approval, hello)
  ;[code] = await api("POST", "bundles/restore")
  check("bundles: restored, the plugin is off and its folder in the trash", code === 200 && !exists(".vaultite/plugins/hello") && !(conf("plugins").enabled ?? []).includes("hello"), conf("plugins"))

  // Save the current setup, export, import, delete.
  ;[code, r] = await api("POST", "bundles", { name: "My desk", workspace: 1 })
  const saved = (f: string) => { try { return JSON.parse(read(`.vaultite/bundles/my-desk/${f}`)) } catch { return null } }
  check("bundles: save writes the user's bundle", code === 200 && r.bundle.id === "my-desk" && saved("bundle.json")?.name === "My desk", r)
  check("bundles: saved: plugins, the workspace's pins, settings that differ from their defaults, never local ones", saved("plugins.json")?.disabled?.includes("recent") &&
    saved("pages.json")?.pinned?.join() === deskBefore.pinned.join() && saved("plugins/page-preview/data.json")?.delay === 300 && saved("plugins/terminal/data.json") === null &&
    saved("appearance.json")?.scheme === "nord" && saved("hotkeys.json") === null, fs.readdirSync(path.join(VAULT, ".vaultite/bundles/my-desk"), { recursive: true }))
  ;[code, r] = await api("GET", "bundles/my-desk/export")
  const exported = JSON.parse(r)
  check("bundles: export is one JSON file", code === 200 && exported.vaultite === "bundle" && exported.files["plugins.json"].disabled.includes("recent"), exported)
  ;[code, r] = await api("POST", "bundles/import", exported)
  check("bundles: import adds it under a free id", code === 200 && r.bundle.id === "my-desk-2" && exists(".vaultite/bundles/my-desk-2/pages.json"), r)
  ;[code, r] = await api("POST", "bundles/import", { vaultite: "bundle", files: { "../x.json": "{}" } })
  check("bundles: an import with a bad path is refused", code === 400, [code, r])
  ;[code] = await api("DELETE", "bundles/my-desk-2")
  check("bundles: delete one of yours (to the trash)", code === 200 && !exists(".vaultite/bundles/my-desk-2"))
  ;[code] = await api("DELETE", "bundles/life-os")
  check("bundles: the app's can't be deleted", code === 400, code)
}

// Binary formats (Spreadsheets, Documents, Presentations, E-books): their text for /api/render and search, from made-up
// files (tools/fixtures/formats/make.ts); and files from outside the vault, only once the desktop app allowed them.
{
  const fx = await import("./fixtures/formats/make.ts")
  const { docxMarkdown } = await import("../plugins/core/documents/plugin.ts")
  const { deckMarkdown } = await import("../plugins/core/presentations/plugin.ts")
  const { epubMarkdown } = await import("../plugins/core/ebooks/plugin.ts")
  const { workbookMarkdown } = await import("../plugins/core/spreadsheets/plugin.ts")
  const { unzip, xmlDecode } = await import("../core/unzip.ts")
  const O = await import("../core/outside.ts")

  check("unzip: entries of a zip held in memory", [...unzip(fx.epub()).keys()].includes("OEBPS/content.opf"))
  check("xmlDecode: named and numeric entities", xmlDecode("a &amp; b &#233; &#x2014; &lt;i&gt; &bogus;") === "a & b é — <i> &bogus;")
  const doc = docxMarkdown(fx.docx())
  check("docx: title and headings, list items together, a table, tabs; deleted text left out",
    doc.startsWith("# Lighthouse lease\n\n# Terms\n\nThe tenant gives 60 days' notice & pays on the 1st.\n\n- Keys returned\n- Walls repainted") &&
    doc.includes("| Item | Cost |\n| --- | --- |\n| Deposit | 1200 |") && doc.includes("Signed by Alice Park\tand Bob Lee") && !doc.includes("struck"), doc)
  const deck = deckMarkdown(fx.pptx())
  check("pptx: slides in the deck's order, with their notes (not the slide number)",
    deck === "## Slide 1\n\nLighthouse pitch\n\nQ3 & beyond\n\nNotes: Open with the storm story\n\n## Slide 2\n\nRoadmap\n\nShip the lighthouse beacon", deck)
  const book = epubMarkdown(fx.epub())
  check("epub: title, author, chapters in the spine's order, no scripts",
    book.startsWith("# The keeper's log\n\nBy Alice Park\n\n# The storm\n\nThe lamp burned all night & the gulls slept.\n\n# Morning") && !book.includes("alert"), book)
  const sheet = workbookMarkdown(fx.xlsx())
  check("xlsx: each sheet a table, values as Excel shows them",
    sheet.includes("## Budget\n| Item | Amount |\n| --- | --- |\n| Lamp oil | $42.50 |") && sheet.includes("## Visitors") && sheet.includes("| Bob Lee | Monday |"), sheet)

  fs.mkdirSync(path.join(VAULT, "Shelf"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, "Shelf/Lease.docx"), fx.docx())
  fs.writeFileSync(path.join(VAULT, "Shelf/Pitch.pptx"), fx.pptx())
  fs.writeFileSync(path.join(VAULT, "Shelf/Log.epub"), fx.epub())
  fs.writeFileSync(path.join(VAULT, "Shelf/Budget.xlsx"), fx.xlsx())
  fs.writeFileSync(path.join(VAULT, "Shelf/Broken.docx"), "not a zip")
  let [code, txt] = await api("GET", "render?path=Shelf/Lease.docx")
  check("render: a Word document as its text", code === 200 && txt.includes("# Lease") && txt.includes("| Deposit | 1200 |"), txt)
  ;[code, txt] = await api("GET", "render?path=Shelf/Budget.xlsx")
  check("render: a workbook's sheets", code === 200 && txt.includes("| Lamp oil | $42.50 |"), txt)
  ;[, txt] = await api("GET", "render?path=Shelf/Broken.docx")
  check("render: a broken file says so", /couldn't be read/.test(txt), txt)
  fs.writeFileSync(path.join(VAULT, "Shelf/Note.md"), "# Shelf\n\n![[Pitch.pptx]]\n")
  ;[, txt] = await api("GET", "render?path=Shelf/Note.md")
  check("render: ![[Pitch.pptx]] in a note is the deck's text", txt.includes("Ship the lighthouse beacon"), txt)
  let hits: Any
  ;[, hits] = await api("GET", "search?q=harbour")
  check("search: finds a book's text", hits.some((h: Any) => h.path === "Shelf/Log.epub"), hits)
  ;[, hits] = await api("GET", "search?q=Deposit")
  check("search: finds a Word document's table", hits.some((h: Any) => h.path === "Shelf/Lease.docx"), hits)
  ;[, hits] = await api("GET", "search?q=beacon")
  check("search: finds a slide's text", hits.some((h: Any) => h.path === "Shelf/Pitch.pptx"), hits)
  // Off, a plugin's files aren't read.
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: [...(conf("plugins").disabled ?? []), "documents"] }, null, 2) + "\n")
  ;[, hits] = await api("GET", "search?q=Deposit")
  check("search: a plugin off reads nothing", !hits.some((h: Any) => h.path === "Shelf/Lease.docx"), hits)
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: (conf("plugins").disabled ?? []).filter((x: string) => x !== "documents") }, null, 2) + "\n")

  // Outside the vault: nothing until allowed; then its info (and, in server.ts, its bytes).
  const out = path.join(tmp, "elsewhere", "Plan.pdf")
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, "%PDF-1.4 made up")
  ;[code] = await api("GET", `file/info?path=${out}`)
  check("outside: a file not allowed is a 404", code === 404, code)
  O.allow([out])
  let info: Any
  ;[code, info] = await api("GET", `file/info?path=${out}`)
  check("outside: an allowed file's info", code === 200 && info.kind === "pdf" && info.size === 16, info)
  check("outside: allowedPath only for allowed files", O.allowedPath(out) === out && (() => { try { O.allowedPath(path.join(tmp, "x.pdf")); return false } catch { return true } })())
  fs.writeFileSync(out.replace(".pdf", ".bin"), Buffer.from([0x41, 0, 0x42]))
  O.allow([out.replace(".pdf", ".bin")])
  ;[code] = await api("GET", `file?path=${out.replace(".pdf", ".bin")}`)
  check("outside: a binary file isn't read as text", code === 415, code)
}

// Events (core/events.ts): the bus, its filters and cursors, the core's own (file.changed from core/live.ts, file.moved,
// op.done), the op events.wait, `vau events`, the SSE stream, and plugin.onEvent.
{
  const { Events, eventsOf, matching, stream, summary } = await import("../core/events.ts")
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

// Vault plugins with no code in the server (core/hooks.ts): the made-up Word count (tools/fixtures/wordcount): its
// manifest's ops (commands), an event hook and a startup command, their environment, log and checks.
{
  const { eventsOf } = await import("../core/events.ts")
  const { hookProblems } = await import("../core/hooks.ts")
  const WC = ".vaultite/plugins/wordcount"
  fs.cpSync(path.join(import.meta.dirname, "fixtures", "wordcount"), path.join(VAULT, WC), { recursive: true })
  // (two more ops, for the tests: the environment, and a command that fails)
  const m = JSON.parse(read(`${WC}/manifest.json`))
  m.ops.push({ id: "wordcount.env", summary: "Its environment (a test's).", kind: "read", command: ["node", "-e",
    "const e = process.env; let i = ''; process.stdin.on('data', (d) => i += d).on('end', () => console.log(JSON.stringify({ id: e.VAULTITE_PLUGIN_ID, dir: e.VAULTITE_PLUGIN_DIR, state: e.VAULTITE_PLUGIN_STATE, bin: e.VAULTITE_BIN, url: e.VAULTITE_URL, vault: e.VAULTITE_VAULT, op: e.VAULTITE_OP, params: e.VAULTITE_PARAMS_JSON, stdin: i, cwd: process.cwd() })))"],
    params: { n: { type: "integer", default: 2, description: "a number" } } })
  m.ops.push({ id: "wordcount.fail", summary: "Fails (a test's).", kind: "write", command: ["node", "-e", "console.error('first'); console.error('the reason'); process.exit(3)"] })
  m.ops.push({ id: "wordcount.slow", summary: "Too slow (a test's).", kind: "read", timeout: 0.3, command: ["node", "-e", "setTimeout(() => {}, 5000)"] })
  write(`${WC}/manifest.json`, JSON.stringify(m, null, 2))
  const vp = async () => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "wordcount")
  let wc = await vp()
  check("hooks: a plugin of only a manifest and commands is listed, off", wc && !wc.on && !wc.problems.length && !app.catalog().some((e) => e.id === "wordcount.count"), wc)
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...(vault.config("plugins").enabled ?? []), "wordcount"] })
  wc = await vp()
  check("hooks: on in the vault alone, none of its commands run until it's allowed here", !wc.loaded && wc.approval && !app.catalog().some((e) => e.id === "wordcount.count"), wc)
  await api("POST", "ops/plugin.allow", { id: "wordcount", edits: true })
  wc = await vp()
  const entry = app.catalog().find((e) => e.id === "wordcount.count")
  check("hooks: on, its ops are in the catalog, with their CLI and MCP names", wc.loaded && entry?.plugin === "wordcount" && entry.cli === "words" && entry.mcp === "wordcount_count", [wc, entry])
  check("hooks: its docs list its ops", (await api("GET", "docs/wordcount"))[1].includes("### wordcount.count"))
  write("Notes/Count me.md", "---\ntype: note\n---\n\none two three\n")
  let [st, body] = await api("POST", "ops/wordcount.count", { folder: "Notes" })
  check("hooks: an op runs its command, its JSON is the answer", st === 200 && body.folder === "Notes" && body.files >= 1 && body.words >= 3, [st, body])
  const cr = await vau("words", "Notes")
  check("hooks: by its CLI name", cr.code === 0 && cr.out.includes("\"words\""), cr)
  ;[st, body] = await api("POST", "ops/wordcount.count", { folder: "Nowhere" })
  check("hooks: a non-zero exit is the op's error, with stderr", st === 500 && body.error.includes("exit 1") && body.error.includes("there's no folder Nowhere"), [st, body])
  ;[st, body] = await api("POST", "ops/wordcount.env", { n: "5" })
  const local = process.env.VAULTITE_LOCAL!
  check("hooks: its environment and stdin (checked params), in its folder", st === 200 && body.id === "wordcount" && body.dir === path.join(VAULT, WC) && body.cwd === fs.realpathSync(path.join(VAULT, WC)) &&
    body.state.startsWith(path.join(local, "plugin-state")) && fs.existsSync(body.state) && fs.existsSync(body.bin) && body.bin.endsWith("bin/vau") && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.url) &&
    body.vault === VAULT && body.op === "wordcount.env" && body.params === "{\"n\":5}" && body.stdin === "{\"n\":5}", body)
  ;[st, body] = await api("POST", "ops/wordcount.changed?as=text", {})
  check("hooks: text that isn't JSON is the answer and its text", st === 200 && typeof body === "string" && !body.includes("```"), [st, body])
  ;[st, body] = await api("POST", "ops/wordcount.fail", {})
  check("hooks: stderr's last lines say why it failed; a write's failure is op.done too", st === 500 && /exit 3\): first\nthe reason$/.test(body.error) && eventsOf(vault).last({ types: ["op.done"] }, 1)[0].id === "wordcount.fail", body)
  check("hooks: a manifest op never holds the vault (its command writes through the API)", app.ops().find((o) => o.op.id === "wordcount.fail")?.op.lock === false)
  ;[st, body] = await api("POST", "ops/wordcount.slow", {})
  check("hooks: a command past its timeout is ended", st === 504 && body.error.includes("longer than 0.3 s"), [st, body])
  const tools = (await import("../plugins/core/mcp/catalog.ts")).toolsOf(app.catalog())
  check("hooks: an op marked mcp is a tool", tools.some((t) => t.name === "wordcount_count" && t.annotations.readOnlyHint === true))

  // Startup ran once it was on; an event hook runs on a matching event (and not on others).
  const state = body && path.join(local, "plugin-state", fs.readdirSync(path.join(local, "plugin-state"))[0], "wordcount")
  for (let i = 0; i < 100 && !fs.existsSync(path.join(state, "started.json")); i++) await sleep(20)
  check("hooks: startup ran once it was on", fs.existsSync(path.join(state, "started.json")) && JSON.parse(fs.readFileSync(path.join(state, "started.json"), "utf8")).url.startsWith("http://"))
  eventsOf(vault).emit("file.changed", { paths: ["People/Alice Park.md"] })
  eventsOf(vault).emit("file.changed", { paths: ["Notes/Count me.md", "People/Alice Park.md"] })
  for (let i = 0; i < 100 && !fs.existsSync(path.join(state, "changed.txt")); i++) await sleep(20)
  await sleep(50)
  check("hooks: an event hook gets the matching event (its paths narrowed) on stdin", fs.existsSync(path.join(state, "changed.txt")) && fs.readFileSync(path.join(state, "changed.txt"), "utf8") === "Notes/Count me.md\n",
    fs.existsSync(path.join(state, "changed.txt")) && fs.readFileSync(path.join(state, "changed.txt"), "utf8"))
  ;[st, body] = await api("POST", "ops/wordcount.changed?as=text", {})
  check("hooks: what it kept, through its op", body === "- Notes/Count me.md", body)
  ;[st, body] = await api("POST", "ops/vault-plugin.log?as=text", { id: "wordcount" })
  check("hooks: every run is logged (vault-plugin.log)", st === 200 && body.includes("startup: `node started.mjs` exit 0") && body.includes("event file.changed: `node note-changed.mjs` exit 0") &&
    body.includes("wordcount.fail") && body.includes("the reason") && body.includes("timed out after 0.3 s"), body)

  // Checked before it loads: commands are argv arrays, inside its folder; ops in its area; known keys.
  const dir = path.join(VAULT, WC)
  const probs = hookProblems({ id: "wordcount", ops: [
    { id: "other.thing", summary: "x", kind: "read", command: ["node", "count.mjs"] },
    { id: "wordcount.shell", summary: "x", kind: "read", command: "node count.mjs" },
    { id: "wordcount.up", summary: "x", kind: "write", command: ["../../escape.sh"] },
    { id: "wordcount.nope", summary: "x", kind: "maybe", command: ["./missing.sh"], params: { x: { type: "string" } }, extra: 1 },
  ], events: [{ on: "File Changed", command: ["node"] }], startup: [["node", "x.mjs"]] }, dir)
  const has = (s: string) => probs.some((p) => p.includes(s))
  check("hooks: the manifest's problems", has("'other.thing' should start with 'wordcount.'") && has("argv array of strings") && has("outside the plugin's folder") && has("isn't in the plugin's folder") &&
    has("kind is read, write or destructive") && has("param 'x' has no description") && has("'extra' isn't a key of an op") && has("events[0]: on is an event type") && has("startup[0] must be"), probs)
  check("hooks: the fixture has none", hookProblems(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "wordcount", "manifest.json"), "utf8")), path.join(import.meta.dirname, "fixtures", "wordcount")).length === 0)
  m.ops.push({ id: "wordcount.bad", summary: "x", kind: "read", command: "rm -rf /" })
  write(`${WC}/manifest.json`, JSON.stringify(m, null, 2))
  wc = await vp()
  check("hooks: a bad command keeps the plugin from loading, saying why", !wc.loaded && wc.problems.some((p: string) => p.includes("ops[5]: command must be an argv array")) && !app.catalog().some((e) => e.plugin === "wordcount"), wc.problems)
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: (vault.config("plugins").enabled ?? []).filter((x: string) => x !== "wordcount") })
}

// Jobs on a timer (core/schedule.ts): when they're due, a manifest's `schedule` (a command, an op) and plugin.every.
{
  const { nextRun, Scheduler, whenProblems } = await import("../core/schedule.ts")
  const { hookProblems } = await import("../core/hooks.ts")
  const at = (s: string) => new Date(s).getTime() // (local time)
  check("schedule: an interval is due at once the first time, then a period after its last run",
    nextRun({ every: "15m" }, { seen: 5 }) === 5 && nextRun({ every: "15m" }, { seen: 5, ran: 1000 }) === 1000 + 900_000)
  check("schedule: an `at` job waits for its next slot, then the one a period after the slot it ran for",
    nextRun({ every: "1d", at: "07:00" }, { seen: at("2026-03-02T09:00") }) === at("2026-03-03T07:00") &&
    nextRun({ every: "1d", at: "07:00" }, { seen: 0, for: at("2026-03-02T07:00") }) === at("2026-03-03T07:00") &&
    nextRun({ every: "1w", at: "07:00" }, { seen: 0, for: at("2026-03-02T07:00") }) === at("2026-03-09T07:00"))
  check("schedule: timings are checked", whenProblems({ every: "soon" }).length === 1 && whenProblems({ every: "2h", at: "07:00" })[0]?.includes("whole days") &&
    whenProblems({ every: "1d", at: "7am" }).length === 1 && !whenProblems({ every: "1d", at: "07:00", machine: "home" }).length)

  // A scheduler of its own: due jobs run once at a time, a missed `at` slot runs once (not once per missed day).
  const file = path.join(tmp, "sched.json"), ran: string[] = []
  let gate: () => void = () => {}, slows = 0
  const jobs = [{ plugin: "p", job: { name: "fast", every: "1h", run: () => { ran.push("fast") } } },
    { plugin: "p", job: { name: "daily", every: "1d", at: "07:00", run: () => { ran.push("daily") } } },
    { plugin: "p", job: { name: "elsewhere", every: "1m", machine: "other", run: () => { ran.push("elsewhere") } } },
    { plugin: "p", job: { name: "slow", every: "1m", run: () => { ran.push("slow"); return slows++ ? undefined : new Promise<void>((r) => { gate = r }) } } },
    { plugin: "p", job: { name: "broken", every: "1h", run: () => { ran.push("broken"); throw new Error("no network") } } }]
  const s = new Scheduler({ file, jobs: () => jobs, here: async (m) => !m })
  const t0 = at("2026-03-02T09:00")
  const slow = s.tick(t0)
  await sleep(10)
  check("schedule: intervals run at once, an `at` job waits, another machine's doesn't run here", ran.sort().join() === "broken,fast,slow", ran)
  ran.length = 0
  await s.tick(t0 + 120_000)
  check("schedule: a job still running isn't started again", !ran.includes("slow") && !ran.length, ran)
  gate()
  await slow
  await s.tick(at("2026-03-05T12:00")) // (three days later)
  check("schedule: after days away each runs once; the missed slot once", ran.sort().join() === "broken,daily,fast,slow", ran)
  ran.length = 0
  await s.tick(at("2026-03-05T12:30"))
  check("schedule: and not again before they're due", ran.join() === "slow", ran)
  const rows = await new Scheduler({ file, jobs: () => jobs, here: async (m) => !m }).list(at("2026-03-05T12:31"))
  const row = (n: string) => rows.find((r) => r.name === n)!
  check("schedule: last runs are kept on this machine (a new scheduler reads them), with errors", row("broken").error === "no network" && row("daily").next === new Date(at("2026-03-06T07:00")).toISOString() &&
    row("elsewhere").next === null && row("elsewhere").here === false, rows)

  // A vault plugin's manifest: a command and an op on a timer, run by the app's scheduler; plugin.every and plugin.around.
  const WC = ".vaultite/plugins/wordcount"
  const m = JSON.parse(read(`${WC}/manifest.json`))
  m.ops = m.ops.filter((o: Any) => o.id !== "wordcount.bad")
  m.schedule = [{ name: "tick", every: "1h", command: ["node", "-e", "require('fs').writeFileSync(process.env.VAULTITE_PLUGIN_STATE + '/tick.txt', process.env.VAULTITE_SCHEDULE)"] },
    { every: "1d", at: "07:00", op: "note.create", params: { title: "Morning" } },
    { name: "now", every: "1m", op: "note.create", params: { title: "Scheduled note", body: "From a schedule." } }]
  write(`${WC}/manifest.json`, JSON.stringify(m, null, 2))
  write(".vaultite/plugins/guard/manifest.json", JSON.stringify({ id: "guard", name: "Guard", description: "A test's middleware.", apiVersion: 1 }))
  write(".vaultite/plugins/guard/plugin.ts", `import { OpError, Plugin } from "@vaultite/core/plugins.ts"
export const plugin = new Plugin(import.meta.url)
plugin.around("*", () => { throw new Error("a bug") })
plugin.around("note.create", async ({ params, who }, next) => {
  if (params.title === "Forbidden") throw new OpError("not that one")
  return next({ ...params, title: params.title.replace("Olympicos", "Olimpicos"), body: \`\${params.body ?? ""} (\${who.source})\` })
})
plugin.around(["ops.list"], async (_call, next) => ((await next()) as unknown[]).slice(0, 1))
plugin.every("beat", { every: "2h" }, () => { plugin.saveSettings({ beat: true }) })
plugin.every("gone", { every: "1h" }, () => {})
plugin.every("gone", null)
`)
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...(vault.config("plugins").enabled ?? []), "wordcount", "guard"] })
  await api("POST", "ops/plugin.allow", { id: "guard" })
  const [, plugins] = await api("GET", "plugins")
  check("schedule: the plugins load", ["wordcount", "guard"].every((id) => (plugins as Any[]).find((p) => p.id === id)?.loaded), (plugins as Any[]).filter((p) => ["wordcount", "guard"].includes(p.id)))
  await app.scheduler.tick()
  const state = path.join(process.env.VAULTITE_LOCAL!, "plugin-state", fs.readdirSync(path.join(process.env.VAULTITE_LOCAL!, "plugin-state"))[0], "wordcount")
  check("schedule: a manifest's command ran, told which", fs.existsSync(path.join(state, "tick.txt")) && fs.readFileSync(path.join(state, "tick.txt"), "utf8") === "tick")
  await vault.synced()
  check("schedule: a manifest's op ran, as a schedule (the middleware saw who)", fs.existsSync(path.join(VAULT, "Notes/Scheduled note.md")) && read("Notes/Scheduled note.md").includes("From a schedule. (schedule)"), fs.existsSync(path.join(VAULT, "Notes/Scheduled note.md")) && read("Notes/Scheduled note.md"))
  check("schedule: plugin.every ran", vault.config("plugins/guard/data").beat === true)
  let [st, body] = await api("POST", "ops/schedule.list", {})
  const ids = (body as Any[]).map((r) => r.id)
  check("schedule: schedule.list has every job, with when it last ran and next runs", st === 200 && ["wordcount/tick", "wordcount/note.create", "wordcount/now", "guard/beat"].every((i) => ids.includes(i)) && !ids.includes("guard/gone") &&
    (body as Any[]).find((r) => r.id === "wordcount/note.create").ran === null && (body as Any[]).find((r) => r.id === "wordcount/tick").ran !== null, body)
  ;[st, body] = await api("POST", "ops/schedule.run", { id: "wordcount/note.create" })
  check("schedule: schedule.run runs one now", st === 200 && body === null && fs.existsSync(path.join(VAULT, "Notes/Morning.md")), [st, body])
  const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
  check("schedule: only this machine's owner may run a job", await app.runOp("schedule.run", { id: "guard/beat" }, { http: stranger }).then(() => false, (e) => e.status === 403))
  const probs = hookProblems({ id: "wordcount", schedule: [{ every: "1x", command: ["node"] }, { every: "1h" }, { every: "1h", op: "Bad", extra: 1 }, { every: "1h", op: "a.b" }, { every: "2h", op: "a.b" }] }, path.join(VAULT, WC))
  const has = (x: string) => probs.some((p) => p.includes(x))
  check("schedule: a manifest's schedule is checked", has("schedule[0]: every is") && has("schedule[1]: give it a command or an op") && has("op is an operation's id") && has("'extra' isn't a key") && has("'a.b' is there twice"), probs)

  // Middleware over ops (plugin.around): rewrite, refuse, answer; one that throws by mistake is skipped.
  ;[st, body] = await api("POST", "ops/note.create", { title: "Olympicos trip", body: "Plans." })
  check("around: rewrites an op's params (checked again), the op runs with them", st === 200 && fs.existsSync(path.join(VAULT, "Notes/Olimpicos trip.md")) && read("Notes/Olimpicos trip.md").includes("Plans. (api)"), [st, body])
  ;[st, body] = await api("POST", "ops/note.create", { title: "Forbidden" })
  check("around: refuses with an OpError", st === 400 && body.error === "not that one" && !fs.existsSync(path.join(VAULT, "Notes/Forbidden.md")), [st, body])
  ;[st, body] = await api("POST", "ops/ops.list", {})
  check("around: changes an op's answer", Array.isArray(body) && body.length === 1, body)
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: (vault.config("plugins").enabled ?? []).filter((x: string) => x !== "guard" && x !== "wordcount") })
  ;[st, body] = await api("POST", "ops/ops.list", {})
  check("around: only while its plugin is on; jobs too", Array.isArray(body) && body.length > 1 && !(await app.scheduler.list()).some((r) => r.plugin === "guard"), body)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/guard"), { recursive: true })
  for (const n of ["Scheduled note", "Morning", "Olimpicos trip"]) fs.rmSync(path.join(VAULT, `Notes/${n}.md`), { force: true })
}

// Ops keep the request they came in: the routes they call see it, so owner-only routes and ops refuse anyone else.
{
  const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
  const refused = async (id: string, params: Any) => app.runOp(id, params, { http: stranger }).then(() => "ran", (e) => (e.status === 403 ? "refused" : `error ${e.status}: ${e.message}`))
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/terminal/data.json"), "{}\n") // (a test above let anyone in)
  const t = await refused("terminal.list", {})
  check("ops: an owner-only op is refused to someone else on the tailnet", t === "refused", t)
  check("ops: an op whose route only the owner may use is refused the same (the request goes with ctx.api)", await refused("inbox.clear", {}) === "refused")
  check("ops: in-process (no request) nothing is refused", (await app.runOp("ops.list", {})).result !== undefined)
  // MCP lets a login the owner allowed (allowUsers) in, and its tools run for that request: the owner's ops stay refused.
  write(".vaultite/plugins/mcp/data.json", JSON.stringify({ allowUsers: ["stranger@example.com"] }) + "\n")
  await vault.synced()
  const viaMcp = async (name: string, args: Any) => {
    const served = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "127.0.0.1" } } as Any // (through Tailscale Serve)
    const r = await app.run("POST", ["mcp"], {}, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, served)
    return r.status === 200 ? JSON.parse((r.body as Any).text).result : { status: r.status, body: r.body }
  }
  const listed = await viaMcp("docs", {})
  check("mcp: a login allowUsers names gets in (its tools run)", listed.isError === false, listed)
  const term = await viaMcp("call", { id: "terminal.list" })
  check("mcp: an owner-only op through MCP is refused to that login (the MCP request goes with the op)", term.isError === true && /owner|only/i.test(term.content[0].text), term)
  const inbox = await viaMcp("call", { id: "inbox.clear" })
  check("mcp: and an op whose route only the owner may use", inbox.isError === true, inbox)
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/mcp/data.json"))
}

// Token count: each Markdown file against its limit, and what a CLAUDE.md loads with its @imports (token-count/plugin.ts).
{
  write("Size/CLAUDE.md", "Short.\n@rules.md and @./deep/a.md\n`@code.md`, @alice, @~/elsewhere.md, @gone.md.\n\n```\n@fenced.md\n```\n")
  write("Size/rules.md", "word ".repeat(1500) + "\n@CLAUDE.md\n")
  write("Size/deep/a.md", "@../rules.md\nThe end.\n")
  write("Size/code.md", "Not imported.\n")
  write("Size/Long.md", "---\nmax_tokens: 100\n---\n" + "word ".repeat(200))
  write(".claude/skills/demo/SKILL.md", "word ".repeat(6000))
  await vault.synced()
  const sized = async (params: Any) => { const { op, params: p, result } = await app.runOp("token-count.size", params); return { r: result as Any, text: op.text!(result, p) } }
  const { r, text } = await sized({})
  const root = r.files.find((s: Any) => s.path === "Size/CLAUDE.md")
  check("token-count: a CLAUDE.md's chain follows its imports (relative ones too), once each, not in code or fences", root?.chain.map((c: Any) => c.path).join() === "Size/rules.md,Size/deep/a.md"
    && root.total === root.tokens + root.chain.reduce((n: number, c: Any) => n + c.tokens, 0), root)
  check("token-count: imports outside the vault and missing ones are named, a mention isn't", root?.outside?.join() === "~/elsewhere.md" && root?.missing?.join() === "gone.md", root)
  check("token-count: a file's own max_tokens is its limit", r.files.find((s: Any) => s.path === "Size/Long.md")?.level === "over")
  check("token-count: agent files in hidden folders count (a skill over 5k)", r.files.find((s: Any) => s.path === ".claude/skills/demo/SKILL.md")?.limit === 5000)
  check("token-count: the text says what's over", /Over their limit[\s\S]*Size\/Long\.md[\s\S]*Loaded at startup[\s\S]*@Size\/rules\.md/.test(text), text)
  const st = (await app.state()).tokenCount
  check("token-count: the app gets the flagged files and the chains, not every file", st.files.some((s: Any) => s.path === "Size/CLAUDE.md") && !st.files.some((s: Any) => s.path === "Size/code.md") && st.limits.limits["CLAUDE.md"] === 3000, st)
  const one = await sized({ path: path.join(VAULT, "Size/Long.md"), over: true })
  check("token-count: an absolute path inside the vault (a hook's) answers that file", one.r.files.length === 1 && one.text.startsWith("Over its limit:"), one)
  check("token-count: --over says nothing for a file under its limit or outside the vault", (await sized({ path: "Size/code.md", over: true })).text === ""
    && (await sized({ path: "/etc/hosts", over: true })).text === "")
  write(".vaultite/plugins/token-count/data.json", JSON.stringify({ limit: 50, limits: { "Size/deep/*.md": 0 } }) + "\n")
  await vault.synced()
  const set = (await sized({ path: "Size/code.md" })).r.files[0], deep = (await sized({ path: "Size/deep/a.md" })).r.files[0]
  check("token-count: settings change the limits, a pattern of 0 turns one off, the others stay", set.limit === 50 && deep.limit === 0 && deep.level === "ok"
    && (await sized({ path: "Size/CLAUDE.md" })).r.files[0].limit === 3000, [set, deep])
  for (const p of ["Size", ".claude", ".vaultite/plugins/token-count"]) fs.rmSync(path.join(VAULT, p), { recursive: true, force: true })
}

// Plugins from elsewhere (core/installs.ts): installed from a made-up git repo at its newest tag, off until on, updated
// by tag, blocked by the index, uninstalled to the trash; and tools/plugin-index.ts on made-up GitHub. (Signing off: a
// global commit.gpgSign or tag.gpgSign would ask for a key, or a message, in these made-up repos.)
{
  const { execFileSync } = await import("node:child_process")
  const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "init.defaultBranch=main",
    "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { cwd, stdio: "pipe" }).toString()
  const repo = (name: string, files: Record<string, string>, tag: string | null) => {
    const d = path.join(tmp, "repos", name)
    for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t) }
    if (!fs.existsSync(path.join(d, ".git"))) g(d, "init", "-q")
    g(d, "add", "-A"); g(d, "commit", "-q", "-m", "x")
    if (tag) g(d, "tag", tag)
    return d
  }
  const manifest = (o: Any = {}) => JSON.stringify({ id: "harbor", name: "Harbor", description: "A made-up plugin: the harbour's tides.", version: "1.0.0", author: "Alice Park",
    repo: "alicepark/harbor", apiVersion: 1, disclosures: { network: ["tides.example.com"] }, ...o }, null, 2)
  const PLUGIN_TS = 'import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\nplugin.route("GET", "harbor", () => ({ tide: "high" }))\n'
  const HARBOR = repo("harbor", { "manifest.json": manifest(), "plugin.ts": PLUGIN_TS, "AGENTS.md": "## Harbor\n", ".github/workflows/ci.yml": "on: push\n" }, "v1.0.0")
  const harbor = async () => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "harbor")
  let [ic, io] = await api("POST", "ops/plugin.install", { source: HARBOR })
  const lock = () => conf("plugins-lock")
  check("install: from a git repository at its newest version tag, off", ic === 200 && io.id === "harbor" && io.tag === "v1.0.0" && !io.untagged && exists(".vaultite/plugins/harbor/plugin.ts")
    && !(conf("plugins").enabled ?? []).includes("harbor") && !(await harbor()).loaded, [ic, io])
  check("install: only what the app reads is copied (no .git, no hidden files)", !exists(".vaultite/plugins/harbor/.git") && !exists(".vaultite/plugins/harbor/.github"))
  check("install: the lock file says where it came from", lock().harbor?.tag === "v1.0.0" && lock().harbor.version === "1.0.0" && /^[0-9a-f]{40}$/.test(lock().harbor.commit) &&
    lock().harbor.source === HARBOR && lock().harbor.hash === (await harbor()).hash && /^\d{4}-\d\d-\d\d$/.test(lock().harbor.installed), lock())
  const listed = await harbor()
  check("install: its manifest's version, author, repo and disclosures are listed, with its source", listed.version === "1.0.0" && listed.author === "Alice Park" && listed.repo === "alicepark/harbor" &&
    JSON.stringify(listed.disclosures) === '{"network":["tides.example.com"]}' && listed.source?.tag === "v1.0.0", listed)
  ;[ic, io] = await api("POST", "ops/plugin.install", { source: HARBOR })
  check("install: again is refused (update it instead)", ic === 409 && io.error.includes("plugin update"), [ic, io])
  const BADTAG = repo("badtag", { "manifest.json": manifest({ id: "badtag", version: "1.0.0" }) }, "v1.0.1")
  ;[ic, io] = await api("POST", "ops/plugin.install", { source: BADTAG })
  check("install: a version that isn't its tag's is refused, with the problem", ic === 422 && io.problems?.some((p: string) => p.includes("version is 1.0.0, but its tag is v1.0.1")) && !exists(".vaultite/plugins/badtag"), [ic, io])
  const CLASH = repo("clash", { "manifest.json": manifest({ id: "people" }) }, "v1.0.0")
  ;[ic, io] = await api("POST", "ops/plugin.install", { source: CLASH })
  check("install: an app plugin's id is refused", ic === 409 && io.error.includes("one of the app's own plugins"), [ic, io])
  const BADCODE = repo("badcode", { "manifest.json": manifest({ id: "badcode" }), "plugin.ts": 'import "../../../core/app.ts"\n' }, "v1.0.0")
  ;[ic, io] = await api("POST", "ops/plugin.install", { source: BADCODE })
  check("install: a plugin breaking the rules is refused", ic === 422 && io.problems?.some((p: string) => p.includes("its own folder")), [ic, io])
  const NOTAGS = repo("notags", { "manifest.json": manifest({ id: "notags", version: "0.1.0" }) }, null)
  ;[ic, io] = await api("POST", "ops/plugin.install", { source: NOTAGS })
  check("install: no tags at all is the default branch, flagged, followed by commit", ic === 200 && io.untagged && lock().notags?.tag === null && lock().notags.commit, [ic, io, lock().notags])
  const cr = await vau("plugin", "install", `${HARBOR}@v9.9.9`)
  check("install: a tag that isn't there fails, saying so", cr.code === 1 && /git clone/.test(cr.err), cr)
  check("install: plugin.install is gated on the public MCP", (await import("../plugins/core/mcp/public.ts")).gateOf("plugin.install", "write", { source: "a/b" }).includes("install"))

  await vau("plugin", "on", "harbor")
  check("install: turned on by this machine's owner, it's allowed and runs", (await harbor()).loaded && (await api("GET", "harbor"))[1].tide === "high")
  write(".vaultite/plugins/harbor/data.json", JSON.stringify({ mine: 1 }) + "\n")

  // A newer version: v1.1.0 changes plugin.ts and runs programs now.
  repo("harbor", { "manifest.json": manifest({ version: "1.1.0", disclosures: { network: ["tides.example.com"], shell: true } }), "plugin.ts": PLUGIN_TS.replace('"high"', '"low"') }, "v1.1.0")
  let [uc, uo] = await api("POST", "ops/plugin.update", {})
  const row = (uo as Any[])?.find((r) => r.id === "harbor")
  check("update: a newer tag, what it changes (files, disclosures), nothing applied", uc === 200 && row?.to === "1.1.0" && row.tag === "v1.1.0" && !row.applied &&
    row.files.includes("changed plugin.ts") && row.files.includes("changed manifest.json") && row.disclosures.includes("now runs programs on this machine") &&
    lock().harbor.version === "1.0.0" && (await api("GET", "harbor"))[1].tide === "high", uo)
  check("update: one installed without tags and unchanged is up to date", (uo as Any[]).find((r) => r.id === "notags")?.current === true, uo)
  ;[uc, uo] = await api("POST", "ops/plugin.update", { id: "harbor", apply: true })
  let h = await harbor()
  check("update: applied, its files are the new version's, its settings kept, the lock follows", uc === 200 && uo[0].applied && lock().harbor.version === "1.1.0" && lock().harbor.tag === "v1.1.0" &&
    read(".vaultite/plugins/harbor/plugin.ts").includes('"low"') && JSON.parse(read(".vaultite/plugins/harbor/data.json")).mine === 1, [uo, lock().harbor])
  check("update: its code changed, so it waits to be allowed on this machine again", h.on && !h.loaded && h.approval?.state === "changed" && h.approval.changed.includes("plugin.ts") &&
    (await api("GET", "harbor"))[0] === 404, h)
  await api("POST", "ops/plugin.allow", { id: "harbor" })
  check("update: allowed, the new version runs", (await api("GET", "harbor"))[1].tide === "low")
  ;[uc, uo] = await api("POST", "ops/plugin.update", { id: "harbor" })
  check("update: then it's up to date", uo[0].current === true, uo)

  // The directory's index: a local file (VAULTITE_PLUGIN_INDEX), searched, and its blocklist.
  const INDEX = path.join(tmp, "index.json")
  const entry = (o: Any) => ({ name: o.id, description: "Made up.", author: "Bob Lee", repo: `boblee/${o.id}`, version: "1.0.0", tag: "v1.0.0", stars: 1, released: "2026-01-01T00:00:00Z",
    created: "2025-01-01T00:00:00Z", pushed: "2026-01-01T00:00:00Z", issues: { open: 1, closed: 3 }, topics: ["vaultite-plugin"], disclosures: {}, readme: "", score: 10, ...o })
  const writeIndex = (blocked: Any) => fs.writeFileSync(INDEX, JSON.stringify({ format: 1, generated: "2026-10-01T00:00:00Z", blocked, plugins: [
    entry({ id: "harbor", name: "Harbor", repo: "alicepark/harbor", version: "1.2.0", stars: 40, disclosures: { network: ["tides.example.com"], shell: true } }),
    entry({ id: "beacon", name: "Beacon", stars: 90, created: "2024-01-01T00:00:00Z", released: "2025-01-01T00:00:00Z" }),
    entry({ id: "skiff", name: "Skiff", stars: 5, created: "2026-09-01T00:00:00Z", released: "2026-09-30T00:00:00Z", description: "Small boats and their moorings." }),
    { id: "Bad id", repo: "x/y", version: "1.0.0" }, { id: "noversion", repo: "x/y" },
  ] }))
  writeIndex({})
  process.env.VAULTITE_PLUGIN_INDEX = INDEX
  let [sc, so] = await api("POST", "ops/plugin.search", { refresh: true })
  check("index: read, entries that don't read left out, by stars", sc === 200 && so.available && so.plugins.map((e: Any) => e.id).join() === "beacon,harbor,skiff", so)
  check("index: what's installed here, and an update out", so.plugins.find((e: Any) => e.id === "harbor").installed === "1.1.0" && so.plugins.find((e: Any) => e.id === "harbor").update === true &&
    so.plugins.find((e: Any) => e.id === "beacon").installed === null, so.plugins)
  ;[, so] = await api("POST", "ops/plugin.search", { sort: "new" })
  check("index: newest first", so.plugins[0].id === "skiff", so.plugins.map((e: Any) => e.id))
  ;[, so] = await api("POST", "ops/plugin.search", { sort: "updated" })
  check("index: last updated first", so.plugins.map((e: Any) => e.id).join() === "skiff,harbor,beacon", so.plugins.map((e: Any) => e.id))
  ;[, so] = await api("POST", "ops/plugin.search", { q: "moorings" })
  check("index: searched by its words", so.plugins.length === 1 && so.plugins[0].id === "skiff", so.plugins)
  check("index: cached in the vault (live data: .vaultite/cache/)", JSON.parse(read(".vaultite/cache/plugin-index.json")).index.plugins.length === 3)
  let text = (await vau("plugin", "search")).out
  check("index: vau plugin search says what each discloses", text.includes("Harbor (alicepark/harbor) 1.2.0, 40 stars") && text.includes("says it talks to tides.example.com; runs programs on this machine"), text)
  write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: "/etc/hosts" }))
  delete process.env.VAULTITE_PLUGIN_INDEX
  check("index: a vault's setting never reads this machine's files (only http(s); else the directory's)", app.index.url().startsWith("https://raw.githubusercontent.com/"), app.index.url())
  write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: null }))
  process.env.VAULTITE_PLUGIN_INDEX = INDEX

  writeIndex({ "alicepark/harbor": ["<1.2.0"] })
  await app.index.get(true)
  h = await harbor()
  check("blocklist: an installed version it blocks doesn't load, and says why", !h.loaded && h.blocked?.includes("blocks alicepark/harbor 1.1.0") && h.problems.some((p: string) => p.includes("blocks")) &&
    (await api("GET", "harbor"))[0] === 404, h)
  ;[ic, io] = await api("POST", "ops/plugin.install", { source: HARBOR, tag: "v1.0.0" })
  check("blocklist: a blocked version isn't installed", ic === 409, [ic, io])
  writeIndex({ harbor: ["*"] })
  await app.index.get(true)
  check("blocklist: by id, every version", (await harbor()).blocked?.includes("blocks harbor"), await harbor())
  writeIndex({ "alicepark/harbor": [">=1.0.0 <1.1.0", "2.0.0"] })
  await app.index.get(true)
  check("blocklist: outside its ranges, it loads again", (await harbor()).loaded && !(await harbor()).blocked, await harbor())
  const { versionMatches } = await import("../core/pluginindex.ts")
  check("blocklist: ranges", versionMatches("1.2.3", "1.2.3") && versionMatches("1.2.3", "*") && versionMatches("1.2.3", ">=1.0.0 <1.3.0") && !versionMatches("1.3.0", ">=1.0.0 <1.3.0") &&
    versionMatches("0.9.0", "<1.0.0") && !versionMatches("1.0.0", "<1.0.0") && versionMatches("1.0.0", "<=1.0.0") && versionMatches("2.0.0", ">1.9.9") && !versionMatches("1.2.3", "nonsense"))

  // Several plugins in one repository (owner/name/folder): each folder's own tags (<folder>/v1.0.0); and an index read
  // from a repository with git (plugins.json's `index`: owner/name/path.json).
  {
    const { parseSource } = await import("../core/installs.ts")
    check("several in one: owner/name/folder, its @tag in the folder", parseSource("fleet/plugins/dinghy@v1.0.0").tag === "dinghy/v1.0.0" &&
      parseSource("fleet/plugins/dinghy").repo === "fleet/plugins" && parseSource("fleet/plugins/dinghy").dir === "dinghy")
    let bad = ""
    try { parseSource("fleet/plugins/../x") } catch (e) { bad = (e as Error).message }
    check("several in one: a folder can't climb out", bad.includes("isn't a plugin's source"), bad)
    const dinghy = (version: string) => JSON.stringify({ id: "dinghy", name: "Dinghy", description: "A made-up plugin, one of several in a repository.", version,
      author: "Alice Park", repo: "fleet/plugins", apiVersion: 1, disclosures: {} })
    const skiff = JSON.stringify({ id: "skiff", name: "Skiff", description: "Made up.", version: "1.0.0", author: "Alice Park", repo: "fleet/plugins", disclosures: {} })
    const dts = (tide: string) => PLUGIN_TS.replaceAll("harbor", "dinghy").replace('"high"', `"${tide}"`)
    repo("fleet/plugins", { "dinghy/manifest.json": dinghy("1.0.0"), "dinghy/plugin.ts": dts("high"), "skiff/manifest.json": skiff,
      "directory/index.json": JSON.stringify({ plugins: [entry({ id: "dinghy", name: "Dinghy", repo: "fleet/plugins", dir: "dinghy", tag: "dinghy/v1.0.0" })] }) }, "dinghy/v1.0.0")
    process.env.VAULTITE_GITHUB = pathToFileURL(path.join(tmp, "repos")).href
    write(".vaultite/plugins/dinghy/data.json", JSON.stringify({ kept: 1 }) + "\n")
    let [fc, fo] = await api("POST", "ops/plugin.install", { source: "fleet/plugins/dinghy" })
    check("several in one: installed from its folder at its own newest tag", fc === 200 && fo.id === "dinghy" && fo.tag === "dinghy/v1.0.0" &&
      exists(".vaultite/plugins/dinghy/plugin.ts") && !exists(".vaultite/plugins/dinghy/skiff") && lock().dinghy?.repo === "fleet/plugins" && lock().dinghy.version === "1.0.0", [fc, fo])
    check("install: a folder with only its settings is kept for it", JSON.parse(read(".vaultite/plugins/dinghy/data.json")).kept === 1)
    // An author's folder: .vaultiteignore leaves its tests out; edited, update --apply takes it and it keeps running.
    const KETCH = path.join(tmp, "ketch")
    const kt = (tide: string) => PLUGIN_TS.replaceAll("harbor", "ketch").replace('"high"', `"${tide}"`)
    for (const [f, t] of Object.entries({ "manifest.json": JSON.stringify({ id: "ketch", name: "Ketch", description: "Made up.", version: "0.1.0", author: "Alice Park",
      repo: "alicepark/ketch", disclosures: {} }), "plugin.ts": kt("high"), ".vaultiteignore": "qa/\n*.test.ts\n", "qa/run.mjs": "x", "deep/a.test.ts": "x", "deep/keep.ts": "export {}\n" })) {
      fs.mkdirSync(path.dirname(path.join(KETCH, f)), { recursive: true }); fs.writeFileSync(path.join(KETCH, f), t)
    }
    ;[fc, fo] = await api("POST", "ops/plugin.install", { source: KETCH })
    check("install from a folder: .vaultiteignore leaves its tests out", fc === 200 && exists(".vaultite/plugins/ketch/deep/keep.ts") && !exists(".vaultite/plugins/ketch/qa") &&
      !exists(".vaultite/plugins/ketch/deep/a.test.ts"), [fc, fo])
    await vau("plugin", "on", "ketch")
    fs.writeFileSync(path.join(KETCH, "plugin.ts"), kt("low"))
    ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "ketch", apply: true })
    check("install from a folder: edited, update --apply takes it, and it keeps running", fc === 200 && fo[0].applied && fo[0].allowed &&
      (await api("GET", "ketch"))[1]?.tide === "low", [fo, await api("GET", "ketch")])
    ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "ketch" })
    check("install from a folder: unchanged, it's up to date", fo[0].current === true, fo)
    await api("POST", "ops/plugin.uninstall", { id: "ketch" })
    // Its userFiles (Vim's init.vim): the user's to edit, not its code; kept when it's updated.
    const sk = (v: string) => JSON.stringify({ id: "skipper", name: "Skipper", description: "Made up.", version: v, author: "Alice Park", repo: "alicepark/skipper",
      disclosures: {}, userFiles: ["log.txt"] })
    const SKIPPER = repo("skipper", { "manifest.json": sk("1.0.0"), "plugin.ts": PLUGIN_TS.replaceAll("harbor", "skipper"), "log.txt": "default\n" }, "v1.0.0")
    await api("POST", "ops/plugin.install", { source: SKIPPER })
    await vau("plugin", "on", "skipper")
    write(".vaultite/plugins/skipper/log.txt", "the user's own\n")
    await app.syncPlugins()
    const skp = await vplugin("skipper")
    check("userFiles: editing one isn't a new version, it keeps running", skp.loaded && !skp.approval, skp)
    repo("skipper", { "manifest.json": sk("1.1.0"), "log.txt": "a newer default\n" }, "v1.1.0")
    await api("POST", "ops/plugin.update", { id: "skipper", apply: true })
    check("userFiles: an update keeps the user's", read(".vaultite/plugins/skipper/log.txt") === "the user's own\n", read(".vaultite/plugins/skipper/log.txt"))
    const rules = await import("../core/rules.ts")
    check("userFiles: never code", rules.metaProblems({ userFiles: ["x.ts"] }).length === 1 && rules.metaProblems({ userFiles: ["../x.txt"] }).length === 1 && !rules.metaProblems({ userFiles: ["init.vim"] }).length)
    await api("POST", "ops/plugin.uninstall", { id: "skipper" })
    repo("fleet/plugins", { "skiff/manifest.json": skiff.replace("1.0.0", "1.1.0") }, "skiff/v1.1.0")
    ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "dinghy" })
    check("several in one: another folder's release isn't this one's update", fc === 200 && fo[0].current === true, fo)
    repo("fleet/plugins", { "dinghy/manifest.json": dinghy("1.1.0"), "dinghy/plugin.ts": dts("low") }, "dinghy/v1.1.0")
    ;[fc, fo] = await api("POST", "ops/plugin.update", { id: "dinghy", apply: true })
    check("several in one: its own newer tag updates it", fc === 200 && fo[0].applied && fo[0].tag === "dinghy/v1.1.0" && lock().dinghy.version === "1.1.0" &&
      read(".vaultite/plugins/dinghy/plugin.ts").includes('"low"'), fo)
    const env = process.env.VAULTITE_PLUGIN_INDEX
    delete process.env.VAULTITE_PLUGIN_INDEX
    write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: "fleet/plugins/directory/index.json" }))
    const [ec, eo] = await api("POST", "ops/plugin.search", { refresh: true })
    check("index in a repository: read with git, its entries' sources name their folder", ec === 200 && eo.available && eo.plugins.length === 1 &&
      eo.plugins[0].source === "fleet/plugins/dinghy" && eo.plugins[0].installed === "1.1.0", eo)
    write(".vaultite/plugins.json", JSON.stringify({ ...conf("plugins"), index: null }))
    process.env.VAULTITE_PLUGIN_INDEX = env
    await app.index.get(true)
    delete process.env.VAULTITE_GITHUB
    await api("POST", "ops/plugin.uninstall", { id: "dinghy" })
  }

  // Uninstalled: off, its folder in the trash, its lock entry and this machine's approval gone.
  let [xc, xo] = await api("POST", "ops/plugin.uninstall", { id: "harbor" })
  check("uninstall: off, to the trash, out of the lock, approval forgotten", xc === 200 && !exists(".vaultite/plugins/harbor") && xo.trashed.startsWith(".trash/") &&
    !lock().harbor && !(conf("plugins").enabled ?? []).includes("harbor") && !app.vaultPlugins.trust.approval("harbor"), [xc, xo])
  ;[xc] = await api("POST", "ops/plugin.uninstall", { id: "notags" })
  check("uninstall: the last one removes the lock file", xc === 200 && !exists(".vaultite/plugins-lock.json"))
  delete process.env.VAULTITE_PLUGIN_INDEX
  for (const f of fs.readdirSync(path.join(VAULT, ".trash"))) if (/^(harbor|notags|dinghy|ketch|skipper) /.test(f)) fs.rmSync(path.join(VAULT, ".trash", f), { recursive: true })
  fs.rmSync(path.join(VAULT, ".vaultite/cache/plugin-index.json"), { force: true })

  // Trust on a vault this machine hasn't opened: none of its plugins run (a shared vault), a new install's first one neither.
  {
    const { trustOf } = await import("../core/trust.ts")
    const { VaultPlugins } = await import("../core/vaultplugins.ts")
    const SHARED = path.join(tmp, "shared")
    fs.cpSync(path.join(import.meta.dirname, "fixtures", "wordcount"), path.join(SHARED, ".vaultite/plugins/wordcount"), { recursive: true })
    fs.writeFileSync(path.join(SHARED, ".vaultite/plugins.json"), JSON.stringify({ enabled: ["wordcount"] }))
    const { Vault } = await import("../core/vault.ts")
    const vps = new VaultPlugins(new Vault(SHARED), app.app)
    await vps.sync()
    check("trust: a shared vault's plugin that's on runs nothing here until allowed (its store made at once, empty)", !vps.list()[0].loaded && vps.list()[0].approval?.state === "new" &&
      JSON.stringify(JSON.parse(fs.readFileSync(trustOf(SHARED).file, "utf8")).plugins) === "{}", vps.list()[0])
    // A new install (no trust store at all) whose first vault has plugins on: none approved (a shared vault may be anyone's).
    const local = process.env.VAULTITE_LOCAL!, aside = `${local}-aside`
    fs.renameSync(path.join(local, "trust"), aside)
    const FIRST = path.join(tmp, "first")
    fs.cpSync(SHARED, FIRST, { recursive: true })
    const vps2 = new VaultPlugins(new Vault(FIRST), app.app)
    await vps2.sync()
    check("trust: a fresh install's first vault approves nothing it has on (its store made, empty)", !vps2.list()[0].loaded && vps2.list()[0].approval?.state === "new" &&
      JSON.stringify(JSON.parse(fs.readFileSync(trustOf(FIRST).file, "utf8")).plugins) === "{}", vps2.list()[0])
    await vps2.close()
    const vps2b = new VaultPlugins(new Vault(FIRST), app.app)
    await vps2b.sync()
    check("trust: ...nor when it's opened again", !vps2b.list()[0].loaded, vps2b.list()[0])
    await vps2b.close()
    await vps.close()
    fs.rmSync(path.join(local, "trust"), { recursive: true })
    fs.renameSync(aside, path.join(local, "trust"))
  }

  // The index builder on made-up GitHub answers.
  const { buildIndex, excerpt, scoreOf } = await import("./plugin-index.ts")
  const now = Date.parse("2026-10-01T00:00:00Z")
  const gh: Record<string, unknown> = {
    "https://api.github.com/search/repositories?q=topic%3Avaultite-plugin&sort=stars&per_page=100&page=1": { items: [
      { full_name: "alicepark/harbor", stargazers_count: 120, created_at: "2025-01-01T00:00:00Z", pushed_at: "2026-09-20T00:00:00Z", topics: ["vaultite-plugin"], owner: { login: "alicepark" } },
      { full_name: "boblee/oldboat", stargazers_count: 3, created_at: "2024-01-01T00:00:00Z", pushed_at: "2024-02-01T00:00:00Z", owner: { login: "boblee" } },
      { full_name: "boblee/notag", stargazers_count: 9, owner: { login: "boblee" } },
      { full_name: "boblee/harbor-copy", stargazers_count: 1, owner: { login: "boblee" } },
      { full_name: "boblee/gone", archived: true, owner: { login: "boblee" } },
      { full_name: "carol/fleet", stargazers_count: 7, owner: { login: "carol" } }] },
    "https://api.github.com/repos/carol/fleet/tags?per_page=100": [{ name: "dinghy/v1.0.0", commit: { sha: "d1" } }, { name: "dinghy/v1.1.0", commit: { sha: "d2" } },
      { name: "skiff/v0.1.0", commit: { sha: "s1" } }, { name: "raft/v1.0.0", commit: { sha: "r1" } }],
    "https://api.github.com/repos/carol/fleet/commits/d2": { commit: { committer: { date: "2026-09-25T00:00:00Z" } } },
    "https://raw.githubusercontent.com/carol/fleet/d2/dinghy/manifest.json": { id: "dinghy", name: "Dinghy", version: "1.1.0", description: "Sails.", icon: "icon.svg" },
    "https://raw.githubusercontent.com/carol/fleet/d2/dinghy/icon.svg": '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20z"/></svg>\n',
    "https://raw.githubusercontent.com/carol/fleet/d2/dinghy/README.md": "# Dinghy\n\nSmall sails for small boats, and when to take them in.\n",
    "https://raw.githubusercontent.com/carol/fleet/s1/skiff/manifest.json": { id: "skiff", name: "Skiff", version: "0.2.0" },
    "https://raw.githubusercontent.com/carol/fleet/HEAD/dinghy/manifest.json": { id: "dinghy", version: "1.1.0" },
    "https://raw.githubusercontent.com/carol/fleet/HEAD/skiff/manifest.json": { id: "skiff", version: "0.2.0" },
    "https://raw.githubusercontent.com/carol/fleet/r1/raft/manifest.json": { id: "raft", name: "Raft", version: "1.0.0" },
    "https://api.github.com/repos/alicepark/harbor/releases/latest": { tag_name: "v1.2.0", published_at: "2026-09-15T00:00:00Z" },
    "https://raw.githubusercontent.com/alicepark/harbor/v1.2.0/manifest.json": { id: "harbor", name: "Harbor", version: "1.2.0", description: "Tides.", author: "Alice Park", icon: "anchor", tint: "teal", disclosures: { network: ["tides.example.com"] }, fundingUrl: "https://example.com/fund" },
    "https://api.github.com/repos/boblee/oldboat/tags?per_page=100": [{ name: "v0.9.0", commit: { sha: "aaa" } }, { name: "v0.10.0", commit: { sha: "bbb" } }, { name: "nightly" }],
    "https://api.github.com/repos/boblee/oldboat/commits/bbb": { commit: { committer: { date: "2024-02-01T00:00:00Z" } } },
    "https://raw.githubusercontent.com/boblee/oldboat/v0.10.0/manifest.json": { id: "oldboat", name: "Old boat", version: "0.10.0", description: "Rowing." },
    "https://api.github.com/repos/boblee/harbor-copy/releases/latest": { tag_name: "v1.0.0" },
    "https://raw.githubusercontent.com/boblee/harbor-copy/v1.0.0/manifest.json": { id: "harbor", name: "Harbor copy", version: "1.0.0", description: "A copy." },
    "https://api.github.com/repos/carol/listed": { full_name: "carol/listed", stargazers_count: 0, owner: { login: "carol" } },
    "https://api.github.com/repos/carol/listed/releases/latest": { tag_name: "2.0.0" },
    "https://raw.githubusercontent.com/carol/listed/2.0.0/manifest.json": { id: "listed", name: "Listed", version: "1.9.0", description: "Wrong version." },
    "https://api.github.com/repos/alicepark/harbor/readme": "# Harbor\n\n[![ci](https://x/badge.svg)](https://x)\n\nShows the **harbour's** tides on a [dashboard](https://example.com), and when the boats leave.\n",
  }
  const issues = (full: string, state: string) => `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${full} type:issue state:${state}`)}&per_page=1`
  gh[issues("alicepark/harbor", "open")] = { total_count: 2 }
  gh[issues("alicepark/harbor", "closed")] = { total_count: 8 }
  const asked: string[] = []
  const get = async (url: string) => { asked.push(url); return url in gh ? { status: 200, body: gh[url] } : { status: 404, body: { message: "Not Found" } } }
  const { index, skipped } = await buildIndex({ get, listed: ["carol/listed", "not a repo"], blocked: { "boblee/oldboat": ["<1.0.0"] }, now })
  const hb = index.plugins.find((p) => p.id === "harbor") as Any
  check("index builder: a repo's manifest at its latest release, with its GitHub numbers", hb?.repo === "alicepark/harbor" && hb.version === "1.2.0" && hb.tag === "v1.2.0" && hb.stars === 120 &&
    hb.released === "2026-09-15T00:00:00Z" && hb.issues.open === 2 && hb.issues.closed === 8 && hb.author === "Alice Park" && hb.fundingUrl === "https://example.com/fund" &&
    JSON.stringify(hb.disclosures) === '{"network":["tides.example.com"]}', hb)
  check("index builder: a README's first prose, without badges or links' addresses", hb?.readme === "Shows the harbour's tides on a dashboard, and when the boats leave.", hb?.readme)
  const ob = index.plugins.find((p) => p.id === "oldboat") as Any
  check("index builder: no release, its newest version tag (and the commit's date)", ob?.tag === "v0.10.0" && ob.released === "2024-02-01T00:00:00Z" && ob.author === "boblee", ob)
  check("index builder: left out, saying why: no tag, archived, a version that isn't its tag's, a copy's id, a folder gone", skipped.some((x) => x.startsWith("boblee/notag: no version tag")) &&
    skipped.some((x) => x.startsWith("boblee/gone: archived")) && skipped.some((x) => x.includes("carol/listed") && x.includes("isn't its tag's")) &&
    skipped.some((x) => x.startsWith("boblee/harbor-copy: id 'harbor'")) && skipped.some((x) => x.startsWith("carol/fleet/skiff: its manifest's version")) &&
    skipped.some((x) => x === "carol/fleet/raft: no longer in the repository") &&
    index.plugins.length === 3, skipped)
  const dg = index.plugins.find((p) => p.id === "dinghy") as Any
  check("index builder: several plugins in one repository, each at its folder's newest tag", dg?.repo === "carol/fleet" && dg.dir === "dinghy" && dg.tag === "dinghy/v1.1.0" &&
    dg.version === "1.1.0" && dg.released === "2026-09-25T00:00:00Z" && dg.readme === "Small sails for small boats, and when to take them in.", dg)
  const fromIndex = (await import("../core/pluginindex.ts")).readIndex(JSON.parse(JSON.stringify(index))).plugins
  check("index builder: an icon by name as it is, an SVG file inline (the app reads both)", hb?.icon === "anchor" && hb.tint === "teal" &&
    dg?.icon === `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20z"/></svg>')}` &&
    fromIndex.find((p) => p.id === "dinghy")?.icon === dg.icon && fromIndex.find((p) => p.id === "harbor")?.tint === "teal", { hb: hb?.icon, dg: dg?.icon })
  check("index builder: listed.json's repos are asked for too", asked.includes("https://api.github.com/repos/carol/listed"))
  check("index builder: sorted by score, the blocklist goes out, and the app reads it", index.plugins[0].id === "harbor" && (index.blocked as Any)["boblee/oldboat"][0] === "<1.0.0" &&
    (await import("../core/pluginindex.ts")).readIndex(JSON.parse(JSON.stringify(index))).plugins.length === 3)
  check("index builder: the score blends stars with upkeep", scoreOf(1000, "2026-09-30T00:00:00Z", 0, 10, now) === 100 && scoreOf(0, null, 0, 0, now) === 10 &&
    scoreOf(120, "2026-09-20T00:00:00Z", 2, 8, now) > scoreOf(120, "2025-01-01T00:00:00Z", 2, 8, now))
  check("index builder: an excerpt is cut at 280", excerpt("x".repeat(10) + " word".repeat(100)).length <= 280)

  // A plugin's own repository, checked as installing would (tools/check_plugins.ts --plugin; the author's CI).
  const chk = (dir: string, ...more: string[]) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(import.meta.dirname, "check_plugins.ts"), "--plugin", dir, ...more], { stdio: "pipe" }).toString() } } catch (e) { return { code: (e as Any).status, out: String((e as Any).stdout) } } }
  let ck = chk(HARBOR, "--tag", "v1.1.0")
  check("plugin check: a repository at its tag passes", ck.code === 0 && ck.out.includes("ok: harbor at v1.1.0"), ck)
  ck = chk(HARBOR, "--tag", "v2.0.0")
  check("plugin check: a tag its version isn't fails", ck.code === 1 && ck.out.includes("version is 1.1.0, but its tag is v2.0.0"), ck)
  ck = chk(BADCODE)
  check("plugin check: a rule broken fails", ck.code === 1 && ck.out.includes("its own folder"), ck)
  const [pc, po] = await api("POST", "ops/plugin.check", { path: BADTAG, tag: "v1.0.1" })
  check("plugin check: vau plugins check <folder> does the same", pc === 200 && po[0].problems.some((p: string) => p.includes("but its tag is v1.0.1")), po)
  const meta = await import("../core/rules.ts")
  const mp = meta.metaProblems({ version: "1", author: "", repo: "nope", fundingUrl: "http://x", disclosures: { network: ["bad host!"], shell: "yes", camera: true } })
  check("manifest: version, author, repo, fundingUrl and disclosures are checked", ["version must be", "author is a name", "repo is its GitHub", "fundingUrl is an https", "disclosures.network is", "disclosures.shell is true or false", "disclosures.camera isn't one"]
    .every((x) => mp.some((p) => p.includes(x))), mp)
  const pm = await import("../core/pluginmeta.ts")
  check("manifest: an icon's SVG is one SVG without scripts", !pm.svgIcon('<svg><script>alert(1)</script></svg>') && !pm.svgIcon("<html></html>") &&
    !pm.svgIcon(`<svg>${"x".repeat(pm.ICON_MAX)}</svg>`) && !!pm.svgIcon("<svg viewBox='0 0 24 24'/></svg>") && pm.iconOf("Not a name") === null && pm.iconOf("heart-pulse") === "heart-pulse")
  const ip = meta.manifestProblems({ id: "x", name: "X", description: "x", icon: "../logo.png" }, "x", new Set(["x"]))
  check("manifest: icon is a name or an SVG file in its folder", ip.some((p) => p.includes("icon is a name")), ip)
  const any = pm.disclosed(pm.disclosuresOf({ disclosures: { network: ["*.example.com", "*"] } }))
  check("manifest: network \"*\" is any host its settings name", !meta.metaProblems({ disclosures: { network: ["*"] } }).length &&
    any[0] === "talks to *.example.com and any host you set in its settings", any)
  // A vault plugin's own modules that index.tsx doesn't import are its backend's: they may use Node.
  const front = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-front-"))
  fs.writeFileSync(path.join(front, "manifest.json"), JSON.stringify({ id: path.basename(front), name: "Harbor", description: "Made up." }))
  fs.writeFileSync(path.join(front, "plugin.ts"), 'import { tide } from "./tides.ts"\nvoid tide\n')
  fs.writeFileSync(path.join(front, "tides.ts"), 'import fs from "node:fs"\nexport const tide = fs.existsSync\n')
  fs.writeFileSync(path.join(front, "index.tsx"), 'import { label } from "./shared"\nvoid label\n')
  fs.writeFileSync(path.join(front, "shared.ts"), 'import os from "node:os"\nexport const label = os.EOL\n')
  const fp = meta.pluginProblems(front, path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), new Map(), true, "harbor")
  check("plugin check: a vault plugin's server-side modules may use Node, what index.tsx imports may not", fp.length === 1 && fp[0].startsWith("harbor/shared.ts: imports node:os"), fp)
  fs.rmSync(front, { recursive: true, force: true })
}

// A vault opened for the first time starts from Minimal (core/start.ts): a new one with Start here, a folder of the
// user's unchanged. Last: opening another vault binds the plugins to it.
{
  const conf = (dir: string, name: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `.vaultite/${name}.json`), "utf8")) } catch { return null } }
  const fresh = path.join(tmp, "Fresh vault")
  fs.mkdirSync(fresh)
  await open(fresh)
  const pj = conf(fresh, "plugins"), look = conf(fresh, "appearance"), pages = conf(fresh, "pages")
  check("new vault: Minimal's plugins (a terminal and Claude Code, none of Life OS)", !(pj?.enabled ?? []).includes("people") && !(pj?.enabled ?? []).includes("today") && !pj?.disabled?.includes("terminal")
    && !pj.disabled.includes("claude-code") && !pj.disabled.includes("provenance"), pj)
  check("new vault: Minimal's look (Gruvbox, the default: unset)", !look?.scheme && look?.fileIcons === false, look)
  check("new vault: Start here, the only pin; plugins' pages out of the user's files", JSON.stringify(pages?.pinned) === '["Start here.md"]' && pages.install === false
    && fs.readFileSync(path.join(fresh, "Start here.md"), "utf8").includes("claude") && !fs.existsSync(path.join(fresh, "Dashboards")), [pages, fs.readdirSync(fresh)])
  check("new vault: agents started in it find its rules", /\.vaultite\/AGENTS\.md/.test(fs.readFileSync(path.join(fresh, "CLAUDE.md"), "utf8")))
  check("new vault: nothing to restore, nothing offered", !fs.existsSync(path.join(fresh, ".vaultite/bundles/previous.json")) && !fs.existsSync(path.join(fresh, ".vaultite/bundles/onboarding.json")))
  const own = path.join(tmp, "Own notes")
  fs.mkdirSync(path.join(own, "Ideas"), { recursive: true })
  fs.writeFileSync(path.join(own, "Ideas/One.md"), "An idea.\n")
  await open(own)
  const files = fs.readdirSync(own, { recursive: true }).map(String).filter((f) => !f.startsWith(".vaultite")).sort()
  check("a folder of notes: Minimal, and nothing added among its files", conf(own, "plugins")?.disabled?.includes("activity") && JSON.stringify(files) === '["Ideas","Ideas/One.md"]'
    && fs.readFileSync(path.join(own, "Ideas/One.md"), "utf8") === "An idea.\n", files)
  const opened = path.join(tmp, "Opened before")
  fs.mkdirSync(path.join(opened, ".vaultite"), { recursive: true })
  await open(opened)
  check("a vault the app opened before keeps its setup", !conf(opened, "plugins") && !fs.existsSync(path.join(opened, "Start here.md")))
  // A new vault still being offered the bundles, given one that pins nothing: none of the plugins' pages get pinned.
  const offered = path.join(tmp, "Offered")
  fs.mkdirSync(path.join(offered, ".vaultite/bundles"), { recursive: true })
  fs.writeFileSync(path.join(offered, ".vaultite/bundles/onboarding.json"), "{}\n")
  const o = await open(offered)
  await o.host().call("POST", "bundles/minimal/apply", {})
  await o.state()
  o.installPages()
  check("a bundle pinning nothing pins nothing (not Errors, not Design)", JSON.stringify(conf(offered, "pages")?.pinned) === "[]", conf(offered, "pages"))
  // Skipping the offer starts from Minimal, with nothing to restore.
  const skipped = path.join(tmp, "Skipped")
  fs.mkdirSync(path.join(skipped, ".vaultite/bundles"), { recursive: true })
  fs.writeFileSync(path.join(skipped, ".vaultite/bundles/onboarding.json"), "{}\n")
  const sk = await open(skipped)
  const after = await sk.host().call("POST", "bundles/onboarding", {}) as { onboarding: boolean; previous: unknown }
  check("skipping the offer: Minimal, nothing offered or to restore", conf(skipped, "plugins")?.disabled?.includes("activity") && !after.onboarding && !after.previous
    && !fs.existsSync(path.join(skipped, ".vaultite/bundles/previous.json")), [after, conf(skipped, "plugins")])
}

// ---------- One file or setting can't take the vault down: a fill that throws, a link back up, a settings file that's null ----------
{
const person: Any = vault.kinds.find((k: Any) => k.type === "person")!
Object.defineProperty(person, "fill", { value: () => { throw new Error("a plugin bug") }, configurable: true })
write("People/Fill Bug.md", "---\ntype: person\n---\n\nMade up.\n")
await vault.sync()
let synced: unknown = null
try { await vault.fillIn("People/Fill Bug.md", null); synced = true } catch (e) { synced = e }
check("resilience: a kind's fill that throws doesn't fail the write", synced === true, String(synced))
check("… the file is indexed, its problem said", vault.entries.get("People/Fill Bug.md")?.problems.some((x: string) => x.includes("couldn't fill in")), vault.entries.get("People/Fill Bug.md")?.problems)
delete person.fill // (its class's again)
fs.rmSync(path.join(VAULT, "People/Fill Bug.md"))

fs.mkdirSync(path.join(VAULT, "Loop"), { recursive: true })
write("Loop/Inside.md", "In the loop.\n")
fs.symlinkSync("..", path.join(VAULT, "Loop/up"))
fs.symlinkSync(".", path.join(VAULT, "Loop/self"))
await vault.sync()
const looped = [...vault.entries.keys()].filter((r) => r.startsWith("Loop/"))
check("resilience: links back up a folder are walked once, not until paths are too long",
  looped.includes("Loop/Inside.md") && !looped.some((r) => r.startsWith("Loop/up/")) && !looped.some((r) => r.startsWith("Loop/self/self/")), looped)
fs.rmSync(path.join(VAULT, "Loop"), { recursive: true, force: true })
await vault.sync()

const pj = path.join(VAULT, ".vaultite/plugins.json"), had = fs.existsSync(pj) ? fs.readFileSync(pj, "utf8") : null
for (const bad of ["null", "\"terminal\"", "[1]"]) {
  fs.writeFileSync(pj, bad)
  vault.forgetConfig("plugins")
  const [st] = await api("GET", "state")
  check(`resilience: plugins.json that's ${bad}: the state still answers`, st === 200, st)
}
if (had === null) fs.rmSync(pj); else fs.writeFileSync(pj, had)
await vault.sync()
}

// ---------- Linux's vault watcher (core/treewatch.ts): folder by folder, new folders followed, skipped ones not watched ----------
{
  const { watchTree } = await import("../core/treewatch.ts")
  const root = path.join(tmp, "watched")
  fs.mkdirSync(path.join(root, ".git"), { recursive: true })
  fs.mkdirSync(path.join(root, "Notes"), { recursive: true })
  const seen = new Set<string | null>()
  const w = watchTree(root, (rel) => rel.split("/").includes(".git"), (rel) => seen.add(rel))
  const settle = () => new Promise((r) => setTimeout(r, 150))
  const until = async (rel: string) => { for (let i = 0; i < 40 && !seen.has(rel); i++) await settle(); return seen.has(rel) }
  await settle(); await settle() // (a Mac's watches take a moment to start: Linux is the one that uses this)
  fs.writeFileSync(path.join(root, "Notes", "a.md"), "a")
  check("tree watcher: a file in a subfolder", await until("Notes/a.md"), [...seen])
  fs.mkdirSync(path.join(root, "Notes", "New"))
  await until("Notes/New")
  await settle()
  fs.writeFileSync(path.join(root, "Notes", "New", "b.md"), "b")
  check("tree watcher: a folder made after it started is watched too", await until("Notes/New/b.md"), [...seen])
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "x")
  await settle(); await settle()
  check("tree watcher: a skipped folder isn't watched", ![...seen].some((r) => r?.startsWith(".git/")), [...seen])
  fs.renameSync(path.join(root, "Notes", "New"), path.join(root, "Moved"))
  await until("Moved")
  await settle()
  fs.writeFileSync(path.join(root, "Moved", "c.md"), "c")
  check("tree watcher: a folder moved within it is followed", await until("Moved/c.md"), [...seen])
  fs.mkdirSync(path.join(root, "At once", "Deeper"), { recursive: true })
  fs.writeFileSync(path.join(root, "At once", "Deeper", "d.md"), "d")
  check("tree watcher: a file made with its new folders is told", await until("At once/Deeper/d.md"), [...seen])
  w.close()
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${fails.length ? `${fails.length} failed` : "all passed"}`)
process.exit(fails.length ? 1 : 0)
