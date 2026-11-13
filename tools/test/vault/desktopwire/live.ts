// The QUIET helper fed its home server's messages, real and malformed: what it holds and says, as JSON.
import { isDeepStrictEqual } from "node:util"
import { done, J, out, quietHelper, ROOT, threw, tick, until } from "./quiet.ts"

const { H, home } = await quietHelper()
const L = await import(`${ROOT}/helperlive.ts`), B = await import(`${ROOT}/helperbase.ts`), A = await import(`${ROOT}/helperask.ts`)
const V = await import(`${ROOT}/helpervoice.ts`), K = await import(`${ROOT}/knockhelper.ts`), M = await import(`${ROOT}/helpermenu.ts`)
const BACKGROUND = new Set(["covered", "windows", "notch", "mics"])

const full = () => ({ agents: [...L.live.state.agents.values()], notes: [...L.live.state.notes.values()], said: L.live.state.said, jobs: L.live.state.jobs })
const state = () => {
  const s = L.live.state
  const ids = (xs: { id?: string }[] | null) => (Array.isArray(xs) ? xs.map((x) => x?.id) : xs)
  return { mode: s.mode, name: s.name, agents: [...s.agents.entries()].map(([k, a]) => `${k}:${a?.tint}:${a?.state}`), notes: [...s.notes.keys()], said: ids(s.said), jobs: ids(s.jobs),
    badge: M.badged, voice: B.prefs.voice.mode, crashes: threw() }
}
async function sent(name: string, ...messages: string[]) {
  const from = home.said.length, asked = A.screenAsked.length
  for (const m of messages) { home.send(m); await tick() }
  await tick(120)
  out[name] = { ...state(), back: home.said.slice(from).map((t) => JSON.parse(t)).filter((m) => m.t !== "riding"), screen: A.screenAsked.slice(asked).filter((a: { op: string }) => !BACKGROUND.has(a.op)) }
}
/** On a fresh socket (one that threw stays deaf, its frame half read), with a probe it surely hears after. */
async function malformed(name: string, ...messages: string[]) {
  const sockets = home.sockets()
  L.live.open(home.port)
  await until(() => home.sockets() > sockets)
  home.send(J(base))
  await tick()
  await sent(name, ...messages, J({ t: "agent", agent: { name: "Probe", tint: "gray", state: "away" } }))
}

const agent = { name: "Ada", tint: "blue", state: "watching", t: 1, seen: true, app: "com.apple.Notes", window: 7, sx: 10, sy: 20, frame: { x: 1, y: 2, width: 30, height: 40 }, box: { x: 0, y: 0, w: 1, h: 1, zoom: 1 } }
const note = { id: "n1", kind: "say", agent: "Ada", t: 5, text: "Hello", answers: { t: 4, voice: true } }
const job = { id: "j1", title: "Fix the build", state: "working", link: "Jobs/j1.md", unseen: true, at: 3, where: "here", now: "testing", took: "2m", result: "", started: 1 }
const base = { t: "state", mode: "on", name: "Ada", agents: [agent, { name: "Bo", tint: "green", state: "thinking" }], notes: [note], said: [note], voice: "auto", follows: [], riding: "" }
await sent("state", J(base))
out.full = full()
await sent("agent", J({ t: "agent", agent: { ...agent, state: "thinking", tint: "red" } }))
await sent("note", J({ t: "note", note: { ...note, id: "n2", kind: "comment" }, voice: "auto" }))
await sent("drop", J({ t: "drop", id: "n1" }))
await sent("said", J({ t: "said", said: [note, { ...note, id: "n3" }] }))
await sent("jobs", J({ t: "jobs", jobs: [job, { ...job, id: "j2", unseen: false, link: null }] }))
out.fullJobs = full()
await sent("voice", J({ t: "voice", voice: "off" }), J({ t: "hush", agent: "Ada" }))
await sent("voice-back", J({ t: "voice", voice: "always" }))
await sent("unknown", J({ t: "pin", id: "x" }), J({ t: "where" }))
await sent("inputs", J({ t: "inputs", on: true }))
await sent("find", J({ t: "find", id: "to1", text: "Save" }))
await sent("things", J({ t: "things", id: "to2" }))
await sent("open", J({ t: "open", id: "to3", url: "https://example.com" }), J({ t: "open", id: "to4", app: "Notes" }), J({ t: "open", id: "to5", path: "nowhere/at/all.txt" }))
await sent("takeover-refused", J({ t: "takeover", id: "to6", agent: "Ada", tint: "blue", step: { action: 5 }, apps: [], sites: [] }))
await sent("confirm", J({ t: "confirm", id: "to7", line: "rm -rf build", sub: "in the repo", agent: "Ada", tint: "blue" }), J({ t: "takeover-answer", yes: true }))
await sent("knocks", J({ t: "knocks", knocks: [{ id: "k1", from: "t1", who: "Ada", line: "Ready", urgency: "normal", at: 1, until: 9e12, state: "waiting" }],
  presences: [{ id: "p1", who: "Ada", tint: "blue", state: "working", since: 1, step: "testing" }] }))
