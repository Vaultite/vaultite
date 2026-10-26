// Set up Vaultite on a made-up home folder: the desktop app's side (electron/setup.ts: Obsidian's vaults, vau without
// Node) and `vau service` (core/service.ts). In npm test.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { check, summary } from "./test/lib.ts"
const t0 = Date.now()

const S = await import("../electron/setup.ts")
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-setup-test-"))
const home = path.join(tmp, "home")
const put = (rel: string, text: string) => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p }
// Node as "the app's executable": the shim runs bin/vau with it, as the app runs it with Electron.
// (macOS' and Linux' logic on Windows too: its own below)
const w = { home, exe: process.execPath, root: ROOT, userData: path.join(tmp, "userData"), env: { VAULTITE_USER_DATA: path.join(tmp, "userData") },
  platform: process.platform === "win32" ? "linux" : process.platform }
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
fs.rmSync(path.join(home, ".config"), { recursive: true })
fs.rmSync(path.join(home, ".var"), { recursive: true })
put("AppData/Roaming/obsidian/obsidian.json", JSON.stringify({ vaults: { a: { path: ov("Win notes"), ts: 1 } } }))
check("obsidian: Windows' config (%APPDATA%)", JSON.stringify(S.obsidianVaults(w).map((v) => v.name)) === '["Win notes"]', S.obsidianVaults(w))
check("places: Documents where the system has it (Windows' may be OneDrive's)", S.places({ ...w, documents: path.join(home, "OneDrive", "Documents") }).documents === path.join(home, "OneDrive", "Documents"))
fs.rmSync(path.join(home, "Library/Mobile Documents"), { recursive: true })
fs.mkdirSync(path.join(home, "iCloudDrive"))
check("places: iCloud for Windows' iCloud Drive", S.places(w).icloud === path.join(home, "iCloudDrive"))

// ---------- coding agents: found where installers put them, computer use turned on only when asked ----------
const wm = { ...w, platform: "darwin" }, vault = path.join(tmp, "Vault")
fs.mkdirSync(vault, { recursive: true })
const byId = (dirs: string[] = []) => Object.fromEntries(S.harnesses(wm, dirs, vault).map((h) => [h.id, h]))
check("agents: none found, each with its install command", Object.values(byId()).every((h) => !h.path && h.install) && Object.keys(byId()).join() === "claude-code,codex,openclaw,hermes,gemini,opencode", byId())
const exe = (rel: string) => { const p = put(rel, "#!/bin/sh\n"); fs.chmodSync(p, 0o755); return p }
const claude = exe(".local/bin/claude"), oc = exe(".opencode/bin/opencode")
const other = path.join(tmp, "elsewhere")
fs.mkdirSync(other, { recursive: true })
fs.writeFileSync(path.join(other, "codex"), "#!/bin/sh\nprintf '%s ' \"$CODEX_HOME\" \"$@\" > \"$CODEX_HOME/ran\"\n", { mode: 0o755 })
let hs = byId([other])
check("agents: in ~/.local/bin, their installers' folders and the user's PATH", hs["claude-code"].path === claude && hs.opencode.path === oc && hs.codex.path === path.join(other, "codex") && !hs.gemini.path, hs)
check("agents: the companion's two say their terminal names", hs["claude-code"].agent === "claude" && hs.codex.agent === "codex" && !hs.opencode.agent)
check("agents: Claude Code's computer use is off for a new folder", hs["claude-code"].extra?.kind === "computer-use" && hs["claude-code"].extra?.state === "off", hs["claude-code"])
check("agents: Codex's needs the Codex app", hs.codex.extra?.state === "unavailable")
check("agents: no computer use off a Mac", !S.harnesses({ ...wm, platform: "linux" }, [other], vault).some((h) => h.extra?.kind === "computer-use"))

