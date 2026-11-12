/** What a terminal's modes change in what a key sends: arrows and Home/End in application cursor mode (DECCKM). */
export type KeyModes = { appCursor?: boolean }

const CSI = "\x1b["
/** Keys that are a CSI with a final letter (arrows, Home, End): `ESC [ 1 ; <mod> <letter>` with modifiers. */
const LETTER: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" }
/** Keys that are `ESC [ <n> ~` (`ESC [ <n> ; <mod> ~` with modifiers). */
const TILDE: Record<string, number> = { insert: 2, ic: 2, delete: 3, dc: 3, pageup: 5, pgup: 5, ppage: 5, pagedown: 6, pgdn: 6, npage: 6,
  f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 }
/** F1 to F4: SS3 letters (`ESC [ 1 ; <mod> P` with modifiers). */
const SS3: Record<string, string> = { f1: "P", f2: "Q", f3: "R", f4: "S" }
const PLAIN: Record<string, string> = { enter: "\r", return: "\r", tab: "\t", btab: `${CSI}Z`, escape: "\x1b", esc: "\x1b", space: " ",
  bspace: "\x7f", backspace: "\x7f" }

export function keyBytes(name: string, modes: KeyModes = {}): string | null {
  let rest = name.trim(), ctrl = false, meta = false, shift = false
  for (let m = /^([CMS])-(.+)$/i.exec(rest); m; m = /^([CMS])-(.+)$/i.exec(rest)) {
    const k = m[1].toUpperCase()
    if (k === "C") ctrl = true; else if (k === "M") meta = true; else shift = true
    rest = m[2]
  }
  if (!rest) return null
  const key = rest.toLowerCase()
  // (xterm's modifier parameter: 1 + shift 1, alt 2, ctrl 4)
  const mod = 1 + (shift ? 1 : 0) + (meta ? 2 : 0) + (ctrl ? 4 : 0)
  if (key in LETTER) {
    if (mod > 1) return `${CSI}1;${mod}${LETTER[key]}`
    return `${modes.appCursor ? "\x1bO" : CSI}${LETTER[key]}`
  }
  if (key in TILDE) return mod > 1 ? `${CSI}${TILDE[key]};${mod}~` : `${CSI}${TILDE[key]}~`
  if (key in SS3) return mod > 1 ? `${CSI}1;${mod}${SS3[key]}` : `\x1bO${SS3[key]}`
  let out: string
  if (key in PLAIN) out = shift && key === "tab" ? `${CSI}Z` : PLAIN[key]
  else if ([...rest].length === 1) out = shift ? rest.toUpperCase() : rest
  else return null
  if (ctrl && out.length === 1) {
    const c = out.toUpperCase().charCodeAt(0)
    // (C-@ to C-_ and C-? are control characters; C-Space is NUL)
    if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64)
    else if (out === " ") out = "\x00"
    else if (out === "?") out = "\x7f"
    else return null
  }
  return meta ? `\x1b${out}` : out
}

export function keysBytes(names: string[], modes: KeyModes = {}): string {
  let out = ""
  for (const n of names) {
    const b = keyBytes(n, modes)
    if (b === null) throw new Error(`'${n}' isn't a key: Enter, Tab, Escape, Space, BSpace, Up, Down, Left, Right, Home, End, PageUp, PageDown, Delete, F1 to F12, one character, with C-, M- or S- before it (C-c)`)
    out += b
  }
  return out
}
