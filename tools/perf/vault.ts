// A made-up, seeded vault for benchmarks: examples/vault plus generated people, notes, logs and books (no one real).
// node tools/perf/vault.ts <dir> [scale]    scale 1 ~ 300 Markdown files, 10 ~ 3000; the folder is replaced
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

const ROOT = path.join(import.meta.dirname, "..", "..")

let seed = 42
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

const FIRST = ["Alice", "Sam", "Maya", "Leo", "Iris", "Noah", "Zoe", "Omar", "Lina", "Theo", "Ruth", "Kai", "Nina", "Hugo", "Ada", "Eli"]
const LAST = ["Stone", "Lee", "Chen", "Costa", "Park", "Silva", "Novak", "Reyes", "Ito", "Berg", "Moreau", "Haddad", "Kim", "Rossi"]
// With coordinates, so the server has nothing to geocode (a real vault's people are filled in already).
const PLACES: [string, number, number][] = [["Lisbon, Portugal", 38.7078, -9.1366], ["Denver, CO", 39.7392, -104.9903],
  ["Berlin, Germany", 52.52, 13.405], ["Tokyo, Japan", 35.6762, 139.6503], ["Austin, TX", 30.2672, -97.7431],
  ["Toronto, Canada", 43.6532, -79.3832], ["Porto, Portugal", 41.1579, -8.6291]]
const RELATIONS = ["friend", "friend", "family", "mentor", "contact", "contact"]
const WORDS = ("the a small app idea launch design climbing book coffee trip project draft notes week plan review focus " +
  "sleep music study research build ship read write call garden city river light morning evening habit").split(" ")
const sentence = (n: number) => { const w = Array.from({ length: n }, () => pick(WORDS)).join(" "); return w[0].toUpperCase() + w.slice(1) + "." }
const para = (n: number) => Array.from({ length: n }, () => sentence(int(6, 16))).join(" ")
const day = (back: number) => new Date(Date.UTC(2026, 8, 29) - back * 86400000).toISOString().slice(0, 10)

function write(dir: string, rel: string, text: string) {
  const file = path.join(dir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** A port nothing listens on (the system's pick): other sessions' servers sit on the usual ones, and a benchmark that
 *  reached one of them would time the wrong server. */
export function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = net.createServer().once("error", fail).listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => ok(port))
    })
  })
}

