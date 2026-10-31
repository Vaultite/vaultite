// The iPhone app's shell (Capacitor): `phoneApp` is null in a browser. Which server to load is the shell's first
// screen's choice; this side only takes the user back there (Switch server…).
import type { Haptic } from "@/core/haptics"

export type Server = { url: string; name: string }
export type ShellPlugin = {
  /** The servers it knows, and the one it opened last (its address). */
  servers: () => Promise<{ servers: Server[]; last?: string }>
  setServers: (o: { servers: Server[] }) => Promise<void>
  /** Is a Vaultite server answering there? `error`: why not, in the system's words. */
  probe: (o: { url: string }) => Promise<{ ok: boolean; error?: string }>
  /** Load a server's app in place of this page (remembered as the last one). */
  open: (o: { url: string }) => Promise<void>
  /** Back to the first screen, which doesn't open the last server by itself this time. */
  launcher: () => Promise<void>
  /** A picture of part of the page as it's drawn now (CSS pixels), `scaled` points wide: a JPEG data URL. Rejects in
   *  an app built before it had this. */
  snapshot: (o: { x: number; y: number; width: number; height: number; scaled: number; quality?: number }) => Promise<{ url: string }>
  /** A tap from the phone's Taptic Engine (core/haptics.ts). Rejects in an app built before it had this. */
  haptic: (o: { weight: Haptic }) => Promise<void>
  /** What a widget, a shortcut or a link asked for, taken once: a command (vaultite://command/<id>), a file to open
   *  (vaultite://open/<path>) or a bundle's preview (vaultite://bundle/<owner>/<name>). Rejects in an older app. */
  pending: () => Promise<{ command?: string; open?: string; bundle?: string }>
  /** Keep a vault file on this iPhone (App/Downloads.swift), fetched in the background from `url`. The rest reject in
   *  an app built before it had them. */
  download: (o: { url: string; path: string; title: string }) => Promise<void>
  downloads: () => Promise<{ items: PhoneDownload[] }>
  removeDownload: (o: { path: string }) => Promise<void>
  /** Where playback of a kept file stopped on the first screen, kept until the server's page takes it (once). */
  setPlace: (o: { path: string; t: number; d: number; at: number }) => Promise<void>
  takePlaces: () => Promise<{ places: { path: string; t: number; d?: number; at: number }[] }>
  /** Apple Health for this page's server (App/Health.swift); setHealth asks Health for access the first time. The
   *  three reject in an app built before it had them. */
  health: () => Promise<PhoneHealth>
  setHealth: (o: { on: boolean; route?: string }) => Promise<PhoneHealth>
  resendHealth: () => Promise<void>
  /** Audio played by the shell (App/Audio.swift), so a reload or iOS ending the page doesn't stop it; each answers its
   *  state, and what changes comes as the event `vaultite:audio`. Missing in an app built before it had them. */
  audioLoad: (o: { path: string; url: string; from?: string; t?: number; rate: number } & PhoneAudioInfo) => Promise<PhoneAudioState>
  audioPlay: () => Promise<PhoneAudioState>
  audioPause: () => Promise<PhoneAudioState>
  audioSeek: (o: { t: number }) => Promise<PhoneAudioState>
  audioRate: (o: { rate: number }) => Promise<PhoneAudioState>
  audioInfo: (o: PhoneAudioInfo) => Promise<PhoneAudioState>
  audioStop: () => Promise<PhoneAudioState>
  audioState: () => Promise<PhoneAudioState>
  /** The sleep timer: stop at `until` (ms), or at the end of the chapter; neither clears it. */
  audioSleep: (o: { until?: number; chapter?: boolean }) => Promise<PhoneAudioState>
}
/** What the lock screen shows: with chapters, the one playing as the title. `artwork`: a full address. */
export type PhoneAudioInfo = { title: string; artist: string; album: string; artwork?: string; chapters: { t: number; title: string }[] }
/** The shell's audio: `path` while a file is loaded; `waiting` while it should play but hasn't the data; `type` (in the
 *  event) what changed. */
export type PhoneAudioState = { path?: string; from?: string; t?: number; d?: number; rate: number; paused: boolean; ended: boolean; waiting: boolean; error?: string; type?: string }
/** What the phone's Apple Health sync is doing: `sent` counts what it posted (sleep samples, workouts, days); `phase`
 *  and `progress` (0-1) while it goes through the history; `done` once the history is in. */
