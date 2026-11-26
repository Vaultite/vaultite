import fs from "node:fs"
import path from "node:path"
import { COPY } from "../core/precompressed.ts"

const PUBLIC = new Map([["android", "android/app/src/main/assets/public"], ["ios", "ios/App/App/public"]])

export function dropPrecompressed(dir: string) {
  let dropped = 0
  for (const f of fs.readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (COPY.test(f)) { fs.rmSync(path.join(dir, f)); dropped++ }
  }
  return dropped
}

const platform = process.env.CAPACITOR_PLATFORM_NAME ?? ""
const dir = PUBLIC.get(platform)
if (dir) dropPrecompressed(path.resolve(process.env.CAPACITOR_ROOT_DIR ?? process.cwd(), dir))
