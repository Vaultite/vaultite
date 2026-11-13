// The QUIET helper on a fake screen helper: its events, real and malformed, and its answers to their readers.
import { fakeHelpers } from "./fakes.ts"
import { caught, done, J, out, quietHelper, ROOT, threw, tick, until } from "./quiet.ts"

const F = fakeHelpers()
const { home, events, close } = await quietHelper()
const B = await import(`${ROOT}/helperbase.ts`), A = await import(`${ROOT}/helperask.ts`), At = await import(`${ROOT}/helperat.ts`)
const Le = await import(`${ROOT}/helperlearn.ts`), T = await import(`${ROOT}/takeover.ts`)
const helper = Object.getOwnPropertyDescriptor(globalThis, "vaultiteHelper")?.value
const notes = { at: { x: 0, y: 0, width: 800, height: 600 } }
const window7 = { bundle: "com.apple.Notes", name: "Notes", pid: 5, window: 7, title: "Groceries", frame: notes.at, vaultite: false }
const thing = { ax: "AXButton", label: "Save", frame: { x: 10, y: 20, width: 60, height: 24 }, actions: ["AXPress"] }
let answers: { [op: string]: string[] } = {}
const snap = (x: { at?: number }) => { const { at: _, ...rest } = JSON.parse(J(x)); return rest }
const answer = (op: string, ...lines: unknown[]) => { answers[op] = lines.map((l) => (typeof l === "string" ? l : J({ id: "$id", ...Object(l) }))); F.answer("screen", answers) }

async function heard(name: string, ...lines: unknown[]) {
  const said = home.said.length, asked = A.asked.length, told = events.length
  answer("near", ...lines.map((l) => (typeof l === "string" ? l : J(l))), { ok: true, elements: [] })
  await helper.near(0, 0)
  await tick(150)
  out[name] = { said: home.said.slice(said).map((t) => JSON.parse(t)).filter((m) => m.t !== "riding"), asked: A.asked.slice(asked), events: events.slice(told),
    front: B.front, threw: threw() }
}
const fresh = () => { answers = {} }
const at = { x: 30, y: 40 }
answer("under", { ok: true, bundle: "com.apple.Notes", name: "Notes", role: "button", label: "Save", in: "Toolbar" })
out.under = await caught(At.underAt(at))
answer("under", { ok: false, vaultite: true })
out.underVaultite = await caught(At.underAt(at))
answer("under", { ok: true, bundle: 5, label: 7, role: null })
out.badUnder = await caught(At.underAt(at))
fresh()
answer("near", { ok: true, elements: [thing, { ...thing, label: "" }, 5] })
out.near = await caught(helper.near(1, 2))
answer("near", { ok: true, elements: "x" })
out.badNear = await caught(helper.near(1, 2))
answer("windows", { ok: true, windows: [{ window: 3, bundle: "com.1password.1password", name: "1Password" }, { window: 4, bundle: "com.apple.Notes", name: "Notes", layer: 0, frame: notes.at }] })
out.excluded = await caught(At.excluded())
answer("windows", { ok: true, windows: "x" })
out.badExcluded = await caught(At.excluded())
fresh()
answer("windows", { ok: true, windows: [] })
answer("under", { ok: true, bundle: "com.apple.Notes", name: "Notes", role: "button", label: "Save", in: "Toolbar" })
answer("at", window7)
answer("text", { ok: true, text: "Milk, eggs" })
answer("near", { ok: true, elements: [thing] })
out.walkPlace = await caught(At.walkPlace(at))
answer("at", { window: 0 })
out.walkNothing = await caught(At.walkPlace(at))
answer("at", { window: "7", bundle: 5 })
answer("text", { ok: true, text: 5 })
out.badWalk = await caught(At.walkPlace(at))
answer("text", { ok: true, text: "Milk, eggs" })
const pointed = await caught(At.pointedAt("Ada", at, window7, false))
out.pointedAt = Object.assign({}, pointed, { displays: undefined })

