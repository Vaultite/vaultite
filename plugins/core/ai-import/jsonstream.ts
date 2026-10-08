// A JSON file's top-level array one item at a time as its bytes come (conversations.json can pass what one string
// holds); a top-level object is one item.
import type { Readable } from "node:stream"

const QUOTE = 0x22, BACKSLASH = 0x5c, OPEN_OBJ = 0x7b, CLOSE_OBJ = 0x7d, OPEN_ARR = 0x5b, CLOSE_ARR = 0x5d, COMMA = 0x2c
const space = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09

/** The top-level array's items, parsed. `onBytes(n)`: n more bytes were read (progress). Throws on JSON that's broken. */
export async function* jsonItems(stream: Readable | AsyncIterable<Buffer | string>, onBytes?: (n: number) => void): AsyncGenerator<unknown> {
  let mode: "start" | "array" | "whole" | "done" = "start"
  let depth = 0, inStr = false, esc = false, inItem = false, bare = false
  let pieces: Buffer[] = []
  const whole: Buffer[] = []
  const parse = (bufs: Buffer[]) => {
    const text = Buffer.concat(bufs).toString("utf8")
    try { return JSON.parse(text) } catch (e) { throw new Error(`broken JSON: ${(e as Error).message}`) }
  }
  for await (const raw of stream) {
    const chunk = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw
    onBytes?.(chunk.length)
    let i = 0
    if (mode === "start") {
      if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) i = 3 // a byte order mark
      while (i < chunk.length && space(chunk[i])) i++
      if (i >= chunk.length) continue
      if (chunk[i] === OPEN_ARR) { mode = "array"; i++ }
      else { mode = "whole" }
    }
    if (mode === "whole") { whole.push(chunk.subarray(i)); continue }
    if (mode === "done") continue
    let start = inItem ? 0 : -1
    for (; i < chunk.length; i++) {
      const c = chunk[i]
      if (!inItem) {
        if (space(c) || c === COMMA) continue
        if (c === CLOSE_ARR) { mode = "done"; break }
        inItem = true; start = i; depth = 0; bare = false
        if (c === QUOTE) { inStr = true; continue }
        if (c === OPEN_OBJ || c === OPEN_ARR) { depth = 1; continue }
        bare = true // a number, true, false or null
        continue
      }
      if (bare) {
        if (space(c) || c === COMMA || c === CLOSE_ARR) {
          pieces.push(chunk.subarray(start, i))
          yield parse(pieces)
          pieces = []; inItem = false; start = -1
          if (c === CLOSE_ARR) { mode = "done"; break }
        }
        continue
      }
      if (inStr) {
        if (esc) esc = false
        else if (c === BACKSLASH) esc = true
        else if (c === QUOTE) {
          inStr = false
          if (depth === 0) { pieces.push(chunk.subarray(start, i + 1)); yield parse(pieces); pieces = []; inItem = false; start = -1 }
        }
        continue
      }
      if (c === QUOTE) inStr = true
      else if (c === OPEN_OBJ || c === OPEN_ARR) depth++
      else if (c === CLOSE_OBJ || c === CLOSE_ARR) {
        if (--depth === 0) { pieces.push(chunk.subarray(start, i + 1)); yield parse(pieces); pieces = []; inItem = false; start = -1 }
      }
    }
    if (inItem && start >= 0) pieces.push(chunk.subarray(start))
  }
  if (mode === "whole") {
    const v = parse(whole)
    yield v
    return
  }
  if (inItem && bare && pieces.length) { yield parse(pieces); return }
  if (mode === "array" || inItem) throw new Error("broken JSON: the file ends in the middle (a cut-off download?)")
}
