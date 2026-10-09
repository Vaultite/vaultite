// The sandbox: examples/vault with its dates moved to today plus generated daily logs, deterministic per date. Making
// it again replaces only a folder that is a sandbox (or empty), so a wrong path never wipes anything. No app modules.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The day examples/vault is written as of: its "today". */
export const ANCHOR = "2026-10-02"
/** The sample vault in the app's source. */
export const SAMPLE = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "examples", "vault")
/** The marker in a sandbox's settings. */
export const MARKER = path.join(".vaultite", "sandbox.json")

/** Files whose text is read for dates to move (others are copied as they are). */
const TEXT = /\.(md|canvas|excalidraw|csv|json|html|base|txt)$/i
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g

/** Today on this machine, YYYY-MM-DD. */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => iso(utc(s) + n * 86400000)
export const daysFrom = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000)
/** 0 Sunday ... 6 Saturday. */
const weekday = (s: string) => new Date(utc(s)).getUTCDay()

/** Every valid date in `text` moved by `days`; a database view's `month: YYYY-MM` too, as its middle day moves (so a
 *  calendar shows last month until this one is half full). */
export function shiftDates(text: string, days: number) {
  if (!days) return text
  return text.replace(DATE, (m, y, mo, d) => {
    const t = Date.UTC(+y, +mo - 1, +d)
    return iso(t) === m ? iso(t + days * 86400000) : m
  }).replace(/^(\s*month:\s*)(\d{4}-\d\d)\s*$/gm, (_m, k, ym) => k + addDays(`${ym}-15`, days).slice(0, 7))
}

/** Is `dir` safe to (re)make: missing, empty, or a sandbox made before. */
export function isSandbox(dir: string) {
  if (!fs.existsSync(dir)) return true
  if (!fs.statSync(dir).isDirectory()) return false
  return fs.readdirSync(dir).length === 0 || fs.existsSync(path.join(dir, MARKER))
}

/** A stamp of the sample's files (names and contents): an app update that changes the sample changes it. */
export function sampleStamp(source = SAMPLE) {
  const h = crypto.createHash("sha1")
  for (const rel of (fs.readdirSync(source, { recursive: true }) as string[]).sort()) {
    const p = path.join(source, rel)
    if (!fs.statSync(p).isFile() || path.basename(rel) === ".DS_Store") continue
    h.update(rel.split(path.sep).join("/") + "\0").update(fs.readFileSync(p)).update("\0")
  }
  return h.digest("hex").slice(0, 12)
}

/** Is the sandbox in `dir` from another day or another sample (so it should be made again)? False for a folder that
 *  isn't a sandbox. */
export function isStale(dir: string, today = localToday(), source = SAMPLE) {
  let m: { made?: string; sample?: string }
  try { m = JSON.parse(fs.readFileSync(path.join(dir, MARKER), "utf8")) } catch { return false }
  return m.made !== today || m.sample !== sampleStamp(source)
}

/** Make a fresh sandbox in `dir` as of `today`. Returns how many files it wrote. */
export function makeSandbox(dir: string, today = localToday(), source = SAMPLE): { files: number; today: string } {
  if (!/^\d{4}-\d\d-\d\d$/.test(today)) throw new Error(`today should be YYYY-MM-DD, not ${today}`)
  const root = path.resolve(dir)
  if (root === path.parse(root).root || root === path.resolve(source)) throw new Error(`won't make a sandbox in ${root}`)
  if (!isSandbox(root)) throw new Error(`${root} isn't empty and isn't a sandbox: pick another folder`)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  const shift = daysFrom(ANCHOR, today)
  let files = 0
  const put = (rel: string, data: string | Buffer) => {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, data)
    if (!rel.startsWith(".")) { const t = editedAt(rel, today); fs.utimesSync(p, t, t) }
    files++
  }
  for (const rel of (fs.readdirSync(source, { recursive: true }) as string[]).sort()) {
    const from = path.join(source, rel)
    if (!fs.statSync(from).isFile() || path.basename(rel) === ".DS_Store") continue
    const to = shiftDates(rel.split(path.sep).join("/"), shift)
    put(to, TEXT.test(rel) ? shiftDates(fs.readFileSync(from, "utf8"), shift) : fs.readFileSync(from))
  }
  for (const [rel, text] of daily(today)) put(rel, text)
  put(MARKER, JSON.stringify({ made: today, anchor: ANCHOR, sample: sampleStamp(source) }, null, 2) + "\n")
  return { files, today }
}

// ---------- what happens every day ----------

/** A random number generator seeded by text: the same text, the same numbers. */
function rng(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}

/** When a sample file was last edited, made up so they spread out (a calendar or "Recently edited" by `updated`): the
 *  day in its name (a daily note, a log), else one of the four weeks before today; never later than now. */
