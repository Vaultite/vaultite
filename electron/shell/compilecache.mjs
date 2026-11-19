import fs from "node:fs"
import path from "node:path"

export const CODE_CACHE = ".compile-cache"

export const codeCacheDir = (root) => path.join(fs.realpathSync(root), CODE_CACHE)

const writable = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true } catch { return false } }
const windowsFlagged = (sub) => path.join(sub, fs.readdirSync(sub)[0] ?? "")
const readOnly = (sub) => !writable(process.platform === "win32" ? windowsFlagged(sub) : sub)

export function ownCompileCache(root) {
  const dir = codeCacheDir(root), id = `v${process.versions.node}-${process.arch}-`, uid = process.getuid?.()
  if (fs.existsSync(path.join(root, ".git"))) return dir
  const sub = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.startsWith(id) && (uid === undefined || n.endsWith(`-${uid}`))) : undefined
  return sub && readOnly(path.join(dir, sub)) ? dir : null
}