export type PhoneHealth = { available: boolean; asked: boolean; on: boolean; syncing: boolean; done?: boolean; phase?: string; progress?: number;
  last?: string; error?: string; sent?: { sleep?: number; workouts?: number; days?: number } }
/** A file kept on the phone: `file` where it is once `done`, `got` of `size` bytes meanwhile. */
export type PhoneDownload = { path: string; title: string; server: string; size: number; got: number; done: boolean; file?: string; error?: string }

/** What the shell's native side puts on every page it loads (its native-bridge.js): no @capacitor/core in the app. */
type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  PluginHeaders?: { name: string; methods: { name: string }[] }[]
  nativePromise: (plugin: string, method: string, options?: object) => Promise<unknown>
}
const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor
const call = (method: string) => (options?: object) => cap!.nativePromise("Shell", method, options ?? {}) as Promise<never>
export const phoneApp: ShellPlugin | null = cap?.isNativePlatform?.() && cap.isPluginAvailable?.("Shell")
  ? { servers: call("servers"), setServers: call("setServers"), probe: call("probe"), open: call("open"), launcher: call("launcher"), snapshot: call("snapshot"), haptic: call("haptic"), pending: call("pending"),
    download: call("download"), downloads: call("downloads"), removeDownload: call("removeDownload"), setPlace: call("setPlace"), takePlaces: call("takePlaces"),
    health: call("health"), setHealth: call("setHealth"), resendHealth: call("resendHealth"),
    audioLoad: call("audioLoad"), audioPlay: call("audioPlay"), audioPause: call("audioPause"), audioSeek: call("audioSeek"), audioRate: call("audioRate"),
    audioInfo: call("audioInfo"), audioStop: call("audioStop"), audioState: call("audioState"), audioSleep: call("audioSleep") }
  : null
/** Whether this app's shell has a method (one built before it may not). */
const shellHas = (method: string) => !!cap?.PluginHeaders?.find((p) => p.name === "Shell")?.methods.some((m) => m.name === method)
/** Open the iPhone app's own voice note (a widget's `vaultite://record`: App/VoiceNote.swift): Capacitor hands an
 *  address it doesn't serve to the system, which gives it back to the app. False in a browser. */
export function phoneVoiceNote() {
  if (!phoneApp) return false
  location.href = "vaultite://record"
  return true
}
// So a terminal opened here tells its shell it's the iPhone app (VAULTITE_CLIENT=iphone, plugins/core/terminal).
if (phoneApp) document.cookie = "vaultite_client=iphone; path=/; max-age=31536000; samesite=strict"

/** Do what the phone's widgets, shortcuts and links ask for (a palette command, a file to open, a bundle's preview): now,
 *  and whenever the shell says there's one (the event `vaultite:link`). Each is false while it can't yet (the app still starting). */
export function takeLinks(run: { command: (id: string) => boolean; open: (path: string) => boolean; bundle: (repo: string) => boolean }) {
  if (!phoneApp) return () => {}
  const take = () => phoneApp!.pending().then(({ command, open, bundle }) => {
    const act = command ? () => run.command(command) : open ? () => run.open(open) : bundle ? () => run.bundle(bundle) : null
    if (!act) return
    let tries = 0
    const go = () => { if (!act() && ++tries < 40) setTimeout(go, 150) }
    go()
  }, () => {})
  take()
  addEventListener("vaultite:link", take)
  return () => removeEventListener("vaultite:link", take)
}

/** The phone's kept files, for a player (null outside the iPhone app). */
export const phoneFiles = phoneApp
  ? { download: phoneApp.download, list: phoneApp.downloads, remove: phoneApp.removeDownload, takePlaces: phoneApp.takePlaces }
  : null

/** The shell's audio player, for the player (null outside the iPhone app, or in one built before it). */
export const phoneAudio = phoneApp && shellHas("audioLoad")
  ? { load: phoneApp.audioLoad, play: phoneApp.audioPlay, pause: phoneApp.audioPause, seek: phoneApp.audioSeek, rate: phoneApp.audioRate,
    info: phoneApp.audioInfo, stop: phoneApp.audioStop, state: phoneApp.audioState, sleep: phoneApp.audioSleep }
  : null

/** The phone's Apple Health, for a plugin that takes it (null outside the iPhone app): `route` is where the server
 *  takes what it reads (after /api/). */
export const phoneHealth = phoneApp
  ? { status: phoneApp.health, set: (on: boolean, route?: string) => phoneApp!.setHealth({ on, route }), resend: phoneApp.resendHealth }
  : null
