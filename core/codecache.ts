import { ownCompileCache } from "../electron/shell/compilecache.mjs"

export { CODE_CACHE } from "../electron/shell/compilecache.mjs"

export const compileCacheEnv = (root: string, fallback: string) =>
  ({ NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || (ownCompileCache(root) ?? fallback), NODE_COMPILE_CACHE_PORTABLE: "1" })
