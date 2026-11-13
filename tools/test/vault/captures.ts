import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { request, socket } from "../fakes.ts"

export default async ($: VaultTest) => {
  // (the companion acting: its own tool call, not any agent's vau)
  const { asItsTool } = await import("../../../plugins/core/companion/chat.ts")
  const { VAULT, api, app, check } = $
  // Region capture: what a Talk key's words ask of it, the box and its moves, and where a clip goes (companion.capture).
  const C = await import("../../../core/desktop/clips.ts")
  {
    const cmd = (t: string, rec = false) => { const c = C.captureCommand(t, rec); return c ? `${c.do}|${c.rest}` : "" }
    check("capture: record this (and its ways of saying it) starts one, the rest of their words kept as narration",
      cmd("Record this.") === "record|" && cmd("okay, record this, the sidebar flickers when I close it") === "record|the sidebar flickers when I close it" &&
      cmd("start recording") === "record|" && cmd("can you record that") === "record|" && cmd("watch this") === "record|", [cmd("Record this."), cmd("okay, record this, the sidebar flickers when I close it")])
    check("capture: that, just now (and what just happened) takes the last seconds",
      cmd("That, just now.") === "replay|" && cmd("that just now, the toast flashed") === "replay|the toast flashed" && cmd("what just happened") === "replay|" && cmd("did you see that?") === "replay|")
    check("capture: an ask that only mentions recording is an ask", cmd("how do I record my screen?") === "" && cmd("records from last week") === "" && cmd("thatch roof") === "")
    check("capture: recording, stop ends it and anything else is narration (no command)",
      cmd("stop", true) === "stop|" && cmd("Stop recording.", true) === "stop|" && cmd("okay that's it", true) === "stop|" && cmd("it blinks here", true) === "" && cmd("record this", true) === "")
    const d = { x: 0, y: 0, width: 1440, height: 900 }
    check("capture: a drag makes a box from its corners, kept on its display; a small one is a slip",
      JSON.stringify(C.boxOf({ x: 300, y: 200 }, { x: 100, y: 50 }, d)) === '{"x":100,"y":50,"width":200,"height":150}' &&
      JSON.stringify(C.boxOf({ x: 1400, y: 800 }, { x: 1600, y: 1000 }, d)) === '{"x":1400,"y":800,"width":40,"height":100}' && C.boxOf({ x: 10, y: 10 }, { x: 20, y: 200 }, d) === null)
    const r = (x: number) => ({ x, y: 0, width: 100, height: 100 })
    let boxes = C.boxMoved([], r(0), 1000, 0)
    boxes = C.boxMoved(boxes, r(10), 1050, 0)
    boxes = C.boxMoved(boxes, r(20), 1200, 0)
    check("capture: a box dragged keeps a move a tenth of a second at most, the latest place in each",
      boxes.length === 2 && boxes[0].t === 1000 && boxes[0].rect.x === 10 && boxes[1].rect.x === 20, boxes)
    const since = C.boxesSince([{ t: 0, rect: r(0) }, { t: 500, rect: r(5) }, { t: 900, rect: r(9) }, { t: 2000, rect: r(20) }], 600, 1500)
    check("capture: a clip's crop is the box in place as it began, then each move till it ended",
      since.map((b) => `${b.t}:${b.rect.x}`).join() === "600:5,900:9", since)
    check("capture: their words by time, and a capture named by them (else what it shows)",
      C.narrationLines([{ t: 3200, text: " it blinks here " }, { t: 0, text: "" }]).join() === "[3.2 s] it blinks here" &&
      C.captureTitle([{ t: 0, text: "the sidebar flickers: when I close it?" }], "x") === "The sidebar flickers when I close it" && C.captureTitle([], "Lighthouse - Site") === "Lighthouse - Site" &&
      C.clock(64_500) === "1:04")
  }

  // The screen's timeline: kept for its last seconds and bounded, read by a time range or from when they said something.
  {
    const T = await import("../../../core/desktop/screentimeline.ts")
    const now = 100_000
    const h: Any[] = [{ t: 50_000, kind: "app", app: "a", name: "Old" }, { t: 60_000, kind: "pointer", x: 0, y: 0 }, { t: 75_000, kind: "said", text: "Record this, it blinks here" },
      { t: 80_000, kind: "pointer", x: 1, y: 1 }, { t: 80_100, kind: "pointer", x: 2, y: 2 }, { t: 80_400, kind: "pointer", x: 3, y: 3 }, { t: 85_000, kind: "click", x: 5, y: 5, under: 'Safari: button "Close"' },
      { t: 90_000, kind: "said", text: "Blinks again" }]
    const k = T.kept(h, now)
    check("timeline: what's kept is the last 30 s, what was done (the app in front) for minutes", k[0].kind === "app" && k[0].t === 50_000 && k.length === 7 && !k.some((e: Any) => e.t === 60_000), k)
    const acts = T.kept([{ t: now - 400_000, kind: "app", app: "z", name: "Z" }, { t: now - 200_000, kind: "pointer", x: 0, y: 0 }, { t: now - 200_000, kind: "click", x: 0, y: 0 }, { t: now - 100_000, kind: "key", key: "cmd+s" }] as Any[], now)
    check("timeline: clicks, keys and fields kept for five minutes, the pointer not; the app before them stamped as they begin",
      acts.length === 3 && acts[0].kind === "app" && acts[0].t === now - T.ACTS_MS && acts[1].kind === "click" && acts[2].kind === "key", acts)
    check("timeline: a stretch of only what was done reaches its minutes, the app in front as it began first", (T.rangeOf(acts, { last: 250, kinds: ["click", "key"] }, now) as Any).from === now - 250_000 &&
      (T.rangeOf(acts, { last: 250 }, now) as Any).from === now - T.KEEP_MS && T.within(k, { from: 75_000, to: now }, ["app", "said"])[0].kind === "app" && T.within(k, { from: 75_000, to: now }, ["app", "said"])[0].t === 75_000)
    const big = Array.from({ length: T.MOST + 100 }, (_, i) => ({ t: now - 1000 + i / 10, kind: "pointer", x: i, y: 0 })) as Any[]
    check("timeline: however busy, it keeps at most its bound", T.kept(big, now).length === T.MOST)
    const said = T.rangeOf(k, { said: "it blinks" }, now) as Any, last = T.rangeOf(k, { last: 20 }, now) as Any, none = T.rangeOf(k, { said: "toast" }, now) as Any
    check("timeline: a stretch from when they said some words, the last seconds, or why there's none",
      said.from === 75_000 && said.to === now && last.from === 80_000 && /nothing said like "toast"/.test(none.why), [said, last, none])
    const w = T.within(k, { from: 75_000, to: now })
    check("timeline: a stretch's events, the pointer a point a quarter second at most, only the kinds asked",
      w.filter((e: Any) => e.kind === "pointer").length === 2 && T.within(k, { from: 0, to: now }, ["click", "said"]).length === 3, w)
    check("timeline: as lines, each by its time in the stretch",
      T.timelineLines(T.within(k, said, ["click", "said"]), said.from).join("|") === '[0.0 s] said "Record this, it blinks here"|[10.0 s] clicked at 5,5: Safari: button "Close"|[15.0 s] said "Blinks again"')
  }

  // The timeline off (the user's default) when they ask for what needs it: never a dead end. The app's own words get a
  // card and a line offering to turn it on (a click or a spoken yes); an agent asking is told to offer the same.
  {
    const T = await import("../../../core/desktop/screentimeline.ts")
    check("timeline: off, an agent asking is told to offer to turn it on (vau screen keep), and that it keeps only from then",
      /offer to turn it on .*vau screen keep.*never what came before/.test(T.offWhy(T.OFF_WHY)) && T.offWhy("nothing said like \"x\"") === "nothing said like \"x\"", T.offWhy(T.OFF_WHY))
    const O = await import("../../../electron/timelineoffer.ts")
    const said: string[] = [], offered: string[] = []
    let answer: (how: Any) => void = () => {}, on = 0
    O.offerHost({ offer: (id, line) => { offered.push(`${id} ${line}`); return new Promise((done) => { answer = done }) }, answer: (_id, how) => answer(how),
      say: (text) => void said.push(text), turnOn: async () => { on++ } })
    const tick = () => new Promise((r) => setTimeout(r, 0))
    let ended = O.offerTimeline("replay")
    check("timeline offer: \"that, just now\" with it off says so in one line, on a card with its yes",
      offered.length === 1 && /nothing to send\. Turn it on\?$/.test(offered[0]) && said.length === 1 && said[0].split(/[.?] /).length <= 2 && O.offerScene()?.needs === "replay", [offered, said])
    check("timeline offer: a word that isn't yes or no moves on from it, and goes on as an ask", O.offerHeard("what's this button") === false && await ended === "asked" && !on && !O.offerScene())
    ended = O.offerTimeline("skill")
    check("timeline offer: a spoken yes is its answer, not an ask", O.offerHeard("yes please") === true && await ended === "yes")
    await tick()
    check("timeline offer: yes turns it on and says what you just did wasn't kept", on === 1 && /It's on from now\. What you just did wasn't kept/.test(said.at(-1)!), said)
    ended = O.offerTimeline("replay")
    O.offerHeard("no thanks")
    check("timeline offer: no leaves it off, saying nothing more", await ended === "no" && on === 1 && !/It's on/.test(said.at(-1)!))
    const kept = () => { try { return JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins/companion/data.json"), "utf8")).timeline } catch { return undefined } }
    const [s1, b1] = await api("POST", "ops/screen.keep", {})
    const was = kept()
    const [s2] = await api("POST", "ops/screen.keep", { off: true })
    check("screen keep: on (their yes) writes the companion's setting, saying it keeps from now only; --off turns it off",
      s1 === 200 && was === true && /from now.*wasn't kept/.test(String((b1 as Any).said)) && s2 === 200 && kept() === false, [s1, b1, was, s2, kept()])
  }

  const K = await import("../../../plugins/core/companion/captures.ts")
  {
    const job = (id: string, where: Any, state = "working", at = Date.now()): Any => ({ id, title: id, state, where: { machine: "", cwd: "", repo: "", ...where }, at, log: [] })
    const jobs = [job("old", { preview: "http://localhost:5173" }, "done", Date.now() - 7 * 3600_000), job("pv", { preview: "http://localhost:5173" }, "ready for review"),
      job("live", { preview: "http://localhost:5173" }), job("dir", { cwd: "/p/site", repo: "site" }), job("far", { machine: "m1", cwd: "/m/site", repo: "site" }, "done"),
      job("stopped", { preview: "http://localhost:4000" }, "stopped")]
    check("capture: it goes to the job previewing that address (a live one before one done), never one stopped or long done",
      K.jobFor(jobs, { url: "http://localhost:5173/about" })?.id === "live" && K.jobFor(jobs.filter((j) => j.id !== "live"), { url: "http://localhost:5173/" })?.id === "pv" &&
      !K.jobFor(jobs, { url: "http://localhost:4000/" }) && !K.jobFor(jobs.slice(0, 1), { url: "http://localhost:5173/" }))
    const f = (cwd: string, from: Any, repo = "") => ({ cwd, why: "", from, repo })
    const noPreview = jobs.filter((j) => !j.where.preview)
    check("capture: else the job in the folder a preview, an editor or a GitHub page there leads to (its repo, on another machine); never by the vault",
      K.jobFor(noPreview, { found: f("/p/site", "editor", "site") })?.id === "dir" && K.jobFor([jobs[4]], { found: f("/elsewhere/site", "github", "site") })?.id === "far" &&
      !K.jobFor([job("v", { cwd: VAULT })], { found: f(VAULT, "note") }))
    const text = K.captureText({ kind: "recording", clip: "", ms: 4200, width: 800, height: 600, frames: [], narration: [{ t: 1200, text: "here" }], box: { x: 10, y: 20, width: 400, height: 300 }, at: 0, place: { under: "Safari: button \"Close\"" } },
      { clip: "Captures/a/clip.mp4", frames: [{ t: 0, path: "Captures/a/0.0s.png" }], note: "Captures/a.md" }, (rel) => `/v/${rel}`, true)
    check("capture: a worker is told the clip and frames where it runs, their words by time, what was under the pointer, the note",
      /recorded 4\.2 s of their screen/.test(text) && text.includes("The clip: /v/Captures/a/clip.mp4") && text.includes("0.0 s /v/Captures/a/0.0s.png") &&
      text.includes("[1.2 s] here") && text.includes('Under their pointer as it began: Safari: button "Close"') && text.includes("their vault too: Captures/a.md"), text)
  }

  // End to end: a clip the helper made, saved in the vault (nothing working on it, nothing said), told to the job previewing
  // that address, or a new job for what they said over it.
  if (process.platform !== "win32") {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "captures-")), made = path.join(tmp, "captures", "2026-11-06T20-00-00-000Z")
    fs.mkdirSync(path.join(made, "frames"), { recursive: true })
    fs.writeFileSync(path.join(made, "clip.mp4"), Buffer.from("not really a video"))
    fs.writeFileSync(path.join(made, "frames", "0.0s.png"), Buffer.from("png"))
    fs.writeFileSync(path.join(made, "frames", "1.5s.png"), Buffer.from("png"))
    const asApp = request({ host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" }, { remote: "127.0.0.1" })
    const capture = (more: Any) => ({ kind: "recording", clip: path.join(made, "clip.mp4"), ms: 3000, width: 400, height: 300, box: { x: 10, y: 10, width: 200, height: 150 }, at: new Date(2026, 10, 6, 20, 0, 0).getTime(),
      frames: [{ t: 0, file: path.join(made, "frames", "0.0s.png") }, { t: 1500, file: path.join(made, "frames", "1.5s.png") }, { t: 1530, file: path.join(made, "frames", "1.5s.png") }], narration: [], place: { app: "com.example.browser", title: "Lighthouse" }, ...more })
    let [st, b] = await api("POST", "ops/companion.capture", capture({}), asApp)
    const note = b.note && fs.existsSync(path.join(VAULT, b.note)) ? fs.readFileSync(path.join(VAULT, b.note), "utf8") : ""
    check("capture: nothing working on it and nothing said: saved in Captures, its clip, frames (one of a name) and a note embedding them",
      st === 200 && b.note === "Captures/2026-11-06 20.00.00 Lighthouse.md" && /^Saved in Captures/.test(b.said) &&
      fs.readFileSync(path.join(VAULT, "Captures/2026-11-06 20.00.00 Lighthouse/clip.mp4"), "utf8") === "not really a video" &&
      fs.existsSync(path.join(VAULT, "Captures/2026-11-06 20.00.00 Lighthouse/1.5s.png")) && /tags: \[capture\]/.test(note) &&
      note.includes("![[Captures/2026-11-06 20.00.00 Lighthouse/clip.mp4]]") && note.includes("no job was working on it"), [st, b, note])
    ;[st, b] = await api("POST", "ops/companion.capture", capture({ clip: path.join(VAULT, "ME.md") }), asApp)
    check("capture: only the helper's own captures are read (never another file)", st === 400 && /helper's own/.test(b.error), [st, b])

    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const started: Any[] = []
    // (a worker that rests, then writes down what it's told)
    cc["agent:claude"] = async (s: Any) => { started.push(s); return { command: `printf '\\033]7501;state=idle\\033\\\\'; IFS= read -r l; echo "$l" > told.txt; sleep 600`, cwd: null } }
    cc["agent-turn:claude"] = async () => null
    const cScreen = await import("../../../plugins/core/companion/screensocket.ts")
    const { matchSocket } = await import("../../../core/plugins.ts")
    const sc = socket()
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc, request(), { wild: [], query: { screen: "1" } })
    const agent = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" }, { remote: "127.0.0.1" })
    const site = path.join(tmp, "site")
    fs.mkdirSync(site)
    const { gitEnv } = await import("../../../core/gitenv.ts")
    for (const a of [["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "first"]]) execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: site, stdio: "pipe", env: gitEnv() })
    const server = spawn(process.execPath, ["-e", "const s=require('http').createServer(()=>{}).listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { cwd: site, stdio: ["ignore", "pipe", "ignore"] })
    const port = await new Promise<string>((ok) => server.stdout!.once("data", (d) => ok(String(d).trim())))
    const ids: string[] = []
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion" })
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "make the heading blue", app: "com.example.browser", title: "Site", screen: `Address and search bar: localhost:${port}/about`, sx: 10, sy: 20 })
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make the heading blue" }, agent))
      ids.push(b.id)
      const job = b
      ;[st, b] = await api("POST", "ops/companion.capture", capture({ narration: [{ t: 0, text: "it flickers" }, { t: 1800, text: "there" }], place: { app: "com.example.browser", title: "Site", url: `http://localhost:${port}/about` } }), asApp)
      const told = await waitFor(() => fs.existsSync(path.join(site, "told.txt")) && fs.readFileSync(path.join(site, "told.txt"), "utf8"), 10000, 100)
      check("capture: over the address a job previews, it's typed into that job: the clip and frames in the vault, their words by time",
        st === 200 && b.job === job.id && b.said === `Sent to ${job.title}` && !!told && told.includes(path.join(VAULT, "Captures/2026-11-06 20.00.00 It flickers/clip.mp4")) &&
        told.includes("[1.8 s] there"), [st, b, told])
      ;[st, b] = await api("POST", "ops/companion.capture", capture({ narration: [{ t: 0, text: "the toast flashes twice" }], place: { app: "com.example.notes", title: "Notes" } }), asApp)
      ids.push(b.job ?? "")
      const fresh = started.at(-1)
      check("capture: over nothing a job works on, what they said starts a new job, given the clip",
        st === 200 && b.said === "Started a job: The toast flashes twice" && /^the toast flashes twice[^]*The clip: [^]*clip\.mp4/.test(fresh?.prompt ?? ""), [st, b, fresh?.prompt])
    } finally {
      server.kill()
      for (const id of ids.filter(Boolean)) await asItsTool(() => api("POST", "ops/companion.job-stop", { id }, agent)).catch(() => {})
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      sc.emit("close")
      await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: "haiku" })
      fs.rmSync(path.join(VAULT, "Captures"), { recursive: true, force: true })
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}
