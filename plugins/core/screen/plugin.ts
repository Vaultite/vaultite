// What agents see of the user's Mac outside Vaultite, through this machine's desktop app (electron/helper.ts): the app in
// front (told unasked, metadata only), a window's text and its picture (asked). Private apps never reach them.
import { inDesktop, OpError, Plugin, privateApp } from "../../../core/plugins.ts"
import { type Happened, KINDS, offWhy, timelineLines } from "./timeline.ts"

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

const time = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Date.parse(v) : undefined)
plugin.op({
  id: "screen.timeline", cli: "screen timeline", owner: "the screen", kind: "read", lock: false,
  summary: "What happened on the user's Mac lately, on one clock: the pointer and their box (the last 30 s), the app in front, clicks (what was clicked), shortcuts, fields typed into and what they said to the companion (5 minutes); with clip, its video saved now.",
  help: `Kept in memory by the desktop app only while the companion is on and its setting timeline (Keep the last 30 s of
screen, off by default) is: nothing before that, nothing on disk till asked, never a private app. Off, it says so: tell
them in one short line and offer to turn it on (on their yes, vau screen keep). A stretch is the last seconds
(last), a time range (from, to), or from when they last said some words (said) on. With clip, its video (the display
under the pointer, or box: screen points) is saved as an MP4 on this Mac with a frame at each change: read the frames.

  vau screen timeline --last 20
  vau screen timeline --said "it blinks" --clip
  vau screen timeline --last 10 --kinds click --kinds said`,
  params: {
    last: { type: "number", minimum: 1, maximum: 300, description: "the last seconds (past 30, only what was done: kinds app, click, key, field, said)" },
    from: { type: "string", description: "from when (ISO time, or ms since 1970)" }, to: { type: "string", description: "till when (default: now)" },
    said: { type: "string", description: "from when they last said these words to the companion (its Talk key) on" },
    kinds: { type: "array", items: { type: "string", enum: KINDS }, description: "only these (pointer, app, click, key, field, said, box, thing)" },
    clip: { type: "boolean", description: "its video too, saved now" },
    box: { type: "object", description: "the clip's crop: { x, y, width, height } in screen points (default: the user's box then, else the display)" },
  },
  run: async (p) => {
    const r = await ask("screen:timeline", { last: p.last, from: time(p.from), to: time(p.to), said: p.said, kinds: p.kinds, clip: p.clip === true, box: p.box })
    if (!r.ok) throw new OpError(`No timeline: ${offWhy(String(r.why ?? "it didn't answer"))}`, 409)
    const events = (r.events ?? []) as Happened[], from = Number(r.from), clip = r.clip as { file: string; ms: number; frames: { t: number; file: string }[] } | undefined
    return { from: new Date(from).toISOString(), to: new Date(Number(r.to)).toISOString(), events: events.map((e) => ({ ...e, at: e.t - from })), lines: timelineLines(events, from),
      ...(clip ? { clip: clip.file, frames: clip.frames } : r.clipWhy ? { clipWhy: r.clipWhy } : {}) }
  },
  text: (r) => [`From ${r.from} to ${r.to}:`, ...(r.lines.length ? r.lines : ["(nothing happened)"]),
    ...(r.clip ? [`Its clip: ${r.clip}`, `Frames: ${r.frames.map((f: { t: number; file: string }) => `${(f.t / 1000).toFixed(1)} s ${f.file}`).join(", ")}`] : r.clipWhy ? [`No clip: ${r.clipWhy}`] : [])].join("\n"),
})

plugin.op({
  id: "screen.keep", cli: "screen keep", owner: "the screen", kind: "write",
  summary: "Turn the screen's timeline on (the companion's setting timeline, Keep the last 30 s of screen), only on the user's yes, or off: it keeps from then, never what came before.",
  help: `Off by default, the user's choice: turn it on only when they said yes to your offer (something they asked for needs
it: "that, just now", what they just did), then say it keeps from now and the last 30 s weren't kept. Off forgets
what's kept.

  vau screen keep
  vau screen keep --off`,
  params: { off: { type: "boolean", description: "turn it off instead (what's kept is forgotten)" } },
  run: async (p, ctx) => {
    const on = p.off !== true
    await ctx.op("settings.set", { name: "plugin/companion", values: { timeline: on } })
    return { on, said: on ? "It keeps the last 30 s of your screen from now (in memory only); what came before wasn't kept." : "It keeps nothing of your screen now." }
  },
  text: (r) => r.said,
})
