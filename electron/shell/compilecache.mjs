import fs from "node:fs"
import path from "node:path"

export const CODE_CACHE = ".compile-cache"

const writable = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true } catch { return false } }

export function ownCompileCache(root) {
  const dir = path.join(root, CODE_CACHE), id = `v${process.versions.node}-${process.arch}-`, uid = process.getuid?.()
  if (fs.existsSync(path.join(root, ".git"))) return dir
  const sub = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.startsWith(id) && (uid === undefined || n.endsWith(`-${uid}`))) : undefined
  return sub && !writable(path.join(dir, sub)) ? dir : null
}