out.island = JSON.parse(JSON.stringify(K.islandNow()))
const drawing = { id: "d1", agent: "Ada", tint: "blue", t: 1, caption: "There.", marks: [{ type: "ring", at: { el: "a1" }, label: "Save" }, { type: "sticky", text: "Hi" }], places: { "el:a1": { x: 1, y: 2, w: 3, h: 4 } } }
await sent("drawing", J({ t: "drawing", agent: "Ada", drawing }))
out.drawn = V.drawn
const { checkMarks } = await import("../../../../core/desktop/screenmarks.ts")
const every = checkMarks([{ type: "point", at: [1, 2], label: "Here", beat: 0, id: "p", life: "screen" }, { type: "frame", at: { pane: "t3" } }, { type: "underline", at: { find: "Save" } },
  { type: "strike", at: { ui: "tab:t3" } }, { type: "check", at: [1, 2, 3, 4] }, { type: "cross", at: { el: "a2" } }, { type: "spotlight", at: [5, 5, 10, 10] }, { type: "scroll", at: [1, 1], dir: "up" },
  { type: "num", at: [2, 2], n: 3 }, { type: "connect", from: [1, 1], to: { el: "a1" }, label: "to" }, { type: "arrow", from: [0, 0], to: [9, 9] }, { type: "write", text: "Words", size: "l", at: "top-left" },
  { type: "sticky", text: "Note", title: "T" }, { type: "list", items: ["a", "b"], numbered: true, title: "L" }, { type: "button", label: "Go", do: { ask: "Go on" } }, { type: "button", label: "C", do: { copy: "x" }, at: "centre" },
  { type: "copy", text: "npm test", label: "Run" }, { type: "open", url: "https://example.com", label: "Site" }, { type: "image", src: "Pics/Shot.png", caption: "Before", over: true, size: "s" },
  { type: "video", src: "Clips/a.mp4", sound: true, paused: true }, { type: "paper", title: "Flow", grid: true, items: [{ type: "rect", id: "a", x: 10, y: 10, w: 60, h: 30, label: "A", color: "blue" },
    { type: "ellipse", id: "b", x: 200, y: 10, w: 40, h: 40 }, { type: "arrow", from: "a", to: "b", label: "then" }, { type: "line", from: [5, 5], to: [50, 90] }, { type: "path", points: [[1, 1], [9, 9]] },
    { type: "text", x: 20, y: 120, text: "Hi", size: "s" }, { type: "chart", kind: "bar", x: 10, y: 150, w: 120, h: 60, values: [1, 2, 3], labels: ["a", "b", "c"] },
    { type: "svg", x: 200, y: 120, w: 80, h: 80, paths: [{ d: "M0 0 L10 10", color: "red", width: 2 }], viewBox: [0, 0, 10, 10] }] }])
const all = { ...drawing, id: "d2", marks: every, spoken: [{ at: 1, dur: 2 }, null], waits: true, question: "Which?", hint: "Say one", kept: "Drawings/x.excalidraw" }
await sent("drawing-every", J({ t: "drawing", agent: "Ada", drawing: all }))
out.drawnEvery = isDeepStrictEqual(V.drawn, all) || V.drawn
await sent("drawing-gone", J({ t: "drawing", agent: "Ada", drawing: null }))
out.drawnAfter = V.drawn

