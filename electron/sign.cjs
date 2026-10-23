// electron-builder's afterPack (package.json "build"): the app's native modules for its architecture (natives.cjs), then
// signs it with codesign, one file at a time.
// electron-builder's own signing (@electron/osx-sign) opens every file in the bundle at once to find the binaries, and
// with node_modules in it (some 26,000 files) that's more than macOS lets a process have open (EMFILE).
//
// With a code signing identity in the keychain it signs with that: VAULTITE_SIGN_IDENTITY (a name or its SHA-1), else
// the first "Developer ID Application", else the first "Apple Development". macOS keeps privacy permissions (Files and
// Folders, iCloud Drive, the microphone) for an app signed so across builds, since they're tied to its team and bundle
// id; an app signed ad hoc is a new app to macOS on every build, and its shells lose the vault until they're granted
// again. With no identity (or one that can't sign: a keychain locked over ssh) it signs ad hoc, and says so.
//
// The Quick Look extension (quicklook.cjs) is built into the app first, and signed in its own sandbox.
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
// That profile, in VAULTITE_NOTARY_KEYCHAIN when it isn't in the login keychain (CI's: .github/workflows/release.yml).
const PROFILE = ["--keychain-profile", NOTARY, ...(process.env.VAULTITE_NOTARY_KEYCHAIN ? ["--keychain", process.env.VAULTITE_NOTARY_KEYCHAIN] : [])]
const ENTITLEMENTS = path.join(__dirname, "entitlements.plist")
const QL_ENTITLEMENTS = path.join(__dirname, "quicklook", "entitlements.plist")

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

/** The bundle's Mach-O files, then its nested bundles (.app, .appex, .framework), deepest first: codesign signs inside out. */
function contents(app) {
  const files = [], bundles = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        if (/\.(app|appex|framework)$/.test(e.name)) bundles.push(p)
      } else if (e.isFile() && macho(p)) files.push(p)
    }
  }
  walk(app)
  const depth = (p) => p.split(path.sep).length
  return [...files.sort((a, b) => depth(b) - depth(a)), ...bundles.sort((a, b) => depth(b) - depth(a))]
}

function release(app, id) {
  const args = ["--force", "--timestamp", "--options", "runtime", "--sign", id]
  const all = [...contents(app), app]
  console.log(`sign.cjs: signing ${all.length} binaries and bundles with the hardened runtime`)
  for (const p of all) execFileSync("codesign", [...args, "--entitlements", p.endsWith(".appex") ? QL_ENTITLEMENTS : ENTITLEMENTS, p], { stdio: "pipe" })
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" })
  notarize(app)
}

/** Notarize a .app (sent zipped) or a .dmg with the `vaultite-notary` profile, then staple its ticket to it. */
function notarize(file) {
  try {
    execFileSync("xcrun", ["notarytool", "history", ...PROFILE], { stdio: "ignore" })
  } catch {
    console.warn(`sign.cjs: NOT NOTARIZED: no notarytool profile "${NOTARY}" in the keychain (xcrun notarytool store-credentials ${NOTARY} ...); macOS will refuse this app once downloaded`)
    return
  }
  const zip = file.endsWith(".app") ? path.join(os.tmpdir(), `vaultite-notarize-${process.pid}.zip`) : null
  try {
    if (zip) execFileSync("ditto", ["-c", "-k", "--keepParent", file, zip])
    console.log(`sign.cjs: notarizing ${path.basename(file)} (notarytool waits for Apple's answer)`)
    execFileSync("xcrun", ["notarytool", "submit", zip ?? file, ...PROFILE, "--wait"], { stdio: "inherit" })
  } finally { if (zip) fs.rmSync(zip, { force: true }) }
  staple(file)
}

// Stapling asks Apple's CloudKit, whose connection drops now and then (error 68): it failed two nightlies in a row.
function staple(file, tries = 5) {
  for (let i = 1; ; i++) {
    try { return execFileSync("xcrun", ["stapler", "staple", file], { stdio: "inherit" }) } catch (e) {
      if (i >= tries) throw e
      console.warn(`sign.cjs: stapling ${path.basename(file)} failed, trying again (${i}/${tries - 1})`)
      execFileSync("sleep", [String(15 * i)])
    }
  }
}

// Chromium encrypts the cookies it keeps on disk, as Chrome does, with the app's key: its "<name> Safe Storage" Keychain
// item on a Mac (the one safeStorage uses), the keyring on Linux. That's Electron's EnableCookieEncryption fuse, a byte in
// its binary, flipped here before the app is signed: a change after breaks the signature (electron-builder's own
// `electronFuses` flips them after afterPack, so after this has signed). Cookies saved in plain text before still load,
// and are encrypted once a site sets them again. A build without the fuse can't read them, and drops every cookie of a
// site with one it can't decrypt: update.sh never goes back to one (it looks for EnableCookieEncryption in this file),
// and a run from source gets the fuse too (start.ts).
async function fuses(context) {
  const { FuseVersion, FuseV1Options } = require("@electron/fuses")
  await context.packager.addElectronFuses(context, { version: FuseVersion.V1, [FuseV1Options.EnableCookieEncryption]: true })
}

exports.default = async function sign(context) {
  await fuses(context)
  if (context.electronPlatformName !== "darwin") return
  await require("./natives.cjs").default(context)
  const appex = require("./quicklook.cjs").default(context)
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
      sealed(app, appex, ["--force", "--timestamp=none", "--sign", id])
      return
    } catch {
      // The updater (update.sh) waits for the next check instead: an ad hoc build over this Mac's signed app would lose
      // every permission granted to it, and the grants then made fail again once it's signed.
      if (process.env.VAULTITE_UPDATING) throw new Error(`sign.cjs: couldn't sign with ${id} (a locked keychain?): not building an update signed ad hoc`)
      console.warn(`sign.cjs: couldn't sign with ${id} (a locked keychain?): signing ad hoc, so macOS will ask for its permissions again`)
    }
  } else console.warn("sign.cjs: no code signing identity in the keychain: signing ad hoc, so macOS will ask for its permissions again after each build")
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" })
  sealed(app, appex, ["--force", "--sign", "-"])
}

/** --deep signed the extension as the app (no sandbox, which macOS won't load): signed again as itself, then the app
 *  over it. */
function sealed(app, appex, args) {
  if (!appex) return
  require("./quicklook.cjs").sign(appex, args)
  execFileSync("codesign", [...args, app], { stdio: "inherit" })
}

exports.identity = identity
exports.macho = macho
exports.notarize = notarize
