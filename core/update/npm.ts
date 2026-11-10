// What an npm install leaves wrong, fixed after each (a service's checkout, a store's deps set).
import fs from "node:fs"
import path from "node:path"

/** node-pty's helper loses its exec bit in an npm install, and terminals then fail (Setup.md). */
export function fixSpawnHelper(modules: string) {
  const dir = path.join(modules, "node-pty", "prebuilds")
  try {
    for (const d of fs.readdirSync(dir)) if (d.startsWith("darwin-")) {
      const f = path.join(dir, d, "spawn-helper")
      if (fs.existsSync(f)) fs.chmodSync(f, 0o755)
    }
  } catch { /* no prebuilds here (Linux builds its own) */ }
}
