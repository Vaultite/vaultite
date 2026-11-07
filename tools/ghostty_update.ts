// The terminal's libghostty-vt (vt/ghostty-vt.wasm) from a Ghostty release, its signature checked, with PROVENANCE.md;
// by hand only: node tools/ghostty_update.ts --version 1.0.0 (a release), or --tip (moves: pin what you test).
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const DIR = path.join(ROOT, "plugins/core/terminal/vt")
/** Ghostty's release signing key (PACKAGING.md in its repository). */
const KEY = "RWQlAjJC23149WL2sEpT/l0QKy7hMIFhYdQOFy0Z7z7PbneUgvlsnYcV"

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

/** What the module says it is (ghostty_type_json): its version and the commit it was built from. */
async function about(wasm: Buffer) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(wasm)), {})
  const e = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }
  const p = e.ghostty_type_json(), b = new Uint8Array(e.memory.buffer)
  let n = p
  while (b[n]) n++
  const j = JSON.parse(new TextDecoder().decode(b.subarray(p, n))) as { library_version: string; commit: string | null; dirty: boolean }
  return { version: j.library_version, commit: j.commit, dirty: j.dirty }
}

async function fetchTo(url: string, file: string) {
  const r = await fetch(url, { redirect: "follow" })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

async function main() {
  const args = process.argv.slice(2), at = args.indexOf("--version"), version = at >= 0 ? args[at + 1] : null
  if (!version && !args.includes("--tip")) { console.error("usage: node tools/ghostty_update.ts --version <x.y.z> | --tip"); process.exit(2) }
  const url = version ? `https://release.files.ghostty.org/libghostty-vt/${version}/ghostty-vt-${version}.wasm`
    : "https://github.com/ghostty-org/ghostty/releases/download/tip/ghostty-vt.wasm"
  // (downloads in a folder of their own until they're checked)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ghostty-vt-"))
  try {
    const wasmFile = path.join(tmp, "ghostty-vt.wasm")
    await fetchTo(url, wasmFile)
    await fetchTo(`${url}.minisig`, `${wasmFile}.minisig`)
    const wasm = fs.readFileSync(wasmFile)
    if (!minisignOk(wasm, fs.readFileSync(`${wasmFile}.minisig`, "utf8"))) throw new Error(`${url}: its signature isn't Ghostty's`)
    const sha = crypto.createHash("sha256").update(wasm).digest("hex"), it = await about(wasm)
    if (it.dirty) throw new Error(`${url}: built from a dirty tree`)
    fs.copyFileSync(wasmFile, path.join(DIR, "ghostty-vt.wasm"))
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
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

if (import.meta.main) await main()
