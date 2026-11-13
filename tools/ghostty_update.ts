// vt/ghostty-vt.wasm, built here for wasm32-wasi from Ghostty's signed source and vt/patches/ (its release wasm has no
// kitty graphics): --build 1.0.0 [--check: rebuild, compare]; --version 1.0.0 | --tip takes a release's (with kitty only).
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { wasiImports } from "../plugins/core/terminal/vt/vt.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const DIR = path.join(ROOT, "plugins/core/terminal/vt")
/** Ghostty's release signing key (PACKAGING.md in its repository). */
const KEY = "RWQlAjJC23149WL2sEpT/l0QKy7hMIFhYdQOFy0Z7z7PbneUgvlsnYcV"
/** Zig's release signing key (ziglang.org/download). */
const ZIG_KEY = "RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U"
/** How it's built: Ghostty's speed build (its release's ghostty-vt.wasm), for WASI (kitty graphics are off on
 *  freestanding), its debug info left out. */
const FLAGS = ["-Demit-lib-vt", "-Dtarget=wasm32-wasi", "-Doptimize=ReleaseFast", "-Dstrip=true"]
/** The Zig it's built with: the one the build was checked with (build.zig.zon asks for 0.17.0 at least). */
const ZIG = "0.17.1"
const PATCHES = path.join(DIR, "patches")

/** Whether `sig` (a .minisig file) is KEY's signature of `data`, its trusted comment too. */
export function minisignOk(data: Buffer, sig: string, key = KEY) {
  const pk = Buffer.from(key, "base64"), lines = sig.trim().split("\n")
  const s = Buffer.from(lines[1] ?? "", "base64"), trusted = (lines[2] ?? "").replace(/^trusted comment: /, ""), global = Buffer.from(lines[3] ?? "", "base64")
  if (pk.length !== 42 || s.length !== 74 || !s.subarray(2, 10).equals(pk.subarray(2, 10))) return false
  const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk.subarray(10)]), format: "der", type: "spki" })
  const alg = s.subarray(0, 2).toString()
  const msg = alg === "ED" ? crypto.createHash("blake2b512").update(data).digest() : alg === "Ed" ? data : null
  return !!msg && crypto.verify(null, msg, pub, s.subarray(10)) && crypto.verify(null, Buffer.concat([s.subarray(10), Buffer.from(trusted)]), pub, global)
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex")

/** What the module says it is (ghostty_type_json, ghostty_build_info): its version, commit, and kitty graphics. */
export function about(wasm: Buffer) {
  const module = new WebAssembly.Module(new Uint8Array(wasm))
  let memory: WebAssembly.Memory | null = null
  const instance = new WebAssembly.Instance(module, wasiImports(module, () => memory!))
  const e = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }
  memory = e.memory
  const p = e.ghostty_type_json(), b = new Uint8Array(e.memory.buffer)
  let n = p
  while (b[n]) n++
  const j = JSON.parse(new TextDecoder().decode(b.subarray(p, n))) as { library_version: string; commit: string | null; dirty: boolean; types: Record<string, { values?: Record<string, number> }> }
  const out = e.ghostty_wasm_alloc(8)
  const kitty = e.ghostty_build_info(j.types.GhosttyBuildInfo.values!.KITTY_GRAPHICS, out) === 0 && new Uint8Array(e.memory.buffer)[out] === 1
  return { version: j.library_version, commit: j.commit, dirty: j.dirty, kitty }
}

async function fetchTo(url: string, file: string) {
  const r = await fetch(url, { redirect: "follow" })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}
/** `url` and its .minisig into `dir`, the signature checked against `key`: the file's path. */
async function signed(url: string, dir: string, key: string) {
  const file = path.join(dir, path.basename(new URL(url).pathname))
  await fetchTo(url, file)
  await fetchTo(`${url}.minisig`, `${file}.minisig`)
  if (!minisignOk(fs.readFileSync(file), fs.readFileSync(`${file}.minisig`, "utf8"), key)) throw new Error(`${url}: its signature isn't the one it should have`)
  return file
}
const untar = (file: string, into: string) => { fs.mkdirSync(into, { recursive: true }); execFileSync("tar", ["-xf", file, "-C", into]) }

