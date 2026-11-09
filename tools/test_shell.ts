// The app's identity and build facts (electron/identity.ts): what stamp.ts and sign.cjs write, and what the app reads
// from them. In npm test.
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { check, exit, summary, tempDir } from "./test/lib.ts"
import { codeAt, shellAt, stamps } from "../electron/identity.ts"
const t0 = Date.now()

const ROOT = path.dirname(import.meta.dirname)
const tmp = tempDir("vaultite-shell-test-")
const put = (root: string, name: string, text: string) => {
  fs.mkdirSync(path.join(root, "electron"), { recursive: true })
  fs.writeFileSync(path.join(root, "electron", name), text)
}
const C = "c".repeat(40), REPO = "https://github.com/Alice/lighthouse.git"

// ---------- reading ----------
const none = path.join(tmp, "none")
check("no stamps (a checkout run as it is): an empty shell, no code", JSON.stringify(shellAt(none)) === "{}" && codeAt(none) === null)
const broken = path.join(tmp, "broken")
put(broken, "shell.json", "{not json")
put(broken, "build.json", "[1]")
check("broken stamps read as none", JSON.stringify(shellAt(broken)) === "{}" && codeAt(broken) === null)
const half = path.join(tmp, "half")
put(half, "build.json", JSON.stringify({ commit: C }))
check("a code stamp without its repo is none", codeAt(half) === null)
const full = path.join(tmp, "full")
put(full, "build.json", JSON.stringify({ commit: C, repo: REPO, channel: "main" }))
put(full, "shell.json", JSON.stringify({ channel: "dev", branch: "fix-tabs", commit: C, appId: "app.lighthouse.dev", productName: "Lighthouse Dev" }))
check("the code: its commit and repo only", JSON.stringify(codeAt(full)) === JSON.stringify({ commit: C, repo: REPO }), codeAt(full))
check("the shell: its channel, branch, name and id", shellAt(full).channel === "dev" && shellAt(full).branch === "fix-tabs" && shellAt(full).productName === "Lighthouse Dev"
  && shellAt(full).appId === "app.lighthouse.dev", shellAt(full))

// ---------- writing (stamp.ts) ----------
const stamp = (env: Record<string, string>) => stamps({ commit: C, repo: REPO, branch: "fix-tabs", env })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
check("a release: release, no channel", same(stamp({ VAULTITE_RELEASE: "1" }).shell, { release: true, commit: C }), stamp({ VAULTITE_RELEASE: "1" }))
check("a nightly: a release on its channel", same(stamp({ VAULTITE_RELEASE: "1", VAULTITE_CHANNEL: "nightly" }).shell, { release: true, channel: "nightly", commit: C }))
check("Main: its channel", same(stamp({ VAULTITE_CHANNEL: "main" }).shell, { channel: "main", commit: C }))
check("Dev: its channel and branch", same(stamp({ VAULTITE_CHANNEL: "dev" }).shell, { channel: "dev", branch: "fix-tabs", commit: C }))
check("an unknown channel: none", same(stamp({ VAULTITE_CHANNEL: "beta" }).shell, { commit: C }))
check("the code's stamp is the same on every channel", ["main", "dev", "nightly"].every((c) => same(stamp({ VAULTITE_CHANNEL: c }).code, { commit: C, repo: REPO })))
// (update.sh's stage, an old app's too, greps build.json's commit on a line of its own)
const line = /^.*"commit": *"([0-9a-f]*)".*$/m.exec(JSON.stringify(stamp({}).code, null, 2))?.[1]
check("build.json as stamp.ts writes it gives update.sh its commit", line === C, line)

// ---------- packaging (sign.cjs) ----------
const { stampShell } = createRequire(import.meta.url)(path.join(ROOT, "electron", "sign.cjs"))
for (const [platform, res] of [["darwin", "Lighthouse Main.app/Contents/Resources/app"], ["linux", "resources/app"], ["win32", "resources/app"]]) {
  const out = path.join(tmp, `out-${platform}`)
  put(path.join(out, res), "shell.json", JSON.stringify({ channel: "main", commit: C }))
  stampShell({ electronPlatformName: platform, appOutDir: out, packager: { appInfo: { id: "app.lighthouse.main", productName: "Lighthouse Main", productFilename: "Lighthouse Main" } } })
  check(`${platform}: the packaged shell gains the name and id it was packaged as`,
    same(shellAt(path.join(out, res)), { channel: "main", commit: C, appId: "app.lighthouse.main", productName: "Lighthouse Main" }), shellAt(path.join(out, res)))
}

// ---------- one reader ----------
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : [])
const readers = files(path.join(ROOT, "electron")).filter((f) => !/[/\\](identity|stamp)\.ts$/.test(f))
  .filter((f) => /"(build|shell)\.json"/.test(fs.readFileSync(f, "utf8")))
check("in the app, only identity.ts reads its stamps", !readers.length, readers.map((f) => path.relative(ROOT, f)))
// (a root's package.json says "Vaultite" from a checkout: Dev and Main would open the release's userData)
check("its name and id never come from package.json", !fs.readFileSync(path.join(ROOT, "electron", "main.ts"), "utf8").includes("package.json"))

await exit(summary("shell", t0))
