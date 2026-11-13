// QA runs on this machine, shared by every checkout and agent: each takes a slot (a file naming its pid) and waits while
// all are taken, so parallel agents' test browsers queue instead of swapping the machine into a stall.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sharedTmp } from "../core/testrun.ts"

const DIR = path.join(sharedTmp(), "vaultite-qa-slots")
/** How many at once: VAULTITE_QA_SLOTS, else one per 4 GB of memory. */
const SLOTS = Number(process.env.VAULTITE_QA_SLOTS) || Math.max(1, Math.floor(os.totalmem() / 2 ** 32))

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }
const mine = new Set<string>()
process.once("exit", () => { for (const f of mine) if (owner(f) === process.pid) fs.rmSync(f, { force: true }) })
const owner = (f: string) => { try { return Number(fs.readFileSync(f, "utf8")) } catch { return 0 } }

/** Frees a slot whose process is gone (its file renamed away first, so two waiters can't both take it). */
function reap(f: string, pid: number) {
  const away = `${f}.${process.pid}.reap`
  try { fs.renameSync(f, away) } catch { return }
  if (owner(away) === pid) fs.rmSync(away, { force: true })
  else { try { fs.linkSync(away, f) } catch { /* taken meanwhile: one over the cap until it ends */ } fs.rmSync(away, { force: true }) }
}

/** Waits for a free slot; resolves to its release (at once when VAULTITE_QA_SLOT says the caller holds one). */
export async function slot(label = path.basename(process.argv[1] ?? "qa")): Promise<() => void> {
  if (process.env.VAULTITE_QA_SLOT) return () => {}
  return take(DIR, SLOTS, label, `a QA slot (all ${SLOTS} on this machine are running; VAULTITE_QA_SLOTS)`)
}
/** The Mac's front window, one script at a time on this machine: one bringing its window forward (BaseWindow.focus) takes
 *  the pointer and focus from another's, whose hovers and peeks then end mid-check (tools/qa_scripts.ts' FRONT). */
export const front = (label: string) => take(path.join(sharedTmp(), "vaultite-qa-front"), 1, label, "the front window (another QA script brings its own forward)")

async function take(dir: string, count: number, label: string, what: string): Promise<() => void> {
  return (await within(dir, count, label, what, Infinity))!
}

const put = (f: string) => { try { fs.writeFileSync(f, String(process.pid), { flag: "wx" }); return true } catch { return false } }

export function claim(dir: string, count: number): (() => void) | null {
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    const f = path.join(dir, String(i))
    if (!put(f)) {
      const pid = owner(f)
      if (!pid || alive(pid)) continue
      reap(f, pid)
      if (!put(f)) continue
    }
    mine.add(f)
    return () => { mine.delete(f); if (owner(f) === process.pid) fs.rmSync(f, { force: true }) }
  }
  return null
}

/** A free one of `count` slots in `dir`, waited for till `deadline` (then null). */
async function within(dir: string, count: number, label: string, what: string, deadline: number): Promise<(() => void) | null> {
  let said = false
  const asked = Date.now()
  for (;;) {
    const release = claim(dir, count)
    if (release) {
      if (said) console.error(`${label}: got ${what.replace(/ \(.*$/, "")} after waiting ${((Date.now() - asked) / 1000).toFixed(0)} s`)
      return release
    }
    if (Date.now() >= deadline) return null
    if (!said) { console.error(`${label}: waiting for ${what}`); said = true }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/** Every QA slot on this machine, then a calm machine (the minute's load under half its cores), `wait` at most: what
 *  measures time can't share it, and other agents' builds and tests load it without a slot. `busy` says why not. */
export async function alone(label: string, wait = 600_000): Promise<{ release: () => void; busy?: string }> {
  const end = Date.now() + wait, held: (() => void)[] = []
  const release = () => { for (const r of held) r() }
  const lock = await within(path.join(sharedTmp(), "vaultite-qa-alone"), 1, label, "the machine (another script that measures time has it)", end)
  if (!lock) return { release, busy: `another script that measures time held the machine for ${wait / 60_000} min` }
  held.push(lock)
  for (let i = 0; i < SLOTS; i++) {
    const slot = await within(DIR, SLOTS, label, "every QA slot (to run alone)", end)
    if (!slot) return { release, busy: `other runs held QA slots for ${wait / 60_000} min` }
    held.push(slot)
  }
  const cores = os.cpus().length
  while (os.loadavg()[0] >= cores / 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 2000))
  const load = os.loadavg()[0]
  return { release, busy: load >= cores / 2 ? `the machine never calmed to measure on: load ${load.toFixed(1)} on ${cores} cores` : undefined }
}

let held: Promise<() => void> | undefined
export const hold = () => (held ??= slot())
