// A test or QA run (VAULTITE_TEST=1, set by tools/test/isolate.ts) never reaches the user's own vaults: a server or app
// it starts refuses one, and the user's server refuses its CLI's calls. Each refusal is kept where the run's end reads it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { serviceVault } from "./service.ts"

type Env = Record<string, string | undefined>

/** The header a test run's `vau` sends (its run's id), which the user's own server refuses. */
export const TEST_HEADER = "x-vaultite-test"
/** Where the user's server keeps the calls it refused (its runtime folder), one JSON line each. */
export const REFUSED_FILE = "vaultite-test-refused.jsonl"

/** The temp folder outside a test run's own (its TMPDIR): for what outlasts runs on purpose (built helpers, downloads,
 *  QA's slots) and the user's app's sockets. */
export const sharedTmp = (env: Env = process.env) => env.VAULTITE_TEST_TMPDIR || os.tmpdir()

export const inTestRun = (env: Env = process.env) => env.VAULTITE_TEST === "1"
/** The run's id: its folder's name (tools/test/isolate.ts). */
export const testRunId = (env: Env = process.env) => (env.VAULTITE_TEST_RUN ? path.basename(env.VAULTITE_TEST_RUN) : "")

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const inside = (dir: string, root: string) => dir === root || dir.startsWith(root + path.sep)

/** The user's own vaults here: ~/.vaultite/vault, the service's, the desktop apps' (Vaultite, Main, Dev), anything in
 *  iCloud Drive, VAULTITE_OWN_VAULTS; never a sandbox (.vaultite/sandbox.json). The home is the user's, not a test's. */
export function ownVaults(env: Env = process.env): string[] {
  const home = env.VAULTITE_TEST_HOME || os.userInfo().homedir
  const support = process.platform === "darwin" ? path.join(home, "Library", "Application Support")
    : process.platform === "win32" ? (env.APPDATA || path.join(home, "AppData", "Roaming")) : path.join(home, ".config")
  const out = [path.join(home, ".vaultite", "vault"), serviceVault(process.platform, home), ...(env.VAULTITE_OWN_VAULTS ?? "").split(path.delimiter)]
  for (const app of ["Vaultite", "Vaultite Main", "Vaultite Dev"]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(support, app, "vaults.json"), "utf8")).vaults
      if (Array.isArray(v)) out.push(...v.map((x: { path?: unknown }) => x?.path).filter((p: unknown): p is string => typeof p === "string"))
    } catch { /* no such app here */ }
  }
  return [...new Set(out.filter((p) => p && fs.existsSync(p) && !fs.existsSync(path.join(p, ".vaultite", "sandbox.json"))).map(real))]
}

/** Whether `dir` is one of the user's own vaults or in one (iCloud Drive's folders count: a test never makes one there). */
export function isOwnVault(dir: string, env: Env = process.env): boolean {
  const d = real(dir)
  if (fs.existsSync(path.join(d, ".vaultite", "sandbox.json"))) return false
  const home = env.VAULTITE_TEST_HOME || os.userInfo().homedir
  const roots = [...ownVaults(env), ...(process.platform === "darwin" ? [real(path.join(home, "Library", "Mobile Documents"))] : [])]
  return roots.some((r) => inside(d, r))
}

/** Keeps a refusal, one JSON line in `file`; never throws (the refusal itself matters more). */
export function keepRefusal(file: string, what: Record<string, unknown>) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...what }) + "\n", { mode: 0o600 })
  } catch { /* not kept */ }
}

/** In a test run, whether `vault` is the user's own: then it's kept in the run's folder (its end fails the run) and the
 *  reason is returned, for the caller to refuse; else null. */
export function refuseOwnVault(vault: string, who: string, env: Env = process.env): string | null {
  if (!inTestRun(env) || !isOwnVault(vault, env)) return null
  const why = `${who}: a test run reached the user's own vault ${vault}: tests use a throwaway one (vau sandbox)`
  if (env.VAULTITE_TEST_RUN) keepRefusal(path.join(env.VAULTITE_TEST_RUN, "refused.jsonl"), { who, vault, why })
  return why
}