type Built = { wasm: Buffer; zigSha: string; src: string; srcSha: string; depsSha: string; patches: string[]; minZig: string }

/** The module built from release `version`'s signed source and vt/patches/, in `tmp` (fresh: its own Zig, caches and
 *  output; a real path, as uucode's generator breaks under macOS's /tmp link). */
async function build(version: string, tmp: string): Promise<Built> {
  const base = `https://release.files.ghostty.org/libghostty-vt/${version}`
  const src = await signed(`${base}/libghostty-vt-${version}.tar.gz`, tmp, KEY)
  const deps = await signed(`${base}/libghostty-vt-${version}-deps.tar.gz`, tmp, KEY)
  untar(src, path.join(tmp, "src")); untar(deps, path.join(tmp, "deps"))
  const srcDir = path.join(tmp, "src", `libghostty-vt-${version}`), depsDir = path.join(tmp, "deps", `libghostty-vt-${version}-deps`)
  const minZig = /\.minimum_zig_version\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(srcDir, "build.zig.zon"), "utf8"))?.[1]
  if (!minZig) throw new Error("build.zig.zon names no minimum_zig_version")
  const patches = fs.readdirSync(PATCHES).filter((f) => f.endsWith(".patch")).sort()
  for (const p of patches) execFileSync("patch", ["-p1", "--forward", "--batch", "-i", path.join(PATCHES, p)], { cwd: srcDir, stdio: "inherit" })
  const arch = { arm64: "aarch64", x64: "x86_64" }[process.arch as string], plat = { darwin: "macos", linux: "linux" }[process.platform as string]
  if (!arch || !plat) throw new Error(`no Zig for ${process.platform}-${process.arch} here`)
  const zigName = `zig-${arch}-${plat}-${ZIG}`
  const zigTar = await signed(`https://ziglang.org/download/${ZIG}/${zigName}.tar.xz`, tmp, ZIG_KEY)
  untar(zigTar, path.join(tmp, "zig"))
  const prefix = path.join(tmp, "out")
  execFileSync(path.join(tmp, "zig", zigName, "zig"), ["build", ...FLAGS, "--system", depsDir, "--prefix", prefix], {
    cwd: srcDir, stdio: "inherit",
    env: { PATH: process.env.PATH ?? "", HOME: tmp, ZIG_GLOBAL_CACHE_DIR: path.join(tmp, "cache"), ZIG_LOCAL_CACHE_DIR: path.join(tmp, "local-cache") },
  })
  return { wasm: fs.readFileSync(path.join(prefix, "bin", "ghostty-vt.wasm")), zigSha: sha256(fs.readFileSync(zigTar)), src: path.basename(src),
    srcSha: sha256(fs.readFileSync(src)), depsSha: sha256(fs.readFileSync(deps)), patches: patches.map((p) => `${p} (SHA-256 ${sha256(fs.readFileSync(path.join(PATCHES, p)))})`), minZig }
}

/** Fails unless the module is what vt.ts runs: kitty graphics in it, no WASI import vt.ts doesn't give. */
function accept(wasm: Buffer, what: string) {
  const it = about(wasm)
  if (it.dirty) throw new Error(`${what}: built from a dirty tree`)
  if (!it.kitty) throw new Error(`${what}: no kitty graphics in it`)
  return it
}

