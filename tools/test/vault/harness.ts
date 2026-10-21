// The vault test's one app, in-process, on a throwaway vault (or a copy of one), and the helpers every area gets as `$`.
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import { check, sleep, type Any } from "../lib.ts"

export type { Any }
export type VaultTest = Awaited<ReturnType<typeof vaultHarness>>
const TOOLS = path.resolve(import.meta.dirname, "..", "..")

/** "Now" for made-up usage that's minutes old and must fall on today: never in the day's first two hours (just after
 *  midnight, "an hour ago" is yesterday, and tests counting today's usage failed until 1 am). */
const fixtureNow = () => { const d = new Date(); d.setHours(2, 0, 0, 0); return Math.max(Date.now(), d.getTime()) }

/** The test vault (made up, or a copy of `from`), the agents' made-up homes in the environment, then the app. */
export async function vaultHarness(from?: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-test-"))
  const VAULT = path.join(tmp, "vault")
  if (from) fs.cpSync(from, VAULT, { recursive: true })
  else {
    fs.mkdirSync(path.join(VAULT, "People"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "People", "Alice Park.md"), "---\ntype: person\nrelation: friend\nlocation: Seattle, WA\n---\n\n" +
      "Likes hiking.\n\n## Timeline\n\n- 2026-09-20 · call · 20 min · Caught up\n")
    // The Vaultite plugins on (the tests use them), but the few that change the app for everyone (Vim...).
    const root = path.join(TOOLS, "..", "plugins", "core")
    const enabled = fs.readdirSync(root).filter((id) => !["agent-meters", "recorder", "vim"].includes(id) &&
      !JSON.parse(fs.readFileSync(path.join(root, id, "manifest.json"), "utf8")).essential)
    fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins.json"), JSON.stringify({ disabled: [], enabled }, null, 2) + "\n")
    // Note dates on, but writing no dates: tests compare new files' exact text (its own area turns them on).
    fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "note-dates"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "note-dates", "data.json"), JSON.stringify({ created: "", updated: "" }) + "\n")
  }
  fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@AGENTS.md\n") // the user's own
  // The People map's lookups so far (its cache), so no test asks the network for a pin.
  fs.mkdirSync(path.join(VAULT, ".vaultite", "cache"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite", "cache", "people.json"), JSON.stringify({ places: {
    "chicago, il": [41.8781, -87.6298], "denver, co": [39.7392, -104.9903], "seattle, wa": [47.6062, -122.3321], "nowhere at all": null } }))
  process.env.VAULTITE_VAULT = VAULT
  process.env.VAULTITE_LOCAL = path.join(tmp, "local")
  // The agents' files: made up (tools/fixtures), never this machine's. Codex's app server then has no login: the limits
  // come from the sessions.
  const CLAUDE_DIR = path.join(tmp, "claude"), CODEX_DIR = path.join(tmp, "codex")
  fs.cpSync(path.join(TOOLS, "fixtures", "claude"), CLAUDE_DIR, { recursive: true })
  fs.cpSync(path.join(TOOLS, "fixtures", "codex"), CODEX_DIR, { recursive: true })
  Object.assign(process.env, { CLAUDE_CONFIG_DIR: CLAUDE_DIR, CODEX_HOME: CODEX_DIR })
  // The app's bundles with their installs pinned to a made-up Vaultite/plugins (tools/test/official.ts), which a test
  // reaches through VAULTITE_GITHUB.
  const { officialBundles, officialRepos } = await import("../official.ts")
  officialRepos(path.join(tmp, "official"))
  process.env.VAULTITE_BUNDLES = officialBundles(path.join(tmp, "official"))
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
    WS_DIR, readWs, writeWs, clearWs, fixtureNow,
    CLAUDE_DIR, CODEX_DIR,
    /** What an area leaves for the ones after it (tools/test/vault/index.ts says which need which). */
    vars: {} as Record<string, Any>,
    close: () => fs.rmSync(tmp, { recursive: true, force: true }),
  }
}
