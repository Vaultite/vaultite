import fs from "node:fs"
import path from "node:path"

const MAX = 2 << 20
let file: string | null = null
let size = 0
let limit = MAX

export function openMainLog(dir: string, max = MAX) {
  file = path.join(dir, "main.log")
  limit = max
  try {
    fs.mkdirSync(dir, { recursive: true })
    size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
  } catch { size = 0 }
}

export function mainLog(line: string) {
  if (!file) return false
  const text = `${new Date().toISOString()} [${process.pid}] ${line.trimEnd()}\n`
  try {
    if (size + text.length > limit) {
      size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
      if (size + text.length > limit) { fs.renameSync(file, `${file}.1`); size = 0 }
    }
    fs.appendFileSync(file, text)
    size += Buffer.byteLength(text)
  } catch { return false }
  return true
}