async function main() {
  const args = process.argv.slice(2), arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
  const buildV = arg("--build"), version = arg("--version"), tip = args.includes("--tip"), check = args.includes("--check")
  if (!buildV && !version && !tip) { console.error("usage: node tools/ghostty_update.ts --build <x.y.z> [--check] | --version <x.y.z> | --tip"); process.exit(2) }
  // (each download and build in a folder of its own, removed after)
  const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ghostty-vt-"))
  const dirs: string[] = []
  try {
    if (buildV) {
      const b = await build(buildV, (dirs[dirs.length] = tmp()))
      const sha = sha256(b.wasm), it = accept(b.wasm, `${buildV} built here`)
      if (check) {
        const prov = fs.readFileSync(path.join(DIR, "PROVENANCE.md"), "utf8"), was = sha256(fs.readFileSync(path.join(DIR, "ghostty-vt.wasm")))
        const same = sha === was && prov.includes(`SHA-256: ${sha}`)
        console.log(same ? `reproduced: ${sha}` : `NOT reproduced: built ${sha}, the file is ${was}`)
        process.exit(same ? 0 : 1)
      }
      const was = fs.existsSync(path.join(DIR, "ghostty-vt.wasm")) ? sha256(fs.readFileSync(path.join(DIR, "ghostty-vt.wasm"))) : ""
      // Built twice, from nothing each time: whether a rebuild gives these bytes (PROVENANCE says).
      const again = sha256((await build(buildV, (dirs[dirs.length] = tmp()))).wasm)
      fs.writeFileSync(path.join(DIR, "ghostty-vt.wasm"), b.wasm)
      fs.writeFileSync(path.join(DIR, "PROVENANCE.md"), `# ghostty-vt.wasm

libghostty-vt, Ghostty's terminal emulator as a library (MIT license, https://github.com/ghostty-org/ghostty), built
here by \`tools/ghostty_update.ts --build ${buildV}\` from Ghostty's signed release source with patches of ours:
Ghostty's own wasm (wasm32-freestanding) has kitty graphics compiled out; this is wasm32-wasi, its WASI imports
stubs \`vt.ts\` gives (no clock, no files), and its grown pages zeroed as Ghostty does on freestanding.

- Version: ${it.version}
- Source: ${b.src} (+ ${b.src.replace(".tar.gz", "-deps.tar.gz")}), minisign checked against Ghostty's key
- Source SHA-256: ${b.srcSha}; deps SHA-256: ${b.depsSha}
- Patches (vt/patches/): ${b.patches.join("; ")}
- Zig: ${ZIG} (build.zig.zon asks for ${b.minZig} at least), from ziglang.org, minisign checked against Zig's key; SHA-256: ${b.zigSha}
- Build: \`zig build ${FLAGS.join(" ")}\`, in fresh folders and caches
- Reproducible: ${again === sha ? `yes (built twice: the same bytes; \`--check\` builds again and compares)` : `no (a second build gave ${again})`}
- SHA-256: ${sha}
- Built: ${new Date().toISOString().slice(0, 10)}

Its C API: \`include/ghostty/vt.h\` there (https://lib.ghostty.org/). \`vt.ts\` reads enum values from the module
itself (\`ghostty_type_json\`); struct offsets it uses are checked by \`tools/test_vt.ts\`.
`)
      console.log(`ghostty-vt.wasm ${it.version} built here, sha256 ${sha}, ${b.wasm.length} bytes; reproducible: ${again === sha}; the same as the file it replaced: ${sha === was}`)
      return
    }
    const url = version ? `https://release.files.ghostty.org/libghostty-vt/${version}/ghostty-vt-${version}.wasm`
      : "https://github.com/ghostty-org/ghostty/releases/download/tip/ghostty-vt.wasm"
    const file = await signed(url, (dirs[dirs.length] = tmp()), KEY)
    const wasm = fs.readFileSync(file), sha = sha256(wasm), it = accept(wasm, url)
    fs.copyFileSync(file, path.join(DIR, "ghostty-vt.wasm"))
    fs.writeFileSync(path.join(DIR, "PROVENANCE.md"), `# ghostty-vt.wasm

libghostty-vt, Ghostty's terminal emulator as a library, built for WebAssembly by the Ghostty project (MIT license,
https://github.com/ghostty-org/ghostty). Not built here: its release file, its minisign signature checked against
Ghostty's key by \`tools/ghostty_update.ts\`, which wrote this file.

- Version: ${it.version}
- Source: ${it.commit ? `commit ${it.commit}` : `tag vt-${version}`}
- From: ${url}
- SHA-256: ${sha}
- Taken: ${new Date().toISOString().slice(0, 10)}

Its C API: \`include/ghostty/vt.h\` there (${version ? "https://lib.ghostty.org/" : "https://libghostty.tip.ghostty.org/"}). \`vt.ts\` reads enum values
from the module itself (\`ghostty_type_json\`); struct offsets it uses are checked by \`tools/test_vt.ts\`.
`)
    console.log(`ghostty-vt.wasm ${it.version} (${it.commit ?? `vt-${version}`}), sha256 ${sha}`)
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) }
}

if (import.meta.main) await main()