export function makeVault(dir: string, scale = 1) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.cpSync(path.join(ROOT, "examples", "vault"), dir, { recursive: true })
  const people: string[] = []
  for (let i = 0; people.length < 25 * scale; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}${i >= FIRST.length * LAST.length / 2 ? ` ${i}` : ""}`
    if (people.includes(name) || fs.existsSync(path.join(dir, "People", `${name}.md`))) continue
    people.push(name)
    const lines = Array.from({ length: int(0, 12) }, (_, j) => `- ${day(j * int(3, 20))} · ${pick(["call", "text", "hang out", "note", "email"])} · ${sentence(int(4, 10))}`)
    const [place, lat, lon] = pick(PLACES)
    write(dir, `People/${name}.md`, `---\ntype: person\nrelation: ${pick(RELATIONS)}\nevery_days: ${pick([14, 30, 60, 90])}\n` +
      `location: ${place}\ncoordinates: [${lat}, ${lon}]\ntags: [${pick(["University", "Work", "Climbing", "Family"])}]\n---\n\n\`\`\`block-person\n\`\`\`\n\n` +
      `${para(2)}\n\n## Timeline\n\n${lines.join("\n")}\n`)
  }
  const notes: string[] = []
  for (let i = 0; i < 60 * scale; i++) {
    const title = `${sentence(int(2, 5)).slice(0, -1)} ${i}`
    notes.push(title)
    const kind = pick(["idea", "note", "note"])
    const links = Array.from({ length: int(0, 4) }, () => `[[${rand() < 0.5 ? pick(people) : pick(notes)}]]`).join(", ")
    const body = Array.from({ length: int(1, 6) }, () => `## ${sentence(3).slice(0, -1)}\n\n${para(int(2, 6))}\n\n- ${sentence(6)}\n- ${sentence(8)}`).join("\n\n")
    write(dir, `Notes/${title}.md`, `---\ntype: note\nkind: ${kind}\n${kind === "idea" ? "status: seed\n" : ""}tags: [${pick(["Product", "Journal", "Lighthouse"])}]\n` +
      `id: gen-note-${i}\ncreated: '${day(int(0, 400))} 10:00:00'\nupdated: '${day(int(0, 30))} 10:00:00'\n---\n\n${links ? links + "\n\n" : ""}${body}\n`)
  }
  const areas = ["workouts", "sleep", "nutrition", "running", "reading", "study"]
  // An areas setting of the vault's own (the default one lacks running: every such log would be a problem in /api/vault).
  write(dir, ".vaultite/plugins/logs/data.json", JSON.stringify({ areas: [
    { slug: "health", name: "Health", icon: "heart" },
    { slug: "workouts", name: "Workouts", icon: "dumbbell", parent: "health", weekly_goal: 3, blocks: ["workout"] },
    { slug: "running", name: "Running", icon: "footprints", parent: "health", weekly_goal: 2, blocks: ["workout"] },
    { slug: "sleep", name: "Sleep", icon: "moon", parent: "health" },
    { slug: "nutrition", name: "Nutrition", icon: "apple", parent: "health", track_duration: false },
    { slug: "learning", name: "Learning", icon: "graduation-cap" },
    { slug: "reading", name: "Reading", icon: "book-open", parent: "learning" },
    { slug: "study", name: "Study", icon: "notebook-pen", parent: "learning" },
  ] }, null, 2) + "\n")
  const folder: Record<string, string> = { workouts: "Workouts", sleep: "Sleep", nutrition: "Nutrition", running: "Running", reading: "Reading", study: "Study" }
  for (let i = 0; i < 150 * scale; i++) {
    const area = pick(areas), date = day(Math.floor(i / (1.5 * scale)))
    const title = area === "nutrition" ? pick(["Oats", "Rice bowl", "Salad", "Pasta"]) : area === "sleep" ? "Sleep" : `${pick(["Push", "Pull", "Legs", "Session"])} ${i}`
    const data = area === "workouts"
      ? `exercises:\n- name: Bench Press (Barbell)\n  sets:\n  - {type: normal, weight_kg: ${int(40, 90)}, reps: ${int(4, 10)}}\n  - {type: normal, weight_kg: ${int(40, 90)}, reps: ${int(4, 10)}}\nvolume_kg: ${int(800, 4000)}\nsets: 2\n`
      : area === "nutrition" ? `meal: ${pick(["Breakfast", "Lunch", "Dinner"])}\nkcal: ${int(300, 900)}\nprotein: ${int(10, 60)}\ncarbs: ${int(20, 120)}\nfat: ${int(5, 40)}\n`
      : area === "sleep" ? `start: '${date} 23:${String(int(0, 59)).padStart(2, "0")}'\nhours: ${int(5, 9)}\n` : `place: ${pick(["Home", "Park", "Library"])}\n`
    write(dir, `Logs/${folder[area]}/${date} ${title}${area === "sleep" || area === "nutrition" ? ` ${i}` : ""}.md`,
      `---\ntype: log\narea: ${area}\ndate: ${date}\nduration_min: ${int(20, 120)}\ntitle: ${title}\nsource: example\next_id: gen-${i}\n${data}---\n\n\`\`\`block-log\n\`\`\`\n\n${rand() < 0.3 ? para(2) + "\n" : ""}`)
  }
  for (let i = 0; i < 30 * scale; i++) write(dir, `Daily/${day(i)}.md`, `---\ntype: day\ndone: [Stretch]\n---\n\n${para(int(1, 3))}\n`)
  for (let i = 0; i < 5 * scale; i++) {
    write(dir, `Books/${sentence(3).slice(0, -1)} ${i}.md`, `---\ntype: book\nauthor: ${pick(FIRST)} ${pick(LAST)}\nstatus: ${pick(["reading", "want", "done"])}\n` +
      `total_pages: ${int(150, 600)}\ncurrent_page: ${int(0, 150)}\n---\n\n\`\`\`block-book\n\`\`\`\n\n${para(1)}\n`)
  }
  let rows = "date,description,amount\n" // a table, like a finance export
  for (let i = 0; i < 400 * scale; i++) rows += `${day(i % 365)},${pick(WORDS)} ${pick(WORDS)},${(rand() * 200 - 100).toFixed(2)}\n`
  write(dir, "Finance/Transactions.csv", rows)
  return { people: people.length, notes: notes.length }
}

/** Environment for a server on a made-up vault: the coding agents' plugins pointed at empty folders under `dir` (they'd
 *  read this machine's own histories, seconds of CPU in the background) and Cursor's account at nothing. */
export function isolated(dir: string): Record<string, string> {
  const at = (name: string) => { const p = path.join(dir, name); fs.mkdirSync(p, { recursive: true }); return p }
  return { CLAUDE_CONFIG_DIR: at("claude"), CODEX_HOME: at("codex"), OPENCODE_DATA_DIR: at("opencode"), OPENCODE_CACHE_DIR: at("opencode-cache"),
    CURSOR_USER_DIR: at("cursor-user"), CURSOR_CONFIG_DIR: at("cursor"), CURSOR_API_URL: "http://127.0.0.1:9" }
}

if (import.meta.main) {
  const [dir, scale] = process.argv.slice(2)
  if (!dir) { console.error("usage: node tools/perf/vault.ts <dir> [scale]"); process.exit(1) }
  const out = makeVault(path.resolve(dir), Number(scale ?? 1))
  console.log(`vault at ${dir}: ${out.people} people, ${out.notes} notes`)
}
