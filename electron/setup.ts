// Set up Vaultite's machine side (web/onboarding.html, tools/test_setup.ts): where vaults go, Obsidian's vaults, the
// coding agents and their computer use, and `vau` (bin/vau with the app as Node) in ~/.local/bin or Windows' PATH.
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { agentName } from "../core/terminalids.ts"
import { vauShims } from "../core/vaushims.ts"

/** Where it looks and writes: a made-up home folder in tests and QA, never the user's. */
export type Where = {
  home: string
  /** The app's executable (run as Node) and its source folder (bin/vau). */
  exe: string
  root: string
  /** The app's userData (a vau of the app's own when ~/.local/bin has someone else's). */
  userData: string
  /** Variables the shim sets (VAULTITE_USER_DATA when the app runs with another). */
  env?: Record<string, string>
  /** The system's Documents folder, when it isn't home's (Windows moves it into OneDrive): Electron's. */
  documents?: string
  /** The platform it sets up for (tests: Windows' logic anywhere). */
  platform?: string
  /** Claude Code's and Codex's folders when the app's environment moves them (CLAUDE_CONFIG_DIR, CODEX_HOME). */
  claudeDir?: string
  codexHome?: string
}

const exists = (p: string) => fs.existsSync(p)
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** A file replaced whole or not at all, its folder made: what vau reads while the app writes it is never half a file. */
export function writeAtomic(p: string, text: string, mode?: number) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.vaultite-${process.pid}.tmp`
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined)
  fs.renameSync(tmp, p)
}

// ---------- places ----------
/** iCloud Drive's folder (null when it's off: a Mac's, or iCloud for Windows') and Documents: where a new vault may go. */
export function places(w: Where) {
  const icloud = [path.join(w.home, "Library", "Mobile Documents", "com~apple~CloudDocs"), path.join(w.home, "iCloudDrive")].find(exists)
  return { icloud: icloud ?? null, documents: w.documents ?? path.join(w.home, "Documents"), home: w.home }
}

/** Where Obsidian keeps its obsidian.json: a Mac's, Windows' (%APPDATA%), then Linux's (its .deb or AppImage, Flatpak,
 *  Snap). */
const obsidianJson = (home: string) => [
  path.join(home, "Library", "Application Support", "obsidian", "obsidian.json"),
  path.join(home, "AppData", "Roaming", "obsidian", "obsidian.json"),
  path.join(home, ".config", "obsidian", "obsidian.json"),
  path.join(home, ".var", "app", "md.obsidian.Obsidian", "config", "obsidian", "obsidian.json"),
  path.join(home, "snap", "obsidian", "current", ".config", "obsidian", "obsidian.json"),
].find(exists)

/** Obsidian's vaults on this machine (its obsidian.json), last opened first; only folders that are there. */
export function obsidianVaults(w: Where): { path: string; name: string }[] {
  try {
    const j = JSON.parse(fs.readFileSync(obsidianJson(w.home) ?? "", "utf8"))
    const list = Object.values(j?.vaults ?? {}) as { path?: unknown; ts?: unknown }[]
    return list.filter((v) => typeof v?.path === "string" && fs.statSync(v.path, { throwIfNoEntry: false })?.isDirectory())
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
      .map((v) => ({ path: v.path as string, name: path.basename(v.path as string) }))
  } catch { return [] }
}

// ---------- coding agents ----------
/** What it looks for (KNOWN_AGENTS' ids): command, install line, and terminal name when the companion runs it. */
const HARNESSES: { id: string; bin: string; install: string; installWin?: string; agent?: string }[] = [
  { id: "claude-code", bin: "claude", agent: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash", installWin: "irm https://claude.ai/install.ps1 | iex" },
  { id: "codex", bin: "codex", agent: "codex", install: "npm i -g @openai/codex" },
  { id: "openclaw", bin: "openclaw", install: "npm i -g openclaw@latest" },
  { id: "hermes", bin: "hermes", install: "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash" },
  { id: "gemini", bin: "gemini", install: "npm i -g @google/gemini-cli" },
  { id: "opencode", bin: "opencode", install: "curl -fsSL https://opencode.ai/install | bash" },
]

/** What makes a found agent more useful here, for the user to say yes to: computer use, or the vault's tools. */
export type Extra = { kind: "computer-use" | "connect"; state: "on" | "off" | "unavailable" }
export type Harness = { id: string; name: string; path: string | null; install: string; agent?: string; extra?: Extra }

/** Where installers put agents' commands, besides the user's PATH (an app's PATH is launchd's). */
const binDirs = (w: Where, dirs: string[]) => platformOf(w) === "win32"
  ? [...dirs, path.join(w.home, "AppData", "Roaming", "npm"), path.join(w.home, ".local", "bin")]
  : [...dirs, ...[".local/bin", ".npm-global/bin", ".bun/bin", ".opencode/bin", ".claude/local"].map((d) => path.join(w.home, d))]
function findBin(w: Where, dirs: string[], bin: string) {
  const names = platformOf(w) === "win32" ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin]
  return binDirs(w, dirs).flatMap((d) => names.map((n) => path.join(d, n))).find((p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile()) ?? null
}

/** The coding agents on this machine, and what's on for them (`vault`: the one being set up). */
export function harnesses(w: Where, dirs: string[], vault: string | null): Harness[] {
  const mac = platformOf(w) === "darwin"
  return HARNESSES.map((h) => {
    const found = findBin(w, dirs, h.bin) ?? (h.id === "hermes" && exists(path.join(w.home, ".hermes", "hermes-agent")) ? path.join(w.home, ".hermes") : null)
    const extra: Extra | undefined = !found ? undefined
      : h.id === "claude-code" ? (mac && vault ? { kind: "computer-use", state: claudeComputerUse(w, vault) ? "on" : "off" } : undefined)
      : h.id === "codex" ? (mac ? { kind: "computer-use", state: codexComputerUse(w) } : undefined)
      : h.id === "openclaw" || h.id === "hermes" ? (vault ? { kind: "connect", state: "off" } : undefined) : undefined
    return { id: h.id, name: agentName(h.id) ?? h.id, path: found, install: platformOf(w) === "win32" && h.installWin ? h.installWin : h.install,
      ...(h.agent ? { agent: h.agent } : {}), ...(extra ? { extra } : {}) }
  })
}

// Claude Code's built-in computer-use server is off until /mcp turns it on, per project: the project's
// enabledMcpServers in its .claude.json (a project is the git repository a folder is in, else the folder).
const CU = "computer-use"
const claudeJson = (w: Where) => path.join(w.claudeDir ?? w.home, ".claude.json")
/** The folder Claude Code keeps the vault's project settings under. */
export function claudeProject(vault: string) {
  let real = vault
  try { real = fs.realpathSync(vault) } catch { /* not there yet */ }
  for (let d = real; ; d = path.dirname(d)) {
    if (exists(path.join(d, ".git"))) return d
    if (path.dirname(d) === d) return real
  }
}
const readJson = (p: string) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null } }
export function claudeComputerUse(w: Where, vault: string) {
  const list = readJson(claudeJson(w))?.projects?.[claudeProject(vault)]?.enabledMcpServers
  return Array.isArray(list) && list.includes(CU)
}
/** A new project's settings as Claude Code makes them (it reads some without checking they're there). */
const NEW_PROJECT = { allowedTools: [], mcpContextUris: [], mcpServers: {}, enabledMcpjsonServers: [], disabledMcpjsonServers: [], hasTrustDialogAccepted: false,
  hasClaudeMdExternalIncludesApproved: false, hasClaudeMdExternalIncludesWarningShown: false }

/** Turns Claude Code's computer use on for the vault, holding the lock Claude Code takes on its config (proper-lockfile's
 *  `<file>.lock` folder) so a running session's next write keeps it: it reads the file again under that lock. */
export async function setClaudeComputerUse(w: Where, vault: string) {
  const file = claudeJson(w), lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      // (stale after 10 s without an update, as proper-lockfile has it: a Claude that died holding it)
      if (Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 10_000) { fs.rmSync(lock, { recursive: true, force: true }); continue }
      if (i > 50) throw new Error("Claude Code is busy writing its settings: try again in a moment")
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  try {
    const text = exists(file) ? fs.readFileSync(file, "utf8") : ""
    const j = text.trim() ? JSON.parse(text) : {}
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`${tilde(w, file)} isn't Claude Code's settings`)
    const key = claudeProject(vault), project = j.projects?.[key] ?? NEW_PROJECT
    const list: unknown[] = Array.isArray(project.enabledMcpServers) ? project.enabledMcpServers : []
    if (list.includes(CU)) return
    j.projects = { ...j.projects, [key]: { ...project, enabledMcpServers: [...list, CU] } }
    writeAtomic(file, JSON.stringify(j, null, 2), text ? fs.statSync(file).mode & 0o777 : 0o600)
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}

// Codex's computer use comes with the Codex app (its helper app in ~/.codex/computer-use), a plugin of its bundled
// marketplace that `codex plugin add` turns on, for every folder.
const CODEX_CU = "computer-use@openai-bundled"
const codexHome = (w: Where) => w.codexHome ?? path.join(w.home, ".codex")
export function codexComputerUse(w: Where): Extra["state"] {
  if (!exists(path.join(codexHome(w), "computer-use", "Codex Computer Use.app"))) return "unavailable"
  let toml = ""
  try { toml = fs.readFileSync(path.join(codexHome(w), "config.toml"), "utf8") } catch { /* none yet */ }
  const table = toml.split(/^(?=\s*\[)/m).find((t) => t.trimStart().startsWith(`[plugins."${CODEX_CU}"]`))
  return table && /^\s*enabled\s*=\s*true\s*$/m.test(table) ? "on" : "off"
}
/** `codex plugin add`, by its own CLI (its config is its own). */
export function setCodexComputerUse(w: Where, codex: string): Promise<void> {
  const env = { ...process.env, HOME: w.home, CODEX_HOME: codexHome(w), PATH: [path.dirname(codex), process.env.PATH].filter(Boolean).join(path.delimiter) }
  return new Promise((ok, fail) => execFile(codex, ["plugin", "add", CODEX_CU], { env, timeout: 60_000 }, (e, _out, err) =>
    (e ? fail(new Error(`codex plugin add failed: ${(String(err).trim() || e.message).split("\n").slice(-2).join(" ")}`)) : ok())))
}

// ---------- vau ----------
// (Windows: vau.cmd for cmd and PowerShell and the script for Git Bash, in a folder of ours added to the user's PATH)
const MARK = "vau, the Vaultite command, written by Set up Vaultite"
const shims = (w: Where) => vauShims({ exe: w.exe, script: path.join(w.root, "bin", "vau"), env: w.env,
  mark: `${MARK} (${path.basename(w.exe)} runs it as Node). Safe to delete.` }, platformOf(w))
const platformOf = (w: Where) => w.platform ?? process.platform

const ours = (p: string) => { try { return fs.readFileSync(p, "utf8").includes(MARK) } catch { return false } }
/** ~/.local/bin/vau, and the app's own when someone else's is there. */
const userBin = (w: Where) => path.join(w.home, ".local", "bin", "vau")
const appBin = (w: Where) => path.join(w.userData, "bin", "vau")
/** Windows: vau.cmd's folder (the local AppData: the shim names this machine's executable, so it mustn't roam). */
export const winBin = (w: Where) => path.join(w.home, "AppData", "Local", "Vaultite", "bin")

/** The folders on the user's PATH, as their login shell has it (the app's own PATH is launchd's); on Windows the
 *  system's and the user's from the registry, as a new terminal gets them. */
export function shellPath(w: Where): string[] {
  if (platformOf(w) === "win32") return winPath().dirs
  try {
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
    const out = execFileSync(shell, ["-ilc", "printf '\\n%s' \"$PATH\""], { env: { ...process.env, HOME: w.home }, timeout: 4000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out.split("\n").pop()!.split(":").filter(Boolean)
  } catch { return (process.env.PATH ?? "").split(":").filter(Boolean) }
}

export type VauStatus = { path: string | null; onPath: boolean; system: boolean
  /** A `vau` that isn't ours in ~/.local/bin, left as it is. */
  other: string | null }
/** Where our vau is (null: not installed) and whether typing `vau` in a terminal finds it. */
export function vauStatus(w: Where, dirs = shellPath(w)): VauStatus {
  if (platformOf(w) === "win32") {
    const at = path.join(winBin(w), "vau.cmd")
    return { path: ours(at) ? at : null, onPath: ours(at) && hasDir(dirs, winBin(w)), system: false, other: null }
  }
  const user = userBin(w), sys = "/usr/local/bin/vau"
  const other = exists(user) && !ours(user) ? user : null
  const at = !other && exists(user) ? user : exists(appBin(w)) && ours(appBin(w)) ? appBin(w) : null
  const system = ours(sys) // (a link to ours reads as ours)
  return { path: at, onPath: system || (!!at && dirs.includes(path.dirname(at))), system, other }
}

/** Write (or update) our vau. Returns where, and what was done. On Windows its folder goes on the user's PATH too
 *  (`userPath`, the registry's unless the home is made up: tests and QA never touch the real one). */
export function installVau(w: Where, userPath: UserPath | null = w.home === os.homedir() ? registryPath : null): { path: string; did: string } {
  const files = shims(w)
  if (platformOf(w) === "win32") {
    const dir = winBin(w)
    let wrote = false
    for (const [name, text] of Object.entries(files)) wrote = write(path.join(dir, name), text) || wrote
    const added = userPath ? addToPath(userPath, dir) : false
    const did = [wrote ? `Wrote vau to ${dir}` : `vau is already at ${dir}`, added && "added it to your PATH (in terminals opened from now on)"]
    return { path: path.join(dir, "vau.cmd"), did: did.filter(Boolean).join(", and ") }
  }
  const user = userBin(w)
  const target = exists(user) && !ours(user) ? appBin(w) : user
  const same = !write(target, files.vau)
  const where = target.startsWith(w.home + "/") ? `~${target.slice(w.home.length)}` : target
  return { path: target, did: same ? `vau is already at ${where}` : target === user ? `Wrote vau to ${where}` : `Wrote vau to ${where} (${tilde(w, user)} is another program's: left as it is)` }
}
const tilde = (w: Where, p: string) => (p.startsWith(w.home + "/") ? `~${p.slice(w.home.length)}` : p)
/** Writes a file unless it already says that: whether it wrote. */
const write = (p: string, text: string) => {
  try { if (fs.readFileSync(p, "utf8") === text) return false } catch { /* not there yet */ }
  writeAtomic(p, text, 0o755)
  return true
}

