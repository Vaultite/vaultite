// A made-up Vaultite/plugins here, so tests installing Vaultite's own plugins (core/migrations.ts MOVED) never reach
// GitHub: each a stub tagged <id>/v1.0.0, with a page where the real one has one (bundles pin them).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { MOVED } from "../../core/migrations.ts"

const PAGES: Record<string, string> = { health: "Health", learning: "Learning", projects: "Projects", today: "Today" }

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
        version: "1.0.0", author: "Vaultite", repo: "Vaultite/plugins", disclosures: {} }, null, 2) + "\n")
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
