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
  /** What a widget or a shortcut asked for, taken once: a command (vaultite://command/<id>) or a file to open
   *  (vaultite://open/<path>). Rejects in an older app. */
  pending: () => Promise<{ command?: string; open?: string }>
}

/** What the shell's native side puts on every page it loads (its native-bridge.js): no @capacitor/core in the app. */
type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  nativePromise: (plugin: string, method: string, options?: object) => Promise<unknown>
}
const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor
const call = (method: string) => (options?: object) => cap!.nativePromise("Shell", method, options ?? {}) as Promise<never>
export const phoneApp: ShellPlugin | null = cap?.isNativePlatform?.() && cap.isPluginAvailable?.("Shell")
  ? { servers: call("servers"), setServers: call("setServers"), probe: call("probe"), open: call("open"), launcher: call("launcher"), snapshot: call("snapshot"), haptic: call("haptic"), pending: call("pending") }
  : null
/** Open the iPhone app's own voice note (a widget's `vaultite://record`: App/VoiceNote.swift): Capacitor hands an
 *  address it doesn't serve to the system, which gives it back to the app. False in a browser. */
export function phoneVoiceNote() {
  if (!phoneApp) return false
  location.href = "vaultite://record"
  return true
}
// So a terminal opened here tells its shell it's the iPhone app (VAULTITE_CLIENT=iphone, plugins/core/terminal).
if (phoneApp) document.cookie = "vaultite_client=iphone; path=/; max-age=31536000; samesite=strict"

/** Do what the phone's widgets and shortcuts ask for (a palette command, a file to open): now, and whenever the shell
 *  says there's one (the event `vaultite:link`). Each is false while it can't yet (the app still starting). */
export function takeLinks(run: { command: (id: string) => boolean; open: (path: string) => boolean }) {
  if (!phoneApp) return () => {}
  const take = () => phoneApp!.pending().then(({ command, open }) => {
    const act = command ? () => run.command(command) : open ? () => run.open(open) : null
    if (!act) return
    let tries = 0
    const go = () => { if (!act() && ++tries < 40) setTimeout(go, 150) }
    go()
  }, () => {})
  take()
  addEventListener("vaultite:link", take)
  return () => removeEventListener("vaultite:link", take)
}
