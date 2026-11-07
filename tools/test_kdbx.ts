// The KeePass reader and writer (electron/browser/kdbx: kdbxweb, vendored): upstream's tests as written, then ours
// for damaged and hostile files, then all of it again in Electron's runtime. `node tools/test_kdbx.ts` (npm test)
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { CryptoEngine } from "../electron/browser/kdbx/index.ts"
import { run } from "./test/kdbx/mocha.ts"
import { argon2 } from "./test/kdbx/resources.ts"
import { check, exit, section, skip, summary, tempDir } from "./test/lib.ts"

const t0 = Date.now()
CryptoEngine.setArgon2Impl(argon2)

const UPSTREAM = ["int64", "byte-utils", "binary-stream", "var-dictionary", "xml-utils", "kdbx-error", "chacha20", "salsa20", "crypto-engine",
  "protected-value", "protected-salt-generator", "hashed-block-transform", "hmac-block-transform", "key-encryptor-aes", "key-encryptor-kdf",
  "kdbx-uuid", "kdbx-binaries", "kdbx-credentials", "kdbx-custom-data", "kdbx-header", "kdbx", "kdbx.merge"]
for (const name of UPSTREAM) await import(`./test/kdbx/upstream/${name}.ts`)
await section("upstream", () => run((name, error) => check(name, !error, error instanceof Error ? error.message : error)))
await import("./test/kdbx/ours.ts")

// The app reads these files in Electron's main process, whose node:crypto is BoringSSL (no ChaCha20, no Argon2).
if (!process.versions.electron) {
  let electron = ""
  try { electron = createRequire(import.meta.url)("electron") as unknown as string } catch { /* not installed */ }
  if (!electron || !fs.existsSync(electron)) skip("kdbx in Electron", "no Electron binary here")
  else await section("kdbx in Electron", () => {
    const out = path.join(tempDir("vau-kdbx-electron-"), "results.json")
    const r = spawnSync(electron, [import.meta.filename], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTITE_TEST_OUT: out }, encoding: "utf8", timeout: 300_000 })
    const results: { name: string; status: string }[] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")).results : []
    const failed = results.filter((x) => x.status === "FAIL").map((x) => x.name)
    const version = spawnSync(electron, ["-p", "process.versions.electron"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" }).stdout.trim()
    check(`in Electron ${version} (BoringSSL): every test above passes too (${results.length})`, r.status === 0 && results.length > 400 && !failed.length,
      failed.length ? failed.slice(0, 5) : r.stderr.slice(-400))
  })
}

await exit(summary("kdbx", t0))
