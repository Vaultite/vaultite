// `vau service`: keep this checkout's server running on this machine, started at login (a launchd agent on macOS, a
// Task Scheduler task on Windows) or boot (a systemd user unit on Linux, with linger so it runs logged out, as on a VPS).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { servingOf } from "./serving.ts"

const LABEL = "app.vaultite.server"
/** `updates`: a branch this checkout follows on its own (core/selfupdate.ts), this machine's choice. */
export type ServiceOptions = { root: string; node: string; vault: string; port?: number; host?: string; home?: string; updates?: string }
export type ServicePlan = { platform: "darwin" | "linux" | "win32"; file: string; text: string; log: string; start: string[][]; stop: string[][]
  /** More files it writes (Windows: the task's definition, UTF-16 as schtasks reads it). */
  more?: { file: string; text: string; utf16?: boolean }[] }

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** systemd unquotes "..." in ExecStart and Environment (not WorkingDirectory) and expands % specifiers. */
const unitWord = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`

/** The `node` on PATH when it's this one (Homebrew's /opt/homebrew/bin/node outlives an upgrade; its Cellar path doesn't). */
export function stableNode(exe: string, PATH = "") {
  const real = (p: string) => { try { return fs.realpathSync(p) } catch { return "" } }
  const me = real(exe)
  return PATH.split(path.delimiter).flatMap((d) => [path.join(d, "node"), path.join(d, "node.exe")]).find((p) => path.isAbsolute(p) && real(p) === me) ?? exe
}

/** Windows' task runs wscript (no window; a task can set no variables), whose script sets them and runs the server in
 *  cmd's hidden console (what it runs shares it, rather than a window each), again 3 s after it stops. */
export const TASK = "Vaultite server"
/** A JScript string, ASCII only (wscript reads a file without a BOM in the system's code page). */
const js = (s: string) => JSON.stringify(s).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
const winQuote = (s: string) => `"${s}"` // (a Windows path can't hold a ")
function windowsPlan(o: ServiceOptions, home: string, env: Record<string, string>): ServicePlan {
  const dir = path.join(home, "AppData", "Local", "Vaultite")
  const file = path.join(dir, "service.js"), xmlFile = path.join(dir, "service.xml")
  const log = path.join(dir, "Logs", "vaultite.log")
  const all: Record<string, string> = { ...env, VAULTITE_LOG: log }
  delete all.PATH // (the user's own, as a terminal has it)
  const text = `// Vaultite's server (vau service install): Task Scheduler's "${TASK}" task runs this at login with wscript, which
// shows no window. vau service uninstall removes it.
var shell = new ActiveXObject("WScript.Shell"), env = shell.Environment("PROCESS")
${Object.entries(all).map(([k, v]) => `env.Item(${js(k)}) = ${js(v)}`).join("\n")}
var command = ${js(`cmd.exe /d /s /c "${winQuote(o.node)} ${winQuote(path.win32.join(o.root, "core", "winservice.ts"))}"`)}
shell.CurrentDirectory = ${js(o.root)}
for (;;) {
  shell.Run(command, 0, true)
  WScript.Sleep(3000)
}
`
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username
  const xmlText = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Vaultite's server (vau service install), serving ${xml(o.vault)}</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(user)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>wscript.exe</Command><Arguments>//B //NoLogo //E:jscript ${xml(winQuote(file))}</Arguments></Exec>
  </Actions>
</Task>
`
  return { platform: "win32", file, text, log, more: [{ file: xmlFile, text: xmlText, utf16: true }],
    start: [["schtasks", "/End", "/TN", TASK], ["schtasks", "/Create", "/TN", TASK, "/XML", xmlFile, "/F"], ["schtasks", "/Run", "/TN", TASK]],
    stop: [["schtasks", "/End", "/TN", TASK], ["schtasks", "/Delete", "/TN", TASK, "/F"]] }
}

/** What it writes and runs, without doing it: the job's file and the commands that start or stop it. */
export function servicePlan(platform: string, o: ServiceOptions): ServicePlan {
  const home = o.home ?? os.homedir()
  const server = path.join(o.root, "server.ts")
  // Login shells set their own PATH; this one is for what the server runs itself (git, tailscale, the agents' CLIs).
  // (Linux: also where its package managers put CLIs, when they're there: snap, linuxbrew, bun, cargo, volta, npm's -g)
  const extra = platform === "linux" ? ["/snap/bin", "/home/linuxbrew/.linuxbrew/bin", ...[".bun/bin", ".cargo/bin", ".volta/bin", ".npm-global/bin"].map((d) => path.join(home, d))]
    .filter((d) => fs.existsSync(d)) : []
  const PATH = [path.dirname(o.node), path.join(home, ".local", "bin"), platform === "darwin" && "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", ...extra]
    .filter((d): d is string => !!d)
    .filter((d, i, all) => all.indexOf(d) === i).join(":")
  const env: Record<string, string> = { VAULTITE_VAULT: o.vault, PATH }
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1" // vau run by the desktop app's own Node
  if (o.port) env.PORT = String(o.port)
  if (o.host) env.HOST = o.host
  if (o.updates) env.VAULTITE_UPDATES = o.updates
  if (platform === "win32") return windowsPlan(o, home, env)
  if (platform === "darwin") {
    const file = path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`)
    const log = path.join(home, "Library", "Logs", "vaultite.log")
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(o.node)}</string><string>${xml(server)}</string></array>
  <key>WorkingDirectory</key><string>${xml(o.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`
    const uid = String(process.getuid?.() ?? 501)
    return { platform: "darwin", file, text, log,
      start: [["launchctl", "bootout", `gui/${uid}/${LABEL}`], ["launchctl", "bootstrap", `gui/${uid}`, file]],
      stop: [["launchctl", "bootout", `gui/${uid}/${LABEL}`]] }
  }
  if (platform !== "linux") throw new Error(`vau service runs on macOS, Linux and Windows, not ${platform}`)
  const file = path.join(home, ".config", "systemd", "user", "vaultite.service")
  const text = `[Unit]
Description=Vaultite server
After=network-online.target

[Service]
WorkingDirectory=${o.root.replace(/%/g, "%%")}
ExecStart=${unitWord(o.node)} ${unitWord(server)}
${Object.entries(env).map(([k, v]) => `Environment=${unitWord(`${k}=${v}`)}`).join("\n")}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`
  // Linger keeps user units running with nobody logged in; it fails without polkit's yes, which only warns.
  return { platform: "linux", file, text, log: "journalctl --user -u vaultite -f",
    start: [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "vaultite"], ["systemctl", "--user", "restart", "vaultite"],
      ["loginctl", "enable-linger", os.userInfo().username]],
    stop: [["systemctl", "--user", "disable", "--now", "vaultite"]] }
}

