// The Vim plugin's state in the app: its settings (/api/config/plugin/vim), whether this device takes Vim's keys, the
// editor's mode, and a reading view switched to editing with `i`.
import { useSyncExternalStore } from "react"
import { devicePref, patch } from "@vaultite"

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
export const onState = subscribe

let settings: Settings = {}
export const getSettings = () => settings
export function setSettings(s: Settings) {
  if (JSON.stringify(s) === JSON.stringify(settings)) return
  settings = s
  emit()
}
export const useSettings = () => useSyncExternalStore(subscribe, getSettings)
/** Change some settings (null: back to the default), here at once and in the vault. */
export function changeSettings(p: Partial<Record<keyof Settings, boolean | null>>) {
  const next: Settings = { ...settings }
  for (const [k, v] of Object.entries(p)) { if (v === null) delete next[k as keyof Settings]; else next[k as keyof Settings] = v }
  setSettings(next)
  return patch("config/plugin/vim", p).catch(() => {})
}

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
export const appKeys = () => deviceOn() && settings.app !== false
/** Space as the leader. */
export const leaderOn = () => deviceOn() && settings.leader !== false

/** The mode of the editor that has the keyboard ("normal", "insert", "visual", "visual line", "replace"), or null when
 *  no Vim editor has it. */
let mode: string | null = null
/** The keys typed so far in that editor (d2...). */
let keys = ""
export const editorMode = () => mode
export const editorKeys = () => keys
export function setEditorMode(m: string | null, k = "") {
  if (m === mode && k === keys) return
  mode = m
  keys = k
  emit()
}
export const useEditorMode = () => useSyncExternalStore(subscribe, () => mode)
export const useEditorKeys = () => useSyncExternalStore(subscribe, () => keys)
/** An editor in normal or visual mode has the keyboard: it hands the app its window and leader keys. */
export const vimNormal = () => mode !== null && mode !== "insert" && mode !== "replace"

/** A file switched from reading to editing with `i`: Escape in normal mode there switches back. */
let peek: string | null = null
export const setPeek = (path: string | null) => { peek = path }
export const peekPath = () => peek
