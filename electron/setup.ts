// Set up Vaultite's machine side (web/onboarding.html): vault places, coding agents, and `vau` on the PATH.
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { agentName } from "../core/terminalids.ts"
import { vauShims } from "../core/vaushims.ts"

export type Where = {
  home: string
  exe: string
  vau: string
  userData: string
  env?: Record<string, string>
  // (Windows may move Documents into OneDrive)
  documents?: string
  platform?: string
  claudeDir?: string
  codexHome?: string
}

const exists = (p: string) => fs.existsSync(p)
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function writeAtomic(p: string, text: string, mode?: number) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.vaultite-${process.pid}.tmp`
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined)
  fs.renameSync(tmp, p)
}

export function places(w: Where) {
  const icloud = [path.join(w.home, "Library", "Mobile Documents", "com~apple~CloudDocs"), path.join(w.home, "iCloudDrive")].find(exists)
  return { icloud: icloud ?? null, documents: w.documents ?? path.join(w.home, "Documents"), home: w.home }
}

const obsidianJson = (home: string) => [
  path.join(home, "Library", "Application Support", "obsidian", "obsidian.json"),
  path.join(home, "AppData", "Roaming", "obsidian", "obsidian.json"),
  path.join(home, ".config", "obsidian", "obsidian.json"),
  path.join(home, ".var", "app", "md.obsidian.Obsidian", "config", "obsidian", "obsidian.json"),
  path.join(home, "snap", "obsidian", "current", ".config", "obsidian", "obsidian.json"),
].find(exists)

export function obsidianVaults(w: Where): { path: string; name: string }[] {
  try {
    const j = JSON.parse(fs.readFileSync(obsidianJson(w.home) ?? "", "utf8"))
    const list = Object.values(j?.vaults ?? {}) as { path?: unknown; ts?: unknown }[]
    return list.filter((v) => typeof v?.path === "string" && fs.statSync(v.path, { throwIfNoEntry: false })?.isDirectory())
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
      .map((v) => ({ path: v.path as string, name: path.basename(v.path as string) }))
  } catch { return [] }
}

const HARNESSES: { id: string; bin: string; install: string; installWin?: string; agent?: string }[] = [
  { id: "claude-code", bin: "claude", agent: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash", installWin: "irm https://claude.ai/install.ps1 | iex" },
  { id: "codex", bin: "codex", agent: "codex", install: "npm i -g @openai/codex" },
  { id: "openclaw", bin: "openclaw", install: "npm i -g openclaw@latest" },
  { id: "hermes", bin: "hermes", install: "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash" },
  { id: "gemini", bin: "gemini", install: "npm i -g @google/gemini-cli" },
  { id: "opencode", bin: "opencode", install: "curl -fsSL https://opencode.ai/install | bash" },
]

export type Extra = { kind: "computer-use" | "connect"; state: "on" | "off" | "unavailable" }
export type Harness = { id: string; name: string; path: string | null; install: string; agent?: string; extra?: Extra }

// An app's PATH is launchd's, not the user's.
const binDirs = (w: Where, dirs: string[]) => platformOf(w) === "win32"
  ? [...dirs, path.join(w.home, "AppData", "Roaming", "npm"), path.join(w.home, ".local", "bin")]
  : [...dirs, ...[".local/bin", ".npm-global/bin", ".bun/bin", ".opencode/bin", ".claude/local"].map((d) => path.join(w.home, d))]
function findBin(w: Where, dirs: string[], bin: string) {
  const names = platformOf(w) === "win32" ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin]
  return binDirs(w, dirs).flatMap((d) => names.map((n) => path.join(d, n))).find((p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile()) ?? null
}

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
export function claudeProject(vault: string) {
  let real = vault
  try { real = fs.realpathSync(vault) } catch {}
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
export async function setClaudeComputerUse(w: Where, vault: string) {
  const file = claudeJson(w), { editClaudeProject } = await import("../core/claudeconfig.ts")
  await editClaudeProject(file, claudeProject(vault), (project) => {
    const list: unknown[] = Array.isArray(project.enabledMcpServers) ? project.enabledMcpServers : []
    return list.includes(CU) ? null : { ...project, enabledMcpServers: [...list, CU] }
  }, tilde(w, file))
}

// Codex's computer use comes with the Codex app (its helper app in ~/.codex/computer-use), a plugin of its bundled
// marketplace that `codex plugin add` turns on, for every folder.
const CODEX_CU = "computer-use@openai-bundled"
const codexHome = (w: Where) => w.codexHome ?? path.join(w.home, ".codex")
export function codexComputerUse(w: Where): Extra["state"] {
  if (!exists(path.join(codexHome(w), "computer-use", "Codex Computer Use.app"))) return "unavailable"
  let toml = ""
  try { toml = fs.readFileSync(path.join(codexHome(w), "config.toml"), "utf8") } catch {}
  const table = toml.split(/^(?=\s*\[)/m).find((t) => t.trimStart().startsWith(`[plugins."${CODEX_CU}"]`))
  return table && /^\s*enabled\s*=\s*true\s*$/m.test(table) ? "on" : "off"
}
export function setCodexComputerUse(w: Where, codex: string): Promise<void> {
  const env = { ...process.env, HOME: w.home, CODEX_HOME: codexHome(w), PATH: [path.dirname(codex), process.env.PATH].filter(Boolean).join(path.delimiter) }
  return new Promise((ok, fail) => execFile(codex, ["plugin", "add", CODEX_CU], { env, timeout: 60_000 }, (e, _out, err) =>
    (e ? fail(new Error(`codex plugin add failed: ${(String(err).trim() || e.message).split("\n").slice(-2).join(" ")}`)) : ok())))
}

const MARK = "vau, the Vaultite command, written by Set up Vaultite"
const shims = (w: Where) => vauShims({ exe: w.exe, script: w.vau, env: w.env,
  mark: `${MARK} (${path.basename(w.exe)} runs it as Node). Safe to delete.` }, platformOf(w))
const platformOf = (w: Where) => w.platform ?? process.platform

const ours = (p: string) => { try { return fs.readFileSync(p, "utf8").includes(MARK) } catch { return false } }
const userBin = (w: Where) => path.join(w.home, ".local", "bin", "vau")
const appBin = (w: Where) => path.join(w.userData, "bin", "vau")
// Local AppData, not roaming: the shim names this machine's executable.
export const winBin = (w: Where) => path.join(w.home, "AppData", "Local", "Vaultite", "bin")

// The app's own PATH is launchd's; on Windows a new terminal gets the system's and the user's from the registry.
export function shellPath(w: Where): string[] {
  if (platformOf(w) === "win32") return winPath().dirs
  try {
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
    const out = execFileSync(shell, ["-ilc", "printf '\\n%s' \"$PATH\""], { env: { ...process.env, HOME: w.home }, timeout: 4000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out.split("\n").pop()!.split(":").filter(Boolean)
  } catch { return (process.env.PATH ?? "").split(":").filter(Boolean) }
}

export type VauStatus = { path: string | null; onPath: boolean; system: boolean
  other: string | null }
export function vauStatus(w: Where, dirs = shellPath(w)): VauStatus {
  if (platformOf(w) === "win32") {
    const at = path.join(winBin(w), "vau.cmd")
    return { path: ours(at) ? at : null, onPath: ours(at) && hasDir(dirs, winBin(w)), system: false, other: null }
  }
  const user = userBin(w), sys = "/usr/local/bin/vau"
  const other = exists(user) && !ours(user) ? user : null
  const at = !other && exists(user) ? user : exists(appBin(w)) && ours(appBin(w)) ? appBin(w) : null
  const system = ours(sys)
  return { path: at, onPath: system || (!!at && dirs.includes(path.dirname(at))), system, other }
}

export function vauHome(w: Where) {
  const user = userBin(w), dir = path.dirname(platformOf(w) === "win32" ? path.join(winBin(w), "vau.cmd") : exists(user) && !ours(user) ? appBin(w) : user)
  return tilde(w, dir)
}

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
const write = (p: string, text: string) => {
  try { if (fs.readFileSync(p, "utf8") === text) return false } catch {}
  writeAtomic(p, text, 0o755)
  return true
}

// Windows keeps the user's PATH in HKCU\Environment, unexpanded; a REG_EXPAND_SZ one has %VARS%.
export type UserPath = { read(): { value: string; expand: boolean } | null; write(value: string, expand: boolean): void }

const dirKey = (d: string) => d.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase()
const sameDir = (a: string, b: string) => dirKey(a) === dirKey(b)
const hasDir = (dirs: string[], dir: string) => dirs.some((d) => sameDir(d, dir))
// (Windows' variable names ignore case)
export const expandVars = (s: string, env: Record<string, string | undefined> = process.env) =>
  s.replace(/%([^%]+)%/g, (m, k: string) => Object.entries(env).find(([n]) => n.toLowerCase() === k.toLowerCase())?.[1] ?? m)

export function addToPath(p: UserPath, dir: string, env: Record<string, string | undefined> = process.env): boolean {
  const was = p.read()
  const entries = (was?.value ?? "").split(";").filter((e) => e.trim())
  if (entries.some((e) => sameDir(expandVars(e.trim(), env), dir))) return false
  p.write([...entries, dir].join(";"), was ? was.expand : true)
  return true
}

// Base64 crosses into PowerShell with no quoting; setting a missing variable to nothing has .NET broadcast
// WM_SETTINGCHANGE, so new terminals see the PATH.
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

function winPath(): { dirs: string[] } {
  try {
    const out = ps("$m = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment').GetValue('Path', ''); " +
      "$u = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment').GetValue('Path', ''); [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(\"$m;$u\"))").trim()
    return { dirs: Buffer.from(out, "base64").toString("utf8").split(";").map((d) => d.trim()).filter(Boolean) }
  } catch { return { dirs: (process.env.PATH ?? "").split(";").filter(Boolean) } }
}

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
