import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { request, socket } from "../fakes.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check } = $
  // QA walks: the words that start, scratch and end one, its sentences, where the pointer rested, the thing there, and
  // the project each item is in; done, one job per project (companion.walk-send).
  const W = await import("../../../core/desktop/walks.ts")
  {
    const cmd = (t: string, on = false) => { const c = W.walkCommand(t, on); return c ? `${c.do}|${c.rest}` : "" }
    check("walk: start a QA walk (and its ways of saying it, the recognizer's slips too) starts one, what follows its first item",
      cmd("Start a QA walk.") === "start|" && cmd("okay, let's do a QA walk") === "start|" && cmd("start a Q&A walk") === "start|" && cmd("QA walk, the sidebar is off") === "start|the sidebar is off" &&
      cmd("start a cue a walk") === "start|", [cmd("QA walk, the sidebar is off")])
    check("walk: a question about walks, or a walkthrough, isn't one", cmd("how does a QA walk work?") === "" && cmd("walk me through it") === "" && cmd("done") === "")
    check("walk: on, a whole sentence ends it (done), drops the last item (scratch that) or ends it sending nothing (cancel)",
      cmd("Done.", true) === "done|" && cmd("I'm done with the walk.", true) === "done|" && cmd("that's it for the walk", true) === "done|" && cmd("end the QA walk", true) === "done|" &&
      cmd("Scratch that.", true) === "scratch|" && cmd("never mind", true) === "scratch|" && cmd("scratch the last one", true) === "scratch|" && cmd("Cancel the walk.", true) === "cancel|")
    check("walk: on, words that only begin like a command are an item (done is greyed out; that's it; stop)",
      cmd("done is greyed out", true) === "" && cmd("That's it.", true) === "" && cmd("stop", true) === "" && cmd("start a QA walk", true) === "")
    const s = W.sentences("This button. It does nothing when I click it. And the toast")
    check("walk: whole sentences go, a short one joined to the next (\"This button.\" alone says nothing), the rest waits",
      JSON.stringify(s) === JSON.stringify({ done: ["This button. It does nothing when I click it."], rest: "And the toast" }) &&
      JSON.stringify(W.sentences("And the toast", true)) === JSON.stringify({ done: ["And the toast"], rest: "" }), s)
    check("walk: a command in what's heard is a sentence of its own, short or not",
      JSON.stringify(W.sentences("The sidebar flickers here. Scratch that. Done.").done) === JSON.stringify(["The sidebar flickers here.", "Scratch that.", "Done."]))
    const ps = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 500, y: 500 }, { t: 200, x: 510, y: 500 }, { t: 1500, x: 900, y: 0 }]
    check("walk: where the pointer rested longest as they spoke, not where it passed or ended",
      JSON.stringify(W.dwellAt(ps, 0, 2000)) === '{"x":509,"y":500}' && JSON.stringify(W.dwellAt(ps, 1600, 3000)) === '{"x":900,"y":0}' && W.dwellAt([], 0, 1) === null, W.dwellAt(ps, 0, 2000))
    const th = (label: string, x: number, y: number, w: number, h: number) => ({ label, frame: { x, y, width: w, height: h } })
    check("walk: the thing pointed at is the smallest named one holding the point (the button, not its toolbar)",
      W.thingAt([th("Toolbar", 0, 0, 800, 40), th("Share", 700, 5, 60, 30), th("", 705, 8, 10, 10)], { x: 710, y: 20 })?.label === "Share" && W.thingAt([th("Share", 700, 5, 60, 30)], { x: 10, y: 300 }) === null)
    const projects = [W.projectOf("Projects/Lighthouse/Lighthouse.md", "Lighthouse", { repo: "example/lighthouse", links: [{ label: "site", url: "https://lighthouse.example.com" }, { url: "https://box.example.ts.net:8451" }] }),
      W.projectOf("Projects/Vaultite.md", "Vaultite", { repo: "https://github.com/Vaultite/vaultite.git" }), W.projectOf("Projects/Idea.md", "Idea", { status: "idea" })]
    const [lh, vt] = projects as Any[]
    check("walk: a project note gives its repo, folder and sites (with a port unless it's the scheme's); one naming none is no project",
      lh.repo === "example/lighthouse" && JSON.stringify(lh.hosts) === '["lighthouse.example.com","box.example.ts.net:8451"]' && vt.repo === "Vaultite/vaultite" && projects[2] === null, projects)
    const P = projects.filter(Boolean) as Any[], of = (p: Any) => W.projectFor(p, P)?.name ?? ""
    check("walk: an item's project: its address's site, else its title's, else the app by name (Vaultite's own window, Vaultite Main), else the top of its window's text",
      of({ appName: "Safari", url: "https://www.lighthouse.example.com/about" }) === "Lighthouse" && of({ appName: "Safari", title: "Preview — box.example.ts.net:8451" }) === "Lighthouse" &&
      of({ vaultite: true, appName: "Vaultite Main" }) === "Vaultite" && of({ appName: "Vaultite Dev", app: "app.vaultite.dev" }) === "Vaultite" &&
      of({ appName: "Safari", screen: "Address and search bar: lighthouse.example.com/x" }) === "Lighthouse" && of({ appName: "Notes", title: "Shopping" }) === "" &&
      of({ appName: "Safari", url: "https://box.example.ts.net:9999/" }) === "", [of({ appName: "Safari", title: "Preview — box.example.ts.net:8451" })])
    const it = { n: 1, said: "The share button does nothing", from: 0, to: 1, at: { x: 710, y: 20 }, place: { vaultite: true, appName: "Vaultite", path: "Notes/a.md", line: 3 },
      anchor: { app: "vaultite", role: "button", label: "Share", inside: ["Toolbar"] }, frame: "Captures/w/1.png", clip: "Captures/w/1.mp4", clipMs: 4200 }
    const text = W.walkJobText("Vaultite", [it as Any], new Date(2026, 10, 6, 22, 0).getTime(), "Captures/w.md", (f) => `/v/${f}`, true)
    check("walk: a job is told the walk, then each item: their words, where, what the pointer was on, its frame and clip where it runs",
      /QA walk through Vaultite/.test(text) && text.includes('1. "The share button does nothing"') && text.includes("Where: Vaultite, the note Notes/a.md, line 3") &&
      text.includes('Pointing at: button "Share" in "Toolbar" (screen 710,20)') && text.includes("Frame: /v/Captures/w/1.png") && text.includes("Clip (4.2 s, as they said it): /v/Captures/w/1.mp4") &&
      text.includes("The whole walk is in their vault: Captures/w.md"), text)
    check("walk: its chip counts items", W.countText(1) === "1 item" && W.countText(3) === "3 items")
  }

  // The timeline names the thing pointed at as they said something.
  {
    const T = await import("../../../core/desktop/screentimeline.ts")
    check("walk: the timeline has the thing pointed at as an item was said",
      T.timelineLines([{ t: 1500, kind: "thing", x: 710, y: 20, thing: 'button "Share" in "Toolbar"' }], 0).join() === '[1.5 s] pointing at button "Share" in "Toolbar" (710,20)')
  }

  // End to end: a walk the helper sent, its items over two projects and another app: saved, and a job for each.
  if (process.platform !== "win32") {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "walks-")), made = (n: number) => { const d = path.join(tmp, "captures", `2026-11-06T22-00-0${n}-000Z`); fs.mkdirSync(path.join(d, "frames"), { recursive: true }); return d }
    const d1 = made(1), d2 = made(2)
    fs.writeFileSync(path.join(d1, "clip.mp4"), "video"); fs.writeFileSync(path.join(d1, "frames", "1.5s.png"), "png1")
    fs.writeFileSync(path.join(d2, "frame.png"), "png2")
    fs.mkdirSync(path.join(VAULT, "Projects"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "Projects/Lighthouse.md"), "---\ntype: project\nrepo: example/lighthouse\nlinks:\n- {label: site, url: 'https://lighthouse.example.com'}\n---\n")
    const site = path.join(tmp, "site")
    fs.mkdirSync(site)
    const { gitEnv } = await import("../../../core/gitenv.ts")
    for (const a of [["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "first"]]) execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: site, stdio: "pipe", env: gitEnv() })
    const server = spawn(process.execPath, ["-e", "const s=require('http').createServer(()=>{}).listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { cwd: site, stdio: ["ignore", "pipe", "ignore"] })
    const port = await new Promise<string>((ok) => server.stdout!.once("data", (d) => ok(String(d).trim())))
    const asApp = request({ host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" }, { remote: "127.0.0.1" })
    const agent = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" }, { remote: "127.0.0.1" })
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const started: Any[] = []
    cc["agent:claude"] = async (s: Any) => { started.push(s); return { command: "sleep 600", cwd: null } }
    cc["agent-turn:claude"] = async () => null
    await import("../../../plugins/core/companion/plugin.ts")
    const { matchSocket } = await import("../../../core/plugins.ts")
    const sc = socket()
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc, request(), { wild: [], query: { screen: "1" } })
    const at = new Date(2026, 10, 6, 22, 0, 0).getTime()
    const item = (said: string, place: Any, more: Any = {}) => ({ said, from: at, to: at + 2000, at: { x: 100, y: 100 }, place, ...more })
    const items = [
      item("The hero image is cut off on the right", { app: "com.example.browser", appName: "Example Browser", url: "https://lighthouse.example.com/" }, { clip: path.join(d1, "clip.mp4"), clipMs: 3000, frame: path.join(d1, "frames", "1.5s.png"),
        anchor: { app: "com.example.browser", role: "img", label: "Hero", inside: ["Main"] } }),
      item("The about link goes nowhere", { app: "com.example.browser", appName: "Example Browser", url: `http://localhost:${port}/about` }, { frame: path.join(d2, "frame.png") }),
      item("The footer says 2025", { app: "com.example.browser", appName: "Example Browser", url: "https://lighthouse.example.com/x" }),
      item("This menu takes a second to open", { app: "com.example.notes", appName: "Notes" }, { frame: path.join(VAULT, "ME.md") }),
    ]
    const ids: string[] = []
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion" })
      const [st, b] = await api("POST", "ops/companion.walk-send", { items, since: at, clips: true }, asApp)
      for (const j of b.jobs ?? []) if (j.id) ids.push(j.id)
      const note = b.note && fs.existsSync(path.join(VAULT, b.note)) ? fs.readFileSync(path.join(VAULT, b.note), "utf8") : ""
      const prompt = (label: string) => started.find((s) => String(s.prompt).includes(`QA walk through ${label}`))?.prompt ?? ""
      const lighthouse = prompt("Lighthouse"), dir = prompt(path.basename(site)), other = prompt("other apps")
      check("walk: done sends a job per project, the most said first: a project note's site, a preview's repo here, the rest",
        st === 200 && JSON.stringify((b.jobs ?? []).map((j: Any) => [j.label, j.items])) === JSON.stringify([["Lighthouse", [1, 3]], [path.basename(site), [2]], ["other apps", [4]]]) &&
        b.said === `Sent 3 jobs: Lighthouse (2), ${path.basename(site)} (1), other apps (1)`, [st, b])
      check("walk: each job is told its items, their frames and clips in the vault where it runs, renumbered",
        lighthouse.includes('1. "The hero image is cut off on the right"') && lighthouse.includes('2. "The footer says 2025"') && lighthouse.includes('Pointing at: img "Hero" in "Main"') &&
        lighthouse.includes(`Frame: ${path.join(VAULT, "Captures/2026-11-06 22.00.00 QA walk/1.png")}`) && lighthouse.includes(`${path.join(VAULT, "Captures/2026-11-06 22.00.00 QA walk/1.mp4")}`) &&
        dir.includes('1. "The about link goes nowhere"') && dir.includes("QA walk/2.png") && other.includes("This menu takes a second to open"), [lighthouse, dir, other])
      check("walk: a job about a preview runs in the repo serving it",
        started.some((s) => String(s.prompt).includes("about link") && fs.realpathSync(String(s.cwd)) === fs.realpathSync(site)), started.map((s) => Object.keys(s).join() + " " + s.cwd))
      check("walk: kept in the vault, a note by project with each item's words, what was pointed at and its frame; only the helper's own files read",
        note.includes("tags: [capture, qa-walk]") && note.includes("## Lighthouse") && note.includes('1. The hero image is cut off on the right (img "Hero" in "Main")') &&
        note.includes("![[Captures/2026-11-06 22.00.00 QA walk/1.png|360]] [[Captures/2026-11-06 22.00.00 QA walk/1.mp4|clip]]") &&
        fs.readFileSync(path.join(VAULT, "Captures/2026-11-06 22.00.00 QA walk/2.png"), "utf8") === "png2" && !fs.existsSync(path.join(VAULT, "Captures/2026-11-06 22.00.00 QA walk/4.png")), note)
      const [st2, b2] = await api("POST", "ops/companion.walk-send", { items: [{ said: " " }] }, asApp)
      check("walk: one with nothing said is refused", st2 === 400 && /nothing said/.test(b2.error), [st2, b2])
      const [st3, b3] = await api("POST", "ops/companion.walk", { do: "status" }, agent)
      check("walk: started and ended through the desktop app only (here there's none)", st3 === 409 && /desktop app/.test(b3.error), [st3, b3])
    } finally {
      server.kill()
      for (const id of ids) await api("POST", "ops/companion.job-stop", { id }, agent).catch(() => {})
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      sc.emit("close")
      await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: "haiku" })
      fs.rmSync(path.join(VAULT, "Captures"), { recursive: true, force: true })
      fs.rmSync(path.join(VAULT, "Projects/Lighthouse.md"), { force: true })
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}
