// The permissions addon (macpermissions.m), built for the app (tools/build_helpers.ts) or on first use from a checkout.
// No Electron here: the build tool and the tests load this in plain Node.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const SOURCE = path.join(import.meta.dirname, "macpermissions.m")

const run = (bin: string, args: string[]) => new Promise<{ ok: boolean; err: string }>((done) =>
  execFile(bin, args, { timeout: 300_000 }, (e, _out, err) => done({ ok: !e, err: String(err).trim() })))

/** The addon's file name, by its source's hash, so a change builds it again. */
export const addonName = () => `macpermissions-${crypto.createHash("sha1").update(fs.readFileSync(SOURCE)).digest("hex").slice(0, 12)}.node`

/** Build it into `dir` (Xcode's Command Line Tools), for both architectures the app ships for. Answers its path. */
export async function buildMacPermissions(dir: string): Promise<string> {
  const out = path.join(dir, addonName())
  if (fs.existsSync(out)) return out
  if (!(await run("/usr/bin/xcode-select", ["-p"])).ok) throw new Error("it needs Xcode's Command Line Tools to be built here")
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${out}.${process.pid}`
  try {
    // (Node-API's calls come from the host process: Electron or node)
    const r = await run("/usr/bin/xcrun", ["clang", "-fobjc-arc", "-O2", "-bundle", "-undefined", "dynamic_lookup", "-arch", "arm64", "-arch", "x86_64",
      "-mmacosx-version-min=12.0", "-framework", "AppKit", "-framework", "CoreLocation", "-framework", "IOKit", SOURCE, "-o", tmp])
    if (!r.ok) throw new Error(`it didn't build: ${r.err.split("\n").filter((l) => l.includes("error")).slice(0, 2).join(" ")}`)
    fs.renameSync(tmp, out)
  } finally { fs.rmSync(tmp, { force: true }) }
  for (const f of fs.readdirSync(dir)) if (f.startsWith("macpermissions-") && f !== path.basename(out)) fs.rmSync(path.join(dir, f), { force: true })
  return out
}

export type MacPermissions = { call: (cmd: Record<string, unknown>) => Record<string, unknown> }

/** Load a built addon: its one call, JSON in and out (it throws on what it answers as an error). */
export function loadMacPermissions(file: string): MacPermissions {
  const mod = { exports: {} as { call: (json: string) => string } }
  process.dlopen(mod, file)
  return {
    call: (cmd) => {
      const res = JSON.parse(mod.exports.call(JSON.stringify(cmd))) as Record<string, unknown>
      if (typeof res.error === "string") throw new Error(res.error)
      return res
    },
  }
}
