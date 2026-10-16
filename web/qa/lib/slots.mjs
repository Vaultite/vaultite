// QA runs on this machine, shared by every checkout and agent: each takes a slot (a file naming its pid) and waits while
// all are taken, so parallel agents' test browsers queue instead of swapping the machine into a stall.
// VAULTITE_QA_SLOTS sets how many (default: one per 4 GB of memory); VAULTITE_QA_SLOT set means the caller holds one.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const DIR = path.join(os.tmpdir(), "vaultite-qa-slots")
export const SLOTS = Number(process.env.VAULTITE_QA_SLOTS) || Math.max(1, Math.floor(os.totalmem() / 2 ** 32))

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } }
const mine = new Set()
process.once("exit", () => { for (const f of mine) if (owner(f) === process.pid) fs.rmSync(f, { force: true }) })
const owner = (f) => { try { return Number(fs.readFileSync(f, "utf8")) } catch { return 0 } }

/** Frees a slot whose process is gone (its file renamed away first, so two waiters can't both take it). */
function reap(f, pid) {
  const away = `${f}.${process.pid}.reap`
  try { fs.renameSync(f, away) } catch { return }
  if (owner(away) === pid) fs.rmSync(away, { force: true })
  else { try { fs.linkSync(away, f) } catch { /* taken meanwhile: one over the cap until it ends */ } fs.rmSync(away, { force: true }) }
}

/** Waits for a free slot; resolves to its release. */
export async function slot(label = path.basename(process.argv[1] ?? "qa")) {
  if (process.env.VAULTITE_QA_SLOT) return () => {}
  fs.mkdirSync(DIR, { recursive: true })
  let said = false
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const f = path.join(DIR, String(i))
      try { fs.writeFileSync(f, String(process.pid), { flag: "wx" }) } catch {
        const pid = owner(f)
        if (pid && !alive(pid)) reap(f, pid)
        continue
      }
      mine.add(f)
      return () => { mine.delete(f); if (owner(f) === process.pid) fs.rmSync(f, { force: true }) }
    }
    if (!said) { console.error(`${label}: waiting for a QA slot (all ${SLOTS} on this machine are running; VAULTITE_QA_SLOTS)`); said = true }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

let held
/** One slot for this whole process, held to its exit. */
export const hold = () => (held ??= slot())
