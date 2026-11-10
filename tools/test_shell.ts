// The shell (electron/shell/): the app's identity and build facts (identity.ts, stamp.ts, sign.cjs), its fingerprint,
// the code root it picks and its record of each, and the vau trampoline. In npm test.
import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { type Any, check, exit, summary, tempDir } from "./test/lib.ts"
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
const P = "e".repeat(64)
const stamp = (env: Record<string, string>) => stamps({ commit: C, repo: REPO, branch: "fix-tabs", fingerprint: P, env })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
check("a release: release, no channel", same(stamp({ VAULTITE_RELEASE: "1" }).shell, { release: true, commit: C, fingerprint: P }), stamp({ VAULTITE_RELEASE: "1" }))
check("a nightly: a release on its channel", same(stamp({ VAULTITE_RELEASE: "1", VAULTITE_CHANNEL: "nightly" }).shell, { release: true, channel: "nightly", commit: C, fingerprint: P }))
check("Main: its channel", same(stamp({ VAULTITE_CHANNEL: "main" }).shell, { channel: "main", commit: C, fingerprint: P }))
check("Dev: its channel and branch", same(stamp({ VAULTITE_CHANNEL: "dev" }).shell, { channel: "dev", branch: "fix-tabs", commit: C, fingerprint: P }))
check("an unknown channel: none", same(stamp({ VAULTITE_CHANNEL: "beta" }).shell, { commit: C, fingerprint: P }))
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

// ---------- the fingerprint (electron/shell/print.mjs, inputs.json) ----------
const { fingerprint } = await import("../electron/shell/print.mjs")
const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, "electron/shell/inputs.json"), "utf8")) as { files: string[]; package: string[]; electron: string }
/** A copy of what the fingerprint reads, and a file it doesn't. */
function shellCopy(name: string) {
  const at = path.join(tmp, name)
  for (const f of [...inputs.files, "package.json", inputs.electron, "electron/natives.cjs", "core/appentry.ts"]) fs.cpSync(path.join(ROOT, f), path.join(at, f), { recursive: true })
  return at
}
const base = shellCopy("print-base"), p0 = fingerprint(base)
check("the fingerprint: the same twice, and the checkout's own", p0 === fingerprint(base) && p0 === fingerprint(ROOT) && /^[0-9a-f]{64}$/.test(p0))
const moved = (what: string, change: (at: string) => void) => { const at = shellCopy(`print-${what.replace(/\W+/g, "-")}`); change(at); return fingerprint(at) !== p0 }
const edit = (f: string, fn: (s: string) => string) => (at: string) => fs.writeFileSync(path.join(at, f), fn(fs.readFileSync(path.join(at, f), "utf8")))
const pkg = (fn: (p: Record<string, Any>) => void) => edit("package.json", (s) => { const p = JSON.parse(s); fn(p); return JSON.stringify(p, null, 2) })
check("...moves with the bootstrap", moved("boot", edit("electron/shell/boot.mjs", (s) => s + "\n// x\n")))
check("...with a new shell file", moved("new file", (at) => fs.writeFileSync(path.join(at, "electron/shell/new.mjs"), "")))
check("...with the entitlements, the icon, the signing", moved("entitlements", edit("electron/entitlements.plist", (s) => s + " ")) && moved("icon", (at) => fs.appendFileSync(path.join(at, "electron/mac/icon.png"), "x"))
  && moved("sign", edit("electron/sign.cjs", (s) => s + "\n")))
check("...with the app's id, its main and Electron's version", moved("appid", pkg((p) => { p.build.appId = "app.lighthouse.x" })) && moved("main", pkg((p) => { p.main = "x.mjs" }))
  && moved("electron", edit(inputs.electron, (s) => { const l = JSON.parse(s); l.packages["node_modules/electron"].version = "1.0.0"; return JSON.stringify(l) })))
check("...not with the code, package.json's scripts or files, or natives.cjs", !moved("code", edit("core/appentry.ts", (s) => s + "\n"))
  && !moved("scripts", pkg((p) => { p.scripts.x = "y"; p.build.files = [...p.build.files, "x/**"] })) && !moved("natives", edit("electron/natives.cjs", (s) => s + "\n")))