// ---------- Windows: the user's PATH ----------

/** The user's PATH as Windows keeps it (HKCU\Environment), unexpanded: what a new terminal starts with, after the
 *  system's. `expand`: a REG_EXPAND_SZ (it has %VARS%), kept so. */
export type UserPath = { read(): { value: string; expand: boolean } | null; write(value: string, expand: boolean): void }

const dirKey = (d: string) => d.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase()
const sameDir = (a: string, b: string) => dirKey(a) === dirKey(b)
const hasDir = (dirs: string[], dir: string) => dirs.some((d) => sameDir(d, dir))
/** %VAR% in a PATH entry, from this process's environment (Windows' names ignore case). */
export const expandVars = (s: string, env: Record<string, string | undefined> = process.env) =>
  s.replace(/%([^%]+)%/g, (m, k: string) => Object.entries(env).find(([n]) => n.toLowerCase() === k.toLowerCase())?.[1] ?? m)

/** Adds `dir` at the end of the user's PATH unless it's there (as itself or through a %VAR%): whether it did. */
export function addToPath(p: UserPath, dir: string, env: Record<string, string | undefined> = process.env): boolean {
  const was = p.read()
  const entries = (was?.value ?? "").split(";").filter((e) => e.trim())
  if (entries.some((e) => sameDir(expandVars(e.trim(), env), dir))) return false
  p.write([...entries, dir].join(";"), was ? was.expand : true)
  return true
}

