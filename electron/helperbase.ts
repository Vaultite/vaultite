import { Notification, shell, type WebContents } from "electron"
import fs from "node:fs"
import path from "node:path"
import { privateApp } from "../core/privateapps.ts"
import type { DictationSink } from "./dictation.ts"
import type { HomeWindow } from "./cursorhandoff.ts"
import type { HeldClick, Point, Prefs } from "./helperlogic.ts"
import type { Press } from "./presslog.ts"
import type { Phase, PressMachine } from "./pressmachine.ts"
import type { AppWindowInfo, Focus, Rect } from "./screen.ts"
import { happened } from "./timeline.ts"
import { asked, QUIET } from "./helperask.ts"

export type Home = { port: number; path: string; name: string }
/** This Mac's say (vaults.json): open at login, and the notice about macOS acting on fn too, shown. */
export type HelperPrefs = { login?: boolean; fnNotice?: boolean }
/** Dictation is the main process's (its windows dictate too, and hand a dictation over): the helper uses that one,
 *  never a copy of its own, so a helper reloaded from another code root shares its one recognizer and owner. */
export type Dictation = Pick<typeof import("./dictation.ts"), "dictate" | "dictating" | "keptLanded" | "stopFor" | "dictationEngines" | "expectedWords"
  | "freeFor" | "handOver" | "onAudioDevices" | "onDictating" | "onRoam" | "releaseMic">
export type HelperHost = {
  dictation: Dictation
  home: () => Home | null
  /** Open (or bring forward) the home vault's window; none known: the vaults list. */
  openHome: () => void
  /** The focused vault window's page while this app is in front: fn is its ⌘J there. */
  focusedPage: () => WebContents | null
  /** The home vault's window while it's on screen (not minimized): its page, where its page is (points), its zoom. */
  homeWindow: () => HomeWindow | null
  /** Tell every vault's server unasked (core/desktopapp.ts onDesktopEvent). */
  event: (name: string, data: unknown) => void
  prefs: () => HelperPrefs
  setPrefs: (p: HelperPrefs) => void
  quit: () => void
  /** The tray's icon (a template image). */
  icon: string
}
export let host: HelperHost | null = null
/** The host's dictation (kept after a stop: what's still in flight there asks it). */
let dictation: Dictation | null = null
const via = <K extends keyof Dictation>(k: K) => ((...a: unknown[]) => (dictation![k] as (...a: unknown[]) => unknown)(...a)) as Dictation[K]
export const dictate = via("dictate"), dictating = via("dictating"), keptLanded = via("keptLanded"), stopFor = via("stopFor"), dictationEngines = via("dictationEngines"),
  expectedWords = via("expectedWords"), freeFor = via("freeFor"), handOver = via("handOver"), releaseMic = via("releaseMic")
const manifest = (id: string) => {
  try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "plugins", "core", id, "manifest.json"), "utf8")).settings ?? {} } catch { return {} }
}
/** The settings' defaults, from the manifests as they are now (read with the settings: a new one needs no relaunch). */
export const defaults = () => ({ dictation: manifest("dictation"), companion: manifest("companion"), screen: manifest("screen") })
const DEFAULTS = defaults()
/** The home vault's settings that the helper follows, their defaults the manifests' (read every 10 s and after a change). */
export let prefs: Prefs = { fn: true, keys: DEFAULTS.dictation.keys?.default ?? [], talk: DEFAULTS.companion.keys?.default ?? [], privateApps: DEFAULTS.screen.private_apps?.default ?? [], dictation: {},
  voice: { mode: "auto", provider: "auto", name: "", eleven: { voice: "", model: "" }, speed: 1 }, sounds: true,
  realtime: { front: "realtime", model: "gpt-realtime-2.1-mini", voice: "cedar" }, jobNews: String(DEFAULTS.companion.job_news?.default ?? "quiet"), timeline: false,
  hideFromShares: true, quietOnCalls: true }
export let based = ""
export async function op(id: string, body: Record<string, unknown> = {}) {
  const home = host?.home()
  if (!home) throw new Error("no vault is open")
  const r = await fetch(`http://127.0.0.1:${home.port}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${id} answered ${r.status}`)
  return r.json() as Promise<Record<string, unknown>>
}
export type Agent = { name: string; tint: string; state: string; t?: number; seen?: boolean; why?: string; app?: string; window?: number; find?: string; sx?: number; sy?: number; display?: number; path?: string
  /** Its place in the app, off a note: a pane (a terminal's row), the app's UI; a note's line. */
  line?: number; pane?: string; row?: number; ui?: string
  /** What it points at on screen (an element of an ask's list): its words never cover it. */
  frame?: Rect
  runs?: string; model?: string; effort?: string }
