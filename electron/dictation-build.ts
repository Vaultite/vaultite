// The dictation helper (dictation.swift), built for the app (tools/build_helpers.ts) or on first use from a checkout.
// Parakeet is transcribe.cpp's release framework (pinned, checked), shipped as a plain dylib; else Apple's engine alone.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import { run, swiftHelper } from "./swiftbuild.ts"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { messageOf } from "./browser/errors.ts"

const TRANSCRIBE = { version: "v0.4.1", sha256: "fb5646e564036a6c49659e3efcf72eb567af20da31b8569045c9a08181d35126" }
const ZIP_URL = `https://github.com/handy-computer/transcribe.cpp/releases/download/${TRANSCRIBE.version}/TranscribeCpp.xcframework.zip`
// (in a test run, the temp folder outside its own: core/testrun.ts sharedTmp, kept out of the app's launch)
const CACHE = path.join(process.env.VAULTITE_TEST_TMPDIR || os.tmpdir(), "vaultite-natives", `transcribe-${TRANSCRIBE.version}`)
const FRAMEWORK = "CTranscribe.framework"
/** The framework's library, beside the helper: one plain file, as a framework's symlinks don't survive packaging. */
const LIB = "libctranscribe.dylib", LIB_ID = `@executable_path/${LIB}`

/** transcribe.cpp's macOS framework (universal), downloaded once and checked against its pinned hash; null without it. */
async function framework(): Promise<string | null> {
  const dir = path.join(CACHE, "TranscribeCpp.xcframework", "macos-arm64_x86_64")
  // (whole only with its module map: macOS's temp cleaner takes files untouched for days and leaves their folders)
  const whole = () => fs.existsSync(path.join(dir, FRAMEWORK, "Modules", "module.modulemap"))
  if (whole()) return dir
  fs.rmSync(CACHE, { recursive: true, force: true })
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
    return whole() ? dir : null
  } catch (e) {
    console.warn(`dictation: Parakeet left out (transcribe.cpp ${TRANSCRIBE.version}: ${messageOf(e)})`)
    return null
  }
}

/** The framework's library copied to `lib`, named by where it is (beside the helper), and the helper made to load it
 *  there; both signed again ad hoc (the app's signing signs them over). */
async function flatten(from: string, helper: string, lib: string) {
  const tmp = `${lib}.${process.pid}`
  try {
    fs.copyFileSync(from, tmp)
    const old = (await stdout("/usr/bin/xcrun", ["otool", "-D", tmp])).split("\n").map((l) => l.trim()).find((l) => l.startsWith("@rpath/"))
    if (!old) throw new Error("the framework's library has no @rpath name")
    for (const [file, args] of [[tmp, ["-id", LIB_ID]], [helper, ["-change", old, LIB_ID]]] as const) {
      const r = await run("/usr/bin/xcrun", ["install_name_tool", ...args, file])
      if (!r.ok) throw new Error(`install_name_tool: ${r.err}`)
      const c = await run("/usr/bin/codesign", ["--force", "--sign", "-", file])
      if (!c.ok) throw new Error(`codesign: ${c.err}`)
    }
    if ((await stdout("/usr/bin/xcrun", ["otool", "-L", helper])).includes("@rpath/")) throw new Error("the helper still loads from @rpath")
    fs.renameSync(tmp, lib)
  } finally { fs.rmSync(tmp, { force: true }) }
}
const stdout = (bin: string, args: string[]) => new Promise<string>((done) => execFile(bin, args, (_e, o) => done(String(o))))

let fw: string | null = null
/** The helper, with transcribe.cpp's framework beside it when it could be had (macOS 14: Parakeet runs there; Apple's
 *  engine is macOS 26's, asked at run time). Its name has transcribe.cpp's version too. */
export const dictationSwift = swiftHelper({ id: "dictation", sources: ["dictation.swift"], macos: "14", salt: `${TRANSCRIBE.version}${LIB}`,
  flags: async () => { fw = await framework(); return fw ? ["-D", "PARAKEET", "-F", fw, "-framework", "CTranscribe"] : [] },
  after: async (bin, dir) => {
    fs.rmSync(path.join(dir, FRAMEWORK), { recursive: true, force: true })
    if (fw) await flatten(path.join(fw, FRAMEWORK, "Versions", "A", "CTranscribe"), bin, path.join(dir, LIB))
  } })

// ---------- Parakeet's model: Handy's or Hex's download, used where it is

const MODEL = "parakeet-unified-en-0.6b"
/** The GGUF of parakeet-unified-en-0.6b on this Mac (Q8_0 first): Hex's, Hugging Face's cache (Handy's), Handy's. */
export function parakeetModel(home = os.homedir()): string | null {
  const support = path.join(home, "Library", "Application Support")
  const hub = process.env.HF_HUB_CACHE || path.join(process.env.HF_HOME || path.join(home, ".cache", "huggingface"), "hub")
  const snapshots = path.join(hub, `models--handy-computer--${MODEL}-gguf`, "snapshots")
  const dirs = [path.join(support, "hex", "models"), path.join(support, "com.pais.handy", "models")]
  try { dirs.splice(1, 0, ...fs.readdirSync(snapshots).map((s) => path.join(snapshots, s))) } catch { /* none */ }
  const found = dirs.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.startsWith(MODEL) && f.endsWith(".gguf")).map((f) => path.join(d, f)) } catch { return [] } })
    .filter((f) => { try { return fs.statSync(f).size > 100_000_000 } catch { return false } })
  return found.find((f) => f.includes("Q8_0")) ?? found[0] ?? null
}
