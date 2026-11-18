import fs from "node:fs"
import path from "node:path"

export function appsOn(vault: string) {
  if (process.platform !== "darwin") return false
  try {
    const c = JSON.parse(fs.readFileSync(path.join(vault, ".vaultite", "plugins.json"), "utf8"))
    return Array.isArray(c.enabled) && c.enabled.includes("app-windows") && !(Array.isArray(c.disabled) && c.disabled.includes("app-windows")) &&
      fs.existsSync(path.join(vault, ".vaultite", "plugins", "app-windows", "manifest.json"))
  } catch { return false }
}
