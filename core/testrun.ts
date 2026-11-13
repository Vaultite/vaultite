import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { serviceVault } from "./service.ts"

type Env = Record<string, string | undefined>

export const TEST_HEADER = "x-vaultite-test"
/** In the runtime folder, one JSON line each. */
export const REFUSED_FILE = "vaultite-test-refused.jsonl"

/** For what outlasts runs on purpose (built helpers, downloads, QA's slots) and the user's app's sockets. */
export const sharedTmp = (env: Env = process.env) => env.VAULTITE_TEST_TMPDIR || os.tmpdir()

export const inTestRun = (env: Env = process.env) => env.VAULTITE_TEST === "1"
export const testRunId = (env: Env = process.env) => (env.VAULTITE_TEST_RUN ? path.basename(env.VAULTITE_TEST_RUN) : "")

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const inside = (dir: string, root: string) => dir === root || dir.startsWith(root + path.sep)

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

/** iCloud Drive's folders count: a test never makes a vault there. */
export function isOwnVault(dir: string, env: Env = process.env): boolean {
  const d = real(dir)
  if (fs.existsSync(path.join(d, ".vaultite", "sandbox.json"))) return false
  const home = env.VAULTITE_TEST_HOME || os.userInfo().homedir
  const roots = [...ownVaults(env), ...(process.platform === "darwin" ? [real(path.join(home, "Library", "Mobile Documents"))] : [])]
  return roots.some((r) => inside(d, r))
}

/** Never throws: the refusal itself matters more. */
export function keepRefusal(file: string, what: Record<string, unknown>) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...what }) + "\n", { mode: 0o600 })
  } catch { /* not kept */ }
}

/** The reason to refuse `vault` in a test run, kept in the run's folder (its end fails the run); null when it isn't the user's. */
export function refuseOwnVault(vault: string, who: string, env: Env = process.env): string | null {
  if (!inTestRun(env) || !isOwnVault(vault, env)) return null
  const why = `${who}: a test run reached the user's own vault ${vault}: tests use a throwaway one (vau sandbox)`
  if (env.VAULTITE_TEST_RUN) keepRefusal(path.join(env.VAULTITE_TEST_RUN, "refused.jsonl"), { who, vault, why })
  return why
}