const shellFiles = fs.readdirSync(path.join(ROOT, "electron/shell")).filter((f) => f.endsWith(".mjs"))
const imports = shellFiles.flatMap((f) => [...fs.readFileSync(path.join(ROOT, "electron/shell", f), "utf8").matchAll(/^\s*(?:import|export)\b[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm)]
  .map((m) => ({ f, spec: m[1] ?? m[2] })))
const unlisted = imports.filter(({ spec }) => !(spec.startsWith("node:") || spec === "electron" || (spec.startsWith("./") && !spec.slice(2).includes("/"))))
check("the shell imports only Node's, Electron's and its own files, all fingerprinted", imports.length > 5 && !unlisted.length && inputs.files.includes("electron/shell"), unlisted)

// ---------- the picker (electron/shell/roots.mjs) ----------
const R = await import("../electron/shell/roots.mjs")
check("Dev's and Main's own roots are off until their stages", !R.ENABLED.dev && !R.ENABLED.store && Object.isFrozen(R.ENABLED))
const uid = process.getuid?.()
/** A code root built for shell fingerprint `print` (its inputs.json lists only what's in it). */
function root(at: string, o: { print?: string; mode?: number } = {}) {
  fs.mkdirSync(path.join(at, "electron/shell"), { recursive: true })
  fs.writeFileSync(path.join(at, "electron/shell/inputs.json"), JSON.stringify({ files: ["electron/shell/id"], package: [], electron: "package-lock.json" }))
  fs.writeFileSync(path.join(at, "electron/shell/id"), o.print ?? "A")
  fs.writeFileSync(path.join(at, "package.json"), "{}")
  fs.writeFileSync(path.join(at, "package-lock.json"), "{}")
  fs.chmodSync(at, o.mode ?? 0o755)
  return at
}
const pa = fingerprint(root(path.join(tmp, "print-a")))
const bundleDir = root(path.join(tmp, "bundle")), store = path.join(tmp, "store")
const S1 = "1".repeat(40), S2 = "2".repeat(40), S3 = "3".repeat(40)
const cur = root(path.join(store, "roots", S1)), good = root(path.join(store, "roots", S2)), other = root(path.join(store, "roots", S3), { print: "B" })
const dev = root(path.join(tmp, "worktree"))
const point = (from: string, commit: string) => { fs.mkdirSync(store, { recursive: true }); fs.writeFileSync(path.join(store, `${from}.json`), JSON.stringify({ commit })) }
point("current", S1); point("good", S2)
const ON = { dev: true, store: true }
const pick = (o: Partial<Parameters<typeof R.pick>[0]> & { shell?: Record<string, Any> }) => R.pick({ bundle: bundleDir, packaged: true, platform: "darwin", env: {}, uid, store, bad: {},
  ...o, shell: { fingerprint: pa, ...o.shell } })
const env = { VAULTITE_CODE_ROOT: dev }
check("a run from source: its own folder, whatever it's told", same([pick({ packaged: false, shell: { channel: "dev" }, env, enabled: ON }).root, pick({ packaged: false, shell: { channel: "dev" }, env, enabled: ON }).from], [bundleDir, "checkout"]))
check("a release: the bundle, whatever the env and the store say", pick({ shell: { release: true, channel: "nightly" }, env, enabled: ON }).root === bundleDir
  && pick({ shell: { release: true, channel: "main" }, enabled: ON }).root === bundleDir)
check("Windows: the bundle", pick({ platform: "win32", shell: { channel: "main" }, env, enabled: ON }).root === bundleDir && pick({ platform: "win32", shell: { channel: "dev" }, env, enabled: ON }).root === bundleDir)
check("off (as built): Dev's override and Main's store change nothing", pick({ shell: { channel: "dev" }, env }).root === bundleDir && pick({ shell: { channel: "main" } }).root === bundleDir
  && !pick({ shell: { channel: "main" } }).passed.length)
check("Dev, on: its VAULTITE_CODE_ROOT", same(pick({ shell: { channel: "dev" }, env, enabled: ON }), { root: dev, from: "dev", passed: [] }))
check("...only Dev's: Main ignores it", pick({ shell: { channel: "main" }, env, enabled: { dev: true, store: false } }).root === bundleDir)
const devMis = pick({ shell: { channel: "dev", fingerprint: fingerprint(other) }, env, enabled: ON })
check("...built for another shell: the bundle, and why", devMis.root === bundleDir && /fingerprint differs/.test(devMis.passed[0]?.why), devMis)
check("Main, on: the store's current root", same(pick({ shell: { channel: "main" }, enabled: ON }), { root: cur, from: "current", passed: [] }))
const curBad = pick({ shell: { channel: "main" }, enabled: ON, bad: { [cur]: { why: "it crashed", t: 1 } } })
check("...current gone bad: the good one, saying why", curBad.root === good && curBad.from === "good" && /failed before: it crashed/.test(curBad.passed[0].why), curBad)
check("...both bad: the bundle", pick({ shell: { channel: "main" }, enabled: ON, bad: { [cur]: { why: "x", t: 1 }, [good]: { why: "y", t: 1 } } }).root === bundleDir)
point("current", S3)
check("...current built for another shell: good", pick({ shell: { channel: "main" }, enabled: ON }).root === good)
point("current", "not a commit")
check("...a pointer that names no commit: skipped", pick({ shell: { channel: "main" }, enabled: ON }).root === good)
point("current", S1)
if (process.platform !== "win32") {
  fs.chmodSync(cur, 0o777)
  check("...one others can write to: passed over", /others can write/.test(pick({ shell: { channel: "main" }, enabled: ON }).passed[0]?.why ?? ""))
  fs.chmodSync(cur, 0o755)
}
// (links need an administrator on Windows)
if (process.platform !== "win32") {
  const outside = root(path.join(tmp, "elsewhere", "roots", S1))
  fs.rmSync(cur, { recursive: true }); fs.symlinkSync(outside, cur)
  check("...one outside the store (a link out of it): passed over", /isn't in the store/.test(pick({ shell: { channel: "main" }, enabled: ON }).passed[0]?.why ?? ""))
}
check("...this app without a fingerprint: none but the bundle", pick({ shell: { channel: "main", fingerprint: undefined }, enabled: ON }).root === bundleDir)

// ---------- the record (userData/shell) ----------
const sdir = path.join(tmp, "state"), A = path.join(tmp, "root-a")
const deadPid = 999_999
R.settle(sdir, { bundle: bundleDir })
R.begin(sdir, { pid: deadPid, root: A, commit: S1 })
R.settle(sdir, { bundle: bundleDir, alive: () => true })
check("a run still going isn't settled", fs.existsSync(path.join(sdir, "attempts", `${deadPid}.json`)) && !R.badRoots(sdir)[A])
R.settle(sdir, { bundle: bundleDir, alive: () => false })
check("one that died before it was ready: its root bad, and said", /never became ready/.test(R.badRoots(sdir)[A]?.why ?? "") && !fs.existsSync(path.join(sdir, "attempts", `${deadPid}.json`)), R.badRoots(sdir))
const ev = R.unreported(sdir)
check("...as an event, once", ev.length === 1 && ev[0].kind === "failed" && ev[0].commit === S1 && R.unreported(sdir).length === 0, ev)
const B = path.join(tmp, "root-b")
const crash = () => { R.begin(sdir, { pid: deadPid, root: B }); R.ready(sdir, deadPid); R.settle(sdir, { bundle: bundleDir, alive: () => false }) }
crash()
check("ready, then a crash within a minute: counted, not bad yet", !R.badRoots(sdir)[B] && R.unreported(sdir)[0]?.kind === "crashed")
check("...and ready made it the good one", JSON.parse(fs.readFileSync(path.join(sdir, "good.json"), "utf8")).root === B)
crash()
check("...a second in a row: bad", /crashed twice/.test(R.badRoots(sdir)[B]?.why ?? ""), R.badRoots(sdir))
const Cr = path.join(tmp, "root-c")
R.begin(sdir, { pid: deadPid, root: Cr }); R.ready(sdir, deadPid); R.settle(sdir, { bundle: bundleDir, alive: () => false })
R.begin(sdir, { pid: deadPid, root: Cr }); R.ready(sdir, deadPid); R.settled(sdir, deadPid)
R.begin(sdir, { pid: deadPid, root: Cr }); R.ready(sdir, deadPid); R.settle(sdir, { bundle: bundleDir, alive: () => false })
check("...a run that lasted in between starts the count over", !R.badRoots(sdir)[Cr], R.badRoots(sdir))
R.begin(sdir, { pid: deadPid, root: Cr }); R.ended(sdir, deadPid); R.unreported(sdir); R.settle(sdir, { bundle: bundleDir, alive: () => false })
check("a run that quit leaves nothing to settle", !R.unreported(sdir).length)
R.begin(sdir, { pid: deadPid, root: bundleDir }); R.settle(sdir, { bundle: bundleDir, alive: () => false })
R.failed(sdir, { root: bundleDir, bundle: bundleDir, why: "its code didn't load: x" })
check("the bundle, the last resort, is never made bad: only said", !R.badRoots(sdir)[bundleDir] && R.unreported(sdir).length === 2)
if (process.platform !== "win32") {
  const linked = path.join(tmp, "bundle-link")
  fs.symlinkSync(bundleDir, linked)
  R.begin(sdir, { pid: deadPid, root: linked }); R.settle(sdir, { bundle: bundleDir, alive: () => false })
  check("...spelled another way (a link, /tmp for /private/tmp) too", !R.badRoots(sdir)[linked])
}
R.failed(sdir, { root: A, bundle: bundleDir, why: "its code didn't load: y" })
check("another root's failure makes it bad", /didn't load: y/.test(R.badRoots(sdir)[A].why))
check("vau.mjs finds the app's userData as Electron names it", R.userDataOf("Lighthouse Main", {}, "darwin", "/Users/alice") === "/Users/alice/Library/Application Support/Lighthouse Main"
  && R.userDataOf("Lighthouse Main", { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" }, "win32", "C:\\Users\\alice") === "C:\\Users\\alice\\AppData\\Roaming\\Lighthouse Main"
  && R.userDataOf("Lighthouse Main", {}, "linux", "/home/alice") === "/home/alice/.config/Lighthouse Main" && R.userDataOf("x", { VAULTITE_USER_DATA: tmp }) === path.resolve(tmp))

// ---------- the trampoline (electron/shell/vau.mjs) ----------
{
  const app = path.join(tmp, "tramp")
  fs.cpSync(path.join(ROOT, "electron/shell"), path.join(app, "electron/shell"), { recursive: true })
  fs.mkdirSync(path.join(app, "bin"), { recursive: true })
  fs.writeFileSync(path.join(app, "bin/vau"), `console.log(JSON.stringify({ root: ${JSON.stringify(app)}, args: process.argv.slice(2) }))\n`)
  fs.writeFileSync(path.join(app, "package.json"), `{ "type": "module" }`)
  // (a Main with a store whose current root could run: off, it isn't taken)
  fs.writeFileSync(path.join(app, "electron/shell.json"), JSON.stringify({ channel: "main", appId: "app.lighthouse.main", productName: "Lighthouse Main", fingerprint: pa }))
  const ud = path.join(tmp, "tramp-ud")
  fs.mkdirSync(path.join(ud, "code.noindex", "roots"), { recursive: true }); fs.cpSync(cur, path.join(ud, "code.noindex", "roots", S1), { recursive: true })
  fs.writeFileSync(path.join(ud, "code.noindex", "current.json"), JSON.stringify({ commit: S1 }))
  const out = execFileSync(process.execPath, [path.join(app, "electron/shell/vau.mjs"), "note", "--title", "Lighthouse"], { encoding: "utf8", env: { ...process.env, VAULTITE_USER_DATA: ud } })
  check("vau.mjs runs the picked root's bin/vau with its arguments (the bundle's: the store is off)", same(JSON.parse(out), { root: app, args: ["note", "--title", "Lighthouse"] }), out)
}

await exit(summary("shell", t0))
