// The Vim plugin's state in the app: its settings (/api/config/plugin/vim), whether this device takes Vim's keys, the
// editor's mode, and a reading view switched to editing with `i`.
import { useSyncExternalStore } from "react"
import { devicePref, pluginSettings } from "@vaultite"

/** Its settings file and vimrc are here. */
export const SETTINGS_DIR = ".vaultite/plugins/vim"
/** The vimrc: Vim's commands run in every editor (map, noremap, set...), like Neovim's init.vim. */
export const VIMRC = `${SETTINGS_DIR}/init.vim`

export type Settings = {
  /** Vim's keys outside the editor too (reading view, pages, lists, panes): on unless false. */
  app?: boolean
  /** Yanks go to the system clipboard, and what was copied elsewhere is pasted by p: on unless false. */
  clipboard?: boolean
  /** Space as the leader key (Space F F...), in the editor's normal mode and outside it: on unless false. */
  leader?: boolean
}

const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
/** Run fn whenever any of this changes (the settings, this device's choice, the editor's mode). */
export const onState = (f: () => void) => { const off = settings.onChange(f), un = subscribe(f); return () => { off(); un() } }

/** Its settings (data.json), live. */
export const settings = pluginSettings<Settings>("vim")
/** Change some settings (null: back to the default), here at once and in the vault. */
export const changeSettings = (p: Partial<Record<keyof Settings, boolean | null>>) => settings.set(p).catch(() => {})

/** This device: Vim's keys when it has a mouse or trackpad (auto), always (an iPad with a keyboard), or never. */
export type DeviceKeys = "auto" | "on" | "off"
const device = devicePref<DeviceKeys>("vim.keys", "auto")
export const deviceKeys = () => device.get()
export function setDeviceKeys(v: DeviceKeys) { device.set(v); emit() }
const pointer = () => typeof matchMedia === "function" && matchMedia("(any-pointer: fine)").matches
/** Whether this device takes Vim's keys at all. */
export const deviceOn = () => { const d = device.get(); return d === "on" || (d === "auto" && pointer()) }
export const useDeviceOn = () => useSyncExternalStore(subscribe, deviceOn)
/** Vim's keys outside the editor, on this device. */
export const appKeys = () => deviceOn() && settings.get().app !== false
/** Space as the leader. */
export const leaderOn = () => deviceOn() && settings.get().leader !== false

/** The mode of the editor that had the keyboard last ("normal", "insert", "visual", "visual line", "replace"): kept
 *  while the keyboard is elsewhere, so the status bar's chip stays put as the user clicks around. */
let mode = "normal"
/** The keys typed so far in that editor (d2...). */
let keys = ""
/** Whether that editor has the keyboard now. */
let focused = false
export function setEditorMode(m: string, k = "") {
  if (m === mode && k === keys && focused) return
  mode = m
  keys = k
  focused = true
  emit()
}
/** The keyboard left the Vim editors; `closed`: the one it was in is gone, and a new one starts in normal mode. */
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

/** A file switched from reading to editing with `i`: Escape in normal mode there switches back. */
let peek: string | null = null
export const setPeek = (path: string | null) => { peek = path }
export const peekPath = () => peek
