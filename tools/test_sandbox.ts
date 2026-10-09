// The sandbox (core/sandbox.ts): the same twice a day, dated up to today, edited across the weeks before, safe about
// what it replaces, and every file, block and view reads without a problem.   node tools/test_sandbox.ts (npm test)
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const S = await import("../core/sandbox.ts")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-sandbox-test-"))
const fails: string[] = []
function check(name: string, ok: unknown, got?: unknown) {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  -> ${JSON.stringify(got)?.slice(0, 400)}`))
  if (!ok) fails.push(name)
}
/** Every file under dir: path -> hash. */
function tree(dir: string) {
  const out: Record<string, string> = {}
  for (const f of (fs.readdirSync(dir, { recursive: true }) as string[]).sort()) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isFile()) out[f] = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex")
  }
  return out
}

// ---------- making it ----------
const today = "2027-03-17" // a Wednesday, far from the sample's own day
const A = path.join(tmp, "a"), B = path.join(tmp, "b")
const made = S.makeSandbox(A, today)
S.makeSandbox(B, today)
check("sandbox: the same day makes the same files", JSON.stringify(tree(A)) === JSON.stringify(tree(B)))
check("sandbox: it writes plenty of files", made.files > 100, made.files)
const top = fs.readdirSync(A).filter((f) => !f.startsWith(".") && fs.statSync(path.join(A, f)).isDirectory())
check("sandbox: a few folders at the top, not a wall of them", top.length <= 6, top)
const t2 = tree(A)
S.makeSandbox(A, today)
check("sandbox: making it again replaces it the same way", JSON.stringify(tree(A)) === JSON.stringify(t2))

const files = Object.keys(tree(A))
const dated = files.map((f) => /(\d{4}-\d\d-\d\d)/.exec(f)?.[1]).filter(Boolean) as string[]
check("sandbox: no file is dated after today", dated.every((d) => d <= today), dated.filter((d) => d > today))
check("sandbox: last night's sleep is there", fs.existsSync(path.join(A, `Logs/Sleep/${today} Sleep.md`)))
check("sandbox: today's daily note is there", fs.existsSync(path.join(A, `Daily/${today}.md`)))
const shift = S.daysFrom(S.ANCHOR, today)
check("sandbox: a person's timeline moves with today", fs.readFileSync(path.join(A, "People/Alice Martin.md"), "utf8").includes(`- ${S.addDays("2026-09-24", shift)} · call`))
check("sandbox: a dated file name moves too", fs.existsSync(path.join(A, `Notes/${S.addDays("2026-09-30", shift)} journal.md`)))
const gymDays = files.filter((f) => f.startsWith("Logs/Workouts/")).map((f) => new Date(f.slice(14, 24) + "T00:00:00Z").getUTCDay())
check("sandbox: workouts fall on the routine's days", gymDays.length > 10 && gymDays.every((d) => [1, 3, 5].includes(d)), gymDays)
const tomorrow = path.join(tmp, "tomorrow")
S.makeSandbox(tomorrow, S.addDays(today, 1))
const y = `Logs/Sleep/${S.addDays(today, -3)} Sleep.md`
check("sandbox: a past day's files don't change the next day", fs.readFileSync(path.join(A, y), "utf8") === fs.readFileSync(path.join(tomorrow, y), "utf8"))
check("sandbox: a calendar's month moves by its middle day", S.shiftDates("month: 2026-09", 7) === "month: 2026-09" && S.shiftDates("month: 2026-09", 18) === "month: 2026-10")
check("sandbox: shiftDates leaves impossible dates alone", S.shiftDates("2026-02-30 and 2026-10-02", 1) === "2026-02-30 and 2026-10-03")
// (as of the real today: a file's edit time is never later than now)
const D = path.join(tmp, "d"), real = S.localToday()
S.makeSandbox(D, real)
const edited = Object.keys(tree(D)).filter((f) => !f.startsWith(".")).map((f) => [f, fs.statSync(path.join(D, f)).mtime] as const)
const editDays = new Set(edited.map(([, t]) => S.localToday(t)))
check("sandbox: files were edited across the weeks before, not all just now", editDays.size >= 10 && edited.every(([, t]) => t.getTime() <= Date.now()), [...editDays])
const named = edited.find(([f]) => f.startsWith("Daily/") && !f.includes(real))
check("sandbox: a dated file was edited on its day", !!named && named[0].includes(S.localToday(named[1])), named)

// The folder it replaces: only a sandbox or an empty folder.
const mine = path.join(tmp, "mine")
fs.mkdirSync(mine)
fs.writeFileSync(path.join(mine, "Important.md"), "keep me")
let refused = false
try { S.makeSandbox(mine, today) } catch { refused = true }
check("sandbox: refuses a folder that isn't a sandbox", refused && fs.readFileSync(path.join(mine, "Important.md"), "utf8") === "keep me")
refused = false
try { S.makeSandbox(S.SAMPLE, today) } catch { refused = true }
check("sandbox: refuses the sample itself", refused)
check("sandbox: has its marker", S.isSandbox(A) && fs.existsSync(path.join(A, S.MARKER)))
check("sandbox: fresh today, stale tomorrow", !S.isStale(A, today) && S.isStale(A, S.addDays(today, 1)))
const marker = JSON.parse(fs.readFileSync(path.join(A, S.MARKER), "utf8"))
fs.writeFileSync(path.join(A, S.MARKER), JSON.stringify({ ...marker, sample: "older" }))
check("sandbox: stale when made from another sample (an app update)", S.isStale(A, today))
check("sandbox: a folder that isn't one is never stale", !S.isStale(mine, today))

// ---------- the app reads it (made as of the real today: the app's views go by this machine's clock) ----------
const C = path.join(tmp, "c")
S.makeSandbox(C, S.localToday())
const cfiles = Object.keys(tree(C))
process.env.VAULTITE_VAULT = C
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_USER_DIR", "CURSOR_CONFIG_DIR"]) process.env[k] = path.join(tmp, "none", k)
const { open } = await import("../core/app.ts")
const { Text } = await import("../core/plugins.ts")
const { publicOf } = await import("../core/vault.ts")
const app = await open(C, { start: false })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
async function api(method: string, p: string, body?: unknown): Promise<[number, Any]> {
  const [route, qs] = p.split("?")
  const parts = route.split("/").filter(Boolean).map(decodeURIComponent)
  const query: Record<string, string> = qs ? Object.fromEntries(qs.split("&").map((x) => x.split("=", 2).map(decodeURIComponent) as [string, string])) : {}
  await app.syncPlugins()
  const res = await app.vault.lock(async () => { await app.vault.sync(); return app.run(method, parts, query, body ?? {}) })
  return [res.status, res.body instanceof Text ? res.body.text : publicOf(res.body)]
}
app.installPages() // what the server does on start: the plugins' pages
const [, v] = await api("GET", "vault")
check("sandbox: the app reads every file", v.problems.length === 0, v.problems)
const BUILT = ".vaultite/pages/Dashboards" // (the plugins' pages are built in: core/pages.ts)
const pages = ["Start here.md", ...fs.readdirSync(path.join(C, BUILT)).filter((f) => f.endsWith(".md")).map((f) => `${BUILT}/${f}`)]
const notes: string[] = []
for (const p of [...pages, "Notes/How this vault works.md", "People/Alice Martin.md", cfiles.find((f) => f.startsWith("Logs/Workouts/"))!]) {
  const [code, text] = await api("GET", `render?path=${encodeURIComponent(p)}`)
  if (code !== 200) notes.push(`${p}: ${code}`)
  for (const m of String(text).matchAll(/_\(([\w-]+ block: .*?)\)_/g)) notes.push(`${p}: ${m[1]}`)
}
check("sandbox: every page renders, no block option notes", !notes.length, notes)
const [, people] = await api("GET", "render?path=Start%20here.md")
check("sandbox: the tour shows who's due", /Dave Kim/.test(people), people.slice(0, 600))
const [, state] = await api("GET", "state")
check("sandbox: only its two pages are pinned (the pages plugins bring aren't)", JSON.stringify(state.pinned) === '["Start here.md","Notes/How this vault works.md"]', state.pinned)
check("sandbox: a plugin that's off brings no page", !fs.existsSync(path.join(C, BUILT, "Codex.md")) && fs.existsSync(path.join(C, BUILT, "Today.md")))
const pj = path.join(C, ".vaultite/plugins.json"), pconf = JSON.parse(fs.readFileSync(pj, "utf8"))
fs.writeFileSync(pj, JSON.stringify({ ...pconf, disabled: pconf.disabled.filter((x: string) => x !== "codex") }))
await api("GET", "vault") // the change is read
await api("GET", "vault") // and the plugins follow it
check("sandbox: turned on, it brings its page (not pinned here: pinNew)", fs.existsSync(path.join(C, BUILT, "Codex.md")) &&
  JSON.parse(fs.readFileSync(path.join(C, ".vaultite/pages.json"), "utf8")).pinned.length === 2)
const [, gym] = await api("GET", `query?q=${encodeURIComponent(JSON.stringify({ type: "log", where: "area = workouts" }))}`)
check("sandbox: the workout logs are found", gym.total > 10, gym.total)
const [, logs] = await api("GET", `query?q=${encodeURIComponent(JSON.stringify({ type: "log", view: "calendar", date: "date", month: S.addDays(S.localToday(), -15).slice(0, 7) }))}`)
check("sandbox: a calendar month has logs", logs.total > 10, logs.total)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${fails.length ? `${fails.length} failed` : "all passed"}`)
process.exit(fails.length ? 1 : 0)
