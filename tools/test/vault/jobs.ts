import { execFileSync, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, write } = $
  const J = await import("../../../plugins/core/companion/jobs.ts")
  const W = await import("../../../plugins/core/companion/where.ts")

  // The lifecycle: one table, every move logged, nothing out of stopped.
  {
    const job = (): Any => ({ id: "j1", title: "t", state: "starting", where: { machine: "", label: "M", cwd: "/r", repo: "r", agent: "claude", account: "", harness: "Claude Code", model: "", effort: "", why: "" },
      terminal: "claude-x", now: "", started: 0, turn: 0, at: 0, seen: true, log: [] })
    const run = (evs: string[]) => { const j = job(); for (const e of evs) J.step(j, e as Any, 1); return j }
    const a = run(["working", "asks", "working", "changed"]), b = run(["working", "stop", "working", "told"]), c = run(["working", "answered", "told", "changed", "stop"])
    check("jobs: the lifecycle moves by its table, each move logged (starting, working, needs you, ready for review), new once it needs the user",
      a.state === "ready for review" && a.log.map((x: Any) => x.to).join() === "working,needs you,working,ready for review" && a.seen === false && J.unseen(a), a.log)
    check("jobs: nothing moves a stopped job; a reviewed one stopped is done", b.state === "stopped" && b.log.length === 2 && c.state === "done" && c.log.at(-1).ev === "stop", [b.log, c.log])
    check("jobs: a worker that ends while it works failed; one ready for review that ends is done",
      run(["working", "ended"]).state === "failed" && run(["working", "changed", "ended"]).state === "done" && run(["ended"]).state === "failed")
    check("jobs: every state is in the table, and each one reached is one of them", J.JOB_STATES.every((s) => s in J.JOB_NEXT) &&
      Object.values(J.JOB_NEXT).every((m) => Object.values(m).every((s) => (J.JOB_STATES as readonly string[]).includes(s!))))
    check("jobs: a PR and a preview's link from the worker's last message", JSON.stringify(J.linksIn("Done. PR: https://github.com/lighthouse/site/pull/12, try http://localhost:5173/about.")) ===
      JSON.stringify({ pr: "https://github.com/lighthouse/site/pull/12", link: "http://localhost:5173/about" }) && J.linksIn("nothing", "https://m1.tail1.ts.net:8450").link === "https://m1.tail1.ts.net:8450")
  }

  // Where: the addresses on screen, Tailscale Serve's ports, the rules, another machine's name.
  {
    const urls = W.urlsIn({ title: "Site", screen: "Address and search bar: localhost:5173/about\nhttps://github.com/lighthouse/site/pull/3" }).map((u) => u.href)
    check("where: the addresses an ask's screen shows", urls.join() === "http://localhost:5173/about,https://github.com/lighthouse/site/pull/3", urls)
    const status = { Web: { "box.tail1.ts.net:8450": { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } }, "box.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000/" } } } } }
    check("where: a Tailscale Serve name's port is the local port it proxies", W.servedPort(status, "box.tail1.ts.net", "8450") === 5173 && W.servedPort(status, "box.tail1.ts.net", "") === 3000 &&
      W.servedPort(status, "box.tail1.ts.net", "9999") === 0)
    const home = "/Users/alice"
    check("where: a folder a rule names is refused with its why, others not", W.refusal("/Users/alice/Work/Acme/api", ["~/Work/Acme: Acme's work runs on its own machine"], home) === "Acme's work runs on its own machine" &&
      W.refusal("/Users/alice/Work/AcmeX", ["~/Work/Acme: no"], home) === "" && W.refusal("/Users/alice/Projects/site", ["~/Work/Acme"], home) === "")
    check("where: an address another machine serves goes to it", W.machineOfUrl({ url: "https://studio.tail1.ts.net:8450/x" }, { studio: "studio.tail1.ts.net" })?.machine === "studio" &&
      W.machineOfUrl({ url: "http://localhost:3000" }, { studio: "studio.tail1.ts.net" }) === null)
  }

  // Where on this machine: a GitHub page's checkout, a preview's process's repo, a note's vault.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-")), roots = [path.join(tmp, "Projects")], repo = path.join(roots[0], "site")
  fs.mkdirSync(repo, { recursive: true })
  const { gitEnv } = await import("../../../core/gitenv.ts")
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: repo, stdio: "pipe", env: gitEnv() }).toString()
  g("init", "-q"); g("remote", "add", "origin", "git@github.com:lighthouse/site.git"); fs.writeFileSync(path.join(repo, "index.html"), "<h1>Hi</h1>\n"); g("add", "."); g("commit", "-qm", "first")
  const real = fs.realpathSync(repo)
  {
    const gh = await W.resolveHere({ url: "https://github.com/lighthouse/site/issues/4" }, VAULT, [], roots)
    const note = await W.resolveHere({ path: "Notes/Plan.md", url: "http://localhost:1" }, VAULT, [], roots)
    check("where: a GitHub page is its checkout here; a note is the vault", fs.realpathSync(gh.cwd) === real && note.cwd === VAULT, [gh, note])
    const editor = await W.resolveHere({ app: "com.microsoft.VSCode", title: "index.html — site" }, VAULT, [], roots)
    check("where: an editor's window is its project's checkout", fs.realpathSync(editor.cwd) === real, editor)
    if (process.platform !== "win32") {
      const server = spawn(process.execPath, ["-e", "const s=require('http').createServer(()=>{}).listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { cwd: path.join(repo), stdio: ["ignore", "pipe", "ignore"] })
      const port = await new Promise<string>((ok) => server.stdout!.once("data", (d) => ok(String(d).trim())))
      try {
        const pv = await W.resolveHere({ title: "Site", screen: `Address and search bar: localhost:${port}/about` }, VAULT, [], roots)
        check("where: a preview's address is the repo its server runs in", fs.realpathSync(pv.cwd) === real && pv.preview === `http://localhost:${port}`, pv)
      } finally { server.kill() }
    }
  }

  // End to end: a handoff starts a worker in a terminal (a stand-in for Claude Code speaking OSC 7501), its job moves as
  // its terminal tells, ends ready for review with its diff; a steer types into it, a stop ends it.
  if (process.platform !== "win32") {
    const c = await import("../../../plugins/core/companion/plugin.ts")
    const { matchSocket } = await import("../../../core/plugins.ts")
    const heard: Any[] = [], sc = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send: (d: string) => heard.push(JSON.parse(d)), close() {}, ping() {}, terminate() {} })
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc as Any, {} as IncomingMessage, { wild: [], query: { screen: "1" } })
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const said: Any[] = []
    const osc = (s: string, more = "") => `printf '\\033]7501;state=${s}${more}\\033\\\\'`
    const b64 = (s: string) => Buffer.from(s).toString("base64")
    // (works, writes a file, rests; told more, works again; then asks a permission)
    const script = `sleep 0.5; ${osc("working", `:msg=${b64("Editing index.html")}`)}; sleep 1; echo '<p>blue</p>' >> index.html; ${osc("idle")}; ` +
      `IFS= read -r l; ${osc("working")}; echo "$l" > told.txt; sleep 1; ${osc("blocked", `:kind=permission:msg=${b64("Bash(rm -rf build)")}`)}; sleep 600`
    cc["agent:claude"] = async (start: Any) => { said.push(start); return { command: script, cwd: null } }
    let turn: Any = null
    cc["agent-turn:claude"] = async () => turn
    let card: Any = null
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion", jobs_agent: "claude_personal", jobs_never: [`${tmp}/Work: Work runs elsewhere`] })
      c.screenMoment({ kind: "ask", agent: "Claude", text: "make the heading blue", app: "com.example.browser", title: "Site", screen: `https://github.com/lighthouse/site`, sx: 10, sy: 20 })
      let [st, b] = await api("POST", "ops/companion.handoff", { task: "Make the heading blue", say: "On it: a session in site.", cwd: repo }, agent)
      card = b
      check("handoff: a job starting in a terminal, in the folder asked, as the jobs' account on Opus, high, auto; the companion says so",
        st === 200 && b.state === "starting" && /^view:terminal\/claude_personal-/.test(b.link) && b.where.includes("site") && b.where.includes("Personal") && b.where.includes("Claude Code Opus") &&
        said[0]?.profile === "personal" && said[0]?.model === "opus" && said[0]?.effort === "high" && said[0]?.mode === "auto" &&
        /Make the heading blue[^]*They said: "make the heading blue"[^]*don't push/.test(said[0]?.prompt ?? "") &&
        (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "On it: a session in site."), [st, b, said[0]])
      const working = await waitFor(() => heard.findLast((m) => m.t === "jobs" && m.jobs.some((j: Any) => j.id === card.id && j.state === "working")), 10000, 50)
      check("jobs: its terminal working moves it to working, what it does now from its agent", !!working && working.jobs.find((j: Any) => j.id === card.id).now === "Editing index.html", heard.at(-1))
      turn = { text: "Made the heading blue in index.html. Try http://localhost:5173.", files: [path.join(repo, "index.html")], at: Date.now(), final: true }
      const review = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: card.id }))[1]; return r.state === "ready for review" && r }, 10000, 100)
      check("jobs: its turn over with a change, it's ready for review: its diff, its link, what it said, new for the menu bar",
        !!review && review.result.diff === "1 file changed, +1 -0" && review.result.link === "http://localhost:5173" && /heading blue/.test(review.result.text) && review.seen === false &&
        review.log.map((x: Any) => x.to).join() === "working,ready for review", review)
      ;[st, b] = await api("POST", "ops/companion.jobs", {})
      check("companion jobs: its state, where, its results", st === 200 && b.jobs[0]?.id === card.id && b.jobs[0].state === "ready for review" && b.jobs[0].where.account === "Personal", b)
      sc.emit("message", Buffer.from(JSON.stringify({ t: "job-seen", ids: [card.id] })))
      check("jobs: opened from the menu bar, it's no longer new", !!(await waitFor(async () => (await api("POST", "ops/companion.job", { id: card.id }))[1].seen === true, 3000, 50)))
      turn = null
      ;[st, b] = await api("POST", "ops/companion.handoff", { task: "Use the darker blue", say: "Telling it.", job: card.id }, agent)
      const told = await waitFor(() => fs.existsSync(path.join(repo, "told.txt")) && fs.readFileSync(path.join(repo, "told.txt"), "utf8").trim(), 10000, 100)
      check("handoff --job: typed into its worker's terminal, which goes on", st === 200 && told === "Use the darker blue", [st, b, told])
      const asks = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: card.id }))[1]; return r.state === "needs you" && r }, 10000, 100)
      check("jobs: a permission it waits on is needs you, saying what", !!asks && /waits on a permission: Bash\(rm -rf build\)/.test(asks.now), asks)
      ;[st, b] = await api("POST", "ops/companion.handoff", { task: "go on", say: "Telling it.", job: card.id }, agent)
      check("handoff --job: never typed into a permission it waits on (only the user answers it)", st === 409 && /permission/.test(b.error), [st, b])
      ;[st, b] = await api("POST", "ops/companion.job-stop", { id: card.id }, agent)
      check("job-stop: stopped, its terminal ended", st === 200 && b.state === "stopped" &&
        !!(await waitFor(async () => !(await api("GET", "terminals/sessions"))[1].sessions.some((s: Any) => card.link.endsWith(s.id)), 5000, 100)), [st, b])
      fs.mkdirSync(path.join(tmp, "Work"), { recursive: true })
      ;[st, b] = await api("POST", "ops/companion.handoff", { task: "Fix it", say: "On it.", cwd: path.join(tmp, "Work") }, agent)
      check("handoff: a folder jobs never run in is refused, saying why", st === 403 && /Work runs elsewhere/.test(b.error), [st, b])
      // Do it: a task line handed over, in progress; a line that isn't an open task; one that moved; only words.
      const asApp = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" } } as unknown as IncomingMessage
      const ends: string[] = [], linkEnd = (b: Any) => { const id = String(b.link ?? "").split("/").pop()!; ends.push(id); return id }
      write("Notes/Errands.md", "# Errands\n\n- [ ] Compare the two flights 📅 2026-12-01\n- [x] Book the car\n")
      ;[st, b] = await api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 3, text: "Compare the two flights" }, asApp)
      linkEnd(b)
      check("Do it: a task line's worker is told its note and line, on Opus, and it goes in progress", st === 200 && b.state === "starting" && said.at(-1)?.model === "opus" &&
        /Notes\/Errands\.md \(line 3\): Compare the two flights/.test(said.at(-1)?.prompt ?? "") && read("Notes/Errands.md").includes("- [/] Compare the two flights 📅 2026-12-01"), [st, b, read("Notes/Errands.md")])
      ;[st, b] = await api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 4 }, asApp)
      check("Do it: a line that's no open task is refused", st === 404, [st, b])
      // Two tapped at once (two devices): one worker. And of two lines alike, the one tapped.
      write("Notes/Errands.md", "# Errands\n\n- [ ] Tap twice\n")
      const both = await Promise.all([api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 3, text: "Tap twice" }, asApp), api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 3, text: "Tap twice" }, asApp)])
      both.forEach(([, r]: Any) => { if (r?.link) linkEnd(r) })
      check("Do it: two at once on a line start one worker", both.filter(([s]: Any) => s === 200).length === 1 && read("Notes/Errands.md").includes("- [/] Tap twice"), [both.map(([s]: Any) => s), read("Notes/Errands.md")])
      write("Notes/Errands.md", "# Errands\n\n- [ ] Twin\n- [ ] Twin\n")
      ;[st, b] = await api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 4, text: "Twin" }, asApp)
      linkEnd(b)
      check("Do it: of two lines alike, the one tapped goes in progress", st === 200 && read("Notes/Errands.md").endsWith("- [ ] Twin\n- [/] Twin\n"), [st, read("Notes/Errands.md")])
      write("Notes/Errands.md", "# Moved down\n\n\n- [ ] Call Lighthouse\n")
      ;[st, b] = await api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 2, text: "Call Lighthouse" }, asApp)
      linkEnd(b)
      check("Do it: a line that moved is found by its words", st === 200 && read("Notes/Errands.md").includes("- [/] Call Lighthouse"), [st, b])
      ;[st, b] = await api("POST", "ops/companion.do", { text: "Tidy the trip note" }, asApp)
      linkEnd(b)
      check("Do it: only words is a job too", st === 200 && /Tidy the trip note/.test(said.at(-1)?.prompt ?? ""), [st, b])
      for (const id of ends) await api("DELETE", `terminals/${id}`).catch(() => {})
      ;[st, b] = await api("POST", "ops/inbox.add", { title: "Tidy the trip note", do: "Tidy the trip note", from: "Dream" })
      check("inbox add --do: the item keeps its task", st === 200 && /^do: Tidy the trip note$/m.test(read(b.path)), [st, b])
      const [, tm] = await api("POST", "ops/companion.timings", {})
      check("companion timings: a job's time to its card and its first step", tm.jobs?.some((r: Any) => r.title === "Make the heading blue" && r.card >= 0 && r.step > 0), tm.jobs)
    } finally {
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      sc.emit("close")
      await api("POST", "ops/companion.next", { timeout: 0 })
      await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: "haiku", jobs_agent: "claude", jobs_never: [] })
      if (card?.link) await api("DELETE", `terminals/${card.link.split("/").pop()}`).catch(() => {})
    }
  }

  // Another machine's job: where and its worker asked of that machine's companion, its terminal started and ended there.
  {
    const http = await import("node:http")
    const calls: Any[] = []
    let stage = "working"
    const server = http.createServer((req, res) => {
      let body = ""
      req.on("data", (d) => (body += d))
      req.on("end", () => {
        const op = req.url!.replace("/api/ops/", ""), p = body ? JSON.parse(body) : {}
        calls.push({ op, p, client: req.headers["x-vaultite-client"] })
        const out: Any = op === "companion.where" ? { cwd: "/home/alice/Projects/site", repo: "site", base: "abc123", why: "as asked", refused: "" }
          : op === "terminal.start" ? { id: "claude-remote1" }
          : op === "companion.worker" ? (stage === "working" ? { running: true, state: "working", title: "✳ Editing the header" }
            : { running: true, state: "idle", ...(p.turn ? { turn: { text: "Header done. Try https://studio.tail1.ts.net:8450", files: ["/home/alice/Projects/site/a.ts"], at: Date.now(), final: true }, diff: "1 file changed, +2 -1" } : {}) })
          : op === "terminal.end" ? { id: "claude-remote1" } : {}
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out))
      })
    }).listen(0, "127.0.0.1")
    await new Promise((r) => server.once("listening", r))
    const url = `http://127.0.0.1:${(server.address() as Any).port}`
    const ms = app.plugins.find((p) => p.id === "machines")!.services, wasM = { ...ms }
    const studio = { id: "studio", label: "Studio", url, online: true, self: false, plugins: ["terminal", "companion"] }
    ms["machines"] = async () => [studio]
    ms["machines:machine"] = async (id: string) => (id === "studio" ? studio : null)
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    let job: Any = null
    try {
      let [st, b] = await api("POST", "ops/companion.handoff", { task: "Fix the header", say: "On it, on the studio.", machine: "studio", cwd: "~/Projects/site" }, agent)
      job = b
      const start = calls.find((c) => c.op === "terminal.start")
      check("handoff on another machine: its where asked there, its terminal started there in that folder, the card says so",
        st === 200 && b.link === "view:terminal/claude-remote1@studio" && b.where.startsWith("Studio, site") && calls[0]?.op === "companion.where" && calls[0].client?.startsWith("machine/") &&
        start?.p.cwd === "/home/alice/Projects/site" && /Fix the header/.test(start?.p.prompt ?? ""), [st, b, calls])
      const working = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job.id }))[1]; return r.state === "working" && r }, 10000, 200)
      check("jobs on another machine: read from its worker there", !!working && working.now === "Editing the header", working)
      stage = "idle"
      const review = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job.id }))[1]; return r.state === "ready for review" && r }, 15000, 300)
      check("jobs on another machine: its turn's end there, with the diff counted there and its preview link", !!review && review.result.diff === "1 file changed, +2 -1" &&
        review.result.link === "https://studio.tail1.ts.net:8450" && calls.some((c) => c.op === "companion.worker" && c.p.turn && c.p.base === "abc123"), review)
      ;[st, b] = await api("POST", "ops/companion.job-stop", { id: job.id }, agent)
      check("job-stop on another machine: its terminal ended there; reviewed, it's done", st === 200 && b.state === "done" && calls.some((c) => c.op === "terminal.end" && c.p.id === "claude-remote1"), [st, b, calls.at(-1)])
    } finally {
      Object.assign(ms, wasM)
      server.close()
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}
