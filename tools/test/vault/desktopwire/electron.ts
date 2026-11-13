// Electron stood in for: each export takes any property, call or `new`, and is undefined awaited.
import { registerHooks } from "node:module"

const NAMES = ["app", "autoUpdater", "BaseWindow", "BrowserWindow", "clipboard", "desktopCapturer", "dialog", "globalShortcut", "ipcMain", "Menu", "nativeImage",
  "nativeTheme", "Notification", "powerMonitor", "powerSaveBlocker", "safeStorage", "screen", "session", "shell", "systemPreferences", "Tray", "WebContentsView"]
const SOURCE = `const f = function () {}
const settled = (ok) => ok?.(undefined)
const p = new Proxy(f, { get: (_t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? settled : p), apply: () => p, construct: () => p })
${NAMES.map((n) => `export const ${n} = p`).join("\n")}
export default p`
const URL = "stub:electron"
registerHooks({
  resolve: (spec, ctx, next) => (spec === "electron" ? { url: URL, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url === URL ? { format: "module", source: SOURCE, shortCircuit: true } : next(url, ctx)),
})