export function editedAt(rel: string, today: string): Date {
  const r = rng(rel), named = rel.match(/\d{4}-\d\d-\d\d/)?.[0]
  const day = named && named <= today ? named : localToday(new Date(new Date(`${today}T12:00`).getTime() - r.int(0, 27) * 86400000))
  return new Date(Math.min(Date.now(), new Date(`${day}T${hm(r.int(8 * 60, 22 * 60))}:00`).getTime()))
}

const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
const q = (s: string) => (/^[\w .,()-]+$/.test(s) && !/^[\d.-]|: |^(true|false|null|yes|no)$/i.test(s) ? s : `'${s.replace(/'/g, "''")}'`)

/** A log file: its frontmatter and a line of notes (its kind draws its blocks). */
function log(area: string, date: string, title: string, n: number, data: Record<string, string | number | undefined>,
  opts: { duration?: number; body?: string; yaml?: string } = {}) {
  const fm = [
    "---", "type: log", `area: ${area}`, `date: ${date}`,
    ...(opts.duration ? [`duration_min: ${opts.duration}`] : []),
    `title: ${q(title)}`, "source: sandbox", `ext_id: sandbox-${area}-${date}-${n}`,
    ...(opts.yaml ? [opts.yaml] : []),
    ...Object.entries(data).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${typeof v === "number" ? v : q(String(v))}`),
    "---", "",
  ]
  return fm.join("\n") + (opts.body ? `\n${opts.body}\n` : "")
}

type Lift = { name: string; base: number; step: number; reps: [number, number]; sets: number; bodyweight?: boolean }
const DAYS: Record<number, { title: string; lifts: Lift[] }> = {
  1: { title: "Push day", lifts: [
    { name: "Bench Press (Barbell)", base: 50, step: 1.25, reps: [5, 8], sets: 3 },
    { name: "Overhead Press (Barbell)", base: 30, step: 0.5, reps: [6, 8], sets: 3 },
    { name: "Incline Bench Press (Dumbbell)", base: 18, step: 0.5, reps: [8, 12], sets: 2 },
    { name: "Triceps Pushdown (Cable)", base: 25, step: 0.5, reps: [10, 12], sets: 2 }] },
  3: { title: "Pull day", lifts: [
    { name: "Lat Pulldown (Cable)", base: 45, step: 1, reps: [8, 10], sets: 3 },
    { name: "Seated Row (Cable)", base: 40, step: 1, reps: [10, 12], sets: 3 },
    { name: "Pull Up", base: 0, step: 0, reps: [5, 8], sets: 2, bodyweight: true },
    { name: "Bicep Curl (Dumbbell)", base: 12, step: 0.25, reps: [10, 12], sets: 2 }] },
  5: { title: "Leg day", lifts: [
    { name: "Squat (Barbell)", base: 70, step: 2.5, reps: [5, 6], sets: 3 },
    { name: "Romanian Deadlift (Barbell)", base: 60, step: 2.5, reps: [6, 8], sets: 3 },
    { name: "Leg Press (Machine)", base: 120, step: 5, reps: [10, 12], sets: 2 },
    { name: "Calf Raise (Machine)", base: 50, step: 1, reps: [12, 15], sets: 2 }] },
}
const round = (x: number, to: number) => Math.round(x / to) * to

function gym(date: string, weeksAgo: number) {
  const r = rng(`gym ${date}`)
  const day = DAYS[weekday(date)]
  let volume = 0, sets = 0
  const ex = day.lifts.map((l) => {
    const w = round(l.base + l.step * (8 - weeksAgo), 2.5)
    const lines = [l.bodyweight ? "" : `  - {type: warmup, weight_kg: ${round(w * 0.5, 2.5)}, reps: 10}`]
    for (let i = 0; i < l.sets; i++) {
      const reps = r.int(l.reps[0], l.reps[1]) - (i === l.sets - 1 && r.chance(0.3) ? 1 : 0)
      const kind = i === l.sets - 1 && r.chance(0.15) ? "failure" : "normal"
      lines.push(l.bodyweight ? `  - {type: ${kind}, reps: ${reps}}` : `  - {type: ${kind}, weight_kg: ${w}, reps: ${reps}}`)
      volume += w * reps
      sets++
    }
    return [`- name: ${l.name}`, "  sets:", ...lines.filter(Boolean)].join("\n")
  })
  const notes = ["Felt strong today.", "Short on sleep, kept it light.", "New best on the first lift.", "Gym was packed; supersetted the last two.", ""]
  return log("workouts", date, day.title, 0, { kind: "Strength", volume_kg: Math.round(volume), sets }, {
    duration: r.int(50, 70), yaml: `exercises:\n${ex.join("\n")}`, body: r.pick(notes),
  })
}

type Meal = readonly [string, number, number, number, number]
const MEALS: Record<"Breakfast" | "Lunch" | "Dinner" | "Snack", readonly Meal[]> = {
  Breakfast: [["Oatmeal with berries", 420, 16, 68, 9], ["Greek yogurt and granola", 380, 24, 48, 10], ["Eggs on toast", 450, 24, 36, 22], ["Banana smoothie", 360, 20, 58, 6]],
  Lunch: [["Chicken rice bowl", 680, 46, 72, 18], ["Lentil soup and bread", 540, 24, 80, 12], ["Turkey sandwich", 560, 34, 58, 18], ["Salmon poke bowl", 620, 38, 70, 16]],
  Dinner: [["Pasta with pesto", 720, 22, 96, 26], ["Tofu stir fry", 580, 30, 62, 22], ["Steak and potatoes", 780, 52, 54, 36], ["Fish tacos", 640, 36, 60, 24], ["Vegetable curry", 610, 18, 84, 20]],
  Snack: [["Apple and peanut butter", 280, 7, 30, 16], ["Protein bar", 230, 20, 24, 8]],
}

const PIANO = ["Hanon exercises", "Left hand arpeggios", "Gymnopédie no. 1", "Scales in G", "Sight reading", "Chord inversions"]
const DAY_NOTES = [
  "Quiet morning, good focus block before lunch.",
  "Walked to the farmers market. Picked up figs.",
  "Long day. Called it early and read instead.",
  "Lifted, then a long walk home.",
  "Rainy. Wrote most of the launch thread.",
  "Too much coffee. Bed earlier tonight.",
  "Lunch with Bob. Talked about the trip.",
  "Fixed the flaky test that blocked the release.",
]

/** [vault path, text] for every generated file, as of `today`. */
export function daily(today: string): [string, string][] {
  const out: [string, string][] = []
  for (let ago = 56; ago >= 0; ago--) {
    const date = addDays(today, -ago)
    const wd = weekday(date)
    const r = rng(`day ${date}`)
    // Sleep: the night before each day (named by the day you woke up).
    const bed = r.int(22 * 60 + 30, 23 * 60 + 50), wake = r.int(7 * 60, 8 * 60)
    const inBed = 24 * 60 - bed + wake
    out.push([`Logs/Sleep/${date} Sleep.md`, log("sleep", date, "Sleep", 0, { bed: hm(bed), wake: hm(wake), in_bed_min: inBed }, { duration: inBed - r.int(10, 40) })])
    if (ago === 0) {
      // Today so far: breakfast, and the daily note with a plan.
      const [t, kcal, protein, carbs, fat] = r.pick(MEALS.Breakfast)
      out.push([`Logs/Nutrition/${date} ${t}.md`, log("nutrition", date, t, 0, { meal: "Breakfast", kcal, protein, carbs, fat }, { body: "Estimated from a photo." })])
      out.push([`Daily/${date}.md`, "---\ntype: day\ndone: []\n---\n\nPlan: finish the launch thread draft, call [[Alice Martin]], piano after dinner.\n"])
      continue
    }
    // Workouts: lifting on Monday, Wednesday and Friday (most weeks).
    if (DAYS[wd] && !(ago > 7 && r.chance(0.12))) out.push([`Logs/Workouts/${date} ${DAYS[wd].title}.md`, gym(date, Math.floor(ago / 7))])
    // Meals: the last week.
    if (ago <= 7) {
      for (const meal of ["Breakfast", "Lunch", "Dinner", "Snack"] as const) {
        if (meal === "Snack" && r.chance(0.5)) continue
        const [t, kcal, protein, carbs, fat] = r.pick(MEALS[meal])
        out.push([`Logs/Nutrition/${date} ${t}.md`, log("nutrition", date, t, 0, { meal, kcal, protein, carbs, fat }, { body: r.chance(0.5) ? "Estimated from a photo." : "" })])
      }
    }
    // Learning: reading most days, piano on Tuesday, Thursday and Saturday.
    if (ago <= 28 && r.chance(0.7)) {
      out.push([`Logs/Reading/${date} Project Hail Mary.md`, log("reading", date, "Project Hail Mary", 0, { book_id: "Project Hail Mary", pages: r.int(12, 38) }, { duration: r.int(20, 50) })])
    }
    if ([2, 4, 6].includes(wd) && ago <= 42 && !r.chance(0.2)) {
      out.push([`Logs/Study/${date} Piano practice.md`, log("study", date, "Piano practice", 0, { subject: "Piano", focus: r.pick(PIANO) }, { duration: r.int(25, 45) })])
    }
    // Daily notes: most days of the last three weeks, with the routines ticked by hand.
    if (ago <= 21 && !r.chance(0.2)) {
      const done = ["Stretch"].filter(() => r.chance(0.7))
      out.push([`Daily/${date}.md`, `---\ntype: day\ndone: [${done.join(", ")}]\n---\n\n${r.pick(DAY_NOTES)}\n`])
    }
  }
  return out
}

