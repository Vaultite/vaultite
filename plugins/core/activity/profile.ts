// A CPU profile of this server taken while it runs (`vau profile`): where its time goes with the real vault and real use,
// without a restart. Kept on this machine (LOCAL/profiles, the last few); Chrome's DevTools opens one (Performance).
import fs from "node:fs"
import path from "node:path"
import { Session } from "node:inspector/promises"
import { HTTPError, LOCAL, localDate, ROOT } from "../../../core/plugins.ts"

type Frame = { functionName: string; url: string; lineNumber: number }
type Node = { id: number; callFrame: Frame; children?: number[] }
type CpuProfile = { nodes: Node[]; samples: number[]; timeDeltas: number[] }
/** A function and the main thread's ms in it: in its own code (`self`) and with what it called (`total`). */
export type Hot = { fn: string; at: string; self: number; total: number }
export type Profiled = { file: string; seconds: number; busy: number; hot: Hot[] }

const DIR = path.join(LOCAL, "profiles"), KEEP = 10
const IDLE = new Set(["(idle)", "(root)", "(program)"])
let taking = false

/** Profile the server for `seconds`; the `top` functions by own time. */
export async function profile(seconds: number, top: number): Promise<Profiled> {
  if (taking) throw new HTTPError(409, "a profile is being taken already")
  taking = true
  const session = new Session()
  let cpu: CpuProfile
  try {
    session.connect()
    await session.post("Profiler.enable")
    await session.post("Profiler.setSamplingInterval", { interval: 500 }) // µs
    await session.post("Profiler.start")
    await new Promise((r) => setTimeout(r, seconds * 1000))
    cpu = (await session.post("Profiler.stop")).profile as CpuProfile
  } finally {
    session.disconnect()
    taking = false
  }
  fs.mkdirSync(DIR, { recursive: true })
  const now = Date.now()
  const file = path.join(DIR, `${localDate(now)} ${new Date(now).toTimeString().slice(0, 8).replace(/:/g, "")}.cpuprofile`)
  fs.writeFileSync(file, JSON.stringify(cpu))
  for (const old of fs.readdirSync(DIR).filter((f) => f.endsWith(".cpuprofile")).sort().slice(0, -KEEP)) fs.rmSync(path.join(DIR, old), { force: true })
  return { file, seconds, ...summary(cpu, top) }
}

/** Each function's own and total time (a recursive one counted once per sample), the busiest first. */
export function summary(cpu: CpuProfile, top: number) {
  const byId = new Map(cpu.nodes.map((n) => [n.id, n]))
  const parent = new Map<number, number>()
  for (const n of cpu.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const own = new Map<number, number>()
  cpu.samples.forEach((id, i) => own.set(id, (own.get(id) ?? 0) + (cpu.timeDeltas[i] ?? 0)))
  const root = ROOT.endsWith("/") ? ROOT : ROOT + "/"
  const keyOf = (f: Frame) => `${f.functionName || "(anonymous)"}\0${f.url.replace(/^file:\/\//, "").replace(root, "")}${f.url ? `:${f.lineNumber + 1}` : ""}`
  const self = new Map<string, number>(), total = new Map<string, number>()
  let busy = 0
  for (const [id, us] of own) {
    const k = keyOf(byId.get(id)!.callFrame)
    if (IDLE.has(k.split("\0")[0])) continue
    busy += us
    self.set(k, (self.get(k) ?? 0) + us)
    const seen = new Set<string>()
    for (let x: number | undefined = id; x !== undefined; x = parent.get(x)) {
      const kk = keyOf(byId.get(x)!.callFrame)
      if (seen.has(kk) || IDLE.has(kk.split("\0")[0])) continue
      seen.add(kk)
      total.set(kk, (total.get(kk) ?? 0) + us)
    }
  }
  const ms = (us: number) => Math.round(us / 100) / 10
  const hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([k, us]) => { const [fn, at] = k.split("\0"); return { fn, at, self: ms(us), total: ms(total.get(k) ?? us) } })
  return { busy: ms(busy), hot }
}