const cj = path.join(home, ".claude.json")
const before = { numStartups: 3, projects: { "/elsewhere": { allowedTools: ["Bash"], enabledMcpServers: ["other"] } }, mcpServers: { x: { command: "x" } } }
fs.writeFileSync(cj, JSON.stringify(before, null, 2), { mode: 0o600 })
await S.setClaudeComputerUse(wm, vault)
const after = JSON.parse(fs.readFileSync(cj, "utf8")), key = fs.realpathSync(vault)
check("claude: computer use on for the vault's project, as /mcp writes it", JSON.stringify(after.projects[key].enabledMcpServers) === '["computer-use"]' && after.projects[key].hasTrustDialogAccepted === false && S.claudeComputerUse(wm, vault), after)
// (Windows has no owner-only mode: a file in the profile is private by its folder's ACL, and Node reads it as 0o666)
check("claude: everything else kept, the file still private", after.numStartups === 3 && JSON.stringify(after.projects["/elsewhere"]) === JSON.stringify(before.projects["/elsewhere"]) && after.mcpServers.x.command === "x" &&
  (fs.statSync(cj).mode & 0o777) === (process.platform === "win32" ? 0o666 : 0o600) && !fs.existsSync(`${cj}.lock`))
check("agents: and it reads as on", byId([other])["claude-code"].extra?.state === "on")
const text = fs.readFileSync(cj, "utf8")
await S.setClaudeComputerUse(wm, vault)
check("claude: again changes nothing", fs.readFileSync(cj, "utf8") === text)
fs.mkdirSync(path.join(vault, "Notes"), { recursive: true })
fs.mkdirSync(path.join(vault, ".git"))
check("claude: a vault in a git repository is the repository's project", S.claudeProject(path.join(vault, "Notes")) === key)
fs.rmSync(path.join(vault, ".git"), { recursive: true })
fs.mkdirSync(`${cj}.lock`)
const held = S.setClaudeComputerUse(wm, path.join(vault, "Notes"))
await new Promise((r) => setTimeout(r, 300))
check("claude: waits while a running Claude Code holds its config's lock", !S.claudeComputerUse(wm, path.join(vault, "Notes")))
fs.rmSync(`${cj}.lock`, { recursive: true })
await held
check("claude: then writes", S.claudeComputerUse(wm, path.join(vault, "Notes")) && S.claudeComputerUse(wm, vault))
fs.rmSync(cj)
await S.setClaudeComputerUse({ ...wm, claudeDir: path.join(tmp, "claude-work") }, vault)
check("claude: CLAUDE_CONFIG_DIR's config when the app has one, none made at home", S.claudeComputerUse({ ...wm, claudeDir: path.join(tmp, "claude-work") }, vault) && !fs.existsSync(cj))

const CU = put(".codex/computer-use/Codex Computer Use.app/Contents/Info.plist", "")
check("codex: with the Codex app, its computer use is off until turned on", S.codexComputerUse(wm) === "off")
put(".codex/config.toml", 'model = "x"\n\n[plugins."computer-use@openai-bundled"]\nenabled = false\n\n[plugins."other@x"]\nenabled = true\n')
check("codex: off in its config is off", S.codexComputerUse(wm) === "off")
// (the Codex app, so its computer use, is a Mac's only; the made-up codex is a shell script Windows can't run)
if (process.platform !== "win32") {
  await S.setCodexComputerUse(wm, path.join(other, "codex"))
  check("codex: turned on by its own CLI, in its home", fs.readFileSync(path.join(home, ".codex/ran"), "utf8").trim() === `${path.join(home, ".codex")} plugin add computer-use@openai-bundled`)
}
put(".codex/config.toml", '[plugins."computer-use@openai-bundled"]\nenabled = true\n')
check("codex: on in its config is on", S.codexComputerUse(wm) === "on" && byId([other]).codex.extra?.state === "on")
fs.rmSync(path.dirname(path.dirname(path.dirname(CU))), { recursive: true })
fs.rmSync(path.join(home, ".local/bin/claude"))

