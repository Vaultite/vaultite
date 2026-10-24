// The shells a terminal can start here, and which kind each is: a POSIX shell (a Mac's, Linux's, Git Bash, a WSL
// distro's), PowerShell or cmd. On Windows they're named as Windows Terminal names them; the setting `shell` picks one.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { distros } from "../../../core/plugins.ts"

/** posix: sh syntax (Git Bash too); wsl: posix inside a WSL distro, its paths WSL's; pwsh: PowerShell 7 or Windows
 *  PowerShell; cmd: Command Prompt. */
export type ShellKind = "posix" | "wsl" | "pwsh" | "cmd"
/** A shell to offer: `shell` is what a terminal's Spec starts (a program's path, or wsl:<distro>). */
export type ShellChoice = { shell: string; label: string; kind: ShellKind }

/** A program's name without its folder or Windows' .exe: "pwsh", "bash", "-zsh". */
export const progName = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase()

/** The kind of shell `shell` (a path, or wsl:<distro>) starts. */
export function kindOf(shell: string): ShellKind {
  if (/^wsl:/i.test(shell)) return "wsl"
  const name = progName(shell)
  if (name === "pwsh" || name === "powershell") return "pwsh"
  if (name === "cmd") return "cmd"
  return "posix"
}
/** The WSL distro a wsl:<distro> shell runs in. */
export const distroOf = (shell: string) => (/^wsl:(.+)$/i.exec(shell)?.[1] ?? "")

const exists = (p: string) => { try { return fs.statSync(p).isFile() } catch { return false } }
/** A program on PATH (Windows' Path, with its extensions), or null. */
function onPath(name: string, env: NodeJS.ProcessEnv = process.env) {
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)
  return dirs.map((d) => path.join(d, name)).find(exists) ?? null
}

/** Windows' shells, found where their installers put them (Windows Terminal's names). */
function windowsShells(): ShellChoice[] {
  const pf = process.env.ProgramFiles || "C:\\Program Files", root = process.env.SystemRoot || "C:\\Windows"
  const out: ShellChoice[] = []
  const pwsh = onPath("pwsh.exe") ?? [path.join(pf, "PowerShell", "7", "pwsh.exe"), path.join(pf, "PowerShell", "7-preview", "pwsh.exe")].find(exists)
  if (pwsh) out.push({ shell: pwsh, label: "PowerShell", kind: "pwsh" })
  out.push({ shell: path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), label: "Windows PowerShell", kind: "pwsh" })
  out.push({ shell: process.env.ComSpec || path.join(root, "System32", "cmd.exe"), label: "Command Prompt", kind: "cmd" })
  const bash = gitBash()
  if (bash) out.push({ shell: bash, label: "Git Bash", kind: "posix" })
  return out
}

/** Git for Windows' bash (bin\bash.exe: the one that sets up its own PATH), or null. */
export function gitBash(): string | null {
  if (process.platform !== "win32") return null
  const pf = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")]
  return pf.filter((d): d is string => !!d).map((d) => path.join(d, "Git", "bin", "bash.exe")).find(exists) ?? null
}

/** A POSIX machine's shells: /etc/shells' that are there, the user's own first. */
function posixShells(): ShellChoice[] {
  let listed: string[] = []
  try { listed = fs.readFileSync("/etc/shells", "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")) } catch { /* none */ }
  const mine = loginShell()
  const all = [...new Set([mine, ...listed])].filter(exists)
  return all.map((s) => ({ shell: s, label: progName(s), kind: "posix" as const }))
}

/** The user's login shell here (not on Windows). */
export const loginShell = () => process.env.SHELL || os.userInfo().shell || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")

/** Every shell a terminal can start here, the default first; WSL's distros on Windows (asked each time: they come and go). */
export async function shellsHere(): Promise<ShellChoice[]> {
  if (process.platform !== "win32") return posixShells()
  const wsl = (await distros()).map((d): ShellChoice => ({ shell: `wsl:${d}`, label: d, kind: "wsl" }))
  return [...windowsShells(), ...wsl]
}

/** The shell new terminals start: the setting's (`chosen`) when it's one of this machine's, else the login shell
 *  (Windows: PowerShell 7, else Windows PowerShell). A WSL distro is trusted by name (listing them is slow). */
export function defaultShell(chosen = ""): string {
  if (chosen && (/^wsl:./i.test(chosen) ? process.platform === "win32" : path.isAbsolute(chosen) && exists(chosen))) return chosen
  if (process.platform !== "win32") return loginShell()
  return windowsShells()[0].shell
}
