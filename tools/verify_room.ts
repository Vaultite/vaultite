// Verify's tests queue on a machine every checkout shares: a slot (qa_slots.ts' kind), then free memory, per stage.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sharedTmp } from "../core/testrun.ts"
import { claim } from "./qa_slots.ts"

const GB = 2 ** 30
export const ROOM = {
  dir: path.join(sharedTmp(), "vaultite-verify-slots"),
  slots: Number(process.env.VAULTITE_VERIFY_SLOTS) || Math.max(1, Math.floor(os.totalmem() / (8 * GB))),
  floor: (Number(process.env.VAULTITE_VERIFY_FREE_GB) || 4) * GB,
  waitMs: (Number(process.env.VAULTITE_VERIFY_WAIT) || 360) * 1000,
}

/** macOS' free pages, and those it gives back at once (os.freemem counts only the first). */
export function vmStatFree(text: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1])
  const n = ["free", "inactive", "speculative"].reduce((sum, k) => sum + Number(new RegExp(`^Pages ${k}:\\s+(\\d+)`, "m").exec(text)?.[1]), 0)
  return page && Number.isFinite(n) ? n * page : null
}

export function available(): number | null {
  if (process.platform === "darwin") return vmStatFree(spawnSync("vm_stat", { encoding: "utf8" }).stdout ?? "")
  if (process.platform !== "linux") return os.freemem()
  const kb = /^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync("/proc/meminfo", "utf8"))?.[1]
  return kb ? Number(kb) * 1024 : os.freemem()
}

export type Room = { release: () => void; busy?: undefined } | { busy: string; release?: undefined }
type Deps = typeof ROOM & { free: () => number | null; now: () => number; pause: (ms: number) => Promise<void>; log: (s: string) => void }
const gb = (n: number) => (n / GB).toFixed(1)

export async function room(label: string, o: Partial<Deps> = {}): Promise<Room> {
  const d: Deps = { ...ROOM, free: available, now: Date.now, pause: (ms) => new Promise<void>((r) => setTimeout(r, ms)), log: (s) => console.error(s), ...o }
  const asked = d.now()
  let release: (() => void) | null = null, said = ""
  for (;;) {
    release ??= claim(d.dir, d.slots)
    const free = release ? d.free() : null, waited = ((d.now() - asked) / 1000).toFixed(0)
    if (release && (free === null || free >= d.floor)) {
      if (said) d.log(`${label}: room after waiting ${waited} s`)
      return { release }
    }
    const want = free === null ? { kind: "slot", what: `a verify slot (all ${d.slots} on this machine are running tests; VAULTITE_VERIFY_SLOTS)` }
      : { kind: "memory", what: `${gb(d.floor)} GB of free memory (${gb(free)} GB now; VAULTITE_VERIFY_FREE_GB)` }
    if (d.now() - asked >= d.waitMs) {
      release?.()
      return { busy: `no room on this machine in ${waited} s: still waiting for ${want.what.replace(/ \(.*$/, "")}` }
    }
    if (said !== want.kind) { d.log(`${label}: waiting for ${want.what}`); said = want.kind }
    await d.pause(2000)
  }
}
