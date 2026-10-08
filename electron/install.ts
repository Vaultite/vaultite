// npm run app:install (Linux): this checkout as the desktop app for this user (~/.local/share/vaultite, a menu launcher,
// `vaultite` in ~/.local/bin), updating itself from main as a Mac's build does; releases are the AppImage and .deb.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
if (process.platform !== "linux") {
  console.log("npm run app:install is Linux's. On a Mac, npm run app:build makes Vaultite.app in dist-app/.")
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
const NAME: string = pkg.build.productName
const EXE: string = pkg.build.linux.executableName
const DATA = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const DEST = path.join(DATA, "vaultite", NAME)
const BIN = path.join(os.homedir(), ".local", "bin")

if (!process.argv.includes("--no-build")) {
  const r = spawnSync("npm", ["run", "app:build"], { cwd: ROOT, stdio: "inherit" })
  if (r.status) process.exit(r.status)
}
const built = fs.readdirSync(path.join(ROOT, "dist-app")).find((d) => /^linux.*-unpacked$/.test(d))
if (!built) throw new Error("no dist-app/linux-unpacked: npm run app:build didn't build the app")

// The app may be running from DEST: its files are replaced under it, and the next launch is the new one.
fs.rmSync(DEST, { recursive: true, force: true })
fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.cpSync(path.join(ROOT, "dist-app", built), DEST, { recursive: true, verbatimSymlinks: true })
const exe = path.join(DEST, EXE)

for (const size of [256, 512]) {
  const dir = path.join(DATA, "icons", "hicolor", `${size}x${size}`, "apps")
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(ROOT, "web", "public", `icon-${size}.png`), path.join(dir, `${EXE}.png`))
}

const mimes = (pkg.build.fileAssociations as { mimeType?: string }[]).map((f) => f.mimeType).filter(Boolean)
const apps = path.join(DATA, "applications")
fs.mkdirSync(apps, { recursive: true })
fs.writeFileSync(path.join(apps, `${EXE}.desktop`), [
  "[Desktop Entry]",
  `Name=${NAME}`,
  `Comment=${pkg.build.linux.synopsis}`,
  `Exec="${exe.replace(/["`$\\]/g, "\\$&")}" %U`,
  `Icon=${EXE}`,
  "Type=Application",
  "Terminal=false",
  `Categories=${pkg.build.linux.category};`,
  `MimeType=${mimes.join(";")};`,
  `StartupWMClass=${pkg.name}`, // (Electron names the window class after package.json's name)
  "",
].join("\n"))
for (const tool of [["update-desktop-database", apps], ["gtk-update-icon-cache", "-q", "-t", path.join(DATA, "icons", "hicolor")]]) {
  try { execFileSync(tool[0], tool.slice(1), { stdio: "ignore" }) } catch { /* not there: the menu finds it on its next scan */ }
}

fs.mkdirSync(BIN, { recursive: true })
fs.rmSync(path.join(BIN, EXE), { force: true })
fs.symlinkSync(exe, path.join(BIN, EXE))

console.log(`Installed ${NAME} in ${DEST}: it's in the applications menu, and \`${EXE}\` opens it (${BIN} on your PATH).`)

// Ubuntu 24.04+ denies Chromium's sandbox its user namespaces unless an AppArmor profile allows them (the .deb installs
// one); without it the app stops at launch, so say how to add it (root).
const userns = spawnSync("unshare", ["-Ur", "true"]).status === 0
const PROFILE = `/etc/apparmor.d/${EXE}-user`
if (!userns && !fs.existsSync(PROFILE)) {
  const profile = `abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile ${EXE}-user "${exe}" flags=(unconfined) {\n  userns,\n  include if exists <local/${EXE}-user>\n}\n`
  console.log(`\nThis system restricts user namespaces (AppArmor), so the app needs a profile to start with its sandbox. Run once:\n\n` +
    `  printf '%s' '${profile.replace(/'/g, "'\\''")}' | sudo tee ${PROFILE} >/dev/null && sudo apparmor_parser -r ${PROFILE}\n`)
}
