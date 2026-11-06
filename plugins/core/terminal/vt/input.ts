// Keys to what a program reads, by Ghostty's key encoder (kitty keyboard off). A key's text goes at its keydown, as
// xterm.js sent it; dead keys, input methods, dictation and iOS's keyboard (keyCode 229) come by the field's events.
import { MOD_ALT, MOD_CTRL, MOD_SHIFT, MOD_SUPER, type Screen } from "./screen.ts"

const modsOf = (e: KeyboardEvent) => (e.shiftKey ? MOD_SHIFT : 0) | (e.ctrlKey ? MOD_CTRL : 0) | (e.altKey ? MOD_ALT : 0) | (e.metaKey ? MOD_SUPER : 0)

/** What a key sends; null: nothing here (its text comes through the input field, or it's the browser's: ⌘ keys). */
export function keyBytes(s: Screen, e: KeyboardEvent, mac: boolean): string | null {
  if (e.isComposing || e.keyCode === 229 || e.key === "Dead" || e.key === "Process") return null
  if (e.metaKey) return null // (⌘C, ⌘V: the browser's copy and paste events)
  const printable = [...e.key].length === 1
  // Text without Control (Option's characters on a Mac, AltGr's elsewhere) is sent as it's pressed: left to the input
  // event, the field changes and the echo waits behind the frame that redraws it.
  if (printable && (e.getModifierState?.("AltGraph") || (!e.ctrlKey && !(e.altKey && !mac)))) return e.key
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "OS", "Fn"].includes(e.key)) return null
  const action = e.repeat ? "repeat" : "press"
  let mods = modsOf(e)
  // ⌃ + a letter is its control code whatever Shift says, as xterm.js sent it.
  if (e.ctrlKey && !e.altKey && /^Key[A-Z]$/.test(e.code)) mods &= ~MOD_SHIFT
  const legacy = LEGACY[`${e.ctrlKey ? "C" : ""}${e.altKey ? "A" : ""}${e.code}`]
  if (legacy) return legacy === "BS" ? (s.mode(67) ? "\b" : "\x7f") : legacy
  // ⌥← and ⌥→ move by word: ESC b / ESC f on a Mac (as Terminal and xterm.js send them), ⌃← and ⌃→'s elsewhere.
  if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.code === "ArrowLeft" || e.code === "ArrowRight"))
    return mac ? (e.code === "ArrowLeft" ? "\x1bb" : "\x1bf") : (e.code === "ArrowLeft" ? "\x1b[1;5D" : "\x1b[1;5C")
  // Alt + text off a Mac: ESC then the character (the encoder does this given the text).
  const text = printable && !e.ctrlKey ? e.key : ""
  const out = s.key({ code: e.code, key: e.key, action, mods, text })
  return out || null
}

/** Keys Ghostty's encoder leaves to the platform's text (a Mac's apps give it), as xterm.js sends them. */
const LEGACY: Record<string, string> = {
  Backspace: "BS", ABackspace: "\x1b\x7f", CBackspace: "\b", CABackspace: "\x1b\b",
  CBracketLeft: "\x1b", CBackslash: "\x1c", CBracketRight: "\x1d", CDigit2: "\0", CDigit6: "\x1e", CMinus: "\x1f",
}
