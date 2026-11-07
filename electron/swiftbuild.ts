// A Mac helper compiled from Swift (screen, take-over, capture, voice, dictation, app windows), built for the app
// (tools/build_helpers.ts) or on first use from a checkout, named by its sources' hash so a change builds it again.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const run = (bin: string, args: string[], timeout = 300_000) => new Promise<{ ok: boolean; err: string }>((done) =>
  execFile(bin, args, { timeout }, (e, _out, err) => done({ ok: !e, err: String(err).trim() })))

export type SwiftHelper = { name: () => string; build: (dir: string, archs?: string[]) => Promise<string>
  /** The app's own (electron/bin), else built into `dir` (userData's bin). */
  binary: (dir: string) => Promise<string> }
/** `sources` in electron/, the first the one with top-level code (more than one: it's compiled as main.swift); `salt`
 *  names what else the binary depends on; `flags` adds to swiftc's, `after` finishes the built binary before it's in. */
export function swiftHelper(o: { id: string; sources: string[]; macos: string; salt?: string; flags?: () => Promise<string[]>; after?: (bin: string, dir: string) => Promise<void> }): SwiftHelper {
  const files = o.sources.map((f) => path.join(import.meta.dirname, f))
  const name = () => {
    const h = crypto.createHash("sha1")
    for (const f of files) h.update(fs.readFileSync(f))
    return `${o.id}-${h.update(o.salt ?? "").digest("hex").slice(0, 12)}`
  }
  /** Built into `dir` (Xcode's Command Line Tools), for this Mac or each of `archs`, then moved in: one cut off midway
   *  never leaves a binary that's reused. Answers its path. */
  async function build(dir: string, archs: string[] = []) {
    const out = path.join(dir, name())
    if (fs.existsSync(out)) return out
    if (!(await run("/usr/bin/xcode-select", ["-p"])).ok) throw new Error("it needs Xcode's Command Line Tools to be built here")
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${out}.${process.pid}`
    const slices = (archs.length ? archs : [os.arch() === "arm64" ? "arm64" : "x86_64"]).map((a) => [`${tmp}-${a}`, a])
    // (swiftc runs top-level code only from a file named main.swift once there's more than one)
    const src = files.length > 1 ? fs.mkdtempSync(path.join(os.tmpdir(), `vaultite-${o.id}-`)) : null
    const inputs = src ? files.map((f, i) => { const to = path.join(src, i ? path.basename(f) : "main.swift"); fs.copyFileSync(f, to); return to }) : files
    try {
      const flags = (await o.flags?.()) ?? []
      for (const [file, arch] of slices) {
        const r = await run("/usr/bin/xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos${o.macos}`, ...flags, ...inputs, "-o", file])
        if (!r.ok) throw new Error(`it didn't build: ${r.err.split("\n").filter((l) => l.includes("error")).slice(0, 2).join(" ")}`)
      }
      const r = await run("/usr/bin/xcrun", ["lipo", "-create", ...slices.map((s) => s[0]), "-output", tmp])
      if (!r.ok) throw new Error(`lipo: ${r.err}`)
      await o.after?.(tmp, dir)
      fs.renameSync(tmp, out)
    } finally {
      for (const f of [tmp, ...slices.map((s) => s[0])]) fs.rmSync(f, { force: true })
      if (src) fs.rmSync(src, { recursive: true, force: true })
    }
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`${o.id}-`) && f !== path.basename(out)) fs.rmSync(path.join(dir, f), { force: true })
    return out
  }
  const binary = (dir: string) => { const shipped = path.join(import.meta.dirname, "bin", name()); return fs.existsSync(shipped) ? Promise.resolve(shipped) : build(dir) }
  return { name, build, binary }
}

export const screenSwift = swiftHelper({ id: "screen", sources: ["screen.swift", "ax.swift"], macos: "13" })
export const takeoverSwift = swiftHelper({ id: "takeover", sources: ["takeover.swift", "ax.swift"], macos: "13" })
export const captureSwift = swiftHelper({ id: "capture", sources: ["capture.swift"], macos: "14" })
export const voiceSwift = swiftHelper({ id: "voice", sources: ["voice.swift"], macos: "14" })
export const appWindowsSwift = swiftHelper({ id: "appwindows", sources: ["appwindows.swift"], macos: "13" })
