import { spawn } from "node:child_process"

export const RESTART_EXIT_MS = 15_000

const GUARD_JS = `
const [pid, ms, why] = [Number(process.argv[1]), Number(process.argv[2]), process.argv[3]]
const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
const until = Date.now() + ms
const t = setInterval(() => {
  if (!alive()) return clearInterval(t)
  if (Date.now() < until) return
  clearInterval(t)
  try { process.stderr.write("vaultite: " + why + ": the server hadn't exited " + Math.round(ms / 1000) + " s after it decided to: killed for its service manager to start it again\\n") } catch {}
  try { process.kill(pid, "SIGKILL") } catch {}
}, 200)
`

export function killUnlessExitedWithin(ms: number, why: string, pid = process.pid): number | undefined {
  try {
    const guard = spawn(process.execPath, ["-e", GUARD_JS, String(pid), String(ms), why], { detached: true, stdio: ["ignore", "ignore", "inherit"], windowsHide: true })
    guard.unref()
    return guard.pid
  } catch { return undefined }
}
