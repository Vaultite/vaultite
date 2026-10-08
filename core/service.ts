// `vau service`: keep this checkout's server running on this machine, started at login (a launchd agent on macOS) or
// boot (a systemd user unit on Linux, with linger so it runs logged out, as on a VPS).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const LABEL = "app.vaultite.server"
export type ServiceOptions = { root: string; node: string; vault: string; port?: number; host?: string; home?: string }
export type ServicePlan = { platform: "darwin" | "linux"; file: string; text: string; log: string; start: string[][]; stop: string[][] }

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** systemd unquotes "..." in ExecStart and Environment (not WorkingDirectory) and expands % specifiers. */
const unitWord = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`

/** The `node` on PATH when it's this one (Homebrew's /opt/homebrew/bin/node outlives an upgrade; its Cellar path doesn't). */
export function stableNode(exe: string, PATH = "") {
  const real = (p: string) => { try { return fs.realpathSync(p) } catch { return "" } }
  const me = real(exe)
  return PATH.split(":").map((d) => path.join(d, "node")).find((p) => path.isAbsolute(p) && real(p) === me) ?? exe
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
  if (platform !== "linux") throw new Error(`vau service runs on macOS and Linux, not ${platform}`)
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
      if (!(cmd === "launchctl" && args[0] === "bootout")) failed.push(`${[cmd, ...args].join(" ")}: ${String((e as { stderr?: Buffer }).stderr ?? e).trim().split("\n")[0]}`)
    }
  }
  return failed
}

export function installService(platform: string, o: ServiceOptions) {
  const plan = servicePlan(platform, o)
  fs.mkdirSync(path.dirname(plan.file), { recursive: true })
  fs.writeFileSync(plan.file, plan.text)
  return { ...plan, failed: run(plan.start) }
}

export function uninstallService(platform: string, o: ServiceOptions) {
  const plan = servicePlan(platform, o)
  const failed = run(plan.stop)
  fs.rmSync(plan.file, { force: true })
  if (platform === "linux") run([["systemctl", "--user", "daemon-reload"]])
  return { ...plan, failed }
}
