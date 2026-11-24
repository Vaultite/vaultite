// Text frames stay text: the Connect relay carries binary as base64.

export const MUX_PATH = "mux"
export const PIECE = 64 * 1024
export const MAX_MESSAGE = 32 << 20
export const ABNORMAL = 1006
export const NO_STATUS = 1005

export type TextFrame =
  | { kind: "open"; ch: number; path: string }
  | { kind: "opened"; ch: number }
  | { kind: "refused"; ch: number; status: number; reason: string }
  | { kind: "text"; ch: number; data: string; more: boolean }
  | { kind: "close"; ch: number; code: number; reason: string }
  | { kind: "ping" }
  | { kind: "pong" }

const LETTER = { open: "o", opened: "k", refused: "r", close: "c", ping: "p", pong: "q" } as const
const BINARY = 0x62, BINARY_MORE = 0x42
const MAX_CHANNEL = 0xffffffff

const head = (letter: string, ch: number) => `${letter}${ch.toString(36)} `

export function writeText(f: TextFrame): string {
  switch (f.kind) {
    case "open": return head(LETTER.open, f.ch) + f.path
    case "opened": return head(LETTER.opened, f.ch)
    case "refused": return `${head(LETTER.refused, f.ch)}${f.status} ${f.reason}`
    case "text": return head(f.more ? "T" : "t", f.ch) + f.data
    case "close": return `${head(LETTER.close, f.ch)}${f.code} ${f.reason}`
    case "ping": return head(LETTER.ping, 0)
    case "pong": return head(LETTER.pong, 0)
  }
}

function numberThenText(rest: string): [number, string] | null {
  const sp = rest.indexOf(" ")
  const n = Number(sp < 0 ? rest : rest.slice(0, sp))
  return Number.isInteger(n) ? [n, sp < 0 ? "" : rest.slice(sp + 1)] : null
}

export function readText(s: string): TextFrame | null {
  const sp = s.indexOf(" ")
  if (sp < 2) return null
  const ch = parseInt(s.slice(1, sp), 36), rest = s.slice(sp + 1)
  if (!Number.isSafeInteger(ch) || ch < 0 || ch > MAX_CHANNEL) return null
  switch (s[0]) {
    case "o": return ch ? { kind: "open", ch, path: rest } : null
    case "k": return ch ? { kind: "opened", ch } : null
    case "t": case "T": return ch ? { kind: "text", ch, data: rest, more: s[0] === "T" } : null
    case "r": case "c": {
      const n = ch ? numberThenText(rest) : null
      if (!n) return null
      return s[0] === "r" ? { kind: "refused", ch, status: n[0], reason: n[1] } : { kind: "close", ch, code: n[0], reason: n[1] }
    }
    case "p": return { kind: "ping" }
    case "q": return { kind: "pong" }
    default: return null
  }
}

export function writeBinary(ch: number, more: boolean, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + data.length)
  out[0] = more ? BINARY_MORE : BINARY
  new DataView(out.buffer).setUint32(1, ch)
  out.set(data, 5)
  return out
}

export function readBinary(b: Uint8Array): { ch: number; more: boolean; data: Uint8Array } | null {
  if (b.length < 5 || (b[0] !== BINARY && b[0] !== BINARY_MORE)) return null
  const ch = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(1)
  return ch ? { ch, more: b[0] === BINARY_MORE, data: b.subarray(5) } : null
}

export function textPieces(s: string, size = PIECE): string[] {
  if (s.length <= size) return [s]
  const out: string[] = []
  for (let at = 0; at < s.length;) {
    let end = Math.min(s.length, at + size)
    const c = s.charCodeAt(end - 1)
    if (end < s.length && c >= 0xd800 && c <= 0xdbff) end--
    out.push(s.slice(at, end))
    at = end
  }
  return out
}

export function bytePieces(b: Uint8Array, size = PIECE): Uint8Array[] {
  if (b.length <= size) return [b]
  const out: Uint8Array[] = []
  for (let at = 0; at < b.length; at += size) out.push(b.subarray(at, at + size))
  return out
}
