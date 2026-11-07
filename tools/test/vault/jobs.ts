import { execFileSync, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  // (the companion acting: its own tool call, not any agent's vau)
  const { asItsTool } = await import("../../../plugins/core/companion/plugin.ts")
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
    check("jobs: one that landed its own change is done, ready for review or still working",
      run(["working", "changed", "landed"]).state === "done" && run(["working", "landed"]).state === "done")
    const said = ["A job's proof is now a video, and it's pushed to main as 98b7fcde.", "It's on main as `08f5dfd`; the M1 picks it up.", "All three are done.\n\n- **Merged:** `c09009af feat: x` is on main.",
      "Landed on main as c09009af. Now cleanup.", "Both fixes are on main as ff4071ef: CI passed."]
    const unsaid = ["Committed as a8ef2daa on branch job-x, but **not pushed**: waiting for your Keep and merge.", "Once it's on main, the M1 picks it up.", "I didn't push to main.",
      "The M1 takes it from main.", "Made the heading blue. Try http://localhost:5173."]
    check("jobs: a worker's words saying it landed its change on main, never ones that only might", said.every(J.landedSaid) && !unsaid.some(J.landedSaid), [said.filter((t) => !J.landedSaid(t)), unsaid.filter(J.landedSaid)])
    check("jobs: the commits a message names", J.commitsIn("pushed as 7493dcf6 (`c09009afa67159e`), see #12345678 and abcdefgh, deadbeef").join() === "7493dcf6,c09009afa67159e", J.commitsIn("pushed as 7493dcf6 (`c09009afa67159e`), see #12345678 and abcdefgh, deadbeef"))
    const E = (text: boolean, final: boolean, changes: boolean, crashed: boolean) => J.endEvent({ text, final, changes, crashed })
    check("jobs: a terminal ending after its worker left an answer is done (with changes, ready for review), mid-turn too unless it crashed; with nothing, failed",
      E(true, false, false, false) === "answered" && E(true, true, true, true) === "changed" && E(false, false, true, false) === "changed" &&
      E(true, false, false, true) === "ended" && E(false, false, false, false) === "ended")
    check("jobs: every state is in the table, and each one reached is one of them", J.JOB_STATES.every((s) => s in J.JOB_NEXT) &&
      Object.values(J.JOB_NEXT).every((m) => Object.values(m).every((s) => (J.JOB_STATES as readonly string[]).includes(s!))))
    check("jobs: its news in a line said aloud: needs you, ready for review, done, failed; a reviewed job done isn't news again",
      J.jobSpoken({ title: "Make the header blue on the about page please", state: "ready for review" }, "working") === 'The job "Make the header blue" is ready for review.' &&
      J.jobSpoken({ title: "x", state: "needs you" }, "working") === 'The job "x" needs you.' && J.jobSpoken({ title: "", state: "failed" }, "working") === "A job failed." &&
      J.jobSpoken({ title: "x", state: "done" }, "ready for review") === "" && J.jobSpoken({ title: "x", state: "working" }, "starting") === "")
    check("jobs: notifications by job_news: needing you or failed, quiet or spoken, none when off; one ready or done knocks instead (its proof)",
      J.jobTold("needs you", "quiet") && J.jobTold("failed", "quiet") && !J.jobTold("done", "quiet") && !J.jobTold("ready for review", "quiet") &&
      !J.jobTold("done", "spoken") && !J.jobTold("ready for review", "spoken") && J.jobTold("failed", "spoken") && !J.jobTold("needs you", "off") && !J.jobTold("working", "spoken"))
    {
      const { jobNews } = await import("../../../electron/helperlogic.ts")
      const j = (state: string) => ({ id: "a", title: "x", state, link: null, unseen: true, at: 0 })
      check("jobs: the menu bar's notifications follow job_news",
        jobNews([j("working")], [j("done")], "quiet").length === 0 && jobNews([j("working")], [j("done")], "spoken").length === 0 &&
        jobNews([j("working")], [j("needs you")], "quiet").length === 1 && jobNews([j("working")], [j("failed")], "off").length === 0)
      const { jobNote } = await import("../../../electron/helperlogic.ts")
      const trust = { ...j("needs you"), waits: { question: "Trust this folder?", choices: ["Yes, I trust this folder", "No, exit"] } }
      const imports = { ...trust, waits: { question: "Allow external CLAUDE.md imports?", choices: ["Yes, allow external imports", "No, disable external imports"] } }
      check("jobs: a job waiting on a prompt is told with its question and its choices as buttons; another prompt after it is told again",
        jobNote(trust).body === "x\nTrust this folder?" && jobNote(trust).choices.join() === "Yes, I trust this folder,No, exit" && jobNote(j("done")).choices.length === 0 &&
        jobNews([trust], [imports], "quiet").length === 1 && jobNews([trust], [trust], "quiet").length === 0, jobNote(trust))
      const perm = { kind: "permission" as const, choices: ["Yes, I trust this folder", "No, exit"] }, q = { kind: "question" as const, choices: ["Local cert", "Let's Encrypt (Recommended)"] }
      check("jobs: a choice is named by its number, its words or their start, or yes and no for a permission",
        J.choiceIn(perm, "1") === 1 && J.choiceIn(perm, "No, exit") === 2 && J.choiceIn(perm, "yes") === 1 && J.choiceIn(perm, "No.") === 2 && J.choiceIn(perm, "Yes, I trust") === 1 &&
        J.choiceIn(perm, "maybe") === 0 && J.choiceIn(perm, "3") === 0 && J.choiceIn(q, "let's encrypt") === 2 && J.choiceIn(q, "yes") === 0)
    }
    {
      const site = { cwd: "/Users/alice/Projects/site", repo: "site", base: "0123456789abcdef", label: "M1", ...J.worktreeOf("/Users/alice/Projects/site", "site", "j3k9x2a") }
      const jt = J.jobTask("Fix the footer", undefined, site, "j3k9x2a")
      check("jobs: a worker is told to show its change working: a demo video recorded on its own copy, its befores, stills of the Mac's UI, by its job's id, in its report",
        jt.includes('vau companion tour-save "') && jt.includes("--job j3k9x2a") && jt.includes("--record <your own copy's address>") && /never their live app/.test(jt) &&
        jt.includes("(before: ") && jt.includes("(after: <png>)") && jt.includes("vau inbox report ... --video") && !J.jobTask("x", undefined, site).includes("tour-save"))
      const live = J.jobTask("Fix the footer", undefined, { ...site, live: true }, "j3k9x2a"), note = J.jobTask("Tidy my note", undefined, { ...site, repo: "", tree: undefined, branch: undefined })
      check("jobs: every coding job works in its own worktree and branch beside its checkout, made at the commit asked, its packages installed there; never the checkout",
        site.tree === "/Users/alice/Projects/site-j3k9x2a" && site.branch === "job-j3k9x2a" &&
        jt.includes("git -C /Users/alice/Projects/site worktree add /Users/alice/Projects/site-j3k9x2a -b job-j3k9x2a 0123456789ab") && /never in \/Users\/alice\/Projects\/site itself/.test(jt) &&
        /install them there/.test(jt) && /Keep and merge lands it/.test(jt) && /running server's own checkout/.test(live) && !/worktree/.test(note) && !/They asked over/.test(jt), jt)
      const moved = J.jobTask("Fix the footer", undefined, { ...site, moved: "the preview http://localhost:5173 on M4" }, "j3k9x2a")
      check("jobs: one moved to another machine works in its worktree there too, previewed there", /worktree add/.test(moved) && /fetch that commit first/.test(moved) && /They asked over the preview http:\/\/localhost:5173 on M4\. You run on M1/.test(moved), moved)
      const land = J.landTask(site), liveLand = J.landTask({ ...site, live: true }), old = J.landTask({ cwd: "/r" })
      check("jobs: Keep and merge lands it from its worktree (pushed to main, nothing merged in the checkout), then removes the worktree and its branch; one line",
        /merge it now, from your worktree \/Users\/alice\/Projects\/site-j3k9x2a \(branch job-j3k9x2a\), as this repo's own rules say/.test(land) && /git push origin HEAD:main/.test(land) &&
        land.includes("git -C /Users/alice/Projects/site worktree remove /Users/alice/Projects/site-j3k9x2a, and branch -D job-j3k9x2a") && /Never switch or edit \/Users\/alice\/Projects\/site:/.test(land) && !land.includes("\n") &&
        /nothing lands there/.test(liveLand) && /the server takes main itself/.test(liveLand) && /don't merge/.test(liveLand) && !/worktree/.test(old) && /^They watched your change and kept it: merge it now, as this repo's own rules say/.test(old), land)
      const first = J.lastOf({ text: "Fixed it. The links \"Why now?\" stay.\n\nShould I also change the header? Or keep it as is?", at: 5, final: true, prompt: jt })
      const told = J.lastOf({ text: "Looking at it.", at: 9, final: false, prompt: "Use the **darker** blue", background: 2 })
      check("jobs: its latest turn: what it said, the questions its answer ends with (quotes left out), what it was told after its task, its background tasks",
        first.text.startsWith("Fixed it.") && JSON.stringify(first.asks) === JSON.stringify(["Should I also change the header?", "Or keep it as is?"]) && first.told === undefined &&
        told.told === "Use the darker blue" && told.asks === undefined && told.background === 2, [first, told])
      const j = { title: "Fix the footer", turn: 10_000, now: "starting", last: { text: "Checking the footer at phone width. Then the header.", at: 20_000 } }
      check("jobs: what it does now is what it waits on, else what it said last this turn, else its status (not its own title)",
        J.nowOf(j, {}) === "Checking the footer at phone width." && J.nowOf(j, { kind: "question", msg: "Which blue?" }) === "waits on an answer: Which blue?" &&
        J.nowOf({ ...j, turn: 30_000 }, { title: "✳ Fix the footer" }) === "starting" && J.nowOf({ ...j, turn: 30_000 }, { title: "✳ Editing a.ts" }) === "Editing a.ts")
      check("jobs: its conversation resumes in its account's terminal", J.resumeOf({ session: "s-123", where: { agent: "claude_agent" } as Any }) === "resume-claude_agent-s-123" &&
        J.resumeOf({ where: { agent: "claude" } as Any }) === "")
    }
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
    const mac = (id: string, o: Any = {}): Any => ({ id, label: id.toUpperCase(), url: `https://${id}.tail1.ts.net`, online: true, self: false, plugins: ["terminal", "companion"], vault: "v1", ...o })
    const ms = [mac("lap", { self: true }), mac("box", { standalone: true, vault: "v2" }), mac("old", { standalone: true, plugins: ["terminal"] }), mac("m1", { standalone: true }), mac("pc", { standalone: true })]
    const pick = (want: string, here = false, all = ms) => W.preferredMachine(all, want, "v1", here)
    check("where: jobs prefer the first always-on machine online with this vault and a companion; none when this one is always on, or set to here",
      pick("auto").machine?.id === "m1" && pick("").machine?.id === "m1" && pick("auto", true).machine === null && pick("here").machine === null &&
      pick("auto", false, ms.map((m) => (m.id === "m1" ? { ...m, online: false } : m))).machine?.id === "pc", [pick("auto"), pick("auto", true)])
    check("where: a machine named for jobs is used while it can be, else here, saying why", pick("pc").machine?.id === "pc" && pick("lap").machine === null &&
      pick("box").machine === null && /another vault/.test(pick("box").why) && pick("nope").machine === null)
    check("where: a preview or an editor's project is a copy the user watches here; a note, a GitHub page or nothing isn't",
      W.watched({ cwd: "/r", why: "", from: "preview" }) && W.watched({ cwd: "/r", why: "", from: "editor" }) && !W.watched({ cwd: "/r", why: "", from: "github" }) && !W.watched({ cwd: "/v", why: "", from: "vault" }))
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
    // A job's own change on main: a commit its words name, or its branch, after its base; nothing before it, nothing unpushed.
    const { onMainSince } = await import("../../../plugins/core/companion/workers.ts")
    const base = g("rev-parse", "HEAD").trim()
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "landed"); const landed = g("rev-parse", "--short", "HEAD").trim()
    g("update-ref", "refs/remotes/origin/main", "HEAD")
    g("checkout", "-qb", "job-x"); fs.writeFileSync(path.join(repo, "b.txt"), "b\n"); g("add", "."); g("commit", "-qm", "unpushed"); const local = g("rev-parse", "--short", "HEAD").trim()
    check("jobs: a job's change is on main when a commit it names (or its branch) is on origin/main after its base",
      await onMainSince(repo, base, `Pushed as ${landed}.`) && !await onMainSince(repo, base, `Committed as ${local}, not pushed.`) && !await onMainSince(repo, base, `Based on ${base.slice(0, 8)}.`) &&
      !await onMainSince(repo, base, "Done.", "job-x") && !await onMainSince(repo, landed, `Pushed as ${landed}.`), { landed, local })
    g("update-ref", "refs/remotes/origin/main", "job-x")
    check("jobs: its branch landed on main counts too", await onMainSince(repo, base, "Done.", "job-x"))
    g("checkout", "-q", "-"); g("branch", "-qD", "job-x"); g("update-ref", "-d", "refs/remotes/origin/main"); g("reset", "-q", "--hard", base)
  }
  {
    const gh = await W.resolveHere({ url: "https://github.com/lighthouse/site/issues/4" }, VAULT, [], roots)
    const note = await W.resolveHere({ path: "Notes/Plan.md", url: "http://localhost:1" }, VAULT, [], roots)
    check("where: a GitHub page is its checkout here; a note is the vault", fs.realpathSync(gh.cwd) === real && note.cwd === VAULT && gh.from === "github" && note.from === "note", [gh, note])
    const editor = await W.resolveHere({ app: "com.microsoft.VSCode", title: "index.html — site" }, VAULT, [], roots)
    check("where: an editor's window is its project's checkout", fs.realpathSync(editor.cwd) === real && editor.from === "editor", editor)
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
    // (the helper's socket, as its upgrade request comes: what its asks' ops run as)
    const helperReq = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" } } as unknown as IncomingMessage
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc as Any, helperReq, { wild: [], query: { screen: "1" } })
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const said: Any[] = []
    const osc = (s: string, more = "") => `printf '\\033]7501;state=${s}${more}\\033\\\\'`
    const b64 = (s: string) => Buffer.from(s).toString("base64")
    // (works, writes a file, rests; told to merge it once kept, works and rests; told more, works again; then asks a permission)
    // (it makes its worktree as told and edits there, never the checkout)
    const script = (tree: string) => `stty -icanon 2>/dev/null; sleep 0.5; ${osc("working", `:msg=${b64("Editing index.html")}`)}; sleep 1; ${tree} -q; (cd ${tree.split(" ")[5]} && echo '<p>blue</p>' >> index.html); ${osc("idle")}; ` +
      `IFS= read -r k; ${osc("working")}; echo "$k" > landed.txt; sleep 1; ${osc("idle")}; ` +
      `IFS= read -r l; ${osc("working")}; echo "$l" > told.txt; sleep 1; ${osc("blocked", `:kind=permission:msg=${b64("Bash(rm -rf build)")}`)}; sleep 600`
    cc["agent:claude"] = async (start: Any) => { said.push(start); return { command: script(/git -C \S+ worktree add \S+ -b \S+ [0-9a-f]+/.exec(start.prompt ?? "")?.[0] ?? "false x x x /nowhere"), cwd: null } }
    let turn: Any = null
    cc["agent-turn:claude"] = async () => turn
    let card: Any = null
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion", jobs_agent: "claude_personal", jobs_never: [`${tmp}/Work: Work runs elsewhere`] })
      c.screenMoment({ kind: "ask", agent: "Claude", text: "make the heading blue", app: "com.example.browser", title: "Site", screen: `https://github.com/lighthouse/site`, sx: 10, sy: 20 })
      let [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make the heading blue", say: "On it: a session in site.", cwd: repo }, agent))
      card = b
      check("handoff: a job starting in a terminal, in the folder asked, as the jobs' account on Opus, high, auto; the companion says so",
        st === 200 && b.state === "starting" && /^view:terminal\/claude_personal-/.test(b.link) && b.where.includes("site") && b.where.includes("Personal") && b.where.includes("Claude Code Opus") &&
        said[0]?.profile === "personal" && said[0]?.model === "opus" && said[0]?.effort === "high" && said[0]?.mode === "auto" &&
        /Make the heading blue[^]*They said: "make the heading blue"[^]*don't push/.test(said[0]?.prompt ?? "") &&
        (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "On it: a session in site."), [st, b, said[0]])
      const working = await waitFor(() => heard.findLast((m) => m.t === "jobs" && m.jobs.some((j: Any) => j.id === card.id && j.state === "working")), 10000, 50)
      check("jobs: its terminal working moves it to working, what it does now from its agent", !!working && working.jobs.find((j: Any) => j.id === card.id).now === "Editing index.html", heard.at(-1))
      // (its worker saves its proof before it ends, as it's told)
      const [tst, tb] = await api("POST", "ops/companion.tour-save", { title: "The blue heading", job: card.id, text: '1. The heading is blue now [ring "Lighthouse"].' }, agent)
      check("proof: tour-save --job keeps it in Guides/Proofs, as that job's; with no video it warns that a proof is one by default", tst === 200 && tb.path === "Guides/Proofs/The blue heading.md" && read(tb.path).includes(`job: ${card.id}`) && /no video: a proof is one by default/.test(tb.warning ?? ""), [tst, tb])
      const tree = path.join(path.dirname(real), `site-${card.id}`)
      turn = { text: "Made the heading blue in index.html. Try http://localhost:5173.", files: [path.join(tree, "index.html")], at: Date.now(), final: true }
      const review = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: card.id }))[1]; return r.state === "ready for review" && r }, 10000, 100)
      check("jobs: its turn over with a change, it's ready for review: its diff, its link, what it said, new for the menu bar",
        !!review && review.result.diff === "1 file changed, +1 -0" && review.result.link === "http://localhost:5173" && /heading blue/.test(review.result.text) && review.seen === false &&
        review.log.map((x: Any) => x.to).join() === "working,ready for review", review)
      check("jobs: a coding job worked in its own worktree on its own branch, its diff read there, the checkout untouched",
        review?.where.tree === tree && review.where.branch === `job-${card.id}` && fs.readFileSync(path.join(tree, "index.html"), "utf8").includes("blue") &&
        !fs.readFileSync(path.join(repo, "index.html"), "utf8").includes("blue") && g("branch", "--show-current").trim() !== `job-${card.id}`, { where: review?.where, diff: review?.result.diff })
      ;[st, b] = await api("POST", "ops/companion.jobs", {})
      check("companion jobs: its state, where, its results", st === 200 && b.jobs[0]?.id === card.id && b.jobs[0].state === "ready for review" && b.jobs[0].where.account === "Personal", b)
      {
        // Its proof: ready, it knocks; its worker was told to save a tour; Show me with no window says so plainly, then the choice.
        const knock = (await api("POST", "ops/companion.knocks", {}))[1].knocks.find((k: Any) => k.open === `job:${card.id}`)
        check("proof: a job ready knocks, Ready to show you its change, its card held 15 s, from its terminal, opening its proof; its worker was told how to save one",
          knock?.line === "Ready to show you the blue heading" && knock.urgency === "normal" && knock.hold === 15_000 && knock.from === card.link.split("/").pop() && said[0]?.prompt.includes(`--job ${card.id}`), [knock, said[0]?.prompt.slice(-900)])
        let [pst, pb] = await api("POST", "ops/companion.tour-save", { title: "The blue heading", job: card.id, text: '1. The heading is blue now [ring "Lighthouse"], in the menu bar.' }, agent)
        check("proof: tour-save warns of a step on the Mac's own UI, outside Vaultite's window", pst === 200 && /step 1 names the Mac's own UI/.test(pb.warning ?? ""), [pst, pb])
        ;[pst, pb] = await api("POST", "ops/companion.tour-save", { title: "The blue heading", job: card.id, text: '1. The heading is blue now [ring "Lighthouse"].' }, agent)
        // (an agent shows a job only when their ask is to see it, and closes one ready for review only on their word)
        const [ast, ab] = await api("POST", "ops/companion.job-show", { id: card.id }, agent)
        const [cst, cb] = await asItsTool(() => api("POST", "ops/companion.job-stop", { id: card.id }, agent))
        check("proof: an agent's Show me without their words asking to see it is refused; its stop of a job ready for review too",
          ast === 403 && /only when their ask is to see/.test(ab.error) && cst === 403 && /closed only on their own word/.test(cb.error) &&
          (await api("POST", "ops/companion.job", { id: card.id }))[1].state === "ready for review", [ast, ab, cst, cb])
        const [ost, ob] = await api("POST", "ops/companion.tour-save", { title: "The blue heading", job: "other1", text: "1. Blue [ring \"Lighthouse\"]." }, agent)
        check("proof: another job's proof by the same title is saved beside it, never over it", ost === 200 && ob.path === "Guides/Proofs/The blue heading 2.md" && read(pb.path).includes(`job: ${card.id}`), [ost, ob])
        ;[pst, pb] = await api("POST", "ops/companion.job-show", { id: card.id })
        const plainly = await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.find((n: Any) => n.kind === "say" && /can't show it here/.test(n.text)), 5000, 50)
        const asked = await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.find((n: Any) => n.kind === "say" && n.text === "Keep it and merge it in, or does it need changes?"), 5000, 50)
        check("proof: Show me with no window to show it on says so plainly, what it changed, then asks Keep and merge or Needs changes",
          pst === 200 && pb.proof === "Guides/Proofs/The blue heading.md" && /heading blue in index\.html/.test(plainly?.text ?? "") && !!asked &&
          (await api("POST", "ops/companion.knocks", {}))[1].knocks.find((k: Any) => k.id === knock?.id)?.state === "opened", [pst, pb, plainly, asked])
        ;[pst, pb] = await api("POST", "ops/companion.job-show", { choose: "broken" })
        check("proof: Needs changes records a clip on the helper for that job", pst === 200 && pb.recording === true && heard.some((m) => m.t === "record" && m.job === card.id), [pst, pb])
        const [pst2] = await api("POST", "ops/companion.job-show", { choose: "keep" })
        check("proof: Keep with nothing just shown is refused (never a close on a guess)", pst2 === 409 && (await api("POST", "ops/companion.job", { id: card.id }))[1].state === "ready for review")
        // Played on a window (a stand-in) with the helper's displays: its ring, its before flipped over the heading, then the
        // choice's buttons; Keep and merge pressed there tells its own worker to merge it, closed once it says it merged.
        const png = Buffer.alloc(33); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(320, 16); png.writeUInt32BE(40, 20)
        fs.mkdirSync(path.join(VAULT, "Pics"), { recursive: true }); fs.writeFileSync(path.join(VAULT, "Pics/Before.png"), png)
        await api("POST", "ops/companion.tour-save", { title: "The blue heading", job: card.id, text: '1. The heading is blue now [ring "Lighthouse"]. (before: "Pics/Before.png")' }, agent)
        const heading = { role: "heading", label: "Lighthouse", frame: { x: 200, y: 120, width: 320, height: 40 } }
        const win = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, close() {}, ping() {}, terminate() {}, send(t: string) {
          const m = JSON.parse(t)
          if (m.t === "things") setImmediate(() => win.emit("message", JSON.stringify({ t: "done", rid: m.rid, ok: true, window: { x: 0, y: 25, width: 1440, height: 875 }, things: [heading] })))
        } })
        matchSocket(app.plugins, ["companion", "live"])![1].fn(win as Any, {} as IncomingMessage, { wild: [], query: {} })
        win.emit("message", JSON.stringify({ t: "where", open: [], shown: [], focus: null, at: Date.now() }))
        heard.length = 0
        ;[pst, pb] = await api("POST", "ops/companion.job-show", { id: card.id, displays: [{ x: 0, y: 0, width: 1440, height: 900 }] })
        const layers = () => heard.filter((m) => m.t === "drawing")
        const ring = await waitFor(() => layers().find((m) => m.agent === "Claude" && m.drawing?.marks.some((k: Any) => k.type === "ring")), 8000, 50)
        const over = await waitFor(() => layers().find((m) => m.agent === "Claude (before)" && m.drawing?.marks[0]?.over), 5000, 50)
        const flipped = await waitFor(() => layers().some((m) => m.agent === "Claude (before)" && m.drawing?.hidden) && layers().some((m, i, all) => m.agent === "Claude (before)" && m.drawing && !m.drawing.hidden && all.slice(0, i).some((x) => x.drawing?.hidden)), 8000, 50)
        const buttons = await waitFor(() => layers().find((m) => m.agent === "Claude" && m.drawing?.marks.filter((k: Any) => k.type === "button").length === 3), 12000, 50)
        const r = ring?.drawing.marks.find((k: Any) => k.type === "ring")?.at, o = over?.drawing.marks[0]?.at
        check("proof: played on the window, its ring on the thing, its before laid over it on its own layer and flipped (hidden, shown again), then Keep and merge, Needs changes, Not yet",
          pst === 200 && r?.x === 200 && r?.w === 320 && JSON.stringify(o) === JSON.stringify({ x: 200, y: 120, w: 320, h: 40 }) && over?.drawing.marks[0].caption === "Before" && !!flipped &&
          buttons?.drawing.marks.filter((k: Any) => k.type === "button").map((k: Any) => k.label).join() === "Keep and merge,Needs changes,Not yet", { pst, pb, ring, over, buttons: buttons?.drawing.marks })
        const narrated = (await api("POST", "ops/companion.status", {}))[1].notes.find((n: Any) => n.kind === "say" && n.text === "The heading is blue now.")
        check("proof: its words are said (aloud, as Show me was)", narrated?.answers?.voice === true, narrated)
        sc.emit("message", Buffer.from(JSON.stringify({ t: "drawing-act", id: buttons?.drawing.id, kind: "ask", text: "Keep and merge" })))
        turn = { text: "Merged: squashed into main as abc1234.", files: [], at: Date.now() + 500, final: true }
        const landing = await waitFor(() => fs.existsSync(path.join(repo, "landed.txt")) && fs.readFileSync(path.join(repo, "landed.txt"), "utf8").trim(), 10000, 100)
        const mid = (await api("POST", "ops/companion.job", { id: card.id }))[1]
        check("proof: Keep and merge pressed tells its own worker to merge it as its repo says, the app's own (no ask to the model), its layers down, and it isn't closed yet",
          /kept it: merge it now, from your worktree [^ ]+ \(branch job-[a-z0-9]+\), as this repo's own rules say/.test(landing || "") && /git push origin HEAD:main/.test(landing || "") && /Merged:/.test(landing || "") && mid.state !== "done" && layers().at(-1)?.drawing === null, { landing, mid: mid.state, last: layers().at(-1), said: (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say").map((n: Any) => n.text).slice(-3) })
        const merged = await waitFor(async () => { const r2 = (await api("POST", "ops/companion.job", { id: card.id }))[1]; return r2.state === "done" && r2 }, 10000, 100)
        const told2 = (await api("POST", "ops/companion.knocks", {}))[1].knocks.find((k: Any) => k.line === "Merged: Make the heading blue")
        check("proof: once its worker says it merged, the job closes as done, its knock saying so and opening its terminal (nothing to show)", !!merged && !!told2 && !told2.open, { merged: merged?.state, told2 })
        // Its demo video (recorded on the worker's own copy): kept beside the proof, played by the notch, narrated, then the choice.
        const mp4 = path.join(os.tmpdir(), `vaultite-test-proof-${process.pid}.mp4`)
        fs.writeFileSync(mp4, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(12)]))
        const [vst, vb] = await api("POST", "ops/companion.tour-save", { title: "The blue heading", job: card.id, video: mp4, text: '1. The heading is blue now [ring "Lighthouse"].\n2. The menu bar says so (before: "Pics/Before.png") (after: "Pics/Before.png").' }, agent)
        fs.rmSync(mp4, { force: true })
        const [rst, rb] = await api("POST", "ops/companion.tour-save", { title: "Recorded", job: card.id, record: `http://127.0.0.1:${process.env.PORT ?? 8793}`, text: '1. Blue [ring "Lighthouse"].' }, agent)
        check("proof: tour-save --video keeps the video beside it, embedded on top and named in its frontmatter; a still of the Mac's UI (after:) is no warning; recording on the user's own app is refused",
          vst === 200 && vb.video === "Guides/Proofs/The blue heading/The blue heading.mp4" && fs.existsSync(path.join(VAULT, vb.video)) && !vb.warning &&
          read(vb.path).includes(`video: ${vb.video}`) && read(vb.path).includes(`![[${vb.video}]]`) && read(vb.path).includes('(after: "Pics/Before.png")') &&
          rst === 409 && /the user's own app/.test(rb.error), [vst, vb, rst, rb])
        heard.length = 0
        const [sst, sb] = await api("POST", "ops/companion.job-show", { id: card.id, displays: [{ x: 0, y: 0, width: 1440, height: 900 }] })
        const card2 = await waitFor(() => layers().find((m) => m.agent === "Claude" && m.drawing?.marks.some((k: Any) => k.type === "video")), 8000, 50)
        const v = card2?.drawing.marks.find((k: Any) => k.type === "video")
        const both = await waitFor(async () => { const n = (await api("POST", "ops/companion.status", {}))[1].notes.filter((x: Any) => x.kind === "say").map((x: Any) => x.text); return n.includes("The heading is blue now.") && n.includes("The menu bar says so.") }, 20000, 100)
        const choice = await waitFor(() => layers().find((m) => m.agent === "Claude" && m.drawing?.marks.some((k: Any) => k.type === "button")), 20000, 50)
        check("proof: Show me plays its video by the notch (a video card at the top), says each step's words as it comes, then the choice",
          sst === 200 && sb.video === vb.video && v?.at?.area === "top" && /The%20blue%20heading\.mp4/.test(v?.url ?? "") && !!both && !!choice, { sst, sb, v, both, choice: choice?.drawing.marks })
        await api("POST", "ops/companion.job-show", { choose: "later" })
        win.emit("close")
      }
      sc.emit("message", Buffer.from(JSON.stringify({ t: "job-seen", ids: [card.id] })))
      check("jobs: opened from the menu bar, it's no longer new", !!(await waitFor(async () => (await api("POST", "ops/companion.job", { id: card.id }))[1].seen === true, 3000, 50)))
      // Opened beside: "open it on the right" is a split, not a new tab.
      {
        const { checkParams, whoOf } = await import("../../../core/ops.ts")
        const opened: string[] = [], ctx = { who: whoOf("cli", null), op: async (id: string, b: unknown) => { opened.push(`${id} ${JSON.stringify(b)}`); return {} } }
        const jo = app.plugins.find((x) => x.id === "companion")!.ops.find((o) => o.id === "companion.job-open")!
        await jo.run(checkParams(jo, { id: card.id, split: "right" }), ctx as never)
        check("job-open --split right: its terminal in a pane beside, not a new tab", opened.at(-1) === `ui.open ${JSON.stringify({ path: card.link, split: "right" })}`, opened)
      }
      turn = null
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Use the darker blue", job: card.id }, agent))
      const told = await waitFor(() => fs.existsSync(path.join(repo, "told.txt")) && fs.readFileSync(path.join(repo, "told.txt"), "utf8").trim(), 10000, 100)
      check("handoff --job: typed into its worker's terminal, which goes on; with no say, it still says so in a line", st === 200 && told === "Use the darker blue" &&
        (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "Passed that on to its job."), [st, b, told])
      check("handoff --job: a follow-up carries the user's own words and screen once, one line",
        J.followTask("Darker", { t: 1, seq: 1, kind: "ask", text: "make it darker", voice: true, app: "com.example.browser", title: "Site", shot: "/s.png" } as Any) ===
          'Darker (The user, through their companion: They said (dictated, so it may hold slips: go by the task): "make it darker" · Where: on their screen, in "Site" (com.example.browser) · Their screen then (a picture): /s.png)' &&
        J.followTask("Darker", undefined) === "Darker")
      const asks = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: card.id }))[1]; return r.state === "needs you" && r }, 10000, 100)
      check("jobs: a permission it waits on is needs you, saying what", !!asks && /waits on a permission: Bash\(rm -rf build\)/.test(asks.now), asks)
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "go on", say: "Telling it.", job: card.id }, agent))
      check("handoff --job: never typed into a permission it waits on (only the user answers it)", st === 409 && /permission/.test(b.error), [st, b])
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.job-stop", { id: card.id }, agent))
      check("job-stop: stopped, its terminal ended", st === 200 && b.state === "stopped" &&
        !!(await waitFor(async () => !(await api("GET", "terminals/sessions"))[1].sessions.some((s: Any) => card.link.endsWith(s.id)), 5000, 100)), [st, b])
      // Not the companion's: another agent's vau (an inbox-resumed session, a job) and a script share its `who`, never its voice or ask.
      {
        const script = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli" } } as unknown as IncomingMessage
        const says = async () => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say").length
        c.screenMoment({ kind: "ask", agent: "Claude", text: "download this video please", app: "com.example.browser", title: "Clips", sx: 10, sy: 20 })
        const was = await says(), ended: string[] = []
        for (const [by, task] of [[agent, "Skip the pointer when unwatched"], [script, "Sync the design hub"]] as const) {
          const [st, b] = await api("POST", "ops/companion.handoff", { task, say: "Handed that off.", cwd: repo }, by)
          ended.push(b.id)
          const prompt = said.at(-1)?.prompt ?? ""
          check(`handoff from ${by === agent ? "another agent's vau" : "a script"}: its task alone, without the companion's latest ask; nothing said in its voice`,
            st === 200 && prompt.includes(task) && !prompt.includes("download this video") && !/through their companion/.test(prompt) && await says() === was, [st, b, prompt])
        }
        const [, conv] = await api("POST", "ops/companion.conversation", {})
        const ex = (conv.exchanges as Any[]).findLast((e) => e.text === "download this video please")
        check("handoff not the companion's: nothing filed under the user's ask in its conversation", !!ex && !ex.did.includes("handoff") && !ex.said.length, ex)
        // (a Codex companion's vau, from its own session's terminal: its own)
        const cp = app.plugins.find((x) => x.id === "companion")!, sess = path.join(cp.localDir(), "session-ada.json")
        fs.writeFileSync(sess, JSON.stringify({ id: "codex-adatest1", name: "Ada", t: Date.now() }))
        try {
          c.screenMoment({ kind: "ask", agent: "Ada", text: "fix the footer", app: "com.example.browser", title: "Site", sx: 10, sy: 20 })
          const fromIts = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "codex", "x-vaultite-terminal": "codex-adatest1" } } as unknown as IncomingMessage
          const [st, b] = await api("POST", "ops/companion.handoff", { task: "Fix the footer", as: "Ada", cwd: repo }, fromIts)
          ended.push(b.id)
          check("handoff from a terminal companion's own session: it says so, and its ask goes with it", st === 200 && /fix the footer/.test(said.at(-1)?.prompt ?? "") &&
            (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.agent === "Ada" && n.text === "Handed that off to a background agent."), [st, b, said.at(-1)?.prompt])
        } finally { fs.rmSync(sess, { force: true }) }
        for (const id of ended.filter(Boolean)) await asItsTool(() => api("POST", "ops/companion.job-stop", { id }, agent)).catch(() => {})
      }
      fs.mkdirSync(path.join(tmp, "Work"), { recursive: true })
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix it", say: "On it.", cwd: path.join(tmp, "Work") }, agent))
      check("handoff: a folder jobs never run in is refused, saying why", st === 403 && /Work runs elsewhere/.test(b.error), [st, b])
      const before = (await api("POST", "ops/companion.jobs", {}))[1].jobs.length
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix it", cwd: "~/no-such-repo-here" }, agent))
      check("handoff: a folder that isn't here (nor on a machine jobs prefer) is refused at once, no job left failed",
        st === 404 && /there's no folder ~\/no-such-repo-here/.test(b.error) && /Leave cwd out/.test(b.error) && (await api("POST", "ops/companion.jobs", {}))[1].jobs.length === before, [st, b])
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
      // (an "it" between two jobs: their ask over one's terminal, an agent naming the other: it asks which, unless their words name it)
      const pwin = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, close() {}, ping() {}, terminate() {}, send() {} })
      matchSocket(app.plugins, ["companion", "live"])![1].fn(pwin as Any, helperReq, { wild: [], query: {} })
      pwin.emit("message", JSON.stringify({ t: "where", open: [], shown: [], focus: null, at: Date.now(), active: true, panes: [{ id: "pjob", to: b.link, title: "Tidy the trip note", tab: "t1" }], pane: "pjob" }))
      c.addMoment({ kind: "ask", for: "Claude", text: "so let's merge the heading one", pane: "pjob" })
      const [ust, ub] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "merge it", job: card.id, land: true }, agent))
      const [wst, wb] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "merge it", job: card.id, land: true, which: "the heading one" }, agent))
      check("handoff --job: their ask over another job's terminal asks which (both named), unless their words name it", ust === 409 && /their ask was over the job "Tidy the trip note"/.test(ub.error) &&
        /\("Make the heading blue, or Tidy the trip note\?"\)/.test(ub.error) && !/their ask was over/.test(wb.error ?? ""), [ust, ub, wst, wb])
      pwin.emit("close")
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

  // A worker's terminal ending mid-turn: closed on purpose (vau terminal end, End session) or exiting cleanly, it's done
  // by what it left, read from its session once the terminal's gone; crashed, it failed.
  if (process.platform !== "win32") {
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-plain-")), ids: string[] = [], read: string[] = []
    let then = "sleep 600"
    cc["agent:claude"] = async () => ({ command: `sleep 0.3; printf '\\033]7501;state=working\\033\\\\'; sleep 1.5; ${then}`, cwd: null })
    cc["agent-turn:claude"] = async (_id: string, session = "") => { read.push(session); return { session: "sess-1", text: "Shipped it: committed and pushed.", files: [], at: Date.now(), final: false } }
    const job = async (id: string) => (await api("POST", "ops/companion.job", { id }))[1]
    const hand = async (how: string) => {
      then = how
      const [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Ship it", say: "On it.", cwd: plain }, agent))
      if (st !== 200) return { st, b }
      ids.push(b.link.split("/").pop())
      await waitFor(async () => (await job(b.id)).state === "working", 10000, 100)
      return { st, b }
    }
    try {
      const clean = await hand("exit 0")
      const done = await waitFor(async () => { const r = await job(clean.b.id); return r.state !== "working" && r }, 15000, 200)
      check("jobs: a worker that exits mid-turn after its answer is done, its words read from its session after its terminal ended",
        done?.state === "done" && /Shipped it/.test(done.result?.text ?? "") && done.session === "sess-1" && read.includes("sess-1"), [done, read])
      check("jobs: an ended job's end is read once: it stays done", (await job(clean.b.id)).state === "done")
      const purpose = await hand("sleep 600")
      await api("DELETE", `terminals/${ids.at(-1)}`)
      const closed = await waitFor(async () => { const r = await job(purpose.b.id); return r.state !== "working" && r }, 15000, 200)
      check("jobs: a worker's terminal ended on purpose while it works, after it said something, is done", closed?.state === "done", closed)
      const crash = await hand("exit 3")
      const failed = await waitFor(async () => { const r = await job(crash.b.id); return r.state !== "working" && r }, 15000, 200)
      check("jobs: a worker that crashes mid-turn failed", failed?.state === "failed", failed)
    } finally {
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      for (const id of ids) await api("DELETE", `terminals/${id}`).catch(() => {})
      fs.rmSync(plain, { recursive: true, force: true })
    }
  }

  // A job done a while closes its terminal (not while its worker runs something in the background); its conversation
  // resumes with a follow-up.
  if (process.platform !== "win32") {
    const Wk = await import("../../../plugins/core/companion/workers.ts")
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-tidy-")), started: Any[] = []
    let background = 1
    cc["agent:claude"] = async (start: Any) => { started.push(start); return { command: "sleep 0.3; printf '\\033]7501;state=working\\033\\\\'; sleep 0.5; printf '\\033]7501;state=idle\\033\\\\'; sleep 600", cwd: null } }
    cc["agent-turn:claude"] = async () => ({ session: "sess-tidy", text: "Wrote the summary. Should I add it to Today?", files: [], at: Date.now(), final: true, background })
    const job = async (id: string) => (await api("POST", "ops/companion.job", { id }))[1]
    const runs = async (id: string) => (await api("GET", "terminals/sessions"))[1].sessions.some((x: Any) => x.id === id)
    let first = ""
    Wk.tidyAfter(0)
    try {
      const [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Write the summary", cwd: plain }, agent))
      first = b.link.split("/").pop()
      const done = await waitFor(async () => { const r = await job(b.id); return r.state === "done" && r }, 15000, 200)
      check("jobs: done while it runs something in the background, its terminal stays", st === 200 && !!done && await runs(first) && !done.closed, done)
      background = 0
      const closed = await waitFor(async () => { const r = await job(b.id); return r.closed && r }, 10000, 200)
      check("jobs: done a while, its terminal closes by itself; it stays done, its result and questions kept, resuming from its card",
        !!closed && closed.state === "done" && closed.terminal === "resume-claude-sess-tidy" && /Wrote the summary/.test(closed.result?.text ?? "") &&
        closed.last?.asks?.[0] === "Should I add it to Today?" && !!(await waitFor(async () => !(await runs(first)), 5000, 100)), closed)
      const [st2, b2] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Yes, add it", job: b.id, title: "Summary on Today" }, agent))
      const resumed = started.at(-1)
      check("handoff --job on a closed job: its conversation resumed with the follow-up, renamed as asked",
        st2 === 200 && b2.state === "working" && b2.title === "Summary on Today" && b2.link === "view:terminal/resume-claude-sess-tidy" && resumed?.resume === "sess-tidy" &&
        resumed?.prompt === "Yes, add it" && !!(await waitFor(() => runs("resume-claude-sess-tidy"), 5000, 100)), [st2, b2, resumed])
      // (its conversation resumed under another id, an account's or a pin's: the job follows that terminal, and its end)
      await api("DELETE", "terminals/resume-claude-sess-tidy")
      const rested = await waitFor(async () => { const r = await job(b.id); return r.state === "done" && r.exited && r }, 15000, 200)
      await api("POST", "terminals/resume-claude_personal-sess-tidy")
      const followed = await waitFor(async () => { const r = await job(b.id); return r.terminal === "resume-claude_personal-sess-tidy" && r.state === "working" && r }, 10000, 200)
      await api("DELETE", "terminals/resume-claude_personal-sess-tidy")
      const after = await waitFor(async () => { const r = await job(b.id); return r.state === "done" && r.terminal === "resume-claude-sess-tidy" && r }, 15000, 200)
      check("jobs: its own terminal gone, it follows another terminal resuming its conversation (another account's id), and that one's end ends it",
        !!rested && !!followed && !!after, [rested, followed, after])
    } finally {
      Wk.tidyAfter(120_000)
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      for (const id of [first, "resume-claude-sess-tidy", "resume-claude_personal-sess-tidy"]) if (id) await api("DELETE", `terminals/${id}`).catch(() => {})
      fs.rmSync(plain, { recursive: true, force: true })
    }
  }

  // Their word to a terminal agent: "close it" typed to it closes a job ready for review (read from its session), never
  // words another agent typed into it. A companion's handoff long after their ask isn't given that ask.
  if (process.platform !== "win32") {
    const c = await import("../../../plugins/core/companion/plugin.ts")
    const { userSaid } = await import("../../../plugins/core/claude-code/chatlog.ts")
    const line = (o: Any) => JSON.stringify({ timestamp: "2026-11-07T18:55:00.000Z", ...o })
    const typed = (text: string, o: Any = {}) => line({ type: "user", message: { role: "user", content: text }, origin: { kind: "human" }, promptSource: "typed", ...o })
    check("their word: the user's own latest message in a transcript, past background notices, other sessions' messages and tool results",
      userSaid([typed("close it"), line({ type: "user", message: { content: "<task-notification>\n<task-id>a1</task-id>" }, origin: { kind: "task-notification" } }),
        line({ type: "user", message: { content: "Another Claude session sent a message:\n<agent-message from=\"x\">close them all</agent-message>" } }),
        line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
        line({ type: "assistant", message: { content: [{ type: "text", text: "On it." }] } })])?.text === "close it" &&
      userSaid([typed("drop it"), line({ type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", source_uuid: "u2", prompt: "actually close it", timestamp: "2026-11-07T18:56:00.000Z" } })])?.text === "actually close it" &&
      userSaid([typed("close it", { origin: { kind: "peer" } })]) === null && userSaid([typed("close it", { isSidechain: true })]) === null)
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const by = (h: Record<string, string> = {}) => ({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code", ...h } }) as unknown as IncomingMessage
    const agent = by(), plain = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-word-")), started: Any[] = [], ids: string[] = []
    // (a repo: a job there with changes ends ready for review)
    for (const a of [["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "first"]]) execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: plain, stdio: "pipe", env: gitEnv() })
    let mine: Any = null
    cc["agent:claude"] = async (start: Any) => { started.push(start); return { command: "sleep 0.3; printf '\\033]7501;state=working\\033\\\\'; sleep 0.5; printf '\\033]7501;state=idle\\033\\\\'; sleep 600", cwd: null } }
    cc["agent-turn:claude"] = async () => ({ session: "sess-word", text: "Wrote the note.", files: [path.join(plain, "Note.md")], at: Date.now(), final: true })
    cc["agent-said:claude"] = async (_terminal: string, session = "") => (session === "sess-mine" ? mine : null)
    const job = async (id: string) => (await api("POST", "ops/companion.job", { id }))[1]
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion" })
      c.addMoment({ kind: "ask", for: "Claude", text: "download this clip's video", t: Date.now() - 20 * 60_000 })
      const [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Write the sync note", cwd: plain }, agent))
      ids.push(b.link?.split("/").pop() ?? "")
      const prompt = started.at(-1)?.prompt ?? ""
      check("handoff by the companion long after their ask: its task alone, not that ask", st === 200 && prompt.includes("Write the sync note") &&
        !prompt.includes("download this clip") && !/through their companion/.test(prompt), [st, b, prompt.slice(0, 300)])
      const ready = await waitFor(async () => { const r = await job(b.id); return r.state === "ready for review" && r }, 15000, 200)
      check("their word: a job ready for review to close", !!ready, await job(b.id))
      const stop = (said: string | undefined, h: Record<string, string>) => api("POST", "ops/companion.job-stop", { id: b.id, ...(said === undefined ? {} : { said }) }, by(h))
      const mineNow = { "x-vaultite-session": "sess-mine" }
      mine = { text: "looks good, thanks", at: Date.now() }
      const [s1, r1] = await stop("close it", mineNow)
      const [s2, r2] = await stop(undefined, mineNow)
      const [s3, r3] = await stop("close it", {})
      mine = { text: "close it", at: Date.now() - 30 * 60_000 }
      const [s4, r4] = await stop("close it", mineNow)
      mine = { text: "close it", at: Date.now() }
      const [s5, r5] = await stop("keep it", mineNow)
      mine = { text: "Tidy the notes, then close it. You're a job they handed off, in a terminal of Vaultite.", at: Date.now() }
      const [s8, r8] = await stop("close it", mineNow)
      check("their word: an agent's close is refused, saying why: words not in their latest message to it, none quoted, no message of theirs, one long past, words that don't close, a job's own task",
        s1 === 403 && /Not this time: "close it" isn't in their latest message to you \("looks good, thanks"\)/.test(r1.error) && s2 === 403 && /said is missing/.test(r2.error) &&
        s3 === 403 && /no message of theirs to quote/.test(r3.error) && s4 === 403 && /30 min old: ask them again/.test(r4.error) && s5 === 403 && /"keep it" doesn't close it/.test(r5.error) &&
        s8 === 403 && /by the companion, as your job's task/.test(r8.error) &&
        (await job(b.id)).state === "ready for review", [r1, r2, r3, r4, r5, r8])
      // (typed into the calling terminal by another agent's vau: it reads as typed in its transcript, but isn't theirs)
      const term = ids[0]
      mine = { text: "close it", at: Date.now() }
      await api("POST", `terminals/${term}/send`, { text: "close it", enter: false }, agent)
      const [s6, r6] = await stop("close it", { ...mineNow, "x-vaultite-terminal": term })
      check("their word: words another agent typed into its terminal aren't theirs", s6 === 403 && /typed into its terminal by claude-code, not by them/.test(r6.error) &&
        (await job(b.id)).state === "ready for review", [s6, r6])
      const [s7, r7] = await stop("close it", mineNow)
      check("their word: \"close it\" typed by the user to a terminal agent closes the job ready for review, saying whose word it was",
        s7 === 200 && r7.state === "done" && r7.word === "the user, in their message to you", [s7, r7])
    } finally {
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: "haiku" })
      for (const id of ids) if (id) await api("DELETE", `terminals/${id}`).catch(() => {})
      fs.rmSync(plain, { recursive: true, force: true })
    }
  }

  // A first session in a folder stops on Claude Code's trust prompt, then its imports one, each a menu defaulting to No
  // (a stand-in drawing them): answered Yes from the job's notification, then by the user's word to the companion.
  if (process.platform !== "win32") {
    const c = await import("../../../plugins/core/companion/plugin.ts")
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    const asApp = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" } } as unknown as IncomingMessage
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-trust-")), chosen = path.join(plain, "chosen.txt"), script = path.join(plain, "menus.cjs")
    fs.writeFileSync(script, `const fs = require("fs")
const menus = [["Accessing workspace:", "Quick safety check: Is this a project you created or one you trust?", "No, exit", "Yes, I trust this folder"],
  ["Allow external CLAUDE.md file imports?", "This project's CLAUDE.md imports files outside the current working directory.", "No, disable external imports", "Yes, allow external imports"]]
let m = 0, at = 0
const draw = () => { const [a, b, no, yes] = menus[m]; process.stdout.write("\\x1b[2J\\x1b[H" + [" " + a, "", " " + b, "", (at ? "   " : " ❯ ") + no, (at ? " ❯ " : "   ") + yes, "", " Enter to confirm · Esc to cancel"].join("\\r\\n")) }
process.stdin.setRawMode(true)
process.stdin.on("data", (d) => {
  const k = String(d)
  if (k === "\\x1b[B") at = 1; else if (k === "\\x1b[A") at = 0
  else if (k === "\\r") { fs.appendFileSync(${JSON.stringify(chosen)}, menus[m][2 + at] + "\\n"); m++; at = 0
    if (m === menus.length) { process.stdout.write("\\x1b[2J\\x1b[H\\x1b]7501;state=working\\x1b\\\\"); return } }
  draw()
})
setTimeout(draw, 300)
`)
    cc["agent:claude"] = async () => ({ command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}; sleep 600`, cwd: null })
    cc["agent-turn:claude"] = async () => null
    const job = async (id: string) => (await api("POST", "ops/companion.job", { id }))[1]
    let id = ""
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion" })
      const [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix the site's header", cwd: plain }, agent))
      id = b.link?.split("/").pop() ?? ""
      const trust = await waitFor(async () => { const r = await job(b.id); return r.state === "needs you" && r.waits && r }, 15000, 200)
      check("jobs: a worker stopped on its folder's trust prompt needs you, with the prompt's question and its choices (Yes first)", st === 200 && !!trust &&
        /^Trust this folder\?/.test(trust.waits.question) && trust.waits.choices.join() === "Yes, I trust this folder,No, exit" && trust.waits.kind === "permission", trust)
      const [, list] = await api("POST", "ops/companion.jobs", {})
      check("jobs: its card carries what it waits on, for its notification's buttons", list.jobs[0]?.waits?.choices?.[0] === "Yes, I trust this folder", list.jobs[0]?.waits)
      let [s2, r2] = await asItsTool(() => api("POST", "ops/companion.job-answer", { id: b.id, choice: "yes", said: "yes" }, agent))
      check("job-answer: an agent can't answer it without the user's words in an ask after it began waiting", s2 === 403, [s2, r2])
      ;[s2, r2] = await api("POST", "ops/companion.job-answer", { id: b.id, choice: "Yes, I trust this folder" }, asApp)
      const first = await waitFor(() => fs.existsSync(chosen) && fs.readFileSync(chosen, "utf8"), 5000, 50)
      check("job-answer from its notification: Yes chosen in its terminal, the cursor moved off the default No first", s2 === 200 && r2.answered === "Yes, I trust this folder" &&
        first === "Yes, I trust this folder\n", [s2, r2, first])
      const imports = await waitFor(async () => { const r = await job(b.id); return r.state === "needs you" && /imports/.test(r.waits?.question ?? "") && r }, 15000, 200)
      check("jobs: its imports prompt next is what it waits on now", !!imports && imports.waits.choices[0] === "Yes, allow external imports", imports)
      c.screenMoment({ kind: "ask", agent: "Claude", text: "Yes, allow them. Thanks", voice: true, app: "com.example.browser", title: "Site", sx: 10, sy: 20 })
      ;[s2, r2] = await asItsTool(() => api("POST", "ops/companion.job-answer", { id: b.id, choice: "no", said: "no" }, agent))
      check("job-answer: words the user didn't say aren't theirs", s2 === 403 && !fs.readFileSync(chosen, "utf8").includes("disable"), [s2, r2])
      const [, jobsNow] = await api("POST", "ops/companion.job", { id: b.id })
      ;[s2, r2] = await asItsTool(() => api("POST", "ops/companion.job-answer", { id: b.id, choice: "yes", said: "yes, allow them" }, agent))
      const both = await waitFor(() => { const t = fs.readFileSync(chosen, "utf8"); return t.split("\n").length > 2 && t }, 5000, 50)
      check("job-answer by voice: the companion answers with the user's word in their ask, its choice pressed in the terminal", s2 === 200 && r2.answered === "Yes, allow external imports" &&
        both === "Yes, I trust this folder\nYes, allow external imports\n", [s2, r2, both, jobsNow.waits])
      const on = await waitFor(async () => { const r = await job(b.id); return r.state === "working" && r }, 10000, 200)
      check("jobs: answered, it works on, waiting on nothing", !!on && !on.waits, on)
    } finally {
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      await api("POST", "ops/companion.next", { timeout: 0 })
      await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: "haiku" })
      if (id) await api("DELETE", `terminals/${id}`).catch(() => {})
      fs.rmSync(plain, { recursive: true, force: true })
    }
  }

  // Another machine's job: where and its worker asked of that machine's companion, its terminal started and ended there.
  {
    const http = await import("node:http")
    const calls: Any[] = []
    let stage = "working", farHas = true
    const server = http.createServer((req, res) => {
      let body = ""
      req.on("data", (d) => (body += d))
      req.on("end", () => {
        const op = req.url!.replace("/api/ops/", ""), p = body ? JSON.parse(body) : {}
        calls.push({ op, p, client: req.headers["x-vaultite-client"] })
        const out: Any = op === "companion.where" ? (farHas ? { cwd: "/home/alice/Projects/site", repo: "site", base: "abc123", why: "as asked", refused: "" }
            : { cwd: "/home/alice/Vault", repo: "", base: "", why: "nothing on screen named a project: the vault", from: "vault", refused: "" })
          : op === "terminal.start" ? { id: "claude-remote1" }
          : op === "companion.worker" ? (stage === "working" ? { running: true, state: "working", title: "✳ Editing the header", typed: Date.now(), ...(p.turn ? { turn: { text: "", files: [], at: 0, final: false, session: "rs1" } } : {}) }
            : stage === "gone" ? { running: false, exit: { code: 0, signal: 1 }, ...(p.turn ? { turn: { text: "Shipped the header.", files: ["/home/alice/Projects/site/a.ts"], at: Date.now(), final: false, session: "rs1" }, diff: "1 file changed, +2 -1" } : {}) }
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
      let [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix the header", machine: "studio", cwd: "~/Projects/site" }, agent))
      job = b
      const start = calls.find((c) => c.op === "terminal.start")
      check("handoff: a routine one (no say) still announces itself in one short line",
        (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "Handed that off to a background agent."))
      check("handoff on another machine: its where asked there, its terminal started there in that folder, the card says so",
        st === 200 && b.link === "view:terminal/claude-remote1@studio" && b.where.startsWith("Studio, site") && !!calls.find((c) => c.op === "companion.where")?.client?.startsWith("machine/") &&
        start?.p.cwd === "/home/alice/Projects/site" && /Fix the header/.test(start?.p.prompt ?? ""), [st, b, calls])
      const working = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job.id }))[1]; return r.state === "working" && r }, 10000, 200)
      check("jobs on another machine: read from its worker there; typed in there by the user, it's theirs (never closed by itself)", !!working && working.now === "Editing the header" && working.held === true, working)
      stage = "idle"
      const review = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job.id }))[1]; return r.state === "ready for review" && r }, 15000, 300)
      check("jobs on another machine: its turn's end there, with the diff counted there and its preview link", !!review && review.result.diff === "1 file changed, +2 -1" &&
        review.result.link === "https://studio.tail1.ts.net:8450" && calls.some((c) => c.op === "companion.worker" && c.p.turn && c.p.base === "abc123"), review)
      ;[st, b] = await api("POST", "ops/companion.job-stop", { id: job.id })
      check("job-stop on another machine: its terminal ended there; reviewed, it's done", st === 200 && b.state === "done" && calls.some((c) => c.op === "terminal.end" && c.p.id === "claude-remote1"), [st, b, calls.at(-1)])
      // Nothing tying it here (no machine, no folder, no preview or editor): to the always-on machine with this vault.
      Object.assign(studio, { standalone: true, vault: "v1" })
      ms["machines"] = async () => [{ id: "lap", label: "Lap", url: "http://127.0.0.1:1", online: true, self: true, plugins: ["terminal", "companion"], vault: "v1" }, studio]
      ms["machines:vault"] = () => "v1"
      stage = "working"
      calls.length = 0
      // (its own ask over the GitHub page: an earlier block's may be no longer the last; heard only while the companion is on)
      await api("PATCH", "config/plugin/companion", { mode: "quiet" })
      await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].mode !== "off", 5000, 50)
      ;(await import("../../../plugins/core/companion/plugin.ts")).screenMoment({ kind: "ask", agent: "Claude", text: "research the header", app: "com.example.browser", title: "Site", screen: "https://github.com/lighthouse/site", sx: 10, sy: 20 })
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Research the header", say: "On it." }, agent))
      job = b
      check("handoff with nothing tying it here (the ask's GitHub page): on the always-on machine, only the page passed on", st === 200 && b.where.startsWith("Studio") && /Studio \(always on\)/.test(b.why) &&
        JSON.stringify(calls.find((c) => c.op === "companion.where")?.p) === JSON.stringify({ url: "https://github.com/lighthouse/site" }), [st, b, calls])
      await waitFor(async () => (await api("POST", "ops/companion.job", { id: job.id }))[1].session === "rs1", 10000, 200)
      stage = "gone"
      const shipped = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job.id }))[1]; return r.state !== "working" && r }, 15000, 300)
      const again = (await api("POST", "ops/companion.job", { id: job.id }))[1]
      check("jobs on another machine: a worker that closed itself after its changes is ready for review, read from its session, and stays so",
        shipped?.state === "ready for review" && /Shipped the header/.test(shipped.result?.text ?? "") && again.state === "ready for review" &&
        calls.some((c) => c.op === "companion.worker" && c.p.turn && c.p.session === "rs1"), [shipped, again.state])
      // A preview served here: to the always-on machine when it has the repo and all of it is pushed, else here, saying why.
      if (process.platform !== "win32") {
        const cc = app.plugins.find((p) => p.id === "claude-code")!.services, wasC = { ...cc }, ours: string[] = []
        cc["agent:claude"] = async () => ({ command: "sleep 60", cwd: null })
        g("add", "-A"); g("commit", "-qm", "earlier blocks' changes", "--allow-empty"); g("update-ref", "refs/remotes/origin/main", "HEAD")
        const pv = spawn(process.execPath, ["-e", "const s=require('http').createServer(()=>{}).listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { cwd: repo, stdio: ["ignore", "pipe", "ignore"] })
        const port = await new Promise<string>((ok) => pv.stdout!.once("data", (d) => ok(String(d).trim())))
        const ask = async () => {
          ;(await import("../../../plugins/core/companion/plugin.ts")).screenMoment({ kind: "ask", agent: "Claude", text: "make the header blue", app: "com.example.browser", title: "Site", screen: `localhost:${port}/about`, sx: 10, sy: 20 })
          calls.length = 0
          const r = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make the header blue", say: "On it." }, agent))
          if (!String(r[1].link ?? "").includes("@")) ours.push(String(r[1].link ?? "").split("/").pop()!)
          return r
        }
        try {
          // (an earlier block leaves it off, which drops the ask)
          await api("PATCH", "config/plugin/companion", { mode: "quiet" })
      await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].mode !== "off", 5000, 50)
          stage = "working"
          ;[st, b] = await ask()
          const start = calls.find((c) => c.op === "terminal.start")
          check("handoff over a preview here, its repo pushed and checked out on the always-on machine: it runs there, in that checkout, told to preview there",
            st === 200 && b.link.endsWith("@studio") && /all pushed: as asked, on Studio \(always on\), previewed there/.test(b.why) &&
            JSON.stringify(calls.find((c) => c.op === "companion.where")?.p) === JSON.stringify({ url: "https://github.com/lighthouse/site" }) && start?.p.cwd === "/home/alice/Projects/site" &&
            new RegExp(`asked over the preview http://localhost:${port} on [^]*Studio's own preview[^]*say it's on Studio`).test(start?.p.prompt ?? ""), [st, b, start?.p])
          await asItsTool(() => api("POST", "ops/companion.job-stop", { id: b.id }, agent))
          fs.appendFileSync(path.join(repo, "index.html"), "<p>wip</p>\n")
          ;[st, b] = await ask()
          check("handoff over a preview here with uncommitted changes: it stays here, its why saying they'd be lost by moving",
            st === 200 && !b.link.includes("@") && /1 uncommitted change, not yet pushed, would be lost on Studio: here\)$/.test(b.why) && !calls.some((c) => c.op === "companion.where"), [st, b, calls])
          await asItsTool(() => api("POST", "ops/companion.job-stop", { id: b.id }, agent))
          g("checkout", "--", "index.html")
          farHas = false
          ;[st, b] = await ask()
          check("handoff over a pushed preview the always-on machine hasn't checked out: it stays here, saying so",
            st === 200 && !b.link.includes("@") && /not checked out on Studio: here\)$/.test(b.why) && calls.some((c) => c.op === "companion.where"), [st, b])
        } finally {
          await api("PATCH", "config/plugin/companion", { mode: "off" })
          pv.kill()
          Object.assign(cc, wasC)
          for (const id of ours) await api("DELETE", `terminals/${id}`).catch(() => {})
        }
      }
    } finally {
      await api("POST", "ops/companion.next", { timeout: 0 })
      await api("PATCH", "config/plugin/companion", { mode: "off" })
      Object.assign(ms, wasM)
      for (const k of Object.keys(ms)) if (!(k in wasM)) delete ms[k]
      server.close()
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}
