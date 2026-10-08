// Part of electron-builder's afterPack (sign.cjs, before signing): a Mac app built for one architecture from this Mac's
// node_modules, which npm installed for this Mac's. A package built for another (rolldown's binding, lightningcss's)
// is swapped for its own architecture's, as package-lock.json pins it (downloaded, its integrity checked); prebuilds for
// other platforms are dropped; then every binary in the app must run on its architecture, or the build fails.
const { execFileSync } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const LOCK = path.join(__dirname, "..", "package-lock.json")
const CACHE = path.join(os.tmpdir(), "vaultite-natives")

/** Every package folder under `dir`'s node_modules, at any depth, as paths relative to `root`. */
function packages(root, dir = root, out = []) {
  const nm = path.join(dir, "node_modules")
  if (!fs.existsSync(nm)) return out
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue
    const names = e.name.startsWith("@") ? fs.readdirSync(path.join(nm, e.name)).map((n) => path.join(e.name, n)) : [e.name]
    for (const n of names) {
      const p = path.join(nm, n)
      if (!fs.existsSync(path.join(p, "package.json"))) continue
      out.push(path.relative(root, p))
      packages(root, p, out)
    }
  }
  return out
}

/** The package-lock.json entry's tarball, downloaded once and checked against its integrity. */
async function tarball(entry) {
  fs.mkdirSync(CACHE, { recursive: true })
  const file = path.join(CACHE, path.basename(new URL(entry.resolved).pathname))
  const [algo, want] = [entry.integrity.slice(0, entry.integrity.indexOf("-")), entry.integrity.slice(entry.integrity.indexOf("-") + 1)]
  const ok = (buf) => crypto.createHash(algo).update(buf).digest("base64") === want
  if (fs.existsSync(file) && ok(fs.readFileSync(file))) return file
  const res = await fetch(entry.resolved)
  if (!res.ok) throw new Error(`natives.cjs: ${entry.resolved}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!ok(buf)) throw new Error(`natives.cjs: ${entry.resolved} doesn't match package-lock.json's integrity`)
  fs.writeFileSync(file, buf)
  return file
}

/** The architectures in a Mach-O file. */
function archs(file) {
  try { return execFileSync("lipo", ["-archs", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(" ") } catch { return null }
}

exports.default = async function natives(context) {
  const { macho } = require("./sign.cjs")
  const arch = require("builder-util").Arch[context.arch]
  if (arch !== "x64" && arch !== "arm64") throw new Error(`natives.cjs: a Mac app for ${arch} isn't built`)
  const other = arch === "x64" ? "arm64" : "x64"
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const root = path.join(app, "Contents", "Resources", "app")
  const lock = JSON.parse(fs.readFileSync(LOCK, "utf8")).packages

  for (const rel of packages(root)) {
    const dir = path.join(root, rel)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
    if (!pkg.cpu || pkg.cpu.includes(arch)) continue
    const name = pkg.name.replace(other, arch)
    const key = path.join(path.dirname(rel), path.basename(name)).split(path.sep).join("/")
    const entry = lock[key] ?? Object.entries(lock).find(([k, v]) => k.endsWith(`node_modules/${name}`) && v.version === pkg.version)?.[1]
    if (name === pkg.name || !entry?.cpu?.includes(arch)) throw new Error(`natives.cjs: ${pkg.name} has no ${arch} counterpart in package-lock.json`)
    fs.rmSync(dir, { recursive: true })
    const to = path.join(root, key)
    fs.mkdirSync(to, { recursive: true })
    execFileSync("tar", ["-xzf", await tarball(entry), "-C", to, "--strip-components=1"])
    console.log(`natives.cjs: ${pkg.name} -> ${name}@${entry.version}`)
  }

  for (const rel of packages(root)) {
    const dir = path.join(root, rel, "prebuilds")
    if (!fs.existsSync(dir)) continue
    for (const p of fs.readdirSync(dir)) {
      const keep = p.startsWith("darwin-") && p.includes(arch)
      if (!keep) fs.rmSync(path.join(dir, p), { recursive: true, force: true })
      // (npm leaves node-pty's x64 spawn-helper not executable)
      else for (const f of fs.readdirSync(path.join(dir, p))) if (!f.endsWith(".node")) fs.chmodSync(path.join(dir, p, f), 0o755)
    }
  }

  const want = arch === "x64" ? "x86_64" : "arm64"
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() && macho(path.join(dir, e.name)) ? [path.join(dir, e.name)] : [])
  const wrong = walk(app).filter((f) => !archs(f)?.includes(want))
  if (wrong.length) throw new Error(`natives.cjs: not built for ${arch}:\n${wrong.map((f) => path.relative(app, f)).join("\n")}`)
}
