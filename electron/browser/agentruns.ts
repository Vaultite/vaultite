// Agents' runs for the replay view (agent.ts `record` writes them): a run's steps.jsonl only grows, so it's read once, then
// only its new lines; its pictures come as the view draws them, never with the steps (a long run's are hundreds of MB).
import { app, nativeImage } from "electron"
import { THUMB_WIDTH } from "./agent.ts"
import fs from "node:fs"
import path from "node:path"
import { handle } from "./engine.ts"
import { fresh, scanLine, SHOT, stepOf, type Scan } from "./runwire.ts"

const RUNS = () => path.join(app.getPath("userData"), "agent-runs")
/** How many runs the list has, newest first. */
const LISTED = 200
/** The activity strip's buckets, over a run's time. */
const BUCKETS = 48

const scans = new Map<string, Scan>()

/** A run's folder by its name, which can't leave the runs' folder. */
function dirOf(run: unknown) {
  const name = String(run ?? "")
  if (!/^[\w.-]+$/.test(name) || /^\.+$/.test(name)) throw new Error("no such run")
  return path.join(RUNS(), name)
}

/** One run read at a time (the list and its replay may ask at once). */
const reading = new Map<string, Promise<Scan | null>>()
function scanned(run: string): Promise<Scan | null> {
  const next = (reading.get(run) ?? Promise.resolve(null)).then(() => scan(run), () => scan(run))
  reading.set(run, next)
  void next.finally(() => { if (reading.get(run) === next) reading.delete(run) })
  return next
}

/** The run's file read on from where it was last read: only new lines (all of it again if it shrank or is new). */
async function scan(run: string): Promise<Scan | null> {
  const file = path.join(dirOf(run), "steps.jsonl")
  const st = await fs.promises.stat(file).catch(() => null)
  if (!st) { scans.delete(run); return null }
  let s = scans.get(run)
  if (s && s.size === st.size && s.mtime === st.mtimeMs) return s
  if (!s || st.size < s.size) s = fresh()
  const fh = await fs.promises.open(file, "r")
  try {
    const buf = Buffer.alloc(st.size - s.size)
    const { bytesRead } = await fh.read(buf, 0, buf.length, s.size)
    let at = 0
    for (;;) {
      const nl = buf.indexOf(10, at)
      // (a line still being written waits for its newline)
      if (nl < 0 || nl >= bytesRead) break
      const line = buf.subarray(at, nl).toString("utf8")
      const start = s.size + at
      at = nl + 1
      scanLine(s, line, start)
    }
    s.size += at
    s.mtime = st.mtimeMs
  } finally { await fh.close() }
  scans.set(run, s)
  return s
}

/** How busy a run was over its time, in buckets: steps, and failed ones. */
function activity(times: number[], start: number, end: number) {
  const steps = new Array<number>(BUCKETS).fill(0)
  const span = Math.max(1, end - start)
  for (const t of times) steps[Math.min(BUCKETS - 1, Math.floor(((t - start) / span) * BUCKETS))]++
  return steps
}
/** `n` of `list`, evenly through it, its last among them. */
const sample = <T>(list: T[], n: number) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.round(((i + 1) / n) * (list.length - 1))])

handle("agents:runs", async () => {
  const names = await fs.promises.readdir(RUNS()).catch(() => Array<string>())
  const listed = names.filter((d) => /^[\w.-]+$/.test(d)).sort().reverse().slice(0, LISTED)
  for (const k of scans.keys()) if (!listed.includes(k)) scans.delete(k)
  const all = await Promise.all(listed.map((d) => scanned(d).catch(() => null)))
  return all.flatMap((s, i) => {
    if (!s || !s.times.length) return []
    const start = s.times[0], end = s.times[s.times.length - 1]
    const fails = s.fails.length ? activity(s.fails, start, end) : []
    return [{
      run: listed[i], by: s.by, task: s.task, summary: s.summary, steps: s.times.length, start, end, title: s.title, url: s.url,
      failed: s.fails.length, hosts: [...s.hosts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([h]) => h), shots: sample(s.shots, 5),
      activity: activity(s.times, start, end), fails,
    }]
  })
})

// A run's steps from `from` on (a live run's new ones), without their pictures: `shot` names one for agents:shot.
handle("agents:run", async (_win, run, from) => {
  const name = String(run ?? "")
  const s = await scanned(name)
  if (!s) throw new Error("no such run")
  const first = Math.max(0, Math.floor(Number(from) || 0))
  if (first >= s.starts.length) return []
  const fh = await fs.promises.open(path.join(dirOf(name), "steps.jsonl"), "r")
  try {
    const buf = Buffer.alloc(s.size - s.starts[first])
    await fh.read(buf, 0, buf.length, s.starts[first])
    return buf.toString("utf8").split("\n").flatMap((l) => (l ? stepOf(l) : []))
  } finally { await fh.close() }
})

/** A step's small picture, made from its big one the first time it's asked (runs from before thumbnails were kept). */
async function thumbOf(dir: string, shot: string) {
  const small = path.join(dir, "thumbs", shot)
  const had = await fs.promises.readFile(small).catch(() => null)
  if (had) return had
  const img = nativeImage.createFromPath(path.join(dir, shot))
  if (img.isEmpty()) return null
  const jpeg = (img.getSize().width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: "good" }) : img).toJPEG(72)
  await fs.promises.mkdir(path.dirname(small), { recursive: true })
  await fs.promises.writeFile(small, jpeg).catch(() => {})
  // (made in the main process: let the rest of the app go on between pictures)
  await new Promise((r) => setImmediate(r))
  return jpeg
}

// Pictures of a run's steps by their names, as data URLs (null: none): `small`, the filmstrip's.
handle("agents:shots", async (_win, run, shots, small) => {
  const dir = dirOf(run)
  const names = (Array.isArray(shots) ? shots : []).map(String).filter((s) => SHOT.test(s)).slice(0, 60)
  const out: Record<string, string | null> = {}
  for (const n of names) {
    const jpeg = small ? await thumbOf(dir, n).catch(() => null) : await fs.promises.readFile(path.join(dir, n)).catch(() => null)
    out[n] = jpeg ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : null
  }
  return out
})

