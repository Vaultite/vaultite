// Whether a checkout's web app (web/dist) is older than its sources: npm run app and npm run app:dev build it first.
import fs from "node:fs"
import path from "node:path"

/** The newest source file of the web app under `dir` (web/src, the plugins' frontends). */
function newest(dir: string): number {
  let t = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "qa" || e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    t = Math.max(t, e.isDirectory() ? newest(p) : /\.(tsx?|css|html)$/.test(e.name) ? fs.statSync(p).mtimeMs : 0)
  }
  return t
}

/** web/dist at `root` is missing or older than a source of it. */
export function webStale(root: string) {
  let built = 0
  try { built = Math.min(...["index.html", "vaults.html", "onboarding.html"].map((f) => fs.statSync(path.join(root, "web", "dist", f)).mtimeMs)) } catch { /* not built */ }
  return built < Math.max(newest(path.join(root, "web")), newest(path.join(root, "plugins")))
}
