import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { agentLine, request, socket } from "../fakes.ts"
import { jobSite } from "./jobsite.ts"

export default async ($: VaultTest) => {
  const { asItsTool } = await import("../../../plugins/core/companion/chat.ts")
  const { VAULT, api, app, check, read, write } = $
  const J = await import("../../../plugins/core/companion/jobs.ts")
  const W = await import("../../../plugins/core/companion/where.ts")
  const { tmp, roots, repo, g, real, done } = jobSite()
  const { gitEnv } = await import("../../../core/gitenv.ts")

  // End to end: a handoff starts a worker in a terminal (a stand-in for Claude Code speaking OSC 7501), its job moves as
  // its terminal tells, ends ready for review with its diff; a steer types into it, a stop ends it.
  if (process.platform !== "win32") {
    const cMoments = await import("../../../plugins/core/companion/momentstext.ts")
    const cIntake = await import("../../../plugins/core/companion/intake.ts")
    const cScreen = await import("../../../plugins/core/companion/screensocket.ts")
    const { matchSocket } = await import("../../../core/plugins.ts")
    const heard: Any[] = [], sc = socket((d) => heard.push(JSON.parse(d)))
    // (the helper's socket, as its upgrade request comes: what its asks' ops run as)
    const helperReq = request({ host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" }, { remote: "127.0.0.1" })
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc, helperReq, { wild: [], query: { screen: "1" } })
    const agent = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" }, { remote: "127.0.0.1" })
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const said: Any[] = []
    const osc = (s: string, more = "") => `printf '\\033]7501;state=${s}${more}\\033\\\\'`
    const b64 = (s: string) => Buffer.from(s).toString("base64")
    // (works, writes a file, rests; told to merge it once kept, works and rests; told more, works again; then asks a permission)
    // (it makes its worktree as told and edits there, never the checkout)
    const script = (tree: string) => `stty -icanon 2>/dev/null; sleep 0.5; ${osc("working", `:msg=${b64("Editing index.html")}`)}; sleep 1; ${tree} -q; (cd ${tree.split(" ")[5]} && echo '<p>blue</p>' >> index.html); ${osc("idle")}; ` +
      `IFS= read -r k; ${osc("working")}; echo "$k" > landed.txt; sleep 1; ${osc("idle")}; ` +
      `IFS= read -r l; ${osc("working")}; echo "$l" > told.txt; sleep 1; ${osc("blocked", `:kind=permission:msg=${b64("Bash(rm -rf build)")}`)}; sleep 600`
    // (the jobs' account, made up beside the test's own: what Claude Code's "Trust this folder?" is answered in)
    const personal = path.join(path.dirname(process.env.CLAUDE_CONFIG_DIR!), "claude-personal"), pj = path.join(personal, ".claude.json")
    fs.mkdirSync(personal, { recursive: true })
    fs.writeFileSync(pj, JSON.stringify({ numStartups: 2, projects: { "/elsewhere": { allowedTools: ["Bash"] } } }))
    const trusted = () => JSON.parse(fs.readFileSync(pj, "utf8")).projects?.[real]?.hasTrustDialogAccepted === true
    cc["agent:claude"] = async (start: Any) => { said.push({ ...start, trusted: trusted() }); return { command: agentLine(script(/git -C \S+ worktree add \S+ -b \S+ [0-9a-f]+/.exec(start.prompt ?? "")?.[0] ?? "false x x x /nowhere")), cwd: null } }
    let turn: Any = null
    cc["agent-turn:claude"] = async () => turn
    let card: Any = null
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion", jobs_agent: "claude_personal", jobs_never: [`${tmp}/Work: Work runs elsewhere`] })
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "make the heading blue", app: "com.example.browser", title: "Site", screen: `https://github.com/lighthouse/site`, sx: 10, sy: 20 })
      let [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make the heading blue", say: "On it: a session in site.", cwd: repo }, agent))
      card = b
      check("handoff: a job starting in a terminal, in the folder asked, as the jobs' account on Opus, high, auto; the companion says so",
        st === 200 && b.state === "starting" && /^view:terminal\/claude_personal-/.test(b.link) && b.where.includes("site") && b.where.includes("Personal") && b.where.includes("Claude Code Opus") &&
        said[0]?.profile === "personal" && said[0]?.model === "opus" && said[0]?.effort === "high" && said[0]?.mode === "auto" &&
        /Make the heading blue[^]*They said: "make the heading blue"[^]*don't push/.test(said[0]?.prompt ?? "") &&
        !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "On it: a session in site."), 3000, 50)), [st, b, said[0]])
      const cj = JSON.parse(fs.readFileSync(pj, "utf8"))
      check("handoff by the companion: its checkout is trusted in the job's account before Claude Code starts there, the rest of its config kept",
        said[0]?.trusted === true && cj.numStartups === 2 && cj.projects["/elsewhere"].allowedTools[0] === "Bash" && cj.projects[real].allowedTools?.length === 0 && !fs.existsSync(`${pj}.lock`), [said[0]?.trusted, cj])
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
        const win = socket((t) => {
          const m = JSON.parse(t)
          if (m.t === "things") setImmediate(() => win.emit("message", JSON.stringify({ t: "done", rid: m.rid, ok: true, window: { x: 0, y: 25, width: 1440, height: 875 }, things: [heading] })))
        })
        matchSocket(app.plugins, ["companion", "live"])![1].fn(win, request(), { wild: [], query: {} })
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
        const fb = cIntake.addMoment({ kind: "ask", for: "Claude", text: "the heading is too big now, make it smaller", path: "Inbox/Status bar.md", line: 28, t: Date.now() - 20 * 60_000 }) ?? undefined
        const fbText = cMoments.momentsText(fb ? [fb] : [], "pair", null), next = cIntake.addMoment({ kind: "ask", for: "Claude", text: "what's on my calendar", path: "Inbox/Status bar.md", line: 3, t: Date.now() - 20 * 60_000 })
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
        const unasked = async () => { throw new Error("not asked") }
        const opened: string[] = [], ctx = { vault: $.vault, who: whoOf("cli", null), plugin: "companion", api: unasked, ui: unasked, op: async (id: string, b: unknown) => { opened.push(`${id} ${JSON.stringify(b)}`); return {} } }
        const jo = app.plugins.find((x) => x.id === "companion")!.ops.find((o) => o.id === "companion.job-open")!
        await jo.run(checkParams(jo, { id: card.id, split: "right" }), ctx)
        check("job-open --split right: its terminal in a pane beside, not a new tab", opened.at(-1) === `ui.open ${JSON.stringify({ path: card.link, split: "right" })}`, opened)
      }
      turn = null
      ;[st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Use the darker blue", job: card.id }, agent))
      const told = await waitFor(() => fs.existsSync(path.join(repo, "told.txt")) && fs.readFileSync(path.join(repo, "told.txt"), "utf8").trim(), 10000, 100)
      check("handoff --job: typed into its worker's terminal, which goes on; with no say, it still says so in a line", st === 200 && told === "Use the darker blue" &&
        !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.text === "Passed that on to its job."), 3000, 50)), [st, b, told])
      check("handoff --job: a follow-up carries the user's own words and screen once, one line, where they were first and the ask last (a cut loses the context)",
        J.followTask("Darker", { t: 1, kind: "ask", text: "make it darker", voice: true, app: "com.example.browser", title: "Site", shot: "/s.png" }) ===
          '(Where the user was, through their companion: Where: on their screen, in "Site" (com.example.browser) · Their screen then (a picture): /s.png) Darker They said (dictated, so it may hold slips: go by the task): "make it darker"' &&
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
      // An ask about Vaultite itself (over its own panel, a menu over a page, or said so) runs in Vaultite's repo, whatever the
      // pane shows; their errands over a panel, and a note's or a page's own content, stay where they were.
      {
        const own = path.join(roots[0], "vaultite"), og = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: own, stdio: "pipe", env: gitEnv() }).toString()
        fs.mkdirSync(own, { recursive: true }); fs.writeFileSync(path.join(own, "README.md"), "app\n")
        og("init", "-q"); og("remote", "add", "origin", "git@github.com:Vaultite/vaultite.git"); og("add", "."); og("commit", "-qm", "first")
        const vt = fs.realpathSync(own), gh = "https://github.com/lighthouse/site"
        W.checkoutsIn(roots)
        const runs = async (m: Any, p: Any = {}) => {
          cIntake.addMoment({ kind: "ask", for: "Claude", summoned: true, ...m })
          const [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: m.text, ...p }, agent))
          const j = st === 200 ? (await api("POST", "ops/companion.job", { id: b.id }))[1] : null
          if (j) await api("POST", "ops/companion.job-stop", { id: b.id }, agent)
          return { st, cwd: j?.where.cwd ? (j.where.cwd === VAULT ? VAULT : fs.realpathSync(j.where.cwd)) : "", why: j?.where.why ?? b.error }
        }
        try {
          const panel = await runs({ text: "the agents list jumps when one finishes", ui: "panel:agents", title: "Agents" })
          check("handoff: an ask over Vaultite's own panel runs in Vaultite's repo, saying why", panel.cwd === vt && /^asked over Vaultite's own panel "Agents": Vaultite\/vaultite is /.test(panel.why), panel)
          const menu = await runs({ text: "why is there a gap under this", pane: "pgh", title: "lighthouse/site", url: gh, chrome: "menu", under: "Show hidden files" })
          check("handoff: an ask on the app's menu over a GitHub page runs in Vaultite's repo, not the page's checkout", menu.cwd === vt && /Vaultite's own menu/.test(menu.why), menu)
          const bar = await runs({ text: "it should say when this finishes downloading", pane: "pgh", title: "lighthouse/site", url: gh, chrome: "web viewer's bar" })
          const page = await runs({ text: "make this heading blue", pane: "pgh", title: "lighthouse/site", url: gh, under: "Lighthouse" })
          check("handoff: the web viewer's own bar is the app's; the page's content under it is the page's checkout", bar.cwd === vt && page.cwd === real, [bar, page])
          const told = await runs({ text: "your bubbles cover the note's last line", path: "Notes/Plan.md", line: 3 }, { about: "app" })
          check("handoff: about app (the companion's look, asked over a note) runs in Vaultite's repo, not the vault", told.cwd === vt && /^their ask is about Vaultite itself: /.test(told.why), told)
          const errand = await runs({ text: "file these under Errands", ui: "panel:inbox", title: "Inbox" }, { about: "work" })
          const note = await runs({ text: "tidy this list", path: "Notes/Plan.md", line: 3 })
          check("handoff: an errand over a panel (about work), and a note's own words, stay in the vault", errand.cwd === VAULT && note.cwd === VAULT, [errand, note])
          await (async function webViewerSites() {
            const { windows } = await import("../../../plugins/core/companion/state.ts")
            const mk = (name: string, slug: string, file: string, text: string) => {
              const dir = path.join(roots[0], name), g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir, stdio: "pipe", env: gitEnv() })
              fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), text)
              g("init", "-q"); g("remote", "add", "origin", `git@github.com:${slug}.git`); g("add", "."); g("commit", "-qm", "first")
              return fs.realpathSync(dir)
            }
            const harbor = mk("harbor", "lighthouse/harbor", "README.md", "app\n"), site = mk("harbor-site", "lighthouse/harbor-site", "wrangler.toml", 'routes = [{ pattern = "harbor.example", custom_domain = true }]\n')
            const win = socket()
            windows.set(win, { open: [], shown: [], focus: null, at: Date.now(), panes: [{ id: "psite", to: "view:web/https://harbor.example/", title: "Harbor - Private notes for you" },
              { id: "pnews", to: "view:web/https://news.example.org/today", title: "Today's news" }] })
            W.checkoutsIn(roots)
            try {
              const footer = { text: "take the tagline off the footer and redeploy", pane: "psite", title: "Harbor - Private notes for you", under: "Harbor\nDownload" }
              const over = await runs(footer, { repo: "harbor" })
              check("handoff: over the web viewer's page, the repo deploying its address wins over one the handoff named from its title", over.cwd === site && /harbor\.example is deployed from .*harbor-site.*\(not harbor, which the handoff named/.test(over.why), over)
              const idea = await runs({ text: "an idea for the Harbor website: render the hero in full glass", pane: "pnews", title: "Today's news" }, { repo: "harbor" })
              check("handoff: an idea for a product's website, asked over another site, runs in the checkout deploying the site, not the app's repo the handoff named",
                idea.cwd === site && idea.why.startsWith("their ask is about the website, and harbor deploys none: lighthouse/harbor-site is harbor's site (it deploys harbor.example): "), idea)
              const other = await runs({ text: "keep the gist of this in my notes", pane: "pnews", title: "Today's news" }, { repo: "harbor" })
              check("handoff: another site no checkout deploys, nor named like the repo, keeps the repo the handoff named", other.cwd === harbor, other)
              fs.rmSync(path.join(roots[0], "harbor-site"), { recursive: true, force: true }); W.checkoutsIn(roots)
              const gone = await runs(footer, { repo: "harbor" })
              check("handoff: a site of that name no machine has the checkout of refuses, saying so, never running in the repo of its name", gone.st === 404 && gone.cwd === "" &&
                /no machine has a checkout that deploys harbor\.example .*harbor is another repo/.test(gone.why), gone)
              const said = await runs({ ...footer, text: "do it in the harbor repo instead" }, { repo: "harbor" })
              check("handoff: their words naming the repo keep it, over the site", said.cwd === harbor, said)
            } finally { windows.delete(win); for (const d of fs.readdirSync(roots[0]).filter((d) => d.startsWith("harbor"))) fs.rmSync(path.join(roots[0], d), { recursive: true, force: true }) }
          })()
          W.checkoutsIn([path.join(tmp, "nothing")])
          const none = await runs({ text: "the agents list jumps", ui: "panel:agents", title: "Agents" })
          check("handoff: over the app's panel with no checkout of Vaultite anywhere (not a developer's), the vault as before, saying so",
            none.cwd === VAULT && /^asked over Vaultite's own panel "Agents", but .*no checkout of Vaultite\/vaultite.*: .*the vault/.test(none.why), none)
          // (their line said before the next ask comes, so it's filed under these)
          await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && /tidy this list/.test(n.text)), 5000, 50)
        } finally { W.checkoutsIn(); fs.rmSync(own, { recursive: true, force: true }) }
      }
      // Not the companion's: another agent's vau (an inbox-resumed session, a job) and a script share its `who`, never its voice or ask.
      {
        const script = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli" }, { remote: "127.0.0.1" })
        // (said since `from`: a count of all would drop as older lines' time on screen ends)
        const says = async (from: number) => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say" && n.t >= from).length
        // (a handoff's line is held a moment for the turn's next one: an earlier one's said first, before this ask)
        await new Promise((r) => setTimeout(r, 1500))
        cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "download this video please", app: "com.example.browser", title: "Clips", sx: 10, sy: 20 })
        const from = Date.now(), ended: string[] = []
        const untrust = () => { const j = JSON.parse(fs.readFileSync(pj, "utf8")); delete j.projects[real]; fs.writeFileSync(pj, JSON.stringify(j)) }
        untrust()
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
        check("handoff from another agent's vau or a script: Claude Code still asks to trust its folder", !trusted() && said.slice(-2).every((x) => x.trusted === false), said.slice(-2).map((x) => x.trusted))
        {
          // (a worktree is trusted as its checkout, as Claude Code reads it; a folder in no checkout isn't trusted this way)
          const wt = path.join(tmp, "site-trust")
          g("worktree", "add", "-q", wt, "-b", "trust-wt")
          const [tst, tb] = await api("POST", "ops/claude-code.trust", { cwd: wt, account: "personal" })
          const [nst, nb] = await api("POST", "ops/claude-code.trust", { cwd: tmp, account: "personal" })
          const [ast] = await api("POST", "ops/claude-code.trust", { cwd: repo, account: "nope" })
          check("claude-code trust: a worktree's main checkout trusted in that account; no checkout, or no such account, refused",
            tst === 200 && tb.checkout === real && tb.trusted === true && trusted() && nst === 404 && /isn't in a git checkout/.test(nb.error) && ast === 404, [tst, tb, nst, nb, ast])
          g("worktree", "remove", "--force", wt)
          g("branch", "-D", "trust-wt")
        }
        {
          // (another session's follow-up to a job, from its own terminal: the job says that one told it, not the companion)
          const other = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code", "x-vaultite-terminal": "claude-watcher1" }, { remote: "127.0.0.1" })
          const [st] = await api("POST", "ops/companion.handoff", { task: "Also keep the pointer when watched", job: ended[0] }, other)
          const by = "another agent, not the companion: Claude Code in terminal claude-watcher1"
          turn = { text: "Kept it.", files: [], at: Date.now(), final: false, prompt: "Also keep the pointer when watched" }
          const r = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: ended[0] }))[1]; return r.last?.by && r }, 5000, 100)
          turn = null
          check("handoff --job from another agent's vau: its job says that agent told it (its terminal), never the companion",
            st === 200 && r?.tells?.at(-1)?.by === by && J.jobText(r).includes(`told last (by ${by}): Also keep the pointer when watched`) && J.jobsLine([r]).includes(`told last by ${by}`), [st, r?.tells, r?.last])
        }
        const [, conv] = await api("POST", "ops/companion.conversation", {})
        const ex = conv.exchanges.findLast((e: Any) => e.text === "download this video please")
        check("handoff not the companion's: nothing filed under the user's ask in its conversation", !!ex && !ex.did.includes("handoff") && !ex.said.length, ex)
        // (a Codex companion's vau, from its own session's terminal: its own)
        const cp = app.plugins.find((x) => x.id === "companion")!, sess = path.join(cp.localDir(), "session-ada.json")
        fs.writeFileSync(sess, JSON.stringify({ id: "codex-adatest1", name: "Ada", t: Date.now() }))
        try {
          cScreen.screenMoment({ kind: "ask", agent: "Ada", text: "fix the footer", app: "com.example.browser", title: "Site", sx: 10, sy: 20 })
          const fromIts = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "codex", "x-vaultite-terminal": "codex-adatest1" }, { remote: "127.0.0.1" })
          const [st, b] = await api("POST", "ops/companion.handoff", { task: "Fix the footer", as: "Ada", cwd: repo }, fromIts)
          ended.push(b.id)
          check("handoff from a terminal companion's own session: it says so, and its ask goes with it", st === 200 && /fix the footer/.test(said.at(-1)?.prompt ?? "") &&
            !!(await waitFor(async () => (await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.kind === "say" && n.agent === "Ada" && n.text === "Handed that off to a background agent."), 3000, 50)), [st, b, said.at(-1)?.prompt])
        } finally { fs.rmSync(sess, { force: true }); cScreen.comeBack("Ada") }
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
        {
          const says = async (from: number) => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say" && n.agent === "Claude" && n.t >= from).map((n: Any) => n.text)
          await new Promise((r) => setTimeout(r, 700))
          cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "fix the footer and the header", app: "com.example.browser", title: "Site", sx: 10, sy: 20 })
          let from = Date.now()
          const both = await Promise.all(["Fix the footer", "Fix the header"].map((task) => asItsTool(() => api("POST", "ops/companion.handoff", { task, cwd: repo }, agent))))
          await new Promise((r) => setTimeout(r, 1200))
          const one = await says(from)
          check("handoff: a turn handing off two jobs is announced once, one line naming both", both.every(([st]) => st === 200) && one.length === 1 &&
            /^Handed off two jobs to background agents: Fix the (footer|header) and Fix the (footer|header)\.$/.test(one[0]) && one[0].includes("footer") && one[0].includes("header"), [both.map(([st, b]) => [st, b?.error]), one])
          for (const [, b] of both) if (b?.id) await asItsTool(() => api("POST", "ops/companion.job-stop", { id: b.id }, agent)).catch(() => {})
          cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "fix the sidebar", app: "com.example.browser", title: "Site", sx: 10, sy: 20 })
          from = Date.now()
          await asItsTool(() => api("POST", "ops/companion.say", { text: "I've handed it off to a background agent to fix." }, agent))
          const [ost, ob] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Fix the sidebar", cwd: repo }, agent))
          await new Promise((r) => setTimeout(r, 1200))
          const own = await says(from)
          check("handoff: a turn whose own words announced it says nothing more (the app's line not said again)", ost === 200 && own.join("|") === "I've handed it off to a background agent to fix.", [ost, ob?.error, own])
          if (ob?.id) await asItsTool(() => api("POST", "ops/companion.job-stop", { id: ob.id }, agent)).catch(() => {})
        }
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
      const asApp = request({ host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" }, { remote: "127.0.0.1" })
      const ends: string[] = [], linkEnd = (b: Any) => { const id = String(b.link ?? "").split("/").pop()!; ends.push(id); return id }
      write("Notes/Errands.md", "# Errands\n\n- [ ] Compare the two flights 📅 2026-12-01\n- [x] Book the car\n")
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "how tall is the lighthouse?", app: "com.example.browser", title: "Lighthouse", sx: 10, sy: 20 })
      const talk = async () => (await api("POST", "ops/companion.conversation", {}))[1].exchanges.findLast((e: Any) => e.text === "how tall is the lighthouse?")
      ;[st, b] = await api("POST", "ops/companion.do", { path: "Notes/Errands.md", line: 3, text: "Compare the two flights" }, asApp)
      linkEnd(b)
      check("Do it: a task line's worker is told its note and line, on Opus, and it goes in progress", st === 200 && b.state === "starting" && said.at(-1)?.model === "opus" &&
        /Notes\/Errands\.md \(line 3\): Compare the two flights/.test(said.at(-1)?.prompt ?? "") && read("Notes/Errands.md").includes("- [/] Compare the two flights 📅 2026-12-01"), [st, b, read("Notes/Errands.md")])
      await new Promise((r) => setTimeout(r, 600))
      const spoke = await talk()
      check("Do it: their own hand, so not the companion's answer to their last ask, nor that ask's words in the job",
        !!spoke && !spoke.did.includes("handed off") && !spoke.said.length && !/how tall is the lighthouse/.test(said.at(-1)?.prompt ?? "") && !(await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.text?.startsWith("On it: Compare")), [spoke, said.at(-1)?.prompt])
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
      const pwin = socket()
      matchSocket(app.plugins, ["companion", "live"])![1].fn(pwin, helperReq, { wild: [], query: {} })
      pwin.emit("message", JSON.stringify({ t: "where", open: [], shown: [], focus: null, at: Date.now(), active: true, panes: [{ id: "pjob", to: b.link, title: "Tidy the trip note", tab: "t1" }], pane: "pjob" }))
      cIntake.addMoment({ kind: "ask", for: "Claude", text: "so let's merge the heading one", pane: "pjob" })
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
      fs.rmSync(personal, { recursive: true, force: true })
    }
  }
  done()
}