// ---------- opened by an agent: as if from the Dock (core/sessionenv.ts) ----------
{
  const { asFromDock } = await import("../core/sessionenv.ts")
  const bin = path.join(tmp, "app-bin"), sep = path.delimiter
  const launched = () => ({ HOME: home, PATH: [bin, "/usr/bin"].join(sep), CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s1", CLAUDE_CONFIG_DIR: path.join(home, ".claude-alice"),
    CODEX_HOME: path.join(home, ".codex-alice"), CODEX_THREAD_ID: "t1", GIT_EDITOR: "true", AI_AGENT: "claude-code", VAULTITE: "1", VAULTITE_TERMINAL: "claude-x1",
    VAULTITE_URL: "http://127.0.0.1:21001", VAULTITE_BIN: bin, VAULTITE_ZDOTDIR: "/tmp/zdot", VAULTITE_USER_DATA: "/tmp/ud", VAULTITE_DEBUG_PORT: "9339" } as Record<string, string | undefined>)
  const e = launched()
  asFromDock(e)
  check("from the Dock: an agent's session, its account and its terminal's variables dropped, the app's own kept",
    JSON.stringify(Object.keys(e).sort()) === JSON.stringify(["HOME", "PATH", "VAULTITE_DEBUG_PORT", "VAULTITE_USER_DATA"]) && e.PATH === "/usr/bin", e)
  const kept = launched()
  asFromDock(kept, true)
  check("from the Dock: a script's copy keeps the account it chose", kept.CLAUDE_CONFIG_DIR === path.join(home, ".claude-alice") && kept.CODEX_HOME && !kept.CLAUDECODE, kept)
  const own = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude-alice"), CODEX_HOME: "/x", GIT_EDITOR: "true" }
  check("from the Dock: an account chosen outside an agent's session is the user's", asFromDock(own).length === 0 && own.CLAUDE_CONFIG_DIR && own.GIT_EDITOR === "true", own)
  const shell = { HOME: home, VAULTITE: "1", VAULTITE_TERMINAL: "zsh-x2", CLAUDE_CONFIG_DIR: path.join(home, ".claude-alice"), GIT_EDITOR: "vim" }
  asFromDock(shell)
  check("from the Dock: a plain terminal's variables dropped, the shell's own kept", !shell.VAULTITE && !shell.VAULTITE_TERMINAL && !!shell.CLAUDE_CONFIG_DIR && shell.GIT_EDITOR === "vim", shell)
}

// ---------- vau ----------
check("vau: not installed", S.vauStatus(w, []).path === null)
const v1 = S.installVau(w)
check("vau: written to ~/.local/bin", v1.path === path.join(home, ".local/bin/vau") && (process.platform === "win32" || (fs.statSync(v1.path).mode & 0o111) !== 0), v1)
check("vau: again is nothing to do", S.installVau(w).did.startsWith("vau is already"))
check("vau: on the PATH when ~/.local/bin is", S.vauStatus(w, [path.join(home, ".local/bin")]).onPath && !S.vauStatus(w, ["/usr/bin"]).onPath)
if (process.platform !== "win32") {
  const out = execFileSync(v1.path, ["--help"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home } })
  check("vau: runs with no node on the PATH", /vau: drive Vaultite/.test(out), out.slice(0, 200))
}
check("vau: the shim passes the app's userData on", fs.readFileSync(v1.path, "utf8").includes(`VAULTITE_USER_DATA='${w.userData}'`))
// Someone else's vau in ~/.local/bin stays; ours goes in userData.
const home2 = path.join(tmp, "home2"), w2 = { ...w, home: home2 }
fs.mkdirSync(path.join(home2, ".local/bin"), { recursive: true })
fs.writeFileSync(path.join(home2, ".local/bin/vau"), "#!/bin/sh\necho mine\n")
const v2 = S.installVau(w2)
check("vau: another program's vau is left as it is", fs.readFileSync(path.join(home2, ".local/bin/vau"), "utf8") === "#!/bin/sh\necho mine\n" && v2.path === path.join(w.userData, "bin/vau"), v2)
check("vau: status says so", S.vauStatus(w2, []).other === path.join(home2, ".local/bin/vau") && S.vauStatus(w2, []).path === v2.path)

// ---------- vau on Windows: the logic anywhere, on a made-up registry ----------
const ww = { ...w, home: path.join(tmp, "winhome"), platform: "win32" }
let reg: { value: string; expand: boolean } | null = { value: "%USERPROFILE%\\bin;C:\\Tools", expand: true }
const fakeReg = { read: () => reg, write: (value: string, expand: boolean) => { reg = { value, expand } } }
const wv = S.installVau(ww, fakeReg), wbin = S.winBin(ww)
check("vau on Windows: vau.cmd (cmd, PowerShell) and the script (Git Bash) in the local AppData", wv.path === path.join(wbin, "vau.cmd") &&
  fs.readFileSync(wv.path, "utf8").includes("\r\nsetlocal\r\n") && fs.readFileSync(path.join(wbin, "vau"), "utf8").startsWith("#!/bin/sh"), wv)
