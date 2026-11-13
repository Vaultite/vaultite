import type { Haptic } from "@/core/haptics"

export type Server = { url: string; name: string }
export type ShellPlugin = {
  servers: () => Promise<{ servers: Server[]; last?: string }>
  setServers: (o: { servers: Server[] }) => Promise<void>
  probe: (o: { url: string }) => Promise<{ ok: boolean; error?: string }>
  open: (o: { url: string }) => Promise<void>
  launcher: () => Promise<void>
  snapshot: (o: { x: number; y: number; width: number; height: number; scaled: number; quality?: number }) => Promise<{ url: string }>
  haptic: (o: { weight: Haptic }) => Promise<void>
  pending: () => Promise<{ command?: string; open?: string; bundle?: string }>
  download: (o: { url: string; path: string; title: string }) => Promise<void>
  downloads: () => Promise<{ items: PhoneDownload[] }>
  removeDownload: (o: { path: string }) => Promise<void>
  setPlace: (o: { path: string; t: number; d: number; at: number }) => Promise<void>
  takePlaces: () => Promise<{ places: { path: string; t: number; d?: number; at: number }[] }>
  health: () => Promise<PhoneHealth>
  setHealth: (o: { on: boolean; route?: string }) => Promise<PhoneHealth>
  resendHealth: () => Promise<void>
  audioLoad: (o: { path: string; url: string; from?: string; t?: number; rate: number } & PhoneAudioInfo) => Promise<PhoneAudioState>
  audioPlay: () => Promise<PhoneAudioState>
  audioPause: () => Promise<PhoneAudioState>
  audioSeek: (o: { t: number }) => Promise<PhoneAudioState>
  audioRate: (o: { rate: number }) => Promise<PhoneAudioState>
  audioInfo: (o: PhoneAudioInfo) => Promise<PhoneAudioState>
  audioStop: () => Promise<PhoneAudioState>
  audioState: () => Promise<PhoneAudioState>
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

export type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  PluginHeaders?: { name: string; methods: { name: string }[] }[]
  nativePromise: (plugin: string, method: string, options?: object) => Promise<unknown>
}
const cap = globalThis.Capacitor
const call = (method: string) => (options?: object) => cap!.nativePromise("Shell", method, options ?? {}) as Promise<never>
export const phoneApp: ShellPlugin | null = cap?.isNativePlatform?.() && cap.isPluginAvailable?.("Shell")
  ? { servers: call("servers"), setServers: call("setServers"), probe: call("probe"), open: call("open"), launcher: call("launcher"), snapshot: call("snapshot"), haptic: call("haptic"), pending: call("pending"),
    download: call("download"), downloads: call("downloads"), removeDownload: call("removeDownload"), setPlace: call("setPlace"), takePlaces: call("takePlaces"),
    health: call("health"), setHealth: call("setHealth"), resendHealth: call("resendHealth"),
    audioLoad: call("audioLoad"), audioPlay: call("audioPlay"), audioPause: call("audioPause"), audioSeek: call("audioSeek"), audioRate: call("audioRate"),
    audioInfo: call("audioInfo"), audioStop: call("audioStop"), audioState: call("audioState"), audioSleep: call("audioSleep") }
  : null
const shellHas = (method: string) => !!cap?.PluginHeaders?.find((p) => p.name === "Shell")?.methods.some((m) => m.name === method)
/** Open the iPhone app's own voice note (a widget's `vaultite://record`: App/VoiceNote.swift): Capacitor hands an
 *  address it doesn't serve to the system, which gives it back to the app. False in a browser. */
export function phoneVoiceNote() {
  if (!phoneApp) return false
  location.href = "vaultite://record"
  return true
}
if (phoneApp) document.cookie = "vaultite_client=iphone; path=/; max-age=31536000; samesite=strict"

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

export type LocalArea = "vault" | "sync"
type LocalStat = { size: number; mtime: number }
export type PhoneLocal = {
  list: (o: { area: LocalArea; vault: string }) => Promise<{ files: ({ path: string } & LocalStat)[] }>
  read: (o: { area: LocalArea; vault: string; paths: string[] }) => Promise<{ files: Record<string, string | null> }>
  write: (o: { area: LocalArea; vault: string; path: string; data: string; append?: boolean }) => Promise<LocalStat>
  remove: (o: { area: LocalArea; vault: string; path: string }) => Promise<void>
  move: (o: { area: LocalArea; vault: string; from: string; to: string }) => Promise<LocalStat>
  /** A URL's bytes straight into a file (big media), with their sha-256. */
  fetch: (o: { area: LocalArea; vault: string; path: string; url: string; headers?: Record<string, string> }) => Promise<LocalStat & { sha256: string }>
  info: () => Promise<{ free: number; wifi: boolean; vaults: string[] }>
  /** Which vault a server's app serves, so the shell opens its copy when that server can't be reached. */
  setOffline: (o: { server: string; vault: string }) => Promise<void>
  openOffline: (o: { vault: string }) => Promise<void>
  /** The offline app's answer to a request the shell passed it (window.__vaultiteLocal.request). */
  answer: (o: { id: string; status: number; headers: Record<string, string>; body: string | null }) => Promise<void>
}
/** The phone's copies of vaults (null outside the iPhone app, or in one built before it had them). */
export const phoneLocal: PhoneLocal | null = cap?.isNativePlatform?.() && shellHas("localList")
  ? { list: call("localList"), read: call("localRead"), write: call("localWrite"), remove: call("localRemove"), move: call("localMove"),
    fetch: call("localFetch"), info: call("localInfo"), setOffline: call("setOffline"), openOffline: call("openOffline"), answer: call("localAnswer") }
  : null

/** The phone's Apple Health, for a plugin that takes it (null outside the iPhone app): `route` is where the server
 *  takes what it reads (after /api/). */
export const phoneHealth = phoneApp
  ? { status: phoneApp.health, set: (on: boolean, route?: string) => phoneApp!.setHealth({ on, route }), resend: phoneApp.resendHealth }
  : null