fresh()
const session = { focus: { field: true } }
answer("kept:info", { ok: true, before: "Buy", name: "Notes" })
answer("kept:insert", { ok: true })
out.kept = await caught(Le.backWhereItBegan(session, "milk"))
answer("kept:insert", { ok: false })
answer("kept:front", { ok: true })
answer("kept:paste", { ok: true })
out.keptPasted = await caught(Le.backWhereItBegan(session, "milk"))
answer("kept:info", { ok: "yes", before: 5 })
answer("kept:insert", { ok: 1 })
out.badKept = await caught(Le.backWhereItBegan(session, "milk"))

fresh()
answer("window", window7)
const ada = { name: "Ada", tint: "blue", state: "watching", app: "com.apple.Notes", window: 7 }
At.places.pointOf(ada)
await until(() => !At.places.pointOf(ada).pending)
out.placed = snap(At.places.pointOf(ada))
await heard("moved", { event: "moved", window: 7, frame: { x: 100, y: 50, width: 800, height: 600 } })
out.moved = snap(At.places.pointOf(ada))
await heard("bad-moved", { event: "moved", window: "7", frame: "x" })
out.badMoved = snap(At.places.pointOf(ada))

fresh()
answer("under", { ok: true, bundle: "com.apple.Notes", name: "Notes", role: "button", label: "Save", in: "Toolbar" })
await heard("front", { event: "front", ...window7 })
await heard("front-private", { event: "front", ...window7, bundle: "com.1password.1password", name: "1Password", window: 9 })
await heard("tap", { event: "tap", ok: false, ink: true }, { event: "tap", ok: true, ink: false })
await heard("input", { event: "input", kind: "type" }, { event: "input", kind: "click", x: 30, y: 40 }, { event: "input", kind: "esc" })
await heard("keys", { event: "key", key: "a" }, { event: "typed" }, { event: "esc" }, { event: "click", x: 5, y: 5, exchange: false }, { event: "click", x: 5, y: 5, held: true })
const replies: unknown[] = []
const host = { reply: (r: { t: string }) => replies.push(r), isPrivate: (a: { bundle: string }) => a.bundle.startsWith("com.1password"), near: async () => [], redraw: () => {} }
const step = (id: string) => ({ t: "takeover", id, agent: "Ada", tint: "blue", step: { action: "click", at: { x: 5, y: 5 } }, apps: [], sites: [] })
async function probed(id: string, ...lines: string[]) {
  F.answer("takeover", { probe: lines })
  T.takeoverHeard(step(id), host)
  await until(() => replies.length > 0, 5000)
  out[`takeover-${id}`] = replies.splice(0)
}
await probed("vaultite", J({ id: "$id", ok: true, vaultite: true, bundle: "com.x", name: "X" }))
await probed("gone", J({ id: "$id", ok: false, why: "gone" }))
await probed("private", J({ event: "busy", why: "keys" }), J({ id: "$id", ok: true, bundle: "com.1password.1password", name: "1Password" }))
await probed("malformed", "junk", J({ id: "$id", ok: 1, vaultite: 1 }))
await heard("bad-front", { event: "front" }, { event: "front", window: "7", bundle: 5, vaultite: "no" })
await heard("bad-tap", { event: "tap", ok: "no" })
await heard("bad-input", { event: "input", kind: 5 }, { event: "input", kind: "click", x: "a" })
await heard("bad-events", { event: 5 }, { event: "ink", phase: "sideways", x: 1 }, { event: "click" }, { event: "chord", name: 5, on: "yes" }, { event: "mod", code: "x" }, { event: "moved", window: "x", frame: "y" },
  { event: "follow" }, "not json", "[1]")

out.takeoverSent = F.sent("takeover").map((m) => m.op)
out.screenSent = [...new Set(F.sent("screen").flatMap((m) => (m.op === "mics" ? [] : [m.op])))].sort()
out.threw = threw()
close()
done()
