export const HELD_MAX = 64 << 10

const ESC = "\x1b"
const STRING_INTRODUCERS = "]P_^X"
const isFinal = (c: number) => c >= 0x40 && c <= 0x7e
const isIntermediate = (c: number) => c >= 0x20 && c <= 0x2f

function wholeSequence(fromEsc: string): boolean {
  if (fromEsc.length < 2) return false
  const kind = fromEsc[1]
  if (kind === "[") {
    for (let i = 2; i < fromEsc.length; i++) if (isFinal(fromEsc.charCodeAt(i))) return true
    return false
  }
  if (STRING_INTRODUCERS.includes(kind)) return fromEsc.includes("\x07", 2)
  let i = 1
  while (i < fromEsc.length && isIntermediate(fromEsc.charCodeAt(i))) i++
  return i < fromEsc.length
}

export function unfinishedAt(d: string): number {
  const last = d.lastIndexOf(ESC)
  if (last < 0) return d.length
  const tail = d.slice(last)
  const before = last > 0 ? d.lastIndexOf(ESC, last - 1) : -1
  const openString = before >= 0 && STRING_INTRODUCERS.includes(d[before + 1]) && !d.slice(before + 2, last).includes("\x07")
  const at = tail === ESC && openString ? before : wholeSequence(tail) || tail[1] === "\\" ? d.length : last
  return d.length - at > HELD_MAX ? d.length : at
}
