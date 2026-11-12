// node tools/qa_plugins.ts [--bump]: Vaultite/plugins at QA's pin (VAULTITE_PLUGINS: a checkout instead); --bump: main's.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { gitEnv } from "../core/gitenv.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const PIN = path.join(ROOT, "tools/qa_plugins.json")
const Pin = z.object({ repo: z.string(), commit: z.string() })
const readPin = () => Pin.parse(JSON.parse(fs.readFileSync(PIN, "utf8")))
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv() }).trim()

// (under the app's node_modules: a plugin's imports resolve to the app's packages, as a sibling checkout's do)
const home = () => path.join(fs.realpathSync(path.join(ROOT, "node_modules")), ".cache", "vaultite-plugins")

export function officialPlugins(): string {
  if (process.env.VAULTITE_PLUGINS) return path.resolve(process.env.VAULTITE_PLUGINS)
  const { repo, commit } = readPin()
  const dir = path.join(home(), commit)
  if (fs.existsSync(path.join(dir, ".complete"))) return dir
  fs.mkdirSync(home(), { recursive: true })
  const work = fs.mkdtempSync(`${dir}.making-`)
  try {
    git(work, "init", "-q")
    git(work, "fetch", "-q", "--depth", "1", repo, commit)
    git(work, "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD")
    fs.rmSync(path.join(work, ".git"), { recursive: true, force: true })
    fs.writeFileSync(path.join(work, ".complete"), `${commit}\n`)
    try { fs.renameSync(work, dir) } catch (e) { if (!fs.existsSync(path.join(dir, ".complete"))) throw e }
  } catch (e) {
    throw new Error(`QA's Vaultite/plugins at ${commit.slice(0, 8)} couldn't be fetched from ${repo} (VAULTITE_PLUGINS=<checkout> uses one instead): ${e instanceof Error ? e.message : e}`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return dir
}

if (import.meta.main) {
  if (process.argv.includes("--bump")) {
    const pin = readPin()
    const commit = git(ROOT, "ls-remote", pin.repo, "refs/heads/main").split(/\s/)[0]
    fs.writeFileSync(PIN, `${JSON.stringify({ ...pin, commit }, null, 2)}\n`)
    console.log(`pinned ${pin.repo} at ${commit}`)
  }
  console.log(officialPlugins())
}
