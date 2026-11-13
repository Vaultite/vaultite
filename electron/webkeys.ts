import { type Input, ipcMain } from "electron"
import { AppWindow } from "./appwindow.ts"
import { MAC, pageOf, sendState, tell } from "./webbase.ts"

export const BROWSER_KEYS = new Set(["f", "g", "shift+g", "=", "shift+=", "-", "0"].map((k) => `mod+${k}`))
// (⌘Y isn't redo on a Mac: it's History there, as in Chrome)
export const PAGE_KEYS = new Set([...["a", "c", "v", "x", "z", "shift+z", ...(MAC ? [] : ["y"]), "b", "i", "u", "k", "shift+v", "arrowleft",
  "arrowright", "arrowup", "arrowdown", "backspace", "delete", "enter", "shift+enter", "tab"].map((k) => `mod+${k}`), ...BROWSER_KEYS])
export const OWN_KEYS: Record<string, string> = { "mod+r": "reload", "mod+shift+r": "hard-reload", [MAC ? "mod+alt+i" : "mod+shift+i"]: "devtools", [MAC ? "mod+alt+u" : "mod+u"]: "source" }
export const keysOf = new WeakMap<AppWindow, Set<string>>()

export function stepOf(i: Pick<Input, "key" | "code" | "meta" | "control" | "alt" | "shift">) {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"].includes(i.key)) return ""
  const CODES: Record<string, string> = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/" }
  const byCode = /^Key[A-Z]$/.test(i.code) ? i.code.slice(3) : /^Digit\d$/.test(i.code) ? i.code.slice(5) : CODES[i.code]
  const key = i.key === " " || i.code === "Space" ? "Space"
    : byCode && (i.alt || (i.shift && !/^[a-z]$/i.test(i.key))) ? byCode
    : i.key.length === 1 ? i.key.toUpperCase() : i.key
  const mod = MAC ? i.meta : i.control
  return [mod && "mod", MAC && i.control && "ctrl", i.alt && "alt", i.shift && "shift", key].filter(Boolean).join("+").toLowerCase()
}
ipcMain.on("vaultite:web:key", (e, k: { key?: unknown; code?: unknown; meta?: unknown; ctrl?: unknown; alt?: unknown; shift?: unknown }) => {
  const p = pageOf(e.sender)
  if (!p || p.agent || p.player || !k || typeof k.key !== "string" || typeof k.code !== "string") return
  const key = { key: k.key, code: k.code, meta: k.meta === true, ctrl: k.ctrl === true, alt: k.alt === true, shift: k.shift === true }
  if (BROWSER_KEYS.has(stepOf({ ...key, control: key.ctrl }))) tell(p.win, { type: "key", id: p.id, ...key })
})
ipcMain.on("vaultite:web:typed", (e, on) => {
  const p = pageOf(e.sender), key = `${e.processId}:${e.frameId}`
  if (!p || (p.typed.get(key) ?? false) === (on === true)) return
  p.typed.set(key, on === true)
  sendState(p)
})
// A press in one of its frames from another site, whose input events never reach the page's (web-preload.cjs).
ipcMain.on("vaultite:web:input", (e) => { const p = pageOf(e.sender); if (p) p.input = Date.now() })
ipcMain.on("vaultite:web:nav", (e, dir) => { const p = pageOf(e.sender); if (p && !p.agent && !p.player) tell(p.win, { type: "nav", id: p.id, dir: dir < 0 ? -1 : 1 }) })