await malformed("bad-agents", J({ t: "state", mode: "on", name: "Ada", agents: "x", notes: [], said: [] }))
await malformed("bad-notes", J({ t: "state", mode: 3, agents: [], notes: null }))
await malformed("bad-agent", J({ t: "agent" }))
await malformed("bad-agent-name", J({ t: "agent", agent: { tint: "red" } }))
await malformed("bad-note", J({ t: "note", note: "x" }))
await malformed("bad-said", J({ t: "said", said: "x" }))
await malformed("bad-jobs", J({ t: "jobs", jobs: [5, null] }))
await malformed("bad-jobs-list", J({ t: "jobs", jobs: "x" }))
await malformed("bad-drop", J({ t: "drop", id: 5 }), J({ t: "drop" }))
await malformed("bad-json", "not json", "[1]", "5")
await malformed("bad-null", "null")
await malformed("bad-find", J({ t: "find", text: 5 }))
await malformed("bad-open", J({ t: "open", id: "to8", url: 5, app: null }))
await malformed("bad-knocks", J({ t: "knocks", knocks: "x", presences: [5] }))
out.badIsland = JSON.parse(JSON.stringify(K.islandNow()))
await malformed("bad-knock", J({ t: "knocks", knocks: [{ id: "k2" }], presences: [] }))
out.badKnock = JSON.parse(JSON.stringify(K.islandNow()))
await malformed("bad-voice", J({ t: "voice", voice: "loud" }), J({ t: "note", voice: 5 }))
await malformed("bad-drawing", J({ t: "drawing", agent: 5, drawing }), J({ t: "drawing", agent: "Bo" }))
out.badDrawn = V.drawn
await malformed("bad-drawing-marks", J({ t: "drawing", agent: "Ada", drawing: { ...drawing, marks: "x" } }))
out.badMarks = V.drawn
await malformed("bad-takeover", J({ t: "takeover", id: 5, step: { action: "click" } }), J({ t: "confirm" }), J({ t: "takeover-answer" }))

await malformed("knocks-none", J({ t: "knocks", knocks: [], presences: [] }))

/** Settings and inbox answered so: its prefs where they aren't the manifests' defaults, and its menu. */
let defaults: Map<string, string> | null = null
async function refreshed(name: string, answers: [string, unknown][]) {
  home.answers.clear()
  for (const [op, v] of answers) home.answers.set(op, JSON.stringify(v))
  const from = home.asked.length
  H.homeChanged()
  await until(() => home.asked.slice(from).includes("inbox.hold"))
  await tick(60)
  const now = Object.entries(B.prefs).map(([k, v]): [string, string] => [k, J(v)])
  defaults ??= new Map(now)
  const prefs = Object.fromEntries(now.filter(([k, v]) => v !== defaults?.get(k)).map(([k, v]) => [k, JSON.parse(v)]))
  out[name] = { prefs, menu: menu(), muted: M.mutedUntil > Date.now(), crashes: threw() }
}
function menu() {
  try { return M.menuItems().map((i: { label?: string; type?: string }) => i.label?.replace(/^Muted until .*/, "Muted until …") ?? i.type) } catch (e) { return `threw: ${e instanceof Error ? e.message : e}` }
}
const decision = { question: "Ship it?", from: "Ada", created: "2026-11-12 10:00", blocking: true }
await refreshed("settings-none", [])
await refreshed("settings", [["settings.get plugin/dictation", { keys: ["fn", "right_option"], fn: true, languages: ["en", "fr"], microphone: "auto" }],
  ["settings.get plugin/companion", { keys: ["control_option"], voice: "always", voice_provider: "elevenlabs", voice_name: "Ava", voice_speed: 1.2, sounds: false, job_news: "all",
    timeline: true, hide_from_shares: false, quiet_on_calls: false, voice_front: "pipeline", realtime_model: "gpt-x", realtime_voice: "ash", elevenlabs_voice: "v1", elevenlabs_model: "m1" }],
  ["settings.get plugin/screen", { private_apps: ["1Password", "Bank"] }],
  ["inbox.decisions", { decisions: [decision, { ...decision, question: "Later?", blocking: false }] }], ["inbox.hold", { hold: { until: "2099-01-01 10:00" } }]])
await refreshed("bad-settings", [["settings.get plugin/dictation", { keys: "fn", fn: "no", languages: 5 }], ["settings.get plugin/companion", { voice: 3, voice_speed: "fast", keys: [1, 2] }],
  ["settings.get plugin/screen", { private_apps: "Bank" }], ["inbox.decisions", { decisions: [{ blocking: true }, 5] }], ["inbox.hold", { hold: { until: 5 } }]])
await refreshed("bad-settings-null", [["settings.get plugin/dictation", null], ["settings.get plugin/companion", []], ["settings.get plugin/screen", "x"],
  ["inbox.decisions", { decisions: "x" }], ["inbox.hold", null]])

H.stopHelper()
home.close()
done()
