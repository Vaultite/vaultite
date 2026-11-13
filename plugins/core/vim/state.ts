import { useSyncExternalStore } from "react"
import { devicePref, pluginSettings } from "@vaultite"

export const SETTINGS_DIR = ".vaultite/plugins/vim"
export const VIMRC = `${SETTINGS_DIR}/init.vim`

export type Settings = {
  app?: boolean
  clipboard?: boolean
  leader?: boolean
}

const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const onState = (f: () => void) => { const off = settings.onChange(f), un = subscribe(f); return () => { off(); un() } }

export const settings = pluginSettings<Settings>("vim")
export const changeSettings = (p: Partial<Record<keyof Settings, boolean | null>>) => settings.set(p).catch(() => {})

export type DeviceKeys = "auto" | "on" | "off"
const device = devicePref<DeviceKeys>("vim.keys", "auto")
export const deviceKeys = () => device.get()
export function setDeviceKeys(v: DeviceKeys) { device.set(v); emit() }
const pointer = () => typeof matchMedia === "function" && matchMedia("(any-pointer: fine)").matches
export const deviceOn = () => { const d = device.get(); return d === "on" || (d === "auto" && pointer()) }
export const useDeviceOn = () => useSyncExternalStore(subscribe, deviceOn)
export const appKeys = () => deviceOn() && settings.get().app !== false
export const leaderOn = () => deviceOn() && settings.get().leader !== false

let mode = "normal"
let keys = ""
let focused = false
export function setEditorMode(m: string, k = "") {
  if (m === mode && k === keys && focused) return
  mode = m
  keys = k
  focused = true
  emit()
}
export function leftEditor(closed = false) {
  const m = closed ? "normal" : mode
  if (!focused && m === mode && !keys) return
  mode = m
  keys = ""
  focused = false
  emit()
}
export const useEditorMode = () => useSyncExternalStore(subscribe, () => mode)
export const useEditorKeys = () => useSyncExternalStore(subscribe, () => keys)
export const useEditorFocused = () => useSyncExternalStore(subscribe, () => focused)

let peek: string | null = null
export const setPeek = (path: string | null) => { peek = path }
export const peekPath = () => peek
