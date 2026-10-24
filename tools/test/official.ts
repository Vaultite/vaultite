// A made-up Vaultite/plugins here, so tests installing Vaultite's own plugins (core/migrations.ts MOVED) never reach
// GitHub: each a stub tagged <id>/v1.0.0, with a page where the real one has one; and the app's bundles pinned to them.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { stage } from "../../core/installs.ts"
import { MOVED } from "../../core/migrations.ts"
import { digestOf } from "../../core/vaultplugins.ts"

const PAGES: Record<string, string> = { health: "Health", learning: "Learning", projects: "Projects", today: "Today" }

/** What a stand-in says beyond its id (its name, from the id when left out): the coding agents in their row. */
const AGENT = { category: "ai-apps", group: "coding-agents" }
const STANDINS: Record<string, Record<string, unknown>> = {
  cursor: AGENT, "grok-bot": { name: "Grok Bot", category: "ai-apps", requires: ["cursor"] }, hermes: AGENT, muse: { category: "ai-apps" },
  openclaw: { name: "OpenClaw", ...AGENT }, opencode: { name: "OpenCode", ...AGENT }, dispatch: { category: "agents", requires: ["terminal"] },
}

/** Make it under `dir` (once) and answer the VAULTITE_GITHUB address owner/name sources then resolve to. */
export function officialRepos(dir: string): string {
  const repo = path.join(dir, "Vaultite", "plugins")
  if (!fs.existsSync(path.join(repo, ".git"))) {
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "init.defaultBranch=main",
      "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { cwd: repo, stdio: "pipe" })
    fs.mkdirSync(repo, { recursive: true })
    for (const id of Object.keys(MOVED)) {
      fs.mkdirSync(path.join(repo, id), { recursive: true })
      fs.writeFileSync(path.join(repo, id, "manifest.json"), JSON.stringify({ id, name: id[0].toUpperCase() + id.slice(1), description: "A stand-in for tests.",
        version: "1.0.0", author: "Vaultite", repo: "Vaultite/plugins", disclosures: {}, ...STANDINS[id] }, null, 2) + "\n")
      if (PAGES[id]) {
        fs.mkdirSync(path.join(repo, id, "pages"))
        fs.writeFileSync(path.join(repo, id, "pages", `${PAGES[id]}.md`), `---\ntype: dashboard\nplugin: ${id}\n---\n\nA stand-in's page.\n`)
      }
    }
    git("init", "-q"); git("add", "-A"); git("commit", "-q", "-m", "stand-ins")
    for (const id of Object.keys(MOVED)) git("tag", `${id}/v1.0.0`)
  }
  return pathToFileURL(dir).href
}

/** Stand-in `id` as tools/pin_bundles.ts pins a real one: the commit its tag names and its files' hash. */
export function standIn(dir: string, id: string) {
  const repo = path.join(dir, "Vaultite", "plugins"), files = fs.mkdtempSync(path.join(dir, "stage-"))
  try {
    stage(path.join(repo, id), path.join(files, id))
    return { tag: `${id}/v1.0.0`, commit: execFileSync("git", ["rev-parse", `${id}/v1.0.0^{commit}`], { cwd: repo, encoding: "utf8" }).trim(), hash: digestOf(path.join(files, id)).content }
  } finally {
    fs.rmSync(files, { recursive: true, force: true })
  }
}

/** The app's bundles copied under `dir` (VAULTITE_BUNDLES), the plugins they install pinned to the stand-ins
 *  officialRepos(dir) made: what applying them installs here. */
export function officialBundles(dir: string): string {
  const out = path.join(dir, "bundles")
  if (fs.existsSync(out)) return out
  fs.cpSync(path.join(import.meta.dirname, "..", "..", "bundles"), out, { recursive: true })
  for (const id of fs.readdirSync(out)) {
    const file = path.join(out, id, "plugins.json")
    if (!fs.existsSync(file)) continue
    const pj = JSON.parse(fs.readFileSync(file, "utf8"))
    for (const [p, x] of Object.entries<Record<string, unknown>>(pj.install ?? {})) pj.install[p] = { ...x, ...standIn(dir, p) }
    fs.writeFileSync(file, JSON.stringify(pj, null, 2) + "\n")
  }
  return out
}
