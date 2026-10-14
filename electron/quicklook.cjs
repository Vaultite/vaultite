// Part of electron-builder's afterPack (sign.cjs, before signing): Finder's Quick Look of Markdown files
// (electron/quicklook/Preview.swift, a data-based preview extension in Contents/PlugIns), and document icons the system
// makes from the app's icon for the files it opens. A Mac without Xcode's tools builds the app without the preview
// (a release can't).
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const SRC = path.join(__dirname, "quicklook")
const NAME = "VaultitePreview"
const ENTITLEMENTS = path.join(SRC, "entitlements.plist")
// What Finder calls a Markdown file (macOS 13 on declare it; the app imports it for older ones: package.json's build).
const TYPES = ["net.daringfireball.markdown"]

const plist = (o) => {
  const v = (x) => typeof x === "boolean" ? `<${x}/>` : Array.isArray(x) ? `<array>${x.map(v).join("")}</array>`
    : typeof x === "object" ? `<dict>${Object.entries(x).map(([k, y]) => `<key>${k}</key>${v(y)}`).join("")}</dict>` : `<string>${x}</string>`
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${v(o)}</plist>\n`
}

/** The extension, built for `arch` into `app`'s PlugIns. Returns its path, or null when there's no Swift compiler. */
function build(app, arch, appId) {
  let swiftc = true
  try { execFileSync("xcrun", ["--sdk", "macosx", "--find", "swiftc"], { stdio: "ignore" }) } catch { swiftc = false }
  if (!swiftc) {
    if (process.env.VAULTITE_RELEASE) throw new Error("quicklook.cjs: a release needs Xcode's command line tools (swiftc) for the Quick Look extension")
    console.warn("quicklook.cjs: no swiftc (xcode-select --install): the app is built without its Quick Look preview")
    return null
  }
  const appex = path.join(app, "Contents", "PlugIns", `${NAME}.appex`)
  fs.rmSync(appex, { recursive: true, force: true })
  fs.mkdirSync(path.join(appex, "Contents", "MacOS"), { recursive: true })
  // (the app's own version numbers: a nightly's version isn't a bundle version)
  const info = path.join(app, "Contents", "Info.plist")
  const read = (key) => execFileSync("plutil", ["-extract", key, "raw", info], { encoding: "utf8" }).trim()
  const target = `${arch === "x64" ? "x86_64" : "arm64"}-apple-macos12.0`
  execFileSync("xcrun", ["--sdk", "macosx", "swiftc", "-O", "-target", target, "-module-name", NAME, "-parse-as-library", "-application-extension",
    "-Xlinker", "-e", "-Xlinker", "_NSExtensionMain", "-framework", "QuickLookUI",
    path.join(SRC, "Preview.swift"), "-o", path.join(appex, "Contents", "MacOS", NAME)], { stdio: "inherit" })
  fs.writeFileSync(path.join(appex, "Contents", "Info.plist"), plist({
    CFBundleDevelopmentRegion: "en", CFBundleDisplayName: "Vaultite Preview", CFBundleExecutable: NAME,
    CFBundleIdentifier: `${appId}.quicklook`, CFBundleInfoDictionaryVersion: "6.0", CFBundleName: NAME,
    CFBundlePackageType: "XPC!", CFBundleShortVersionString: read("CFBundleShortVersionString"), CFBundleVersion: read("CFBundleVersion"),
    CFBundleSupportedPlatforms: ["MacOSX"], LSMinimumSystemVersion: "12.0",
    NSExtension: {
      NSExtensionAttributes: { QLIsDataBasedPreview: true, QLSupportedContentTypes: TYPES, QLSupportsSearchableItems: false },
      NSExtensionPointIdentifier: "com.apple.quicklook.preview",
      NSExtensionPrincipalClass: "PreviewProvider",
    },
  }))
  return appex
}

/** Each kind of file the app opens gets the system's document icon made from the app's (macOS 11 on). */
function documentIcons(app) {
  const info = path.join(app, "Contents", "Info.plist")
  const n = Number(execFileSync("plutil", ["-extract", "CFBundleDocumentTypes", "raw", info], { encoding: "utf8" }).trim())
  for (let i = 0; i < n; i++) {
    execFileSync("plutil", ["-replace", `CFBundleDocumentTypes.${i}.CFBundleTypeIconSystemGenerated`, "-integer", "1", info])
    // (electron-builder's icon for them is the app's own, which would show in place of the system's)
    try { execFileSync("plutil", ["-remove", `CFBundleDocumentTypes.${i}.CFBundleTypeIconFile`, info], { stdio: "ignore" }) } catch { /* none */ }
  }
}

/** Sign the extension in its own sandbox, after the app's nested code was signed and before the app is (again). */
function sign(appex, args) {
  if (fs.existsSync(appex)) execFileSync("codesign", [...args, "--entitlements", ENTITLEMENTS, appex], { stdio: "inherit" })
}

exports.default = function quicklook(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const arch = require("builder-util").Arch[context.arch]
  documentIcons(app)
  return build(app, arch, context.packager.appInfo.id)
}
exports.sign = sign
exports.NAME = NAME
