const KEYS: Record<string, { code: string; key: string; vk: number; text?: string }> = {
  enter: { code: "Enter", key: "Enter", vk: 13, text: "\r" }, tab: { code: "Tab", key: "Tab", vk: 9 }, escape: { code: "Escape", key: "Escape", vk: 27 },
  backspace: { code: "Backspace", key: "Backspace", vk: 8 }, delete: { code: "Delete", key: "Delete", vk: 46 }, space: { code: "Space", key: " ", vk: 32, text: " " },
  arrowup: { code: "ArrowUp", key: "ArrowUp", vk: 38 }, arrowdown: { code: "ArrowDown", key: "ArrowDown", vk: 40 },
  arrowleft: { code: "ArrowLeft", key: "ArrowLeft", vk: 37 }, arrowright: { code: "ArrowRight", key: "ArrowRight", vk: 39 },
  home: { code: "Home", key: "Home", vk: 36 }, end: { code: "End", key: "End", vk: 35 }, pageup: { code: "PageUp", key: "PageUp", vk: 33 },
  pagedown: { code: "PageDown", key: "PageDown", vk: 34 },
}
// A Mac page takes its editing keys only as Chromium's editing commands: none of them copies, cuts or pastes.
export const MAC_COMMANDS: Record<string, string> = {
  "meta+a": "selectAll", "meta+z": "undo", "meta+shift+z": "redo",
  "meta+arrowleft": "moveToBeginningOfLine", "meta+arrowright": "moveToEndOfLine", "meta+arrowup": "moveToBeginningOfDocument", "meta+arrowdown": "moveToEndOfDocument",
  "meta+shift+arrowleft": "moveToBeginningOfLineAndModifySelection", "meta+shift+arrowright": "moveToEndOfLineAndModifySelection",
  "meta+shift+arrowup": "moveToBeginningOfDocumentAndModifySelection", "meta+shift+arrowdown": "moveToEndOfDocumentAndModifySelection",
  "alt+arrowleft": "moveWordLeft", "alt+arrowright": "moveWordRight", "alt+shift+arrowleft": "moveWordLeftAndModifySelection", "alt+shift+arrowright": "moveWordRightAndModifySelection",
  "meta+backspace": "deleteToBeginningOfLine", "alt+backspace": "deleteWordBackward", "alt+delete": "deleteWordForward",
  "shift+arrowleft": "moveLeftAndModifySelection", "shift+arrowright": "moveRightAndModifySelection", "shift+arrowup": "moveUpAndModifySelection", "shift+arrowdown": "moveDownAndModifySelection",
  "shift+home": "moveToBeginningOfLineAndModifySelection", "shift+end": "moveToEndOfLineAndModifySelection",
}
const CLIPBOARD = /^(?:(?:meta|cmd|control|ctrl)\+(?:shift\+)?[cxv]|(?:control|ctrl|shift)\+(?:insert|delete))$/i
export const clipboardKey = (combo: string) => CLIPBOARD.test(combo.replace(/\s+/g, ""))

export function keyEvent(combo: string, platform: NodeJS.Platform) {
  const parts = combo.split("+").map((x) => x.trim()).filter(Boolean)
  const last = parts.pop() ?? ""
  const mods = parts.map((m) => m.toLowerCase())
  const modifiers = (mods.includes("alt") ? 1 : 0) | (mods.includes("control") || mods.includes("ctrl") ? 2 : 0) | (mods.includes("meta") || mods.includes("cmd") ? 4 : 0) | (mods.includes("shift") ? 8 : 0)
  const k = KEYS[last.toLowerCase()] ?? (last.length === 1
    ? { code: /[a-z]/i.test(last) ? `Key${last.toUpperCase()}` : /\d/.test(last) ? `Digit${last}` : "", key: last, vk: last.toUpperCase().charCodeAt(0), text: last }
    : null)
  if (!k) throw new Error(`no key "${last}": Enter, Tab, Escape, Backspace, Delete, Space, arrows, Home, End, PageUp, PageDown or one character`)
  const text = modifiers & ~8 ? undefined : k.text
  const command = platform === "darwin" ? MAC_COMMANDS[[...new Set(mods.map((m) => (m === "cmd" ? "meta" : m === "ctrl" ? "control" : m)))].sort().concat(last.toLowerCase()).join("+")] : undefined
  return {
    down: { type: text ? "keyDown" : "rawKeyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}), ...(command ? { commands: [command] } : {}) },
    up: { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers },
  }
}
