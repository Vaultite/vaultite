// What a QA script started that's still running: every process whose environment carries its mark (VAULTITE_QA_RUN),
// detached or not, as a desktop app's terminal and chat keepers are (they outlive the app by design).
import { spawnSync } from "node:child_process"
import fs from "node:fs"

export const MARK = "VAULTITE_QA_RUN"
export type Left = { pid: number; command: string }

/** The processes carrying `MARK=value` but this one and those it runs under. None on Windows (no one's environment
 *  can be read there cheaply). */
export function carrying(value: string): Left[] {
  const tag = `${MARK}=${value}`, out: Left[] = [], parents = new Map<number, number>()
  if (process.platform === "linux") {
    for (const n of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
      try {
        const env = fs.readFileSync(`/proc/${n}/environ`, "utf8").split("\0")
        const stat = fs.readFileSync(`/proc/${n}/stat`, "utf8"), ppid = Number(/\) \S (\d+)/.exec(stat)?.[1] ?? 0)
        parents.set(Number(n), ppid)
        if (env.includes(tag)) out.push({ pid: Number(n), command: fs.readFileSync(`/proc/${n}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ") })
      } catch { /* gone, or not ours */ }
    }
  } else if (process.platform === "darwin") {
    // (-E: each one's environment after its command, as electron/devinstance.ts' ownedBy reads it)
    const ps = (args: string[]) => spawnSync("ps", ["-A", "-ww", ...args], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout ?? ""
    const names = new Map(ps(["-o", "pid=", "-o", "comm="]).split("\n").flatMap((l) => { const m = /^\s*(\d+)\s(.*)$/.exec(l); return m ? [[Number(m[1]), m[2]] as const] : [] }))
    for (const l of ps(["-E", "-o", "pid=", "-o", "ppid=", "-o", "command="]).split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(l)
      if (!m) continue
      parents.set(Number(m[1]), Number(m[2]))
      const at = m[3].indexOf(tag)
      if (at >= 0 && [" ", undefined].includes(m[3][at + tag.length])) out.push({ pid: Number(m[1]), command: names.get(Number(m[1])) ?? "?" })
    }
  }
  const mine = new Set<number>()
  for (let p = process.pid; p > 1 && !mine.has(p); p = parents.get(p) ?? 0) mine.add(p)
  return out.filter((x) => !mine.has(x.pid))
}

/** Ends them: asked first, then killed what's still there after `ms`. */
export async function endAll(left: Left[], ms = 2000) {
  for (const x of left) { try { process.kill(x.pid, "SIGTERM") } catch { /* gone */ } }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  for (const end = Date.now() + ms; left.some((x) => alive(x.pid)) && Date.now() < end;) await new Promise((r) => setTimeout(r, 100))
  for (const x of left) { try { process.kill(x.pid, "SIGKILL") } catch { /* gone */ } }
}
