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
  const { jobTold } = await import("../../../core/desktop/jobnews.ts")
  const W = await import("../../../plugins/core/companion/where.ts")

  // The lifecycle: one table, every move logged, nothing out of stopped.
  {
    const job = (): Any => ({ id: "j1", title: "t", state: "starting", where: { machine: "", label: "M", cwd: "/r", repo: "r", agent: "claude", account: "", harness: "Claude Code", model: "", effort: "", why: "" },
      terminal: "claude-x", now: "", started: 0, turn: 0, at: 0, seen: true, log: [] })
    const run = (evs: string[]) => { const j = job(); for (const e of evs) J.step(j, e as Any, 1); return j }
    {
      // (what each summoned ask is told of its jobs: the newest few, and every one waiting on them however old)
      const now = 10 * 3600_000, at = (id: string, state: string, h: number) => ({ ...job(), id, title: id, state, at: now - h * 3600_000, started: now - h * 3600_000 })
      const line = J.jobsLine([at("ja", "working", 0), at("jb", "done", 0.1), at("jc", "done", 0.2), at("jd", "done", 0.3), at("je", "done", 0.4), at("jold", "ready for review", 8), at("jgone", "done", 9)], now)
      check("jobs line: a job ready for review is always listed, past the newest few", /jold "jold" \(ready for review/.test(line) && !/je "je"/.test(line) && !/jgone/.test(line), line)
    }
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
    {
      // (a turn at rest: its background tasks running hold it working, and one landing itself until it says how that went)
      const R = (o: Any) => J.restEvent({ landed: false, changes: true, text: "Fixed it.", at: 0, now: 1000, ...o })
      check("jobs: a turn ending with its background tasks running stays working; one landing itself is never ready for review before it says Merged or Not merged",
        R({ background: 1 }) === "working" && R({ background: 2, changes: false }) === "working" && R({ background: 1, landed: true }) === "landed" &&
        R({}) === "changed" && R({ changes: false }) === "answered" && R({ landed: true }) === "landed" &&
        R({ lands: true, text: "Verify is still running in the background. When it's done I'll land the fix." }) === "working" &&
        R({ lands: true, text: "Not merged: verify fails on main too." }) === "changed" && R({ lands: true, now: J.LAND_WAIT + 1 }) === "changed" &&
        R({ lands: true, changes: false, text: "Nothing to change." }) === "answered")
      const j = { title: "t", turn: 0, now: "", last: { text: "Still running local verify before the try.", at: 5, background: 1 } }
      check("jobs: at rest with a background task, its now-line says it waits on that; working, what it says",
        J.nowOf(j, { state: "idle" }) === "waits on its task in the background: Still running local verify before the try." &&
        J.nowOf({ ...j, last: { ...j.last, background: 3 } }, { state: "done" }).startsWith("waits on its 3 tasks in the background") &&
        J.nowOf(j, { state: "working" }) === "Still running local verify before the try.", J.nowOf(j, { state: "idle" }))
    }
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
      jobTold("needs you", "quiet") && jobTold("failed", "quiet") && !jobTold("done", "quiet") && !jobTold("ready for review", "quiet") &&
      !jobTold("done", "spoken") && !jobTold("ready for review", "spoken") && jobTold("failed", "spoken") && !jobTold("needs you", "off") && !jobTold("working", "spoken"))
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
      const lands = J.jobTask("Fix the footer", undefined, site, "j3k9x2a", true), watchedLand = J.jobTask("x", undefined, { ...site, watched: true }, "j3k9x2a", true)
      check("jobs: with jobs_land, a coding job lands itself once its checks pass, from its worktree, cleaned up; it asks only on a real tradeoff; one over a watched preview doesn't",
        /land it yourself, from your worktree \/Users\/alice\/Projects\/site-j3k9x2a/.test(lands) && /worktree remove/.test(lands) && /"Merged:"/.test(lands) && /only on a real tradeoff/.test(lands) &&
        !/Keep and merge lands it/.test(lands) && lands.includes("tour-save") && !/land it yourself/.test(watchedLand) && !/land it yourself/.test(note), lands)
      check("jobs: a worker writes plain sentences and shows a UI as real pictures (vau html picture, embedded), never ASCII; one over a watched preview isn't told",
        [jt, note].every((t) => /plain, short sentences/.test(t) && t.includes("vau html picture") && /Never ASCII art/.test(t)) && !J.jobTask("x", undefined, { ...site, watched: true }, "j3k9x2a").includes("vau html picture"), note)
      const moved = J.jobTask("Fix the footer", undefined, { ...site, moved: "the preview http://localhost:5173 on M4" }, "j3k9x2a")
      const over = { cwd: site.cwd, repo: "site", label: "M4", preview: "http://localhost:5173" }
      const watching = J.jobTask("Make the heading blue", undefined, { ...over, watched: true }, "j3k9x2a")
      check("jobs: one over a preview they watch edits the checkout serving it, fast, no worktree, no demo; the live server's own or one moved elsewhere isn't",
        J.inPlace(over) && !J.inPlace({ ...over, live: true }) && !J.inPlace({ ...over, moved: "the preview on M4" }) && !J.inPlace({ ...over, preview: undefined }) && !J.inPlace({ ...over, repo: "" }) &&
        /They watch http:\/\/localhost:5173 reload as you change \/Users\/alice\/Projects\/site[^]*no worktree/.test(watching) && !/worktree add/.test(watching) && !watching.includes("tour-save"), watching)
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
    {
      const shot = "/Users/alice/Library/Application Support/Vaultite Main/screens/display-746-1794124886020.png", close = "/Users/alice/Library/Application Support/Vaultite Main/screens/close-746-1794124886021.png"
      const m: Any = { kind: "ask", t: 1, seq: 1, text: "what's this?", path: "Notes/Ideas.md", under: "a/b c", shot, closeUp: { shot, at: { x: 0, y: 0, width: 9, height: 9 }, scale: 3 } }
      const followed = J.followTask("Look again", { ...m, closeUp: { ...m.closeUp, shot: close } }), started = J.jobTask("Look", m)
      check("jobs: the pictures an ask hands a worker are found in what it's told (a path with spaces, on one line with the rest), each once",
        J.picturesIn(followed).join("|") === `${shot}|${close}` && J.picturesIn(started).join("|") === shot && !J.picturesIn("see /tmp/screens/other.png").length, [J.picturesIn(followed), followed])
    }
    check("jobs: a PR and a preview's link from the worker's last message", JSON.stringify(J.linksIn("Done. PR: https://github.com/lighthouse/site/pull/12, try http://localhost:5173/about.")) ===
      JSON.stringify({ pr: "https://github.com/lighthouse/site/pull/12", link: "http://localhost:5173/about" }) && J.linksIn("nothing", "https://m1.tail1.ts.net:8450").link === "https://m1.tail1.ts.net:8450")
  }

  // A turn's handoffs, said: one's own line (or its say); several, one line naming them, a sentence each kind.
  {
    const Wk = await import("../../../plugins/core/companion/workers.ts")
    const T = (kind: Any, title: string, line = "", say = "") => ({ kind, title, line, say })
    check("handoffs said: one keeps its own line, or its say", Wk.toldLine([T("follow", "Card", "Passed that on to its job.")]) === "Passed that on to its job." &&
      Wk.toldLine([T("new", "x", "Handed that off to a background agent.", "On it.")]) === "On it." && Wk.toldLine([]) === "")
    check("handoffs said: several, one line naming them by their titles' first words",
      Wk.toldLine([T("land", "Fix the video card overlap", "Told its job to merge it."), T("land", "Dictation drops words after a pause", "x"), T("land", "Screenshots in the chat", "x")]) ===
        "Told three jobs, Fix the video card, Dictation drops words after and Screenshots in the chat, to merge." &&
      Wk.toldLine([T("new", "Research Hexagon", "x"), T("follow", "Card fix", "x"), T("kept", "Notes", "Studio is offline: the job starts there once it's back.")]) ===
        "Handed off one job to background agents: Research Hexagon. Passed that on to Card fix. Studio is offline: the job starts there once it's back.", Wk.toldLine([T("land", "Fix the video card overlap", "")]))
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
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "landed"); const landed = g("rev-parse", "HEAD").trim()
    g("update-ref", "refs/remotes/origin/main", "HEAD")
    g("checkout", "-qb", "job-x"); fs.writeFileSync(path.join(repo, "b.txt"), "b\n"); g("add", "."); g("commit", "-qm", "unpushed"); const local = g("rev-parse", "--short", "HEAD").trim()
    const on = [await onMainSince(repo, base, `Pushed as ${landed}.`), await onMainSince(repo, base, `Committed as ${local}, not pushed.`), await onMainSince(repo, base, `Based on ${base.slice(0, 8)}.`),
      await onMainSince(repo, base, "Done.", "job-x"), await onMainSince(repo, landed, `Pushed as ${landed}.`)]
    check("jobs: a job's change is on main when a commit it names (or its branch) is on origin/main after its base", on.join() === "true,false,false,false,false", { landed, local, on })
    check("jobs: a commit its branch was rebased onto isn't its landing, though its words name it", !await onMainSince(repo, base, `Rebased onto ${landed.slice(0, 7)}, not pushed.`, "job-x"), landed)
    g("update-ref", "refs/remotes/origin/main", "job-x")
    check("jobs: its branch landed on main counts too", await onMainSince(repo, base, "Done.", "job-x"))
    g("checkout", "-q", "-"); g("branch", "-qD", "job-x"); g("update-ref", "-d", "refs/remotes/origin/main"); g("reset", "-q", "--hard", base)
  }
  {
    // Landed by someone else (rebased or squashed: a new sha), its branch removed: found by its change's patch-ids, read
    // while the branch existed; never another job's with the same words, nor main's commits a branch was rebased onto.
    const { onMainSince, marksOf } = await import("../../../plugins/core/companion/workers.ts")
    const base = g("rev-parse", "HEAD").trim(), on = g("symbolic-ref", "--short", "HEAD").trim(), put = (f: string, t: string, msg: string) => { fs.writeFileSync(path.join(repo, f), t); g("add", "."); g("commit", "-qm", msg) }
    g("update-ref", "refs/remotes/origin/main", base)
    g("checkout", "-qb", "job-y"); put("c.txt", "c\n", "feat: the header"); put("d.txt", "d\n", "feat: its footer")
    g("checkout", "-qb", "job-z", base); put("c.txt", "z\n", "feat: the header")
    g("checkout", "-q", "--detach", base); put("o.txt", "o\n", "chore: someone else's"); g("update-ref", "refs/remotes/origin/main", "HEAD")
    g("rebase", "-q", "origin/main", "job-z")
    const y = await marksOf(repo, "job-y"), z = await marksOf(repo, "job-z")
    check("jobs: a branch's marks are its own commits' patch-ids, not main's it was rebased onto; none on main yet",
      y?.each.length === 2 && !!y.whole && z?.each.length === 1 && !await onMainSince(repo, base, "Done.", "job-y", y) && !await onMainSince(repo, base, "Done.", "job-z", z), { y, z })
    g("checkout", "-q", "--detach", "origin/main"); g("merge", "-q", "--squash", "job-y"); g("commit", "-qm", "feat: header and footer"); g("update-ref", "refs/remotes/origin/main", "HEAD")
    g("branch", "-qD", "job-y")
    check("jobs: squashed onto main by someone else with its branch removed, a job's change is found by its marks; a rival's same words aren't",
      await marksOf(repo, "job-y") === null && await onMainSince(repo, base, "Done.", "job-y", y) && !await onMainSince(repo, base, "Done.", "job-z", z) &&
      !await onMainSince(repo, base, "Done.", "job-y", null) && !await onMainSince(repo, "origin/main", "Done.", "job-y", y), { y, z })
    const main = g("rev-parse", "HEAD").trim()
    g("checkout", "-qb", "job-w", base); put("w.txt", "w\n", "fix: one"); put("w.txt", "w\nx\n", "fix: two")
    g("checkout", "-q", "--detach", main); g("cherry-pick", "job-w~1", "job-w"); g("update-ref", "refs/remotes/origin/main", "HEAD")
    check("jobs: rebased onto main commit by commit, its branch still there, it's on main by its marks", await onMainSince(repo, base, "Done.", "job-w", await marksOf(repo, "job-w")))
    g("checkout", "-q", "-f", on); g("branch", "-qD", "job-z", "job-w"); g("update-ref", "-d", "refs/remotes/origin/main"); g("reset", "-q", "--hard", base)
  }
  {
    const gh = await W.resolveHere({ url: "https://github.com/lighthouse/site/issues/4" }, VAULT, [], roots)
    const note = await W.resolveHere({ path: "Notes/Plan.md", url: "http://localhost:1" }, VAULT, [], roots)
    check("where: a GitHub page is its checkout here; a note is the vault", fs.realpathSync(gh.cwd) === real && note.cwd === VAULT && gh.from === "github" && note.from === "note", [gh, note])
    const editor = await W.resolveHere({ app: "com.microsoft.VSCode", title: "index.html — site" }, VAULT, [], roots)
    check("where: an editor's window is its project's checkout", fs.realpathSync(editor.cwd) === real && editor.from === "editor", editor)
    // Each machine keeps its repos in its own place: another machine's path, a folder's name or GitHub's name is this one's own checkout.
    const named = (x: string) => { const d = W.checkoutNamed(x, roots); return d ? fs.realpathSync(d) : d }
    check("where: a repo another machine names (its path, its folder's name, GitHub's owner/name) is this machine's own checkout of it",
      named("/Users/alice/Projects/site") === real && named("~/Documents/personal/Projects/site") === real && named("site") === real && named("lighthouse/site") === real &&
      named("https://github.com/lighthouse/site.git") === real && named("~/Projects/elsewhere") === "" && named("lighthouse/nope") === "")
    W.checkoutsIn(roots)
    try {
      let [st, b] = await api("POST", "ops/companion.where", { cwd: "/Users/alice/Projects/site" })
      check("companion where: a folder another machine has its repo in finds this one's checkout, saying so", st === 200 && fs.realpathSync.native(b.cwd) === fs.realpathSync.native(repo) && b.repo === "site" &&
        /^\/Users\/alice\/Projects\/site is .*[\\/]site here$/.test(b.why), [st, b])
      ;[st, b] = await api("POST", "ops/companion.where", { repo: "lighthouse/site" })
      check("companion where --repo: by GitHub's name", st === 200 && fs.realpathSync.native(b.cwd) === fs.realpathSync.native(repo) && b.base.length === 40, [st, b])
      ;[st, b] = await api("POST", "ops/companion.where", { repo: "nowhere" })
      const [, text] = await api("POST", "ops/companion.where?as=text", { repo: "nowhere" })
      check("companion where: a repo with no checkout here says so, and where it looked: never a guess", st === 200 && b.missing === true &&
        new RegExp(`no checkout of nowhere \\(looked in ${roots[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\. Its checkouts: [^.]*[\\\\/]site`).test(String(text.text ?? text)) && /[\\/]site/.test(b.have), [b, text])
    } finally { W.checkoutsIn() }
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
        !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "On it: a session in site."), 3000, 50)), [st, b, said[0]])
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
        check("proof: played on the window, its ring on the thing, its before laid over it on its own layer and flipped (hidden, shown again), then Keep and merge, Needs changes, Not yet: one choice card, its question atop (answers with no place of their own)",
          pst === 200 && r?.x === 200 && r?.w === 320 && JSON.stringify(o) === JSON.stringify({ x: 200, y: 120, w: 320, h: 40 }) && over?.drawing.marks[0].caption === "Before" && !!flipped &&
          buttons?.drawing.marks.filter((k: Any) => k.type === "button").map((k: Any) => k.label).join() === "Keep and merge,Needs changes,Not yet" &&
          buttons.drawing.question === "Keep it and merge it in, or does it need changes?" && buttons.drawing.marks.every((k: Any) => k.type !== "button" || !k.at), { pst, pb, ring, over, buttons: buttons?.drawing })
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
        const already = await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.find((n: Any) => n.kind === "say" && n.text === "It's already in. Keep it, or does it need changes?"), 5000, 50)
        check("proof: Show me plays its video by the notch (a video card at the top), says each step's words as it comes, then the choice: merged, it's already in, Keep or Needs changes",
          sst === 200 && sb.video === vb.video && v?.at?.area === "top" && /The%20blue%20heading\.mp4/.test(v?.url ?? "") && !!both && !!choice &&
          !!already && choice.drawing.marks.filter((k: Any) => k.type === "button").map((k: Any) => k.label).join() === "Keep,Needs changes",
          { buttons: choice?.drawing.marks.map((k: Any) => k.label), already, said: (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say").map((n: Any) => n.text).slice(-3), sst, sb, v, both })
        check("proof: its choice card says, under its answers, that their Talk key's words go to that job", /^Or hold your Talk key and say what to change: it goes to "Make the heading blue"\.$/.test(choice?.drawing.hint ?? ""), choice?.drawing.hint)
        // (their words next, not a choice, over another note: about the job just shown, told the companion and the job; asked
        // long ago here, so no later handoff takes them as its ask)
        const fb = c.addMoment({ kind: "ask", for: "Claude", text: "the heading is too big now, make it smaller", path: "Inbox/Status bar.md", line: 28, t: Date.now() - 20 * 60_000 }) as Any
        const fbText = c.momentsText([fb], "pair", null), next = c.addMoment({ kind: "ask", for: "Claude", text: "what's on my calendar", path: "Inbox/Status bar.md", line: 3, t: Date.now() - 20 * 60_000 }) as Any
        check("proof: their next ask after it (not a choice), over another note, is marked as about the job just shown: its line says so, the job is told they just watched it; the ask after, not",
          fb?.reviewed === card.id && fbText.includes(`just after they watched job ${card.id} "Make the heading blue"`) && fbText.includes(`handoff --job ${card.id}`) &&
          J.followTask("Smaller", fb, card.id).startsWith("They just watched your demo (Show me)") && !J.followTask("Smaller", fb, "other").startsWith("They just") && !next?.reviewed,
          { fb: fb?.reviewed, fbText, next: next?.reviewed })
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
        !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "Passed that on to its job."), 3000, 50)), [st, b, told])
      check("handoff --job: a follow-up carries the user's own words and screen once, one line",
        J.followTask("Darker", { t: 1, seq: 1, kind: "ask", text: "make it darker", voice: true, app: "com.example.browser", title: "Site", shot: "/s.png" } as Any) ===
          'Darker (The user, through their companion: They said (dictated, so it may hold slips: go by the task): "make it darker" · Where: on their screen, in "Site" (com.example.browser) · Their screen then (a picture): /s.png)' &&
        J.followTask("Darker", undefined) === "Darker")
      {
        // (who told it what: the companion's own turn here, read wherever the job is)
        turn = { text: "Darker now.", files: [], at: Date.now(), final: false, prompt: "Use the darker blue" }
        const r = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: card.id }))[1]; return r.last?.by && r }, 5000, 100)
        const text = r ? J.jobText(r) : "", line = J.jobsLine([r]), list = J.jobsText([r])
        check("handoff --job by the companion: its job says so, in its JSON, its text (told last by), its line in the companion's asks and in jobs",
          r?.by === "the companion (Claude)" && r.tells?.at(-1)?.by === "the companion (Claude)" && text.includes("handed off by the companion (Claude)") &&
          text.includes("told last (by the companion (Claude)): Use the darker blue") && line.includes("told last by the companion (Claude)") && list.includes("told last by the companion (Claude)"), [r?.by, r?.tells, r?.last, text])
        check("jobs: a prompt no handoff sent, typed in its tab since, is the user's in its terminal; else no one's said",
          J.toldBy({ tells: r.tells, started: 0 }, "something else", Date.now() + 1000) === "you, in its terminal" && J.toldBy({ tells: r.tells, started: 0 }, "something else", 1) === "" &&
          J.toldBy({ tells: r.tells, started: 0 }, "Use the darker blue", Date.now() + 1000) === "the companion (Claude)")
        turn = null
      }
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
        // (said since `from`: a count of all would drop as older lines' time on screen ends)
        const says = async (from: number) => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say" && n.t >= from).length
        c.screenMoment({ kind: "ask", agent: "Claude", text: "download this video please", app: "com.example.browser", title: "Clips", sx: 10, sy: 20 })
        // (a handoff's line is held a moment for the turn's next one: an earlier one's said first)
        await new Promise((r) => setTimeout(r, 700))
        const from = Date.now(), ended: string[] = []
        for (const [by, task] of [[agent, "Skip the pointer when unwatched"], [script, "Sync the design hub"]] as const) {
          const [st, b] = await api("POST", "ops/companion.handoff", { task, say: "Handed that off.", cwd: repo }, by)
          ended.push(b.id)
          const prompt = said.at(-1)?.prompt ?? ""
          check(`handoff from ${by === agent ? "another agent's vau" : "a script"}: its task alone, without the companion's latest ask; nothing said in its voice`,
            st === 200 && prompt.includes(task) && !prompt.includes("download this video") && !/through their companion/.test(prompt) && await says(from) === 0, [st, b, prompt])
          const j = (await api("POST", "ops/companion.job", { id: b.id }))[1]
          check(`handoff from ${by === agent ? "another agent's vau" : "a script"}: its job says who handed it off, never the companion`,
            j.by === (by === agent ? "another agent, not the companion: Claude Code" : "not the companion: vau from a shell or script"), j.by)
        }
        {
          // (another session's follow-up to a job, from its own terminal: the job says that one told it, not the companion)
          const other = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code", "x-vaultite-terminal": "claude-watcher1" } } as unknown as IncomingMessage
          const [st] = await api("POST", "ops/companion.handoff", { task: "Also keep the pointer when watched", job: ended[0] }, other)
          const by = "another agent, not the companion: Claude Code in terminal claude-watcher1"
          turn = { text: "Kept it.", files: [], at: Date.now(), final: false, prompt: "Also keep the pointer when watched" }
          const r = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: ended[0] }))[1]; return r.last?.by && r }, 5000, 100)
          turn = null
          check("handoff --job from another agent's vau: its job says that agent told it (its terminal), never the companion",
            st === 200 && r?.tells?.at(-1)?.by === by && J.jobText(r).includes(`told last (by ${by}): Also keep the pointer when watched`) && J.jobsLine([r]).includes(`told last by ${by}`), [st, r?.tells, r?.last])
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
            !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.agent === "Ada" && n.text === "Handed that off to a background agent."), 3000, 50)), [st, b, said.at(-1)?.prompt])
        } finally { fs.rmSync(sess, { force: true }) }
        for (const id of ended.filter(Boolean)) await asItsTool(() => api("POST", "ops/companion.job-stop", { id }, agent)).catch(() => {})
      }
      fs.mkdirSync(path.join(tmp, "Work"), { recursive: true })
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix it", say: "On it.", cwd: path.join(tmp, "Work") }, agent))
      check("handoff: a folder jobs never run in is refused, saying why", st === 403 && /Work runs elsewhere/.test(b.error), [st, b])
      const before = (await api("POST", "ops/companion.jobs", {}))[1].jobs.length
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix it", cwd: "~/no-such-repo-here" }, agent))
      check("handoff: a folder that isn't here (nor on a machine jobs prefer) is refused at once, no job left failed",
        st === 404 && /no folder ~\/no-such-repo-here, nor a checkout of no-such-repo-here \(looked in /.test(b.error) && /Leave cwd out/.test(b.error) && (await api("POST", "ops/companion.jobs", {}))[1].jobs.length === before, [st, b])
      {
        // A model said as people say it ("a Fable 5.2 on medium effort") reaches Claude Code by its id, its card naming it
        // plainly; one Claude Code can't run is refused at the handoff, so the companion can say so, and no job is left.
        const started: string[] = []
        for (const [model, id, name] of [["Fable 5.2", "claude-fable-5-2", "Fable 5.2"], ["opus 55", "claude-opus-5-5", "Opus 5.5"]]) {
          ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Discuss the plan", model, effort: "medium", cwd: repo }, agent))
          if (b?.id) started.push(b.id)
          check(`handoff --model "${model}": Claude Code is started on ${id}, its card says Claude Code ${name}`, st === 200 && said.at(-1)?.model === id && said.at(-1)?.effort === "medium" &&
            String(b.where).includes(`Claude Code ${name}`), [st, b?.where, said.at(-1)?.model])
        }
        for (const id of started) await asItsTool(() => api("POST", "ops/companion.job-stop", { id }, agent)).catch(() => {})
        const count = (await api("POST", "ops/companion.jobs", {}))[1].jobs.length, starts = said.length
        ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Discuss the plan", model: "gpt 5", cwd: repo }, agent))
        check("handoff --model a name Claude Code can't run: refused at once, saying what it takes; no job, nothing started",
          st === 400 && /'gpt 5' isn't a model Claude Code runs: sonnet, opus, haiku, fable/.test(b.error) && said.length === starts &&
          (await api("POST", "ops/companion.jobs", {}))[1].jobs.length === count, [st, b])
        // (every start of Claude Code takes it so: a terminal started with one too)
        const t = `claude-modeltest${Date.now() % 1000}`
        ;[st, b] = await api("POST", "ops/terminal.start", { agent: "claude", model: "Haiku 5.5", prompt: "hi" })
        check("terminal start --model \"Haiku 5.5\": Claude Code runs claude-haiku-5-5", st === 200 && said.at(-1)?.model === "claude-haiku-5-5", [st, b, said.at(-1)?.model])
        if (b?.id) await api("DELETE", `terminals/${b.id}`).catch(() => {})
        ;[st, b] = await api("POST", `terminals/${t}`, { model: "gemini 3", prompt: "hi" })
        check("terminal route: a model Claude Code can't run is refused, no terminal started", st === 400 && /isn't a model Claude Code runs/.test(b.error) && said.at(-1)?.model === "claude-haiku-5-5", [st, b])
      }
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
      const going = await waitFor(async () => { const r = await job(b.id); return r.state === "working" && /^waits on its task in the background: Wrote the summary/.test(r.now) && r }, 15000, 200)
      check("jobs: its turn over while it runs something in the background, it stays working, saying it waits on that; its terminal stays",
        st === 200 && !!going && await runs(first) && !going.closed && !going.log.some((x: Any) => x.to === "done" || x.to === "ready for review"), going ?? await job(b.id))
      background = 0
      const done = await waitFor(async () => { const r = await job(b.id); return r.state === "done" && r }, 25000, 200)
      check("jobs: its background tasks over and its turn after them ended, it's done", !!done, await job(b.id))
      const closed = await waitFor(async () => { const r = await job(b.id); return r.closed && r }, 10000, 200)
      check("jobs: done a while, its terminal closes by itself; it stays done, its result and questions kept, resuming from its card",
        !!closed && closed.state === "done" && closed.terminal === "resume-claude-sess-tidy" && /Wrote the summary/.test(closed.result?.text ?? "") &&
        closed.last?.asks?.[0] === "Should I add it to Today?" && !!(await waitFor(async () => !(await runs(first)), 5000, 100)), closed)
      const [st2, b2] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Yes, add it", job: b.id, title: "Summary on Today" }, agent))
      const resumed = started.at(-1)
      check("handoff --job on a closed job: its conversation resumed with the follow-up, renamed as asked",
        st2 === 200 && b2.state === "working" && b2.title === "Summary on Today" && b2.link === "view:terminal/resume-claude-sess-tidy" && resumed?.resume === "sess-tidy" &&
        resumed?.prompt === "Yes, add it" && !!(await waitFor(() => runs("resume-claude-sess-tidy"), 5000, 100)), [st2, b2, resumed])
    } finally {
      Wk.tidyAfter(120_000)
      Object.assign(cc, was)
      for (const k of Object.keys(cc)) if (!(k in was)) delete cc[k]
      for (const id of [first, "resume-claude-sess-tidy"]) if (id) await api("DELETE", `terminals/${id}`).catch(() => {})
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

  // A picture another machine's companion hands on for a job here: kept out of the vault, by the helper's name only.
  {
    const { Readable } = await import("node:stream")
    const take = (name: string, bytes: Buffer) => app.runOp("companion.picture-take", { name }, { input: Readable.from([bytes]) }).then((r) => r.result as Any, (e: Error) => e.message)
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 1)])
    const got = await take("close-3-44.png", png), bad = await take("../x.png", png), notPng = await take("display-1-2.png", Buffer.from("hello"))
    check("picture-take: a picture handed on is kept on this machine, out of the vault, and its path answered; a name not the helper's, or not a PNG, refused",
      typeof got?.path === "string" && got.path.endsWith(path.join("screens", "close-3-44.png")) && !got.path.startsWith(VAULT) && fs.readFileSync(got.path).equals(png) &&
      /isn't a picture of the screen's name/.test(bad) && /isn't a PNG/.test(notPng), [got, bad, notPng])
  }

  // Another machine's job: where and its worker asked of that machine's companion, its terminal started and ended there.
  {
    const http = await import("node:http")
    const calls: Any[] = []
    let stage = "working", farHas = true, landed = false
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", (d) => chunks.push(d))
      req.on("end", () => {
        const [op, qs] = req.url!.replace("/api/ops/", "").split("?"), raw = Buffer.concat(chunks), png = op === "companion.picture-take"
        const p = png ? { ...Object.fromEntries(new URLSearchParams(qs)), bytes: raw.length } : raw.length ? JSON.parse(String(raw)) : {}
        calls.push({ op, p, client: req.headers["x-vaultite-client"] })
        const out: Any = png ? { path: `/home/alice/.vaultite/local/companion/screens/${p.name}` } : op === "companion.where" ? (farHas ? { cwd: "/home/alice/Projects/site", repo: "site", base: "abc123", why: "as asked", refused: "" }
            : { cwd: "/home/alice/Vault", repo: "", base: "", why: "nothing on screen named a project: the vault", from: "vault", refused: "" })
          : op === "terminal.start" ? { id: "claude-remote1" }
          : op === "companion.worker" ? (stage === "working" ? { running: true, state: "working", title: "✳ Editing the header", typed: Date.now(), ...(p.turn ? { turn: { text: "", files: [], at: 0, final: false, session: "rs1" } } : {}) }
            : stage === "gone" ? { running: false, exit: { code: 0, signal: 1 }, ...(p.turn ? { turn: { text: "Shipped the header.", files: ["/home/alice/Projects/site/a.ts"], at: Date.now(), final: false, session: "rs1" }, diff: "1 file changed, +2 -1" } : {}) }
            : stage === "landed" ? (p.cwd ? { running: false, onMain: landed, marks: { whole: "a".repeat(40), each: ["b".repeat(40)] } } : null)
            : { running: true, state: "idle", ...(p.turn ? { turn: { text: "Header done. Try https://studio.tail1.ts.net:8450", files: ["/home/alice/Projects/site/a.ts"], at: Date.now(), final: true }, diff: "1 file changed, +2 -1" } : {}) })
          : op === "terminal.end" ? { id: "claude-remote1" } : op === "terminal.send" ? { submitted: true } : {}
        // (its machine failing to read its terminal)
        if (out === null) return void res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "no such terminal" }))
        const none = op === "claude-code.limits" && p.account === "nope"
        res.writeHead(none ? 404 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(none ? { error: "no Claude Code account 'nope' (default, personal)" } : out))
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
        !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "Handed that off to a background agent."), 3000, 50)))
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
      // Its machine offline: a new job waits for it (shown so), a follow-up waits on its job, each sent once it's back.
      {
        const Wk = await import("../../../plugins/core/companion/workers.ts")
        Wk.flushEvery(1)
        await api("PATCH", "config/plugin/companion", { mode: "quiet" })
        await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].mode !== "off", 5000, 50)
        const says = async () => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say").map((n: Any) => n.text)
        const card = async (id: string) => (await api("POST", "ops/companion.jobs", {}))[1].jobs.find((x: Any) => x.id === id)
        ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Say hi", machine: "studio", cwd: "~/Projects/site", account: "nope" }, agent))
        check("handoff --account: an account that machine hasn't is refused, saying which there are", st === 404 && /nope/.test(b.error) && /personal/.test(b.error), [st, b])
        studio.online = false
        calls.length = 0
        ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix the footer", machine: "studio", cwd: "~/Projects/site", account: "personal" }, agent))
        const waiting = b
        check("handoff to a machine that's offline: kept as a job waiting for it, in that account, said so; nothing started",
          st === 200 && b.state === "waiting" && b.queued === true && /Waiting for Studio to come back/.test(b.now) && /Personal/.test(b.where) && !calls.some((c) => c.op === "terminal.start") &&
          !!(await waitFor(async () => (await says()).includes("Studio is offline: the job starts there once it's back."), 3000, 50)), [st, b, calls])
        ;(await import("../../../plugins/core/companion/plugin.ts")).screenMoment({ kind: "ask", agent: "Claude", text: "and make it red. Also, can you run things on my personal account?", app: "com.example.browser", title: "Site", sx: 10, sy: 20 })
        ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make it red", job: waiting.id, ask: false }, agent))
        check("handoff --job to a job still waiting for its machine: added to its task, said so", st === 200 && b.state === "waiting" && !!(await waitFor(async () => (await says()).at(-1) === "Studio is still offline: that goes to its job once it's back.", 3000, 50)), [st, b])
        ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make it red", job: waiting.id }, agent))
        check("handoff --job: the same follow-up again isn't kept twice", st === 200 && !!(await waitFor(async () => (await says()).at(-1) === "That's already waiting for Studio.", 3000, 50)), [st, b])
        studio.online = true
        const begun = await waitFor(() => calls.find((c) => c.op === "terminal.start"), 15000, 200)
        check("a job waiting for its machine starts there once it's back: in its account and folder, told its follow-up, never their words a follow-up left out",
          begun?.p.agent === "claude_personal" && begun.p.cwd === "/home/alice/Projects/site" && /Fix the footer/.test(begun.p.prompt) && /Also: Make it red/.test(begun.p.prompt) &&
          !/personal account\?/.test(begun.p.prompt), begun?.p)
        const started = await waitFor(async () => { const r = await card(waiting.id); return r && r.state !== "waiting" && r }, 10000, 200)
        check("a job started once its machine is back is no longer waiting", !!started && started.terminal === "claude-remote1" && !started.queued, started)
        studio.online = false
        ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Use bigger text", job: waiting.id }, agent))
        check("handoff --job to a job whose machine went offline: kept, its card waiting, said so",
          st === 200 && b.state === "waiting" && /to pass on a follow-up/.test(b.now) && !!(await waitFor(async () => (await says()).at(-1) === "Studio is offline: I'll pass that on to its job once it's back.", 3000, 50)) &&
          !calls.some((c) => c.op === "terminal.send"), [st, b])
        studio.online = true
        const sent = await waitFor(() => calls.find((c) => c.op === "terminal.send"), 15000, 200)
        check("a follow-up kept for its machine is typed in once it's back, and its card no longer waits",
          sent?.p.id === "claude-remote1" && /^Use bigger text/.test(sent.p.text) && !!(await waitFor(async () => !(await card(waiting.id))?.queued, 5000, 200)), sent?.p)
        Wk.flushEvery(5)
        // Several handoffs in one turn (one tool call each, at once): one line naming the jobs, never the default line per call.
        const more: string[] = []
        for (const task of ["Ship the video card", "Fix dictation dropping words"]) {
          const was = (await says()).at(-1)
          ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task, say: `On it: ${task}.`, machine: "studio", cwd: "~/Projects/site" }, agent))
          more.push(b.id)
          await waitFor(async () => (await says()).at(-1) !== was, 3000, 50)
        }
        const was = (await says()).at(-1)
        const all = await asItsTool(() => Promise.all([waiting.id, ...more].map((job) => api("POST", "ops/companion.handoff", { task: "They can merge on their own", job, ask: false }, agent))))
        await waitFor(async () => (await says()).at(-1) !== was, 3000, 50)
        await new Promise((r) => setTimeout(r, 700))
        const tail = (await says()).slice(-2), last = tail[1] ?? ""
        check("handoffs in one turn: one line naming the jobs, said once", all.every(([st]) => st === 200) && tail[0] === was &&
          /^Passed that on to three jobs: [^.]+\.$/.test(last) && ["Fix the footer", "Ship the video card", "Fix dictation dropping words"].every((x) => last.includes(x)), [all.map(([st, b]) => [st, b.error]), tail])
        for (const id of more) await asItsTool(() => api("POST", "ops/companion.job-stop", { id }, agent)).catch(() => {})
        await asItsTool(() => api("POST", "ops/companion.job-stop", { id: waiting.id }, agent)).catch(() => {})
      }
      // Nothing tying it here (no machine, no folder, no preview or editor): to the always-on machine with this vault.
      Object.assign(studio, { standalone: true, vault: "v1" })
      ms["machines"] = async () => [{ id: "lap", label: "Lap", url: "http://127.0.0.1:1", online: true, self: true, plugins: ["terminal", "companion"], vault: "v1" }, studio]
      ms["machines:vault"] = () => "v1"
      stage = "working"
      calls.length = 0
      // (its own ask over the GitHub page: an earlier block's may be no longer the last; heard only while the companion is on)
      await api("PATCH", "config/plugin/companion", { mode: "quiet" })
      await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].mode !== "off", 5000, 50)
      // (its pictures in the helper's folder here, under a name with a space as Application Support's)
      const shots = path.join($.tmp, "Vaultite Main", "screens"), shot = path.join(shots, "display-7-1001.png"), close = path.join(shots, "close-7-1002.png")
      fs.mkdirSync(shots, { recursive: true })
      const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 7)])
      fs.writeFileSync(shot, pngBytes); fs.writeFileSync(close, pngBytes.subarray(0, 1200))
      ;(await import("../../../plugins/core/companion/plugin.ts")).screenMoment({ kind: "ask", agent: "Claude", text: "research the header", app: "com.example.browser", title: "Site", screen: "https://github.com/lighthouse/site", sx: 10, sy: 20,
        shot, shotAt: { x: 0, y: 0, width: 800, height: 600 }, closeUp: { shot: close, at: { x: 0, y: 0, width: 100, height: 60 }, scale: 3, mark: "pointer" } })
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Research the header", say: "On it." }, agent))
      job = b
      check("handoff with nothing tying it here (the ask's GitHub page): on the always-on machine, only the page passed on", st === 200 && b.where.startsWith("Studio") && /Studio \(always on\)/.test(b.why) &&
        JSON.stringify(calls.find((c) => c.op === "companion.where")?.p) === JSON.stringify({ url: "https://github.com/lighthouse/site" }), [st, b, calls])
      const told = calls.find((c) => c.op === "terminal.start")?.p.prompt ?? "", took = calls.filter((c) => c.op === "companion.picture-take")
      check("handoff on another machine: the ask's picture and close-up copied there (machine to machine), the worker told their paths there, never this one's",
        took.map((c) => `${c.p.name}:${c.p.bytes}`).sort().join() === "close-7-1002.png:1200,display-7-1001.png:3008" && took.every((c) => c.client?.startsWith("machine/")) &&
        told.includes("Their screen then (a picture): /home/alice/.vaultite/local/companion/screens/display-7-1001.png") &&
        told.includes("(3× as large): /home/alice/.vaultite/local/companion/screens/close-7-1002.png") && !told.includes(shots), [took, told])
      await waitFor(async () => (await api("POST", "ops/companion.job", { id: job.id }))[1].session === "rs1", 10000, 200)
      stage = "gone"
      const shipped = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job.id }))[1]; return r.state !== "working" && r }, 15000, 300)
      const again = (await api("POST", "ops/companion.job", { id: job.id }))[1]
      check("jobs on another machine: a worker that closed itself after its changes is ready for review, read from its session, and stays so",
        shipped?.state === "ready for review" && /Shipped the header/.test(shipped.result?.text ?? "") && again.state === "ready for review" &&
        calls.some((c) => c.op === "companion.worker" && c.p.turn && c.p.session === "rs1"), [shipped, again.state])
      // Its terminal unreadable there now, its change landed later by anyone: looked for on main all the same (its marks
      // kept from its branch and passed back), and closed as done.
      const Wk = await import("../../../plugins/core/companion/workers.ts")
      stage = "landed"
      calls.length = 0
      Wk.shipEvery(300)
      try {
        const jobs = async () => (await api("POST", "ops/companion.jobs", {}))[1].jobs.find((x: Any) => x.id === job.id)
        const kept = await waitFor(async () => calls.some((c) => c.op === "companion.worker" && c.p.marks?.whole === "a".repeat(40)) && await jobs(), 10000, 100)
        check("jobs: one ready for review whose terminal can't be read stays so until its change is on main, its marks kept", kept?.state === "ready for review" && kept.marks?.each?.[0] === "b".repeat(40), kept)
        landed = true
        const closed = await waitFor(async () => { const r = await jobs(); return r?.state === "done" && r }, 10000, 100)
        check("jobs: one ready for review is done once its change is on main, its terminal unreadable on its machine", !!closed && closed.log.at(-1).ev === "landed" &&
          calls.some((c) => c.op === "companion.worker" && c.p.branch === `job-${job.id}` && c.p.cwd === "/home/alice/Projects/site"), [closed, calls.map((c) => c.p)])
      } finally { Wk.shipEvery(5 * 60_000) }
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
          // A repo named, with no machine nor folder: to the always-on machine when it has it and what a job starts from is pushed.
          const Wh = await import("../../../plugins/core/companion/where.ts")
          Wh.checkoutsIn(roots)
          farHas = true
          const byName = async () => {
            calls.length = 0
            const r = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make the header blue", repo: "site", say: "On it." }, agent))
            if (!String(r[1].link ?? "").includes("@")) ours.push(String(r[1].link ?? "").split("/").pop()!)
            else await asItsTool(() => api("POST", "ops/companion.job-stop", { id: r[1].id }, agent))
            return r
          }
          try {
            const head = g("rev-parse", "HEAD").trim()
            fs.appendFileSync(path.join(repo, "index.html"), "<p>wip</p>\n")
            ;[st, b] = await byName()
            const start = calls.find((c) => c.op === "terminal.start")
            check("handoff naming a repo checked out here, its commits pushed: on the always-on machine (uncommitted changes a worktree never takes don't tie it), from this commit, saying why",
              st === 200 && b.link.endsWith("@studio") && /^site is .*site here, all pushed: as asked, on Studio \(always on\)$/.test(b.why) &&
              JSON.stringify(calls.find((c) => c.op === "companion.where")?.p) === JSON.stringify({ url: "https://github.com/lighthouse/site" }) &&
              start?.p.cwd === "/home/alice/Projects/site" && (start?.p.prompt ?? "").includes(`${head.slice(0, 12)} (fetch that commit first if need be)`), [st, b, start?.p])
            g("checkout", "--", "index.html")
            fs.appendFileSync(path.join(repo, "index.html"), "<p>local</p>\n"); g("commit", "-qam", "local only")
            ;[st, b] = await byName()
            check("handoff naming a repo with a commit only here: it stays here, its why saying the commit would be missing there",
              st === 200 && !b.link.includes("@") && /1 unpushed commit it starts from would be missing on Studio: here\)$/.test(b.why) && !calls.some((c) => c.op === "companion.where"), [st, b])
            g("reset", "-q", "--hard", head)
            await api("PATCH", "config/plugin/companion", { jobs_machine: "here" })
            ;[st, b] = await byName()
            check("handoff naming a repo with jobs_machine here: it stays here, saying so", st === 200 && !b.link.includes("@") && /jobs_machine is here: here\)$/.test(b.why), [st, b])
            await api("PATCH", "config/plugin/companion", { jobs_machine: "auto" })
            farHas = false
            ;[st, b] = await byName()
            check("handoff naming a repo the always-on machine hasn't checked out: it stays here, saying so", st === 200 && !b.link.includes("@") && /not checked out on Studio: here\)$/.test(b.why), [st, b])
          } finally { Wh.checkoutsIn(); await api("PATCH", "config/plugin/companion", { jobs_machine: "auto" }) }
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