check("vau on Windows: its folder goes at the end of the user's PATH, still a REG_EXPAND_SZ", reg?.value === `%USERPROFILE%\\bin;C:\\Tools;${wbin}` && reg.expand && /PATH/.test(wv.did), reg)
check("vau on Windows: again is nothing to do", S.installVau(ww, fakeReg).did === `vau is already at ${wbin}` && reg?.value.split(";").length === 3)
reg = { value: "C:\\Tools;%LOCALAPPDATA%\\Vaultite\\bin\\", expand: false }
check("vau on Windows: its folder through a %VAR% is there already", !S.addToPath(fakeReg, wbin, { localappdata: path.join(ww.home, "AppData", "Local") }) && reg.value === "C:\\Tools;%LOCALAPPDATA%\\Vaultite\\bin\\")
reg = { value: "C:\\Tools", expand: false }
check("vau on Windows: a REG_SZ PATH stays one", S.addToPath(fakeReg, wbin) && !reg.expand && reg.value === `C:\\Tools;${wbin}`)
reg = null
check("vau on Windows: no PATH of the user's yet makes one", S.addToPath(fakeReg, wbin) && reg!.value === wbin && reg!.expand)
check("vau on Windows: status reads the PATH's folders (any case, a trailing slash)", S.vauStatus(ww, [wbin.toUpperCase() + "\\"]).onPath && !S.vauStatus(ww, ["C:\\Tools"]).onPath && S.vauStatus(ww, []).path === wv.path)
if (process.platform === "win32") {
  const out = execFileSync("cmd.exe", ["/d", "/c", wv.path, "--help"], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot, PATH: "C:\\Windows\\System32" } })
  check("vau on Windows: vau.cmd runs with no node on the PATH", /vau: drive Vaultite/.test(out), out.slice(0, 200))
}
check("vau on Windows: a made-up home never touches the registry", !/PATH/.test(S.installVau({ ...ww, home: path.join(tmp, "winhome2") }).did))

