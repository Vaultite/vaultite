import fs from "node:fs"
import path from "node:path"

export const CODE_CACHE = ".compile-cache"
const writable = (p: string) => { try { fs.accessSync(p, fs.constants.W_OK); return true } catch { return false } }

function own(root: string) {
  const dir = path.join(root, CODE_CACHE), id = `v${process.versions.node}-${process.arch}-`, uid = process.getuid?.()
  if (fs.existsSync(path.join(root, ".git"))) return dir
  const sub = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.startsWith(id) && (uid === undefined || n.endsWith(`-${uid}`))) : undefined
  return sub && !writable(path.join(dir, sub)) ? dir : null
}

export const compileCacheEnv = (root: string, fallback: string) =>
  ({ NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || (own(root) ?? fallback), NODE_COMPILE_CACHE_PORTABLE: "1" })