export type Note = { id: string; kind: string; agent: string; t: number; text?: string; question?: boolean; dismissed?: number; seen?: boolean
  /** A say answering a Talk key's ask (on screen or in the app): when it was asked, whether it was said, its language;
   *  `realtime`: the realtime voice's own words, said already. */
  answers?: { t: number; voice?: boolean; lang?: string; realtime?: boolean } }
export let front: AppWindowInfo | null = null
export const hidden = (a: { bundle?: string; name?: string } | null) => !!a && privateApp(a, prefs.privateApps)
export const frontHappened = () => { if (front) happened({ t: Date.now(), kind: "app", ...(hidden(front) ? { app: "", name: "", private: true } : { app: front.bundle, name: front.name, title: front.title }) }) }
const said = new Set<string>()
/** A notice once a launch (`once`: once ever, kept in vaults.json under that name); a click opens `link`. */
export function notice(key: string, title: string, body: string, link?: string, once?: "fnNotice") {
  if (QUIET) return void asked.push({ notice: key })
  if (said.has(key) || !Notification.isSupported()) return
  said.add(key)
  const n = new Notification({ title, body, silent: true })
  if (link) n.on("click", () => void shell.openExternal(link))
  n.show()
  if (once) host?.setPrefs({ [once]: true })
}
/** The helper's own session: words into a field, a cursor's conversation, the companion summoned (`summon`: sent when
 *  let go) or hands-free (`free`: a QA walk's or a lesson's, freeBy's); `talk`: a Talk key's, sent when it stops. */
export type Session = { sink: DictationSink; into: "field" | "panel" | "summon" | "free"; focus: Focus; finals: string[]; pending: string; level: number; ready: boolean
  talk?: boolean
  /** The mic it hears with is a Bluetooth one: held open after, till its answer is said (holdMic). */
  bluetooth?: boolean
  /** The summoned companion its words are for (a new press may summon another before they're done). */
  of?: Summon
  /** Hands-free (a double tap): on till the next press. */
  free?: boolean
  /** It began in a window of ours (a note, a terminal, a field): that page keeps where. */
  origin?: WebContents
  /** Why it stopped by itself: said once it's over. */
  failed?: string
  log?: Press }
/** The companion called up outside Vaultite: its cursor at the pointer (listening, then thinking), the window there, the
 *  pointer's trail while the key is held (`released`: when it was let go); `was`: where its own cursor was. */
export type Summon = { name: string; tint: string; p: Point; w: AppWindowInfo | null; trail: (Point & { t: number })[]; released?: number
  at: number; was: string
  /** Its cursor may show (a moment after the press: `appear`). */
  appeared?: boolean
  /** Where the press is (pressmachine.ts), each move in its log. */
  m: PressMachine
  /** Words heard before the recognizer stopped while it was held: sent once it's let go. */
  heard?: string
  /** Its turn on the ask seen at work (the agent's state, the server's): only then can it be over. */
  begun?: boolean
  /** Its press went nowhere: what its cursor says a moment ("Didn't catch that"). */
  missed?: string
  /** Its press, in the log of presses. */
  press?: Press | null
  /** What they clicked while it was held (each went on to the app): where, and what Accessibility read there. */
  clicks?: Promise<HeldClick>[]
  /** Its coming was cued. */
  cued?: boolean
  /** Its words are in the timeline. */
  told?: boolean
  /** What's at the point let go at, gathered as its words are finished (not after). */
  place?: Promise<{ w: AppWindowInfo | null; place: Record<string, unknown> }>
  /** The display as the key went down: a toast or a menu there then may be gone by the let-go. */
  down?: Promise<Shot | null> }
/** The exchange its answer is in: its box open by the point asked about (and the window there), since `since`. */
export type Exchange = { name: string; p: Point; w: AppWindowInfo | null; since: number
  /** Its answer is spoken: no box (its cursor, its voice and its marks say it); a tap of the key opens one. */
  spoken?: boolean
  /** Its answer began coming (its first words, a drawing). */
  arrived?: boolean }
export type Shot = { file: string; frame: Rect }
/** A word in the dictation pill's place, a moment: a key pressed where it does nothing. */
export let hinted: { text: string; until: number } | null = null
export function hint(text: string, ms = 2200) {
  hinted = { text, until: Date.now() + ms }
  draw()
  setTimeout(draw, ms + 50)
}
export const BUSY = new Set(["thinking", "reading", "writing", "starting"])
export const HELD = new Set<Phase>(["listening", "failed"])

let redraw = () => {}
/** The overlay drawn again (helpercursor.ts draw): set by helper.ts, above every part that asks for it. */
export const draw = () => redraw()
export const drawWith = (fn: () => void) => { redraw = fn }
export const hostIs = (h: HelperHost | null) => { host = h; if (h) dictation = h.dictation }
export const prefsAre = (p: Prefs) => { prefs = p }
export const basedAt = (base: string) => { based = base }
export const frontIs = (f: AppWindowInfo) => { front = f }