// ---------- vau in WSL: the script, with a stand-in wslpath and Windows executable ----------
if (process.platform !== "win32") {
  const { wslShim } = await import("../core/vaushims.ts")
  const fake = path.join(tmp, "wslbin"), there = path.join(tmp, "there.md")
  fs.mkdirSync(fake, { recursive: true })
  fs.writeFileSync(there, "")
  fs.writeFileSync(path.join(fake, "wslpath"), `#!/bin/sh\ncase $1 in -u) echo '${path.join(fake, "exe")}' ;; -w) echo "W:$2" ;; esac\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(fake, "exe"), "#!/bin/sh\nprintf '%s\\n' \"$WSLENV\" \"$ELECTRON_RUN_AS_NODE\" \"$VAULTITE_WSL\" \"$@\"\n", { mode: 0o755 })
  const shim = path.join(tmp, "wslvau")
  fs.writeFileSync(shim, wslShim({ exe: "C:\\Program Files\\Vaultite\\Vaultite.exe", script: "C:\\app\\bin\\vau", env: { VAULTITE_USER_DATA: "C:\\Users\\alice\\AppData\\Roaming\\Vaultite" }, mark: "test" }), { mode: 0o755 })
  const lines = execFileSync(shim, ["read", there, `--from=${there}`, "/nowhere/x.md", "Notes/a b.md"], { encoding: "utf8",
    env: { PATH: `${fake}:/usr/bin:/bin`, WSLENV: "MINE", WSL_DISTRO_NAME: "Ubuntu", VAULTITE_VAULT: "/mnt/c/Vault", VAULTITE_URL: "http://127.0.0.1:8800", CLAUDECODE: "1", HOME: home } }).split("\n")
  const crossed = lines[0].split(":")
  check("vau in WSL: Vaultite's and the agent's variables cross by WSLENV (the vault as a path), after the user's own", crossed[0] === "MINE" &&
    ["ELECTRON_RUN_AS_NODE", "VAULTITE_USER_DATA", "VAULTITE_URL", "VAULTITE_WSL", "VAULTITE_VAULT/p", "CLAUDECODE"].every((v) => crossed.includes(v)) && !crossed.includes("VAULTITE_VAULT"), lines[0])
  check("vau in WSL: runs Windows' vau as Node, saying it's from WSL", lines[1] === "1" && lines[2] === "Ubuntu" && lines[3] === "C:\\app\\bin\\vau", lines)
  check("vau in WSL: paths of files that are there go as Windows sees them, the rest as they are", JSON.stringify(lines.slice(4, 9)) === JSON.stringify(["read", `W:${there}`, `--from=W:${there}`, "/nowhere/x.md", "Notes/a b.md"]), lines)
}
const { wslText } = await import("../core/wsl.ts")
const onDisk = new Set(["C:\\Users\\Alice Park\\Vault"])
check("vau in WSL: the Windows paths it prints are WSL's (spaces and all, when they're there)", wslText("Vault: C:\\Users\\Alice Park\\Vault (open). Also C:\\x\\y and more, \\\\wsl.localhost\\Ubuntu\\home\\a.md", "Ubuntu", (p) => onDisk.has(p)) ===
  "Vault: /mnt/c/Users/Alice Park/Vault (open). Also /mnt/c/x/y and more, /home/a.md")

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
check("service: --updates follows a branch, in the job's env (this machine's choice)", SV.servicePlan("darwin", { ...so, updates: "main" }).text.includes("<key>VAULTITE_UPDATES</key><string>main</string>") &&
  SV.servicePlan("linux", { ...so, updates: "main" }).text.includes('Environment="VAULTITE_UPDATES=main"') && !mac.text.includes("VAULTITE_UPDATES"))
const win = SV.servicePlan("win32", { ...so, root: "C:\\src\\vault ite", node: "C:\\Program Files\\nodejs\\node.exe", vault: "C:\\Users\\Zoë\\My Vault" })
check("service: on Windows a task at login running wscript's launcher, no time limit, restarted", win.more?.[0].text.includes("<LogonTrigger>") &&
  win.more[0].text.includes("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>") && win.more[0].text.includes("<LogonType>InteractiveToken</LogonType>") &&
  win.more[0].text.includes(`//E:jscript "${win.file}"`) && win.start.some((c) => c.includes("/Run")), win.more)
check("service: the launcher sets the variables (ASCII only) and runs the server hidden, again when it stops", win.text.includes('env.Item("VAULTITE_VAULT") = "C:\\\\Users\\\\Zo\\u00eb\\\\My Vault"') &&
  win.text.includes('env.Item("PORT") = "8800"') && !win.text.includes('"PATH"') && win.text.includes("shell.Run(command, 0, true)") &&
  win.text.includes('\\"C:\\\\src\\\\vault ite\\\\core\\\\winservice.ts\\"') && /^[\x00-\x7f]*$/.test(win.text), win.text)
fs.mkdirSync(path.dirname(win.file), { recursive: true })
fs.writeFileSync(win.file, win.text)
check("service: its vault and port read back from the launcher", SV.serviceVault("win32", home) === "C:\\Users\\Zoë\\My Vault" && SV.serviceEnv("win32", home).PORT === "8800")
check("service: macOS' and Linux' read back too", (() => { fs.mkdirSync(path.dirname(lin.file), { recursive: true }); fs.writeFileSync(lin.file, lin.text); return SV.serviceVault("linux", home) === "/home/alice/My Vault" && SV.serviceEnv("linux", home).PORT === "8800" })())
check("service: not elsewhere", (() => { try { SV.servicePlan("aix", so); return false } catch { return true } })())
const realNode = fs.realpathSync(process.execPath), binDir = path.join(tmp, "bin")
fs.mkdirSync(binDir, { recursive: true })
fs.symlinkSync(realNode, path.join(binDir, "node"))
check("service: the node on PATH when it's this one (outlives a Homebrew upgrade)", SV.stableNode(realNode, `/nowhere${path.delimiter}${binDir}`) === path.join(binDir, "node") &&
  SV.stableNode(realNode, "/nowhere") === realNode)

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(summary("setup", t0))
