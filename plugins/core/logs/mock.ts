// Made-up logs for plugin previews (Plugins → a plugin), in the vault's real areas (configuration, not personal data),
// so every page that shows logs renders its real layout.
import { addDays, today, type Store } from "@vaultite"
import type { Log } from "./types"

export function mockLogs(real: Store): Partial<Store> {
  const t = today()
  const d = (n: number) => addDays(t, -n)
  const areas = new Set(real.areas.map((a) => a.slug))
  let id = 1
  const logs: Log[] = []
  const log = (area: string, date: string, title: string, data: Record<string, unknown> = {}, duration_min: number | null = null, notes = "") => {
    if (areas.has(area)) logs.push({ id: `Logs/mock/${id++}`, area, date, title, data, duration_min, notes, source: "mock", ext_id: null })
  }
  for (const n of [1, 3, 5, 8, 10]) {
    log("workouts", d(n), n % 2 ? "Push day" : "Pull day", {
      kind: "Strength",
      exercises: [
        { name: "Bench Press (Barbell)", sets: [{ type: "warmup", reps: 10 }, { type: "normal", weight_kg: 50, reps: 8 }, { type: "normal", weight_kg: 52.5, reps: 6 }] },
        { name: "Lat Pulldown (Cable)", sets: [{ type: "normal", weight_kg: 45, reps: 10 }, { type: "failure", weight_kg: 45, reps: 9 }] },
      ],
    }, 60)
  }
  for (const n of [2, 6, 9]) log("workouts", d(n), "Bouldering", { kind: "Climbing", place: "Bouldering gym", top_grade: n === 2 ? "V4" : "V3" }, 90)
  for (let n = 0; n < 10; n++) log("sleep", d(n), "Sleep", { bed: n % 3 ? "22:40" : "23:25", wake: "07:40", in_bed_min: n % 3 ? 540 : 495 }, n % 3 ? 540 : 495)
  log("nutrition", t, "Oatmeal with berries", { meal: "Breakfast", kcal: 420, protein: 18, carbs: 64, fat: 9 })
  log("nutrition", t, "Chicken rice bowl", { meal: "Lunch", kcal: 680, protein: 46, carbs: 72, fat: 18 })
  for (const n of [0, 2, 4]) log("study", d(n), "Piano practice", { subject: "Piano", focus: "Scales in G" }, 30)
  log("study", d(1), "Spanish lesson", { subject: "Spanish", focus: "Past tense" }, 45)
  log("study", d(4), "Drawing class", { subject: "Drawing", focus: "Pears on a plate" }, 60)
  log("work", d(0), "Talked with Bob about the roadmap", { kind: "conversation", person: "Bob" })
  log("work", d(1), "Looked into slow page loads", { kind: "investigation", topic: "Performance" })
  log("work", d(2), "Weekly demo video", { kind: "idea", status: "planned" })
  return { areas: real.areas, logs }
}
