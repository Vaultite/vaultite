// npm run app [-- --vault <path>]: the desktop app from this checkout, building the web app first when it's stale.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const built = (() => {
  try {
    return Math.min(...["index.html", "vaults.html", "onboarding.html"].map((f) => fs.statSync(path.join(ROOT, "web", "dist", f)).mtimeMs))
  } catch {
    return 0
  }
})()

/** The newest source file of the web app (web/src, the plugins' frontends). */
function newest(dir: string): number {
  let t = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "qa" || e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    t = Math.max(t, e.isDirectory() ? newest(p) : /\.(tsx?|css|html)$/.test(e.name) ? fs.statSync(p).mtimeMs : 0)
  }
  return t
}

if (built < Math.max(newest(path.join(ROOT, "web")), newest(path.join(ROOT, "plugins")))) {
  const r = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" })
  if (r.status) process.exit(r.status)
}
// npm may skip install scripts (allowScripts), and Electron's downloads its binary: fetch it when it's missing.
if (!fs.existsSync(path.join(ROOT, "node_modules", "electron", "path.txt"))) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "electron", "install.js")], { cwd: ROOT, stdio: "inherit" })
  if (r.status) process.exit(r.status)
}
const electron = path.join(ROOT, "node_modules", ".bin", "electron")
const r = spawnSync(electron, [ROOT, ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" })
process.exit(r.status ?? 0)
