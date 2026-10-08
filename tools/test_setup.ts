// Set up Vaultite on a made-up home folder: the desktop app's side (electron/setup.ts: Obsidian's vaults, vau without
// Node) and `vau service` (core/service.ts).
// node tools/test_setup.ts (npm test)
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const S = await import("../electron/setup.ts")
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-setup-test-"))
const fails: string[] = []
function check(name: string, ok: unknown, got?: unknown) {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  -> ${JSON.stringify(got)?.slice(0, 400)}`))
  if (!ok) fails.push(name)
}
const home = path.join(tmp, "home")
const put = (rel: string, text: string) => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p }
// Node as "the app's executable": the shim runs bin/vau with it, as the app runs it with Electron.
const w = { home, exe: process.execPath, root: ROOT, userData: path.join(tmp, "userData"), env: { VAULTITE_USER_DATA: path.join(tmp, "userData") } }
fs.mkdirSync(home, { recursive: true })

// ---------- places, Obsidian ----------
check("places: no iCloud Drive, Documents", S.places(w).icloud === null && S.places(w).documents === path.join(home, "Documents"))
fs.mkdirSync(path.join(home, "Library/Mobile Documents/com~apple~CloudDocs"), { recursive: true })
check("places: iCloud Drive when it's there", S.places(w).icloud?.endsWith("com~apple~CloudDocs"))
check("obsidian: none without its config", S.obsidianVaults(w).length === 0)
const ov = (n: string) => { const p = path.join(tmp, n); fs.mkdirSync(p, { recursive: true }); return p }
put("Library/Application Support/obsidian/obsidian.json", JSON.stringify({ vaults: {
  a: { path: ov("Old notes"), ts: 1 }, b: { path: ov("Work notes"), ts: 5, open: true }, c: { path: path.join(tmp, "Gone"), ts: 9 } } }))
check("obsidian: its vaults that are there, last opened first", JSON.stringify(S.obsidianVaults(w).map((v) => v.name)) === '["Work notes","Old notes"]', S.obsidianVaults(w))
put("Library/Application Support/obsidian/obsidian.json", "{not json")
check("obsidian: a broken config is none", S.obsidianVaults(w).length === 0)
fs.rmSync(path.join(home, "Library/Application Support/obsidian/obsidian.json"))
put(".var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json", JSON.stringify({ vaults: { a: { path: ov("Work notes"), ts: 1 } } }))
check("obsidian: Linux's Flatpak config", JSON.stringify(S.obsidianVaults(w).map((v) => v.name)) === '["Work notes"]', S.obsidianVaults(w))
put(".config/obsidian/obsidian.json", JSON.stringify({ vaults: { a: { path: ov("Old notes"), ts: 1 } } }))
check("obsidian: Linux's own config first", JSON.stringify(S.obsidianVaults(w).map((v) => v.name)) === '["Old notes"]', S.obsidianVaults(w))

// ---------- vau ----------
check("vau: not installed", S.vauStatus(w, []).path === null)
const v1 = S.installVau(w)
check("vau: written to ~/.local/bin", v1.path === path.join(home, ".local/bin/vau") && (fs.statSync(v1.path).mode & 0o111) !== 0, v1)
check("vau: again is nothing to do", S.installVau(w).did.startsWith("vau is already"))
check("vau: on the PATH when ~/.local/bin is", S.vauStatus(w, [path.join(home, ".local/bin")]).onPath && !S.vauStatus(w, ["/usr/bin"]).onPath)
const out = execFileSync(v1.path, ["--help"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home } })
check("vau: runs with no node on the PATH", /vau: drive Vaultite/.test(out), out.slice(0, 200))
check("vau: the shim passes the app's userData on", fs.readFileSync(v1.path, "utf8").includes(`VAULTITE_USER_DATA='${w.userData}'`))
// Someone else's vau in ~/.local/bin stays; ours goes in userData.
const home2 = path.join(tmp, "home2"), w2 = { ...w, home: home2 }
fs.mkdirSync(path.join(home2, ".local/bin"), { recursive: true })
fs.writeFileSync(path.join(home2, ".local/bin/vau"), "#!/bin/sh\necho mine\n")
const v2 = S.installVau(w2)
check("vau: another program's vau is left as it is", fs.readFileSync(path.join(home2, ".local/bin/vau"), "utf8") === "#!/bin/sh\necho mine\n" && v2.path === path.join(w.userData, "bin/vau"), v2)
check("vau: status says so", S.vauStatus(w2, []).other === path.join(home2, ".local/bin/vau") && S.vauStatus(w2, []).path === v2.path)

// ---------- vau service: the job's file on each platform (nothing started) ----------
const SV = await import("../core/service.ts")
const so = { root: "/srv/vault ite", node: "/usr/bin/node", vault: "/home/alice/My Vault", port: 8800, home }
const mac = SV.servicePlan("darwin", so), lin = SV.servicePlan("linux", so)
check("service: a launchd agent on macOS, kept alive, logging to ~/Library/Logs", mac.file === path.join(home, "Library/LaunchAgents/app.vaultite.server.plist") &&
  mac.text.includes("<string>/srv/vault ite/server.ts</string>") && mac.text.includes("<key>KeepAlive</key><true/>") && mac.text.includes("<key>PORT</key><string>8800</string>"), mac.text)
check("service: a systemd user unit on Linux, paths with spaces quoted, linger on", lin.file === path.join(home, ".config/systemd/user/vaultite.service") &&
  lin.text.includes('ExecStart="/usr/bin/node" "/srv/vault ite/server.ts"') && lin.text.includes("WorkingDirectory=/srv/vault ite\n") && !lin.text.includes("homebrew") && lin.text.includes('Environment="VAULTITE_VAULT=/home/alice/My Vault"') &&
  lin.text.includes("WantedBy=default.target") && lin.start.some((c) => c[0] === "loginctl" && c[1] === "enable-linger"), lin)
check("service: % is escaped for systemd", SV.servicePlan("linux", { ...so, vault: "/v/100%" }).text.includes("VAULTITE_VAULT=/v/100%%"))
check("service: not on Windows", (() => { try { SV.servicePlan("win32", so); return false } catch { return true } })())
const realNode = fs.realpathSync(process.execPath), binDir = path.join(tmp, "bin")
fs.mkdirSync(binDir, { recursive: true })
fs.symlinkSync(realNode, path.join(binDir, "node"))
check("service: the node on PATH when it's this one (outlives a Homebrew upgrade)", SV.stableNode(realNode, `/nowhere:${binDir}`) === path.join(binDir, "node") &&
  SV.stableNode(realNode, "/nowhere") === realNode)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed")
process.exit(fails.length ? 1 : 0)
