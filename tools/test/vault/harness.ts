// The vault test's one app, in-process, on a throwaway vault (or a copy of one), and the helpers every area gets as `$`.
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import { check, cursorFixture, hermesFixture, openclawFixture, opencodeFixture, sleep, type Any } from "../lib.ts"

export type { Any }
export type VaultTest = Awaited<ReturnType<typeof vaultHarness>>
const TOOLS = path.resolve(import.meta.dirname, "..", "..")

/** "Now" for made-up usage that's minutes old and must fall on today: never in the day's first two hours (just after
 *  midnight, "an hour ago" is yesterday, and tests counting today's usage failed until 1 am). */
const fixtureNow = () => { const d = new Date(); d.setHours(2, 0, 0, 0); return Math.max(Date.now(), d.getTime()) }

/** A fake Cursor API (its account's usage), recording what it was asked. */
async function cursorApi() {
  const seen: { path: string; cookie: string; origin: string }[] = []
  const server = (await import("node:http")).createServer((req, res) => {
    seen.push({ path: req.url ?? "", cookie: String(req.headers.cookie ?? ""), origin: String(req.headers.origin ?? "") })
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
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  return { server, seen }
}

/** The test vault (made up, or a copy of `from`), the agents' made-up homes in the environment, then the app. */
export async function vaultHarness(from?: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-test-"))
  const VAULT = path.join(tmp, "vault")
  if (from) fs.cpSync(from, VAULT, { recursive: true })
  else {
    fs.mkdirSync(path.join(VAULT, "People"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "People", "Alice Park.md"), "---\ntype: person\nrelation: friend\nlocation: Seattle, WA\n---\n\n" +
      "Likes hiking.\n\n## Timeline\n\n- 2026-09-20 · call · 20 min · Caught up\n")
    // The Vaultite plugins on (the tests use them), but the few that change the app for everyone (the Dock icon...).
    const root = path.join(TOOLS, "..", "plugins", "core")
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
  // The agents' files: made up (tools/fixtures), never this machine's. Codex's app server then has no login: the limits
  // come from the sessions. Cursor's account is the fake API above.
  const CLAUDE_DIR = path.join(tmp, "claude"), CODEX_DIR = path.join(tmp, "codex"), CURSOR_DIR = path.join(tmp, "cursor")
  const OPENCODE_DIR = path.join(tmp, "opencode"), OPENCLAW_DIR = path.join(tmp, "openclaw"), HERMES_DIR = path.join(tmp, "hermes")
  const MUSE_DIR = path.join(tmp, "muse") // (an agent named Wren, made up)
  fs.cpSync(path.join(TOOLS, "fixtures", "claude"), CLAUDE_DIR, { recursive: true })
  fs.cpSync(path.join(TOOLS, "fixtures", "codex"), CODEX_DIR, { recursive: true })
  fs.cpSync(path.join(TOOLS, "fixtures", "muse"), MUSE_DIR, { recursive: true })
  await cursorFixture(CURSOR_DIR)
  await opencodeFixture(OPENCODE_DIR)
  await openclawFixture(OPENCLAW_DIR)
  await hermesFixture(HERMES_DIR)
  const cursor = await cursorApi()
  Object.assign(process.env, {
    CLAUDE_CONFIG_DIR: CLAUDE_DIR, CODEX_HOME: CODEX_DIR, CURSOR_USER_DIR: path.join(CURSOR_DIR, "User"), CURSOR_CONFIG_DIR: path.join(CURSOR_DIR, "config"),
    CURSOR_API_URL: `http://127.0.0.1:${(cursor.server.address() as { port: number }).port}`,
    OPENCODE_DATA_DIR: OPENCODE_DIR, OPENCODE_CACHE_DIR: path.join(TOOLS, "fixtures", "opencode"),
    OPENCLAW_STATE_DIR: OPENCLAW_DIR, OPENCLAW_WORKSPACE_DIR: path.join(OPENCLAW_DIR, "workspace"), HERMES_HOME: HERMES_DIR, MUSE_HOME: MUSE_DIR,
  })
  // Imported after the environment is set: plugins read it when they load.
  const { open } = await import("../../../core/app.ts")
  const { merge3 } = await import("../../../core/textedit.ts")
  const { Text } = await import("../../../core/plugins.ts")
  const { publicOf } = await import("../../../core/vault.ts")
  const app = await open(VAULT, { start: false })
  const vault = app.vault
  /** The Vaultite plugins on in the test vault (above): a test that writes plugins.json keeps them on. */
  const ON: string[] = vault.config("plugins").enabled ?? []

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
    const res = await app.run(method, parts, query, body ?? {}, http)
    return [res.status, res.body instanceof Text ? res.body.text : publicOf(res.body)]
  }
  /** One API call, like the server makes it: [status, body]. */
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

  return {
    tmp, VAULT, TOOLS, app, vault, ON, open, merge3, Text, publicOf, check, sleep, run, api, sentBy, read, exists, write,
    WS_DIR, readWs, writeWs, clearWs, fixtureNow, cursorSeen: cursor.seen, cursorApi: cursor.server,
    CLAUDE_DIR, CODEX_DIR, CURSOR_DIR, OPENCODE_DIR, OPENCLAW_DIR, HERMES_DIR, MUSE_DIR,
    /** What an area leaves for the ones after it (tools/test/vault/index.ts says which need which). */
    vars: {} as Record<string, Any>,
    close: () => { cursor.server.close(); fs.rmSync(tmp, { recursive: true, force: true }) },
  }
}
