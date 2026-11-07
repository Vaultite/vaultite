// This Mac's microphones for the setting Microphone's choices (web: plugins/core/dictation/mics.ts), as dictation.swift
// lists them, told again to the windows showing them as they come and go. Loaded only when Settings asks.
import type { AppWindow } from "./appwindow.ts"
import { helperDevices, keeps, onAudioDevices } from "./dictation.ts"
import { pickMic, type Devices } from "./miclogic.ts"

/** The inputs, the system's first, and the one `auto` takes now. */
export type MicList = { inputs: { uid: string; name: string; transport: string }[]; input: string; auto: string }
function micList(d: Devices): MicList {
  const inputs = d.devices.filter((x) => x.input).sort((a, b) => Number(b.uid === d.input) - Number(a.uid === d.input))
  return { inputs: inputs.map(({ uid, name, transport }) => ({ uid, name, transport })), input: d.input, auto: pickMic("auto", d).name }
}

/** The list (`watch` undefined), or this window following it (true) or no more (false). */
export async function microphones(win: AppWindow, watch?: unknown): Promise<MicList | null> {
  if (typeof watch === "boolean") { watchMics(win, watch); return null }
  const d = await helperDevices()
  return d ? micList(d) : null
}

/** Windows following the list, each as often as it asked: the helper stays while one does. */
const watchers = new Map<AppWindow, number>()
let off: (() => unknown) | null = null
function watchMics(win: AppWindow, on: boolean) {
  const n = (watchers.get(win) ?? 0) + (on ? 1 : -1)
  if (n > 0) watchers.set(win, n); else watchers.delete(win)
  if (on && n === 1) win.once("closed", () => { watchers.delete(win); watchMics(win, false) })
  if (watchers.size) {
    keeps.add(watchers)
    off ??= onAudioDevices((d) => { for (const w of watchers.keys()) if (!w.isDestroyed()) w.webContents.send("vaultite:microphones", micList(d)) })
  } else {
    keeps.delete(watchers)
    off?.(); off = null
  }
}
