// The screen helper (screen.swift), built for the app (tools/build_helpers.ts) or on first use from a checkout.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SOURCE = path.join(import.meta.dirname, "screen.swift")

/** Named by its source's hash, so a change builds it again. */
export const screenHelperName = () => `screen-${crypto.createHash("sha1").update(fs.readFileSync(SOURCE)).digest("hex").slice(0, 12)}`

const run = (bin: string, args: string[]) => new Promise<{ ok: boolean; err: string }>((done) =>
  execFile(bin, args, { timeout: 300_000 }, (e, _out, err) => done({ ok: !e, err: String(err).trim() })))

/** Build it into `dir` (Xcode's Command Line Tools), for this Mac or each of `archs`. Answers its path. */
export async function buildScreen(dir: string, archs: string[] = []): Promise<string> {
  const out = path.join(dir, screenHelperName())
  if (fs.existsSync(out)) return out
  if (!(await run("/usr/bin/xcode-select", ["-p"])).ok) throw new Error("it needs Xcode's Command Line Tools to be built here")
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${out}.${process.pid}`
  const slices = (archs.length ? archs : [os.arch() === "arm64" ? "arm64" : "x86_64"]).map((a) => [`${tmp}-${a}`, a])
  try {
    for (const [file, arch] of slices) {
      const r = await run("/usr/bin/xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos13`, SOURCE, "-o", file])
      if (!r.ok) throw new Error(`it didn't build: ${r.err.split("\n").filter((l) => l.includes("error")).slice(0, 2).join(" ")}`)
    }
    const r = await run("/usr/bin/xcrun", ["lipo", "-create", ...slices.map((s) => s[0]), "-output", tmp])
    if (!r.ok) throw new Error(`lipo: ${r.err}`)
    fs.renameSync(tmp, out)
  } finally { for (const f of [tmp, ...slices.map((s) => s[0])]) fs.rmSync(f, { force: true }) }
  for (const f of fs.readdirSync(dir)) if (f.startsWith("screen-") && f !== path.basename(out)) fs.rmSync(path.join(dir, f), { force: true })
  return out
}
