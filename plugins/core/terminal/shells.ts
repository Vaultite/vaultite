import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { distros } from "../../../core/plugins.ts"

export type ShellKind = "posix" | "wsl" | "pwsh" | "cmd"
export type ShellChoice = { shell: string; label: string; kind: ShellKind }

export const progName = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase()

export function kindOf(shell: string): ShellKind {
  if (/^wsl:/i.test(shell)) return "wsl"
  const name = progName(shell)
  if (name === "pwsh" || name === "powershell") return "pwsh"
  if (name === "cmd") return "cmd"
  return "posix"
}
export const distroOf = (shell: string) => (/^wsl:(.+)$/i.exec(shell)?.[1] ?? "")

const exists = (p: string) => { try { return fs.statSync(p).isFile() } catch { return false } }
function onPath(name: string, env: NodeJS.ProcessEnv = process.env) {
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)
  return dirs.map((d) => path.join(d, name)).find(exists) ?? null
}

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

function posixShells(): ShellChoice[] {
  let listed: string[] = []
  try { listed = fs.readFileSync("/etc/shells", "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")) } catch {}
  const mine = loginShell()
  const all = [...new Set([mine, ...listed])].filter(exists)
  return all.map((s) => ({ shell: s, label: progName(s), kind: "posix" as const }))
}

export const loginShell = () => process.env.SHELL || os.userInfo().shell || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")

export async function shellsHere(): Promise<ShellChoice[]> {
  if (process.platform !== "win32") return posixShells()
  const wsl = (await distros()).map((d): ShellChoice => ({ shell: `wsl:${d}`, label: d, kind: "wsl" }))
  return [...windowsShells(), ...wsl]
}

// A WSL distro is trusted by name: listing them is slow.
export function defaultShell(chosen = ""): string {
  if (chosen && (/^wsl:./i.test(chosen) ? process.platform === "win32" : path.isAbsolute(chosen) && exists(chosen))) return chosen
  if (process.platform !== "win32") return loginShell()
  return windowsShells()[0].shell
}
