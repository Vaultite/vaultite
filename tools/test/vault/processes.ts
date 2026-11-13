import { spawnSync } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check } = $
  {
    const { atExit } = await import("../../../core/exit.ts")
    const { gitEnv } = await import("../../../core/gitenv.ts")
    const listeners = process.listenerCount("exit"), ran: number[] = []
    const offs = Array.from({ length: 20 }, (_, i) => atExit(() => ran.push(i)))
    const grew = process.listenerCount("exit") - listeners
    for (const off of offs) off()
    check("exit hooks: any number share the process's one exit listener", grew === 0, grew)
    const ROOT = path.resolve(import.meta.dirname, "../../..")
    const own = spawnSync("git", ["grep", "-nE", "process\\.(on|once)\\??\\.?\\(\\s*[\"']exit", "--", "core", "plugins", "electron", "server.ts", "bin"], { cwd: ROOT, encoding: "utf8", env: gitEnv() }).stdout
      .split("\n").filter((l) => l && !l.startsWith("core/exit.ts:") && !l.startsWith("electron/shell/"))
    check("exit hooks: the app's code goes through core/exit.ts (Node warns past 10 listeners)", !own.length, own)
  }
  // A shell kept running (core/keptshell.ts), how Windows' process table is read: one PowerShell answering each read,
  // as starting one per read took 20 s on an Arm machine. Here the platform's own shell stands in.
  const { keptShell } = await import("../../../core/keptshell.ts")
  const win = process.platform === "win32"
  // (module autoload off, the one module these use imported: its first command took 22 s on CI's Arm runner, core/plugins.ts)
  const PS = "$PSModuleAutoLoadingPreference = 'None'; Import-Module Microsoft.PowerShell.Utility"
  const kept = () => win ? keptShell("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { echo: (m) => `'${m}'`, first: PS, idle: 400 })
    : keptShell("sh", [], { echo: (m) => `echo '${m}'`, idle: 400 })
  const pid = win ? "$PID" : "echo $$", hang = win ? "Start-Sleep 30" : "sleep 30"
  const sh = kept()
  const [a, b] = await Promise.all([sh.ask(pid, 30_000), sh.ask(win ? "'one'; 'two'" : "echo one; echo two", 30_000)])
  const c = await sh.ask(pid, 30_000)
  check("kept shell: scripts asked together answer in turn, each its own output, from one shell", /^\d+$/.test(a?.trim() ?? "") && b?.trim().split(/\r?\n/).join() === "one,two" && c?.trim() === a?.trim(), [a, b, c])
  const t0 = Date.now(), stuck = await sh.ask(hang, 500), after = await sh.ask(pid, 30_000)
  check("kept shell: a script that doesn't finish in time is null, the shell ended and the next one started", stuck === null && Date.now() - t0 < 25_000 &&
    /^\d+$/.test(after?.trim() ?? "") && after?.trim() !== a?.trim(), [stuck, after, a])
  await $.sleep(700)
  const again = await sh.ask(pid, 30_000)
  check("kept shell: unasked a while, it ends; asked again, it starts again", /^\d+$/.test(again?.trim() ?? "") && again?.trim() !== after?.trim(), [after, again])
  sh.close()
  // Starting isn't a script's time: a shell's first line can take seconds (PowerShell's module autoload: 22 s on Arm).
  const slow = win ? "Start-Sleep -Milliseconds 1500" : "sleep 1.5"
  const late = win ? keptShell("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { echo: (m) => `'${m}'`, first: `${PS}; ${slow}` })
    : keptShell("sh", [], { echo: (m) => `echo '${m}'`, first: slow })
  const lateAnswer = await late.ask(pid, 1000)
  check("kept shell: a script's timeout counts from when the shell is up, not through a slow start", /^\d+$/.test(lateAnswer?.trim() ?? ""), lateAnswer)
  late.close()
  const stuckUp = win ? keptShell("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { echo: (m) => `'${m}'`, first: `${PS}; Start-Sleep 30`, start: 2000 })
    : keptShell("sh", [], { echo: (m) => `echo '${m}'`, first: "sleep 30", start: 2000 })
  const t1 = Date.now(), never = await stuckUp.ask(pid, 30_000)
  check("kept shell: one that doesn't come up within its start bound is ended, its ask null", never === null && Date.now() - t1 < 10_000, [never, Date.now() - t1])
  stuckUp.close()
  // A process that asked once and has nothing else to do ends: the shell kept doesn't hold it.
  const mod = JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, "../../../core/keptshell.ts")).href)
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { keptShell } from ${mod}
const sh = ${win ? `keptShell("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { echo: (m) => "'" + m + "'" })` : `keptShell("sh", [], { echo: (m) => "echo '" + m + "'" })`}
console.log((await sh.ask(${JSON.stringify(win ? "'asked'" : "echo asked")}, 30000)).trim())`], { encoding: "utf8", timeout: 60_000 })
  check("kept shell: a process done with it ends, the shell left running doesn't hold it", r.status === 0 && r.stdout.trim() === "asked", [r.status, r.stdout, r.stderr?.slice(0, 300)])

  // The process table: this process in it, with its parent and command line.
  const { processTable } = await import("../../../core/plugins.ts")
  const me = (await processTable(0)).get(process.pid)
  check("processes: this one is in the table, its parent and command", !!me && me.ppid === process.ppid && me.args.includes("test_vault"), me)
}
