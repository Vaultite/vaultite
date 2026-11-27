import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const KEEP_RUNS_DAYS = 14
export const KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST = 3 * 1024 ** 3
export const PRUNE_EVERY_MS = 15 * 60_000

export const frameHash = (bitmap: Buffer) => crypto.createHash("sha256").update(bitmap).digest("base64")

export const READ_ONLY_STEPS = new Set(["evaluate", "snapshot", "read", "pdf"])
export const LOOK_AGAIN_ON_A_READ_ONLY_STEP_MS = 60_000

const RECENT_FRAMES_MATCHED_PAST_A_BLINKING_CARET = 4
type Looked = { page: string; at: number }
const keptFramesByTab = new Map<number, { run: string; frames: { hash: string; shot: string }[]; looked?: Looked }>()
export function repeatOf(tab: number, run: string, hash: string) {
  const was = keptFramesByTab.get(tab)
  return was?.run === run ? was.frames.find((f) => f.hash === hash)?.shot ?? null : null
}
export function keptFrame(tab: number, run: string, hash: string, shot: string) {
  const was = keptFramesByTab.get(tab), same = was?.run === run
  keptFramesByTab.set(tab, { run, frames: [{ hash, shot }, ...(same ? was.frames : [])].slice(0, RECENT_FRAMES_MATCHED_PAST_A_BLINKING_CARET), looked: same ? was.looked : undefined })
}
export function looksNow(tab: number, run: string, action: string, page: string, now: number) {
  const was = keptFramesByTab.get(tab), same = was?.run === run, last = same ? was.looked : undefined
  if (READ_ONLY_STEPS.has(action) && last && last.page === page && now - last.at < LOOK_AGAIN_ON_A_READ_ONLY_STEP_MS) return false
  keptFramesByTab.set(tab, { run, frames: same ? was.frames : [], looked: { page, at: now } })
  return true
}
export const forgetFrames = (tab: number) => { keptFramesByTab.delete(tab) }
const forgetRun = (run: string) => { for (const [tab, f] of keptFramesByTab) if (f.run === run) keptFramesByTab.delete(tab) }

export type Picture = { shot: string; bytes: number }
export type RunOnDisk = { name: string; bytes: number; at: number; pictures: Picture[] }

export function runsToPruneKeepingLatest(runs: RunOnDisk[], now: number, keepDays = KEEP_RUNS_DAYS, keepBytes = KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST) {
  const old = now - keepDays * 86400_000
  const dated = (r: RunOnDisk) => { const day = Date.parse(r.name.slice(0, 10)); return !Number.isFinite(day) || day >= old }
  const gone = runs.flatMap((r) => dated(r) ? [] : [r.name])
  let total = 0
  for (const [i, r] of runs.filter(dated).sort((a, b) => b.at - a.at).entries()) {
    total += r.bytes
    if (i > 0 && total > keepBytes) gone.push(r.name)
  }
  return gone
}

export function oldestPicturesOverTheCap(run: RunOnDisk, keepBytes = KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST) {
  let over = run.bytes - keepBytes
  const gone: string[] = []
  for (const p of [...run.pictures].sort((a, b) => a.shot.localeCompare(b.shot, "en", { numeric: true }))) {
    if (over <= 0) break
    gone.push(p.shot)
    over -= p.bytes
  }
  return gone
}

async function sizeOf(dir: string): Promise<RunOnDisk | null> {
  const files = await fs.promises.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => null)
  if (!files) return null
  let bytes = 0, at = 0
  const pictures = new Map<string, number>()
  for (const f of files) {
    if (!f.isFile()) continue
    const st = await fs.promises.stat(path.join(f.parentPath, f.name)).catch(() => null)
    if (!st) continue
    bytes += st.size
    at = Math.max(at, st.mtimeMs)
    if (f.name.endsWith(".jpg")) pictures.set(f.name, (pictures.get(f.name) ?? 0) + st.size)
  }
  return { name: path.basename(dir), bytes, at, pictures: [...pictures].map(([shot, n]) => ({ shot, bytes: n })) }
}

export async function pruneRuns(root: string, now = Date.now(), keepDays = KEEP_RUNS_DAYS, keepBytes = KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST) {
  const names = await fs.promises.readdir(root).catch(() => Array<string>())
  const runs: RunOnDisk[] = []
  for (const n of names) {
    const r = await sizeOf(path.join(root, n))
    if (r) runs.push(r)
  }
  const gone = runsToPruneKeepingLatest(runs, now, keepDays, keepBytes)
  for (const n of gone) {
    forgetRun(n)
    await fs.promises.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {})
  }
  const left = runs.filter((r) => !gone.includes(r.name))
  const trimmed: string[] = []
  for (const r of left) {
    const shots = oldestPicturesOverTheCap(r, keepBytes)
    if (shots.length) forgetRun(r.name)
    for (const s of shots) {
      for (const f of [path.join(root, r.name, s), path.join(root, r.name, "thumbs", s)]) await fs.promises.rm(f, { force: true }).catch(() => {})
      trimmed.push(`${r.name}/${s}`)
    }
  }
  return { gone, trimmed }
}
