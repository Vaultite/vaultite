// The dictation helper (dictation.swift), built for the app (tools/build_helpers.ts) or on first use from a checkout.
// Parakeet is transcribe.cpp's release framework, pinned and checked; without it, Apple's engine alone.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SOURCE = path.join(import.meta.dirname, "dictation.swift")
const TRANSCRIBE = { version: "v0.4.1", sha256: "fb5646e564036a6c49659e3efcf72eb567af20da31b8569045c9a08181d35126" }
const ZIP_URL = `https://github.com/handy-computer/transcribe.cpp/releases/download/${TRANSCRIBE.version}/TranscribeCpp.xcframework.zip`
const CACHE = path.join(os.tmpdir(), "vaultite-natives", `transcribe-${TRANSCRIBE.version}`)
/** The framework the helper loads, beside it. */
export const FRAMEWORK = "CTranscribe.framework"

const run = (bin: string, args: string[], timeout = 300_000) => new Promise<{ ok: boolean; err: string }>((done) =>
  execFile(bin, args, { timeout }, (e, _out, err) => done({ ok: !e, err: String(err).trim() })))

/** The helper's file name: its source's hash and transcribe.cpp's version, so a change builds it again. */
export const helperName = () =>
  `dictation-${crypto.createHash("sha1").update(fs.readFileSync(SOURCE)).update(TRANSCRIBE.version).digest("hex").slice(0, 12)}`

/** transcribe.cpp's macOS framework (universal), downloaded once and checked against its pinned hash; null without it. */
async function framework(): Promise<string | null> {
  const dir = path.join(CACHE, "TranscribeCpp.xcframework", "macos-arm64_x86_64")
  if (fs.existsSync(path.join(dir, FRAMEWORK))) return dir
  try {
    const res = await fetch(ZIP_URL)
    if (!res.ok) throw new Error(`${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (crypto.createHash("sha256").update(buf).digest("hex") !== TRANSCRIBE.sha256) throw new Error("its checksum doesn't match")
    fs.mkdirSync(CACHE, { recursive: true })
    const zip = path.join(CACHE, `framework-${process.pid}.zip`)
    fs.writeFileSync(zip, buf)
    const r = await run("/usr/bin/ditto", ["-x", "-k", zip, CACHE])
    fs.rmSync(zip, { force: true })
    if (!r.ok) throw new Error(r.err)
    return fs.existsSync(path.join(dir, FRAMEWORK)) ? dir : null
  } catch (e) {
    console.warn(`dictation: Parakeet left out (transcribe.cpp ${TRANSCRIBE.version}: ${(e as Error).message})`)
    return null
  }
}

/** Build the helper into `dir` (Xcode's Command Line Tools), for this Mac or for each of `archs` (the app's: both),
 *  with transcribe.cpp's framework beside it when it could be had. Answers its path. */
export async function buildDictation(dir: string, archs: string[] = []): Promise<string> {
  const out = path.join(dir, helperName())
  if (fs.existsSync(out)) return out
  if (!(await run("/usr/bin/xcode-select", ["-p"])).ok) throw new Error("it needs Xcode's Command Line Tools to be built here")
  fs.mkdirSync(dir, { recursive: true })
  const fw = await framework()
  const link = fw ? ["-D", "PARAKEET", "-F", fw, "-framework", "CTranscribe", "-Xlinker", "-rpath", "-Xlinker", "@executable_path"] : []
  const tmp = `${out}.${process.pid}`
  const slices = (archs.length ? archs : [os.arch() === "arm64" ? "arm64" : "x86_64"]).map((a) => [`${tmp}-${a}`, a])
  try {
    for (const [file, arch] of slices) {
      // (macOS 14: Parakeet runs there; Apple's engine is macOS 26's, asked at run time)
      const r = await run("/usr/bin/xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos14`, ...link, SOURCE, "-o", file])
      if (!r.ok) throw new Error(`it didn't build: ${r.err.split("\n").filter((l) => l.includes("error")).slice(0, 2).join(" ")}`)
    }
    const r = await run("/usr/bin/xcrun", ["lipo", "-create", ...slices.map((s) => s[0]), "-output", tmp])
    if (!r.ok) throw new Error(`lipo: ${r.err}`)
    if (fw) {
      fs.rmSync(path.join(dir, FRAMEWORK), { recursive: true, force: true })
      // (ditto keeps the framework's symlinks, which codesign needs)
      const c = await run("/usr/bin/ditto", [path.join(fw, FRAMEWORK), path.join(dir, FRAMEWORK)])
      if (!c.ok) throw new Error(`the framework wasn't copied: ${c.err}`)
    }
    fs.renameSync(tmp, out)
  } finally { for (const f of [tmp, ...slices.map((s) => s[0])]) fs.rmSync(f, { force: true }) }
  for (const f of fs.readdirSync(dir)) if (f.startsWith("dictation-") && f !== path.basename(out)) fs.rmSync(path.join(dir, f), { force: true })
  return out
}