/** PowerShell on the registry: the value crosses as base64 (no quoting, any characters), and setting a variable that
 *  isn't there to nothing has .NET tell every window the environment changed (WM_SETTINGCHANGE), so new terminals see it. */
const ps = (script: string, env: Record<string, string> = {}) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
  { encoding: "utf8", timeout: 20000, windowsHide: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
const KEY = "$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');"
export const registryPath: UserPath = {
  read() {
    const out = ps(`${KEY} $v = $k.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); if ($v -ne $null) { $t = $k.GetValueKind('Path'); ` +
      "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(\"$t`n$v\")) }").trim()
    if (!out) return null
    const [kind, ...rest] = Buffer.from(out, "base64").toString("utf8").split("\n")
    return { value: rest.join("\n"), expand: kind === "ExpandString" }
  },
  write(value, expand) {
    ps(`${KEY} $v = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:VAULTITE_PATH)); ` +
      `$k.SetValue('Path', $v, '${expand ? "ExpandString" : "String"}'); [Environment]::SetEnvironmentVariable('VAULTITE_PATH_CHANGED', $null, 'User')`,
    { VAULTITE_PATH: Buffer.from(value, "utf8").toString("base64") })
  },
}

/** PATH's folders as a new terminal gets them: the system's then the user's, expanded (none when it can't be read). */
function winPath(): { dirs: string[] } {
  try {
    const out = ps("$m = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment').GetValue('Path', ''); " +
      "$u = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment').GetValue('Path', ''); [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(\"$m;$u\"))").trim()
    return { dirs: Buffer.from(out, "base64").toString("utf8").split(";").map((d) => d.trim()).filter(Boolean) }
  } catch { return { dirs: (process.env.PATH ?? "").split(";").filter(Boolean) } }
}

/** Link /usr/local/bin/vau to ours, as an administrator (macOS asks for the password; Linux, polkit's pkexec). Never
 *  over another program's. */
export function linkSystem(shim: string): Promise<void> {
  const sys = "/usr/local/bin/vau"
  if (fs.lstatSync(sys, { throwIfNoEntry: false }) && !ours(sys)) return Promise.reject(new Error(`${sys} is another program's: left as it is`))
  const script = `mkdir -p /usr/local/bin && ln -sf ${quote(shim)} ${sys}`
  if (process.platform !== "darwin") {
    // pkexec: 126 when the password dialog was dismissed, 127 when not allowed (or no polkit agent to ask).
    return new Promise((ok, fail) => execFile("pkexec", ["/bin/sh", "-c", script], (e) =>
      (e ? fail(new Error((e as { code?: unknown }).code === 126 ? "Cancelled" : (e as { code?: unknown }).code === "ENOENT" ? "pkexec isn't installed: run `sudo ln -sf " + shim + " " + sys + "`" : String(e.message))) : ok())))
  }
  return new Promise((ok, fail) => execFile("osascript", ["-e", `do shell script ${JSON.stringify(script)} with administrator privileges`],
    (e) => (e ? fail(new Error(/-128/.test(String(e)) ? "Cancelled" : String(e.message))) : ok())))
}
