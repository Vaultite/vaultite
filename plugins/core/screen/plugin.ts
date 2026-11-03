// What agents see of the user's Mac outside Vaultite, through this machine's desktop app (electron/helper.ts): the app in
// front (told unasked, metadata only), a window's text and its picture (asked). Private apps never reach them.
import { inDesktop, OpError, Plugin, privateApp } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** The app in front and its window, as the desktop app last told; `private`: one of the private apps (nothing more). */
export type Front = { app: string; name: string; title: string; window: number; at: number; vaultite?: boolean } | { private: true; at: number }
let front: Front | null = null

const DEFAULT = (plugin.manifest.settings?.private_apps?.default ?? []) as string[]
export const privateApps = (): string[] => { const l = plugin.settings().private_apps; return Array.isArray(l) ? l.map(String) : DEFAULT }
const hidden = (a: { app?: string; bundle?: string; name?: string }) => privateApp({ bundle: a.bundle ?? a.app, name: a.name }, privateApps())

plugin.onDesktopEvent((name, data) => {
  if (name !== "screen:front" || !data || typeof data !== "object") return
  const d = data as Record<string, unknown>
  const a = { app: String(d.bundle ?? ""), name: String(d.name ?? ""), title: String(d.title ?? "").slice(0, 300), window: Number(d.window) || 0, at: Date.now() }
  front = hidden(a) ? { private: true, at: a.at } : { ...a, ...(d.vaultite === true ? { vaultite: true } : {}) }
})
/** For pair mode's awareness: what's in front now, or null when no desktop app said. */
plugin.provide("screen:front", () => front)

async function ask(name: string, args: Record<string, unknown>) {
  if (!inDesktop()) throw new OpError("the screen is the desktop app's: open Vaultite on the Mac whose screen it is", 409)
  return await plugin.desktop(name, args) as Record<string, unknown>
}
const why = (r: Record<string, unknown>) => (r.why === "private" ? "it's one of the private apps (screen settings)" : r.why === "no-window" ? "there's no such window" : String(r.why ?? "it didn't answer"))

const APP = { type: "string", description: "an app's bundle id or name: its focused window (default: the app in front)" } as const
const WINDOW = { type: "integer", minimum: 1, description: "a window's number (CGWindowID), as screen.front or a moment names it" } as const

plugin.op({
  id: "screen.front", cli: "screen", owner: "the screen", kind: "read", lock: false,
  summary: "The app and window in front on the user's Mac (its name and title only).",
  params: {},
  run: () => front ?? { none: true },
  text: (r) => ("none" in r ? "No desktop app has said what's in front." : "private" in r ? "A private app is in front." :
    `${r.name}${r.title ? `: ${JSON.stringify(r.title)}` : ""} (${r.app}, window ${r.window})${r.vaultite ? ", Vaultite itself" : ""}.`),
})

plugin.op({
  id: "screen.text", cli: "screen text", owner: "the screen", kind: "read", lock: false,
  summary: "What a window on the user's Mac says: its text, buttons and fields, read with macOS's Accessibility (never a password field's).",
  help: `The focused window of the app in front, of --app, or --window. Point at something in it with
companion say --app <bundle id> --find <its text>.

  vau screen text
  vau screen text --app com.apple.Safari`,
  params: { app: APP, window: WINDOW, max: { type: "integer", minimum: 100, maximum: 100_000, default: 20_000, description: "the most characters" } },
  run: async (p) => {
    const r = await ask("screen:text", { app: p.app, window: p.window, max: p.max })
    if (!r.ok) throw new OpError(`Couldn't read the window: ${why(r)}`, r.why === "private" ? 403 : 404)
    if (hidden({ app: String(r.bundle), name: String(r.name) })) throw new OpError("Couldn't read the window: it's one of the private apps", 403)
    return { app: r.bundle, name: r.name, title: r.title, window: r.window, text: r.text }
  },
  text: (r) => `${r.name}: ${JSON.stringify(r.title ?? "")} (${r.app}, window ${r.window})\n\n${r.text || "(it says nothing to Accessibility)"}`,
})

plugin.op({
  id: "screen.shot", cli: "screen shot", owner: "the screen", kind: "read", lock: false,
  summary: "A picture of a window on the user's Mac, as a PNG file on this machine (read it to see it).",
  help: `The focused window of the app in front, of --app, or --window. It needs Vaultite's screen recording permission.

  vau screen shot
  vau screen shot --window 4211`,
  params: { app: APP, window: WINDOW },
  run: async (p) => {
    const r = await ask("screen:shot", { app: p.app, window: p.window })
    if (!r.ok) throw new OpError(`Couldn't take its picture: ${why(r)}`, r.why === "private" ? 403 : 404)
    return { file: r.file, app: r.bundle, name: r.name, title: r.title, window: r.window }
  },
  text: (r) => `${r.file} (${r.name}: ${JSON.stringify(r.title ?? "")}, window ${r.window})`,
})