/** Runs each command, carrying on past one that fails (a job that wasn't loaded yet): what failed, as lines. */
function run(cmds: string[][]) {
  const failed: string[] = []
  for (const [cmd, ...args] of cmds) {
    try {
      execFileSync(cmd, args, { stdio: "pipe", timeout: 20000 })
    } catch (e) {
      if (!(cmd === "launchctl" && args[0] === "bootout") && !(cmd === "schtasks" && args[0] === "/End")) failed.push(`${[cmd, ...args].join(" ")}: ${String((e as { stderr?: Buffer }).stderr ?? e).trim().split("\n")[0]}`)
    }
  }
  return failed
}

export function installService(platform: string, o: ServiceOptions) {
  const plan = servicePlan(platform, o)
  const was = platform === "win32" ? serviceEnv(platform, o.home).VAULTITE_VAULT : ""
  for (const f of [plan, ...plan.more ?? []]) {
    fs.mkdirSync(path.dirname(f.file), { recursive: true })
    fs.writeFileSync(f.file, "utf16" in f && f.utf16 ? Buffer.from(`\ufeff${f.text.replace(/\n/g, "\r\n")}`, "utf16le") : f.text)
  }
  if (platform === "win32") {
    run(plan.start.slice(0, 1))
    for (const v of new Set([was, o.vault])) if (v) stopServer(v)
    return { ...plan, failed: run(plan.start.slice(1)) }
  }
  return { ...plan, failed: run(plan.start) }
}

export function uninstallService(platform: string, o: ServiceOptions) {
  const plan = servicePlan(platform, o)
  const vault = platform === "win32" ? serviceEnv(platform, o.home).VAULTITE_VAULT : ""
  const failed = run(plan.stop)
  if (vault) stopServer(vault)
  for (const f of [plan, ...plan.more ?? []]) fs.rmSync(f.file, { force: true })
  if (platform === "linux") run([["systemctl", "--user", "daemon-reload"]])
  return { ...plan, failed }
}

/** Windows: ending the task ends its launcher, not the server it ran: that one by its claim on the vault (core/serving.ts),
 *  never the desktop app's own. */
function stopServer(vault: string) {
  const s = servingOf(vault)
  if (s && !s.app) try { process.kill(s.pid) } catch { /* gone already */ }
}

export type ServiceStatus = { installed: boolean; file: string; vault: string; url: string; running: boolean; log: string }
/** Whether the service is installed and its job running (not whether the server answers: ask its url). */
export function serviceStatus(platform = process.platform, home = os.homedir()): ServiceStatus {
  const plan = servicePlan(platform, { root: "", node: "", vault: "", home })
  const env = serviceEnv(platform, home)
  const installed = fs.existsSync(plan.file)
  const ask = (cmd: string, args: string[]) => { try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000, windowsHide: true }).trim() } catch { return "" } }
  const running = !installed ? false : platform === "darwin" ? /\bstate = running\b/.test(ask("launchctl", ["print", `gui/${process.getuid?.() ?? 501}/${LABEL}`]))
    : platform === "linux" ? ask("systemctl", ["--user", "is-active", "vaultite"]) === "active"
    : ask("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-ScheduledTask -TaskName '${TASK}').State`]) === "Running"
  return { installed, file: plan.file, vault: env.VAULTITE_VAULT ?? "", url: `http://${env.HOST ?? "127.0.0.1"}:${env.PORT ?? 8793}`, running, log: plan.log }
}

/** The variables this machine's service runs with, read from its job file (none when it isn't installed). */
export function serviceEnv(platform = process.platform, home = os.homedir()): Record<string, string> {
  let text = ""
  try { text = fs.readFileSync(servicePlan(platform, { root: "", node: "", vault: "", home }).file, "utf8") } catch { return {} }
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/<key>(\w+)<\/key><string>([^<]*)<\/string>/g)) out[m[1]] = m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  for (const m of text.matchAll(/^Environment="(\w+)=((?:[^"\\]|\\.)*)"$/gm)) out[m[1]] = m[2].replace(/\\(.)/g, "$1").replace(/%%/g, "%")
  for (const m of text.matchAll(/^env\.Item\("(\w+)"\) = ("(?:[^"\\]|\\.)*")$/gm)) out[m[1]] = JSON.parse(m[2])
  return out
}

/** The vault this machine's service serves, if one is installed, else "". */
export const serviceVault = (platform = process.platform, home = os.homedir()) => serviceEnv(platform, home).VAULTITE_VAULT ?? ""
