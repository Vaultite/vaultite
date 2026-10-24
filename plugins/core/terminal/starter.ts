// Starts an agent from PowerShell or cmd on Windows (plugin.ts: agentRun), where its POSIX line can't run: `<the server's
// Node> starter.ts <job.json>` runs the job's program here (Ctrl+C is the agent's), then the shell goes on.
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { winCommand } from "../../../core/winbin.ts"

/** What plugin.ts writes for it (read once, then removed). `state`: the terminal's state file, marked `missing` when
 *  there's no such program. */
export type Job = { argv: string[]; env?: Record<string, string>; cwd?: string | null; state?: string | null }

/** The system's Path then the user's, as Windows keeps them (HKLM, HKCU), %VARS% expanded; null when unread. */
function registryPath(env: NodeJS.ProcessEnv) {
  const reg = path.join(env.SystemRoot || "C:\\Windows", "System32", "reg.exe")
  const read = (key: string) => {
    try {
      const out = execFileSync(reg, ["query", key, "/v", "Path"], { encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })
      return /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out)?.[1].trim() ?? ""
    } catch { return "" }
  }
  const all = [read("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), read("HKCU\\Environment")].filter(Boolean).join(";")
  const vars = Object.fromEntries(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]))
  return all ? all.replace(/%([^%]+)%/g, (m, k: string) => vars[k.toLowerCase()] ?? m) : null
}

async function main() {
  const file = process.argv[2]
  const job = JSON.parse(fs.readFileSync(file, "utf8")) as Job
  fs.rmSync(file, { force: true })
  const env: NodeJS.ProcessEnv = { ...process.env, ...job.env }
  // (how the desktop app runs this as Node: its agent mustn't inherit it, or an Electron app it starts would be Node too)
  delete env.ELECTRON_RUN_AS_NODE
  let how = winCommand(job.argv, env)
  // (installed since this shell started: Windows' Path as a new terminal gets it, from the registry)
  if (!how) {
    const fresh = registryPath(env)
    if (fresh) { env.Path = `${env.Path ?? env.PATH ?? ""};${fresh}`; delete env.PATH; how = winCommand(job.argv, env) }
  }
  if (!how) {
    if (job.state) try { fs.writeFileSync(job.state, "missing") } catch { /* told on screen anyway */ }
    process.stderr.write(`${job.argv[0]}: not found (it isn't installed, or isn't on Path)\r\n`)
    process.exit(127)
  }
  // Ctrl+C reaches the whole console: the agent's to answer, never this one's.
  process.on("SIGINT", () => {})
  const child = spawn(how[0], how[1], { stdio: "inherit", env, cwd: job.cwd || process.cwd(), windowsVerbatimArguments: how[2] })
  child.on("error", (e) => { process.stderr.write(`${job.argv[0]}: ${e.message}\r\n`); process.exit(126) })
  child.on("exit", (code) => process.exit(code ?? 1))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
