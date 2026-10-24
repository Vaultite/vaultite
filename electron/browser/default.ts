// Vaultite as the Mac's web browser: links from other apps open in a web tab (main.ts appLink). macOS asks the user to
// confirm; the browser that was the default before is kept, for "Open in another browser" (else it'd come back here).
import { app, shell } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { handle } from "./engine.ts"

const isDefault = () => app.isDefaultProtocolClient("https") && app.isDefaultProtocolClient("http")
const keptFile = () => path.join(app.getPath("userData"), "other-browser.json")
const otherBrowser = (): string | null => {
  try { const p = JSON.parse(fs.readFileSync(keptFile(), "utf8")).path; return typeof p === "string" && fs.existsSync(p) ? p : null } catch { return null }
}

/** An http(s) address in the user's other browser: the system's default, or while that's Vaultite, the one before it
 *  (Safari if none was kept). */
export function openElsewhere(url: string) {
  if (process.platform !== "darwin" || !isDefault()) return void shell.openExternal(url).catch(console.error)
  const other = otherBrowser()
  execFile("/usr/bin/open", other ? ["-a", other, url] : ["-b", "com.apple.Safari", url], (e) => { if (e) console.error("vaultite: couldn't open another browser:", e.message) })
}

handle("browser:default", () => isDefault())
handle("browser:make-default", async () => {
  // (Windows keeps the choice to its Settings: registering the schemes here would change nothing it uses)
  if (process.platform === "win32") return false
  if (!isDefault()) {
    const was = await app.getApplicationInfoForProtocol("https://").catch(() => null)
    const own = path.dirname(path.dirname(path.dirname(app.getPath("exe"))))
    if (was?.path && path.resolve(was.path) !== own) { try { fs.writeFileSync(keptFile(), JSON.stringify({ name: was.name, path: was.path })) } catch { /* Safari then */ } }
  }
  app.setAsDefaultProtocolClient("http")
  app.setAsDefaultProtocolClient("https")
  return isDefault()
})
