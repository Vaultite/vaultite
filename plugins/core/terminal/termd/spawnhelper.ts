import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

export const ptyDir = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))

/** node-pty's prebuilt spawn-helper can arrive without the exec bit (npm skips install scripts): posix_spawnp fails. */
export function fixHelper() {
  if (process.platform !== "win32") for (const sub of [`prebuilds/${process.platform}-${process.arch}`, "build/Release"]) {
    const helper = path.join(ptyDir, sub, "spawn-helper")
    try { if (!(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755) } catch { /* not there */ }
  }
}
