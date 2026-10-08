// electron-builder's afterPack (package.json "build"): signs the app with codesign, one file at a time.
// electron-builder's own signing (@electron/osx-sign) opens every file in the bundle at once to find the binaries, and
// with node_modules in it (some 26,000 files) that's more than macOS lets a process have open (EMFILE).
//
// With a code signing identity in the keychain it signs with that: VAULTITE_SIGN_IDENTITY (a name or its SHA-1), else
// the first "Developer ID Application", else the first "Apple Development". macOS keeps privacy permissions (Files and
// Folders, iCloud Drive, the microphone) for an app signed so across builds, since they're tied to its team and bundle
// id; an app signed ad hoc is a new app to macOS on every build, and its shells lose the vault until they're granted
// again. With no identity (or one that can't sign: a keychain locked over ssh) it signs ad hoc, and says so.
//
// A release (VAULTITE_RELEASE, npm run release) needs a Developer ID: every binary is signed with the hardened runtime
// (electron/entitlements.plist) and a timestamp, then notarized with the `vaultite-notary` notarytool profile if there is one
// and stapled (the dmg too: electron/dmg.cjs).
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const RELEASE = !!process.env.VAULTITE_RELEASE
const NOTARY = "vaultite-notary"
const ENTITLEMENTS = path.join(__dirname, "entitlements.plist")

/** The identity to sign with, or null for ad hoc. */
function identity() {
  if (process.env.VAULTITE_SIGN_IDENTITY) return process.env.VAULTITE_SIGN_IDENTITY
  let out = ""
  try { out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }) } catch { return null }
  const ids = [...out.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/gm)].map((m) => ({ hash: m[1], name: m[2] }))
  const dev = ids.find((x) => x.name.startsWith("Developer ID Application:"))
  if (RELEASE) return dev ? dev.hash : null
  const pick = dev ?? ids.find((x) => x.name.startsWith("Apple Development:"))
  return pick ? pick.hash : null
}

/** Is this file a Mach-O binary (thin or fat; 0xcafebabe is also a Java class, whose next word is its version, >= 45). */
function macho(file) {
  const b = Buffer.alloc(8)
  const fd = fs.openSync(file, "r")
  try { if (fs.readSync(fd, b, 0, 8, 0) < 8) return false } finally { fs.closeSync(fd) }
  const m = b.readUInt32BE(0)
  return m === 0xfeedfacf || m === 0xcffaedfe || m === 0xfeedface || m === 0xcefaedfe || (m === 0xcafebabe && b.readUInt32BE(4) < 45)
}

/** The bundle's Mach-O files, then its nested bundles (.app, .framework), deepest first: codesign signs inside out. */
function contents(app) {
  const files = [], bundles = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        if (/\.(app|framework)$/.test(e.name)) bundles.push(p)
      } else if (e.isFile() && macho(p)) files.push(p)
    }
  }
  walk(app)
  const depth = (p) => p.split(path.sep).length
  return [...files.sort((a, b) => depth(b) - depth(a)), ...bundles.sort((a, b) => depth(b) - depth(a))]
}

function release(app, id) {
  const args = ["--force", "--timestamp", "--options", "runtime", "--entitlements", ENTITLEMENTS, "--sign", id]
  const all = [...contents(app), app]
  console.log(`sign.cjs: signing ${all.length} binaries and bundles with the hardened runtime`)
  for (const p of all) execFileSync("codesign", [...args, p], { stdio: "pipe" })
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" })
  notarize(app)
}

/** Notarize a .app (sent zipped) or a .dmg with the `vaultite-notary` profile, then staple its ticket to it. */
function notarize(file) {
  try {
    execFileSync("xcrun", ["notarytool", "history", "--keychain-profile", NOTARY], { stdio: "ignore" })
  } catch {
    console.warn(`sign.cjs: NOT NOTARIZED: no notarytool profile "${NOTARY}" in the keychain (xcrun notarytool store-credentials ${NOTARY} ...); macOS will refuse this app once downloaded`)
    return
  }
  const zip = file.endsWith(".app") ? path.join(os.tmpdir(), `vaultite-notarize-${process.pid}.zip`) : null
  try {
    if (zip) execFileSync("ditto", ["-c", "-k", "--keepParent", file, zip])
    console.log(`sign.cjs: notarizing ${path.basename(file)} (notarytool waits for Apple's answer)`)
    execFileSync("xcrun", ["notarytool", "submit", zip ?? file, "--keychain-profile", NOTARY, "--wait"], { stdio: "inherit" })
  } finally { if (zip) fs.rmSync(zip, { force: true }) }
  execFileSync("xcrun", ["stapler", "staple", file], { stdio: "inherit" })
}

exports.default = async function sign(context) {
  if (context.electronPlatformName !== "darwin") return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const id = identity()
  if (RELEASE) {
    if (!id) throw new Error("sign.cjs: a release needs a \"Developer ID Application\" identity in the keychain (or VAULTITE_SIGN_IDENTITY)")
    return release(app, id)
  }
  if (id) {
    try {
      // No timestamp: it asks Apple's server, and an app that's never notarized doesn't need one.
      execFileSync("codesign", ["--force", "--deep", "--timestamp=none", "--sign", id, app], { stdio: "inherit" })
      return
    } catch {
      console.warn(`sign.cjs: couldn't sign with ${id} (a locked keychain?): signing ad hoc, so macOS will ask for its permissions again`)
    }
  } else console.warn("sign.cjs: no code signing identity in the keychain: signing ad hoc, so macOS will ask for its permissions again after each build")
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" })
}

exports.identity = identity
exports.notarize = notarize
