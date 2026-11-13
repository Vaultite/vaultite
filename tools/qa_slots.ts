// QA runs on this machine, shared by every checkout and agent: each takes a slot (a file naming its pid) in turn, waiting
// in line (a ticket file) while all are taken, so parallel agents' test browsers queue instead of swapping the machine.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sharedTmp } from "../core/testrun.ts"

/** One folder for the whole machine, whatever TMPDIR a caller has (/tmp: emptied at boot, so no pid outlives its run). */
export const MACHINE_TMP = process.platform === "win32" ? sharedTmp() : "/tmp"
const DIR = path.join(MACHINE_TMP, "vaultite-qa-slots")
/** How many at once: VAULTITE_QA_SLOTS, else one per 4 GB of memory. */
export const SLOTS = Number(process.env.VAULTITE_QA_SLOTS) || Math.max(1, Math.floor(os.totalmem() / 2 ** 32))

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return e instanceof Error && "code" in e && e.code === "EPERM" } }
const mine = new Set<string>()
process.once("exit", () => { for (const f of mine) if (owner(f) === process.pid) fs.rmSync(f, { force: true }) })
const read = (f: string) => { try { return fs.readFileSync(f, "utf8") } catch { return "" } }
const owner = (f: string) => Number.parseInt(read(f), 10) || 0

/** Frees a slot whose process is gone (its file renamed away first, so two waiters can't both take it). */
function reap(f: string, pid: number) {
  const away = `${f}.${process.pid}.reap`
  try { fs.renameSync(f, away) } catch { return }
  if (owner(away) === pid) fs.rmSync(away, { force: true })
  else { try { fs.linkSync(away, f) } catch { /* taken meanwhile: one over the cap until it ends */ } fs.rmSync(away, { force: true }) }
}

const put = (f: string, label: string) => { try { fs.writeFileSync(f, `${process.pid} ${label}`.trim(), { flag: "wx" }); return true } catch { return false } }

export function claim(dir: string, count: number, label = ""): (() => void) | null {
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    const f = path.join(dir, String(i))
    if (!put(f, label)) {
      const pid = owner(f)
      if (!pid || alive(pid)) continue
      reap(f, pid)
      if (!put(f, label)) continue
    }
    mine.add(f)
    return () => { mine.delete(f); if (owner(f) === process.pid) fs.rmSync(f, { force: true }) }
  }
  return null
}

function claimAll(dir: string, count: number, want: number, label: string): (() => void) | null {
  const got: (() => void)[] = []
  for (let i = 0; i < want; i++) {
    const r = claim(dir, count, label)
    if (!r) { for (const g of got) g(); return null }
    got.push(r)
  }
  return () => { for (const g of got) g() }
}

type Held = { label: string; ms: number }
export function holders(dir: string, count: number, now = Date.now()): Held[] {
  const out: Held[] = []
  for (let i = 0; i < count; i++) {
    const f = path.join(dir, String(i)), text = read(f), pid = Number.parseInt(text, 10)
    if (!pid || !alive(pid)) continue
    let ms = 0
    try { ms = now - fs.statSync(f).mtimeMs } catch { continue }
    out.push({ label: text.slice(String(pid).length).trim() || `pid ${pid}`, ms })
  }
  return out
}

/** What the live tickets before `name` want (ticket names sort by when they were taken). */
function ahead(line: string, name: string): number {
  let sum = 0
  for (const t of fs.readdirSync(line).sort()) {
    if (t >= name) break
    const pid = Number(t.split("-")[1])
    if (!alive(pid)) { fs.rmSync(path.join(line, t), { force: true }); continue }
    sum += Number.parseInt(read(path.join(line, t)), 10) || 1
  }
  return sum
}

const min = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`
let tickets = 0

/** `want` of the `count` slots, taken once the free ones cover it and every ticket before it; null at `deadline`. */
export async function queued(dir: string, count: number, want: number, label: string, what: string, deadline: number,
  o: { pause?: (ms: number) => Promise<void>; log?: (s: string) => void; now?: () => number } = {}): Promise<(() => void) | null> {
  const pause = o.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))), log = o.log ?? ((s: string) => console.error(s)), now = o.now ?? Date.now
  const line = `${dir}.queue`, name = `${String(Date.now()).padStart(15, "0")}-${process.pid}-${String(tickets++).padStart(6, "0")}`, ticket = path.join(line, name)
  fs.mkdirSync(line, { recursive: true })
  fs.writeFileSync(ticket, `${want} ${label}`)
  mine.add(ticket)
  const asked = now()
  let said = false
  try {
    for (;;) {
      const free = count - holders(dir, count).length
      const release = ahead(line, name) + want <= free ? claimAll(dir, count, want, label) : null
      if (release) {
        if (said) log(`${label}: got ${what.replace(/ \(.*$/, "")} after waiting ${min(now() - asked)}`)
        return release
      }
      if (now() >= deadline) return null
      if (!said) {
        const held = holders(dir, count).map((h) => `${h.label} ${min(h.ms)}`).join(", "), before = ahead(line, name)
        log(`${label}: waiting for ${what}; held by ${held || "none"}${before ? `; ${before} wanted before this one` : ""}`)
        said = true
      }
      await pause(2000)
    }
  } finally {
    mine.delete(ticket)
    fs.rmSync(ticket, { force: true })
  }
}

export async function slotTill(label: string, deadline: number): Promise<(() => void) | null> {
  if (process.env.VAULTITE_QA_SLOT) return () => {}
  return queued(DIR, SLOTS, 1, label, `a QA slot (all ${SLOTS} on this machine taken; VAULTITE_QA_SLOTS)`, deadline)
}
export const slot = async (label = path.basename(process.argv[1] ?? "qa")) => (await slotTill(label, Infinity)) ?? (() => {})
/** The Mac's front window, one script at a time on this machine: one bringing its window forward (BaseWindow.focus) takes
 *  the pointer and focus from another's, whose hovers and peeks then end mid-check (tools/qa_scripts.ts' FRONT). */
export async function front(label: string): Promise<() => void> {
  return (await queued(path.join(MACHINE_TMP, "vaultite-qa-front"), 1, 1, label, "the front window (another QA script brings its own forward)", Infinity)) ?? (() => {})
}

/** Every slot, then a calm machine (load under half its cores): what measures time can't share it, and other agents'
 *  builds load it without a slot. */
export async function alone(label: string, deadline: number): Promise<{ release: () => void; busy?: string } | null> {
  const release = await queued(DIR, SLOTS, SLOTS, label, "every QA slot (to run alone)", deadline)
  if (!release) return null
  const cores = os.cpus().length, calmBy = Math.min(deadline, Date.now() + 600_000)
  while (os.loadavg()[0] >= cores / 2 && Date.now() < calmBy) await new Promise((r) => setTimeout(r, 2000))
  const load = os.loadavg()[0]
  return { release, busy: load >= cores / 2 ? `the machine never calmed to measure on: load ${load.toFixed(1)} on ${cores} cores` : undefined }
}

let held: Promise<() => void> | undefined
export const hold = () => (held ??= slot())
