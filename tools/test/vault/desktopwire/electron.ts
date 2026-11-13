// Electron stood in for (any property, call or `new`); with VAULTITE_FAKE_HELPERS, the Swift helpers are fakes.ts'.
import { registerHooks } from "node:module"

const NAMES = ["app", "autoUpdater", "BaseWindow", "BrowserWindow", "clipboard", "desktopCapturer", "dialog", "globalShortcut", "ipcMain", "Menu", "nativeImage",
  "nativeTheme", "Notification", "powerMonitor", "powerSaveBlocker", "safeStorage", "screen", "session", "shell", "systemPreferences", "Tray", "WebContentsView"]
const SOURCE = `const f = function () {}
const settled = (ok) => ok?.(undefined)
const p = new Proxy(f, { get: (_t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? settled : p), apply: () => p, construct: () => p })
const folder = ${JSON.stringify(process.env.VAULTITE_FAKE_HELPERS ?? "/nonexistent")}
export const app = new Proxy(f, { get: (_t, k) => (k === "getPath" ? () => folder : p[k]), apply: () => p })
${NAMES.flatMap((n) => (n === "app" ? [] : [`export const ${n} = p`])).join("\n")}
export default p`
const FAKES = process.env.VAULTITE_FAKE_HELPERS
const HELPERS = ["screen", "capture", "takeover", "voice", "appWindows", "dictation"]
const SWIFT = `${HELPERS.map((h) => `export const ${h}Swift = { binary: async () => ${JSON.stringify(`${FAKES}/${h}`)} }`).join("\n")}
export const run = () => ({ ok: false, err: "" }), swiftHelper = () => ({}), parakeetModel = () => null`
const STUBS = new Map<string, string>([["electron", SOURCE], ...(FAKES ? [["./swiftbuild.ts", SWIFT], ["./dictation-build.ts", SWIFT]] satisfies [string, string][] : [])])
registerHooks({
  resolve: (spec, ctx, next) => (STUBS.has(spec) ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url.startsWith("stub:") ? { format: "module" as const, source: STUBS.get(url.slice(5)) ?? "", shortCircuit: true } : next(url, ctx)),
})
