import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { job as aJob, moment, plugin, request, socket, where } from "../fakes.ts"
import type { FileEdit } from "../../../plugins/core/claude-code/edits.ts"
import type { current } from "../../../plugins/core/terminal/terms.ts"

export default async ($: VaultTest) => {
  // (the companion acting: its own tool call, not any agent's vau)
  const { asItsTool } = await import("../../../plugins/core/companion/chat.ts")
  const { app, api, check } = $
  const L = await import("../../../plugins/core/companion/liveedit.ts")
  const Asks = await import("../../../plugins/core/companion/liveasks.ts")
  const U = await import("../../../plugins/core/companion/unedit.ts")
  const F = await import("../../../core/desktop/framediff.ts")
  const E = await import("../../../plugins/core/claude-code/edits.ts")
  const W = await import("../../../plugins/core/companion/where.ts")

  // A worker's transcript as spans: each message it was told (one typed mid-turn too), with the files changed after it.
  {
    const line = (o: object) => JSON.stringify(o)
    const lines = [
      line({ type: "user", timestamp: "2026-11-06T10:00:00Z", message: { role: "user", content: "Live edit L1: make the title Hi" } }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", content: "The file was updated" }] }, toolUseResult: { filePath: "/s/a.html", oldString: "Hello", newString: "Hi", replaceAll: false, originalFile: "<h1>Hello</h1>\n", structuredPatch: [] } }),
      line({ type: "attachment", attachment: { type: "queued_command", prompt: "Live edit L2: and a footer", origin: { kind: "human" } }, timestamp: "2026-11-06T10:00:05Z" }),
      line({ type: "user", message: { content: [{ type: "tool_result" }] }, toolUseResult: { type: "create", filePath: "/s/footer.html", content: "<footer/>\n", originalFile: null, structuredPatch: [] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", is_error: true }] }, toolUseResult: "Error: String not found" }),
      line({ type: "user", message: { content: [{ type: "text", text: "my own words" }] } }),
      "not json",
    ]
    const s = E.editSpans(lines)
    check("live edit: a transcript's spans are its messages (one typed mid-turn too), each with the edits made till the next, no tool's result or error a span",
      s.length === 3 && s[0].prompt!.startsWith("Live edit L1") && s[0].edits.length === 1 && s[0].edits[0].kind === "edit" && s[1].prompt!.startsWith("Live edit L2") &&
      s[1].edits[0].kind === "write" && s[1].edits[0].original === null && s[2].prompt === "my own words" && !s[2].edits.length && s[0].at === Date.parse("2026-11-06T10:00:00Z"), s)
  }

  // Whose edits: an ask's from its message, or from where its worker says it's on it (asks typed mid-turn all come first).
  {
    const e = (n: string): FileEdit => ({ file: `/s/${n}`, kind: "edit", old: "", new: n, all: false, original: null })
    const spans: Any[] = [{ prompt: "Live edit L1: a", edits: [] }, { prompt: "Live edit L2: b", edits: [] }, { prompt: "Live edit L3: c", edits: [] },
      { said: "L1:", edits: [e("a")] }, { said: "L2: rounding the card", edits: [e("b")] }, { said: "Now the footer.", edits: [] }, { said: "**L3**", edits: [e("c")] },
      { said: "Done: all three.", edits: [] }, { prompt: "my own words", edits: [e("d")] }]
    const of = (t: string) => Asks.editsFor(spans, t).map((x: Any) => x.new).join()
    const plain: Any[] = [{ prompt: "Live edit L4: x", edits: [e("x")] }, { prompt: "Live edit L5: y", edits: [e("y")] }]
    check("live edit: each ask's edits are those its worker made once it said it was on it (L2:), till the next; the user's own typed words end them",
      of("L1") === "a" && of("L2") === "b" && of("L3") === "c" && Asks.editsFor(plain, "L5").map((x: Any) => x.new).join() === "y" && Asks.editsFor(plain, "L4").map((x: Any) => x.new).join() === "x", [of("L1"), of("L2"), of("L3")])
  }

  // Undoing: its edits reversed latest first on the files as they are now; the user's edits stay; nothing on a conflict.
  {
    const files: Record<string, string | null> = { "/s/a.css": "h1 { color: red; }\np { margin: 0; }\n/* theirs */\n" }
    const read = (f: string) => (f in files ? files[f] : null)
    const edits: Any[] = [
      { file: "/s/a.css", kind: "edit", old: "color: blue", new: "color: red", all: false, original: "h1 { color: blue; }\np { margin: 0; }\n" },
      { file: "/s/a.css", kind: "edit", old: "margin: 4px", new: "margin: 0", all: false, original: "h1 { color: red; }\np { margin: 4px; }\n" },
    ]
    const r = U.unedit(edits, read)
    check("live edit: undo reverses each of the ask's edits, the user's own line since kept", r.ok && r.files.get("/s/a.css") === "h1 { color: blue; }\np { margin: 4px; }\n/* theirs */\n", r)
    files["/s/a.css"] = "h1 { color: green; }\np { margin: 0; }\n"
    const c = U.unedit(edits, read)
    check("live edit: undo refuses, writing nothing, when what it wrote was changed since", !c.ok && c.file === "/s/a.css" && /changed since/.test(c.why), c)
    files["/s/c.md"] = "one\nthree\n"
    const cut2 = U.unedit([{ file: "/s/c.md", kind: "edit", old: "two\n", new: "", all: false, original: "one\ntwo\nthree\n" }], read)
    files["/s/d.html"] = "<b>Hi</b> <i>Hi</i>\n"
    const twin = U.unedit([{ file: "/s/d.html", kind: "edit", old: "Hello", new: "Hi", all: false, original: "<b>Hi</b> <i>Hello</i>\n" }], read)
    files["/s/new.html"] = "<footer/>\n"
    const made = U.unedit([{ file: "/s/new.html", kind: "write", content: "<footer/>\n", original: null }], read)
    files["/s/new2.html"] = "<footer>theirs</footer>\n"
    const made2 = U.unedit([{ file: "/s/new2.html", kind: "write", content: "<footer/>\n", original: null }], read)
    check("live edit: a cut comes back in place; of the same words twice, the one it changed; a file it made goes, unless it changed since",
      cut2.ok && cut2.files.get("/s/c.md") === "one\ntwo\nthree\n" && twin.ok && twin.files.get("/s/d.html") === "<b>Hi</b> <i>Hello</i>\n" &&
      made.ok && made.files.get("/s/new.html") === null && !made2.ok, [cut2, twin, made, made2])
  }

  // Ringing what changed: two pictures of the window, the boxes that differ.
  {
    const w = 200, h = 120, px = (fill: (x: number, y: number) => number) => {
      const b = new Uint8Array(w * h * 4)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fill(x, y), i = (y * w + x) * 4; b[i] = b[i + 1] = b[i + 2] = v; b[i + 3] = 255 }
      return b
    }
    const a = px(() => 255), changed = px((x, y) => (x >= 40 && x < 90 && y >= 20 && y < 44 ? 0 : 255)), dot = px((x, y) => (x === 150 && y === 100 ? 0 : 255))
    const r = F.changedBoxes(a, changed, w, h), none = F.changedBoxes(a, a, w, h), noise = F.changedBoxes(a, dot, w, h), all = F.changedBoxes(a, px(() => 0), w, h)
    const b = r.boxes[0]
    check("live edit: what changed between two pictures is one box round it; the same picture nothing; a speck noise; most of it, the whole (no ring)",
      r.boxes.length === 1 && b.x <= 40 && b.y <= 20 && b.x + b.w >= 90 && b.y + b.h >= 44 && b.w <= 64 && !none.boxes.length && !none.whole && !noise.boxes.length && all.whole, [r, noise, all])
  }

  // What's the app's own: "undo that" and its kin, never an ask with more in it.
  check("live edit: undo that (and its kin) is the app's own; an ask about undoing, or more with it, isn't",
    ["undo that", "Undo.", "okay, undo that please", "revert it", "Undo the last change", "no, take that back", "undo", "undo that too", "Undo that one as well."].every(Asks.isUndo) &&
    !["how do I undo in vim?", "undo that and make it red", "undo the header change", "redo that"].some(Asks.isUndo))
  check("live edit: a plain question is the companion's; a change, one asked as a question, or anything unclear is the job's",
    ["what does this button do?", "Why is this red", "how does the filter work?", "OK, which font is this?", "is this the final logo?", "can you tell me what this link opens?", "Explain this section", "where does this go"].every(Asks.isQuestion) &&
    !["make this blue", "move that up", "can you make it blue?", "what if the title were bigger?", "why isn't the button centered?", "could we drop the footer?", "the header looks off", "how about a darker one?", "is it possible to add a logo?", "how do I add a page?", "", "undo that"].some(Asks.isQuestion),
    ["what does this button do?", "can you make it blue?", "why isn't the button centered?"].map((t) => [t, Asks.isQuestion(t)]))
  {
    const t = Asks.freshText({ title: "Landing page", on: "site:http://localhost:5173", where: where({ cwd: "/p/site", tree: "/p/site-j1", branch: "job-j1", base: "abc123" }), result: { text: "Made it blue." } },
      [{ tag: "L1", text: "make it blue" }, { tag: "L2", text: "a footer", undone: true }], "Live edit L3: now bigger")
    check("live edit: a worker starting fresh is told the job, its page, its worktree and diff, its asks so far (what's undone), then the next",
      /^You're taking over a job [^]*"Landing page"[^]*localhost:5173[^]*worktree \/p\/site-j1 \(branch job-j1\)[^]*diff abc123[^]*L1 "make it blue"; L2 "a footer" \(they undid it\)[^]*Made it blue\.[^]*Live edit L3: now bigger$/.test(t), t)
  }
  check("live edit: what an ask is over: a note, else a preview's site from its address, never GitHub",
    W.surfaceOf({ path: "Notes/A.md", url: "http://localhost:5173/x" }) === "note:Notes/A.md" && W.surfaceOf({ title: "Site", screen: "Address and search bar: localhost:5173/about" }) === "site:http://localhost:5173" &&
    W.surfaceOf({ screen: "github.com/lighthouse/site" }) === "" && W.surfaceOf(undefined) === "")
  check("live edit: only the page itself goes live: a browser's address or a web pane's, never a terminal or editor mentioning it",
    Asks.pageOf(moment({ app: "com.google.Chrome", title: "Site", screen: "Address and search bar: localhost:5173/about\nHello" })) === "site:http://localhost:5173" &&
    Asks.pageOf(moment({ url: "http://localhost:5173/x", pane: "t1" })) === "site:http://localhost:5173" && Asks.pageOf(moment({ path: "Notes/A.md" })) === "note:Notes/A.md" &&
    Asks.pageOf(moment({ app: "com.mitchellh.ghostty", title: "npm run dev", screen: "VITE ready\n  Local:   http://localhost:5173/\n" })) === "" &&
    Asks.pageOf(moment({ pane: "t2", screen: "  Local:   http://localhost:5173/" })) === "" &&
    Asks.pageOf(moment({ app: "com.todesktop.230313mzl4w4u92", screen: 'const site = "http://localhost:5173"' })) === "")
  {
    // (a job asked over a note may only research: it takes that note's asks once it changed it, never before)
    const job = (id: string, files?: string[]) => aJob({ id, state: "done", on: "note:Notes/Day.md", at: Date.now(), ...(files ? { result: { files } } : {}) })
    const jobs = [job("j1"), job("j2", ["~/vault/Notes/Other.md"])]
    const own = await plugin(path.join($.tmp, "live-edits-plugin"), "live-edits-test", $.vault)
    const unasked = () => { throw new Error("not asked here") }
    const live = L.liveEdits(own, { jobs: { list: () => jobs, find: unasked, tell: unasked, fresh: unasked, context: unasked, atMachine: unasked },
      ctx: unasked, say: unasked, seen: unasked, ring: unasked, fallback: unasked, desktop: unasked })
    const none = live.jobOn(moment({ path: "Notes/Day.md" }))
    jobs.push(job("j3", ["~/vault/Notes/Day.md"]))
    check("live edit: a note's asks go to a job only once it changed that note", !none && live.jobOn(moment({ path: "Notes/Day.md" }))?.id === "j3", none)
  }
  check("live edit: what its worker is told: tagged, change it now, a question answered, another's handed back",
    /^Live edit L3: [^]*make this change now[^]*\(not for me\)[^]*they undid[^]*They said: "make it red"$/.test(Asks.liveText("L3", moment({ t: 1, seq: 1, text: "make it red" }), ["(they undid L2)"])))

  // End to end: a job on a preview, then asks over that page go straight to it (no turn of the companion's), its turn's
  // end said; "undo that" takes back exactly its edits for the last ask, the user's own kept.
  if (process.platform !== "win32") {
    const cMoments = await import("../../../plugins/core/companion/momentstext.ts")
    const cScreen = await import("../../../plugins/core/companion/screensocket.ts")
    const { matchSocket } = await import("../../../core/plugins.ts")
    const heard: Any[] = [], sc = socket((d) => heard.push(JSON.parse(d)))
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc, request(), { wild: [], query: { screen: "1" } })
    const agent = request({ host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" }, { remote: "127.0.0.1" })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-")), repo = path.join(tmp, "site"), page = path.join(repo, "index.html")
    fs.mkdirSync(repo, { recursive: true })
    const { gitEnv } = await import("../../../core/gitenv.ts")
    execFileSync("git", ["init", "-q"], { cwd: repo, env: gitEnv() })
    fs.writeFileSync(page, "<h1>Hello</h1>\n")
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const osc = (s: string) => `printf '\\033]7501;state=${s}\\033\\\\'`
    // (a stand-in worker: rests, then each line typed in is a turn, ended when the test says (`end`), never on a clock:
    // the app runs in this process, and a busy one saw a turn end before the test set what it said)
    const go = path.join(repo, "go")
    const script = `sleep 0.3; ${osc("working")}; sleep 0.5; ${osc("idle")}; while IFS= read -r l; do ${osc("working")}; echo "$l" >> told.txt; ` +
      `case "$l" in *"Live edit L1:"*) perl -pi -e 's/Hello/Hi/' index.html;; *"Live edit L2:"*) perl -pi -e 's/Hello/Howdy/' index.html;; esac; ` +
      `while [ ! -e '${go}' ]; do sleep 0.05; done; rm -f '${go}'; ${osc("idle")}; done`
    const starts: Any[] = []
    cc["agent:claude"] = async (start: Any) => { starts.push(start); return { command: script, cwd: null } }
    let context: Any = null
    cc["agent-context:claude"] = async () => context
    let turn: Any = null
    const termState: (id: string) => ReturnType<typeof current> = app.plugins.find((p) => p.id === "terminal")!.services["terminal:state"]
    /** The worker's turn ends, saying `said`, once its terminal was seen working on it (a real one's turn lasts seconds;
     *  the stand-in's two state marks, a moment apart, may otherwise be read as one). */
    const end = async (said: Any) => {
      const t = String((await api("POST", "ops/companion.job", { id: job }))[1].terminal ?? "").split("@")[0]
      await waitFor(() => termState(t)?.state === "working", 10000, 20)
      turn = said
      fs.writeFileSync(go, "")
    }
    cc["agent-turn:claude"] = async () => turn
    cc["agent-edits:claude"] = async () => [{ prompt: "Live edit L1: …", at: 0, edits: [{ file: page, kind: "edit", old: "Hello", new: "Hi", all: false, original: "<h1>Hello</h1>\n" }] },
      { prompt: "Live edit L2: …", at: 0, edits: [{ file: page, kind: "edit", old: "Hello", new: "Howdy", all: false, original: "<h1>Hello</h1>\n<p>mine</p>\n" }] }]
    const told = () => (fs.existsSync(path.join(repo, "told.txt")) ? fs.readFileSync(path.join(repo, "told.txt"), "utf8") : "")
    const says = async () => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say").map((n: Any) => n.text)
    const over = { app: "com.example.browser", title: "Site", screen: "Address and search bar: localhost:5199/", sx: 10, sy: 20 }
    let job = ""
    const jobNow = async () => { const r = (await api("POST", "ops/companion.job", { id: job }))[1]; return [r.state, r.log?.slice(-3).map((x: Any) => `${x.from}>${x.to}`).join(" "), r.last?.text] }
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion", jobs_agent: "claude" })
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "make me a landing page", ...over })
      const [st, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make a landing page", cwd: repo }, agent))
      job = b.id
      turn = { text: "Made it.", files: [], at: Date.now() + 1500, final: true }
      const ready = await waitFor(async () => { const r = (await api("POST", "ops/companion.job", { id: job }))[1]; return !["starting", "working"].includes(r.state) && r }, 10000, 100)
      check("live edit: a job handed off over a preview is on that page", st === 200 && !!ready && (await api("POST", "ops/companion.jobs", {}))[1].jobs[0].on === "site:http://localhost:5199", [st, b, ready])

      await api("POST", "ops/companion.next", { timeout: 0 }); await api("POST", "ops/companion.next", { timeout: 0 })
      const heardFrom = heard.length
      const m = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "make the title say Hi", ...over })
      const typed = await waitFor(() => /Live edit L1: [^\n]*make the title say Hi/.test(told()) && fs.readFileSync(page, "utf8").includes("Hi") && told(), 8000, 50)
      check("live edit: the next ask over that page goes straight into its worker's terminal, tagged, no turn of the companion's first",
        !!typed && m?.live === job && fs.readFileSync(page, "utf8") === "<h1>Hi</h1>\n", [told(), m])
      const [hs, hb] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make the title say Hi", job }, agent))
      check("live edit: the companion handing the same ask on is refused: the job has it", hs === 409 && /already went straight to the job/.test(hb.error), [hs, hb])
      await end({ text: "Title says Hi now.", files: [page], at: Date.now(), final: true })
      const said = await waitFor(async () => (await says()).includes("Title says Hi now."), 10000, 100)
      check("live edit: its turn over with nothing to ring (no screen here), its few words are said", !!said, [await says(), await jobNow()])
      const liveStates = heard.slice(heardFrom).flatMap((x) => (x.t === "agent" && x.agent.name === "Claude" ? [`${x.agent.state}${x.agent.seen ? " seen" : ""}`] : [])).filter((x, i, xs) => x !== xs[i - 1]).join(", ")
      check("live edit: the companion's cursor shows it sent the ask on (a seen tick), then watches once the job's words are said", liveStates === "watching seen, watching", liveStates)

      fs.appendFileSync(page, "<p>mine</p>\n")
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "Undo that.", ...over })
      const back = await waitFor(() => fs.readFileSync(page, "utf8") === "<h1>Hello</h1>\n<p>mine</p>\n", 8000, 50)
      check("live edit: undo that takes back exactly the last ask's edits, their own line since kept, and says so; its worker isn't asked",
        !!back && (await waitFor(async () => (await says()).includes("Undone."), 3000, 50)) && !/Undo that/.test(told()), [fs.readFileSync(page, "utf8"), await says(), told()])
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "undo", ...over })
      check("live edit: once it's all undone, another undo says there's nothing of its to undo",
        !!await waitFor(async () => (await says()).some((t: string) => /nothing of mine to undo/.test(t)), 3000, 50), await says())

      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "now a footer", ...over })
      const noted = await waitFor(() => /Live edit L2: [^\n]*they undid your change for L1[^\n]*now a footer/.test(told()), 8000, 50)
      check("live edit: its next ask tells it what was undone, so it knows what's on disk", !!noted, told())
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "undo that too", ...over })
      const later = await waitFor(async () => (await says()).includes("I'll undo it once it's done."), 3000, 50)
      await end({ text: "Footer added.", files: [page], at: Date.now(), final: true })
      const after = await waitFor(() => fs.readFileSync(page, "utf8") === "<h1>Hello</h1>\n<p>mine</p>\n", 10000, 50)
      check("live edit: undo said while it works waits for its turn's end, then takes back the ask it was on", !!later && !!after, [await says(), fs.readFileSync(page, "utf8"), await jobNow()])
      turn = null
      const q = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "what does this button do?", ...over })
      const qText = cMoments.momentsText(q ? [q] : [], "quiet", null)
      check("live edit: a plain question over the page goes to the companion, told the job there and what it was asked live",
        !q?.live && q?.pageJob === job && new RegExp(`over the page job ${job} [^\\n]*this question is yours[^\\n]*L2 "now a footer"[^\\n]*companion job ${job}`).test(qText) && !/what does this button do/.test(told()), [q, qText])
      const other = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "remind me to call Alice at five", ...over })
      await waitFor(() => /Live edit L3: /.test(told()), 8000, 50)
      check("live edit: anything not plainly a question goes to its job at once", other?.live === job, other)
      await end({ text: "(not for me)", files: [], at: Date.now(), final: true })
      const handed = await waitFor(() => !!other && other.live === undefined, 20000, 50)
      check("live edit: one its worker says isn't about the page goes to the companion after all, nothing said for it", !!handed && !(await says()).includes("(not for me)"), [other, await says()])

      // (its context grown large: the next ask starts a new conversation, told a summary, the old terminal ended)
      await waitFor(async () => !["starting", "working"].includes((await api("POST", "ops/companion.job", { id: job }))[1].state), 10000, 100)
      const was0 = String((await api("POST", "ops/companion.jobs", {}))[1].jobs.find((x: Any) => x.id === job)?.terminal), n0 = starts.length
      context = { tokens: 150_000, window: 1_000_000 }
      turn = null
      const big = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "make the title bigger", ...over })
      const fresh = await waitFor(() => starts.length > n0 && starts.at(-1), 10000, 50)
      const moved = await waitFor(async () => { const r = (await api("POST", "ops/companion.jobs", {}))[1].jobs.find((x: Any) => x.id === job); return r?.terminal !== was0 && r }, 8000, 100)
      check("live edit: a worker grown large starts fresh for its next ask: a new conversation in a new terminal, told the job, its asks so far and the ask",
        big?.live === job && !!fresh && !fresh.resume && !!moved && /^You're taking over a job [^]*L1 "make the title say Hi" \(they undid it\)[^]*Live edit L4: [^]*make the title bigger/.test(fresh.prompt ?? "") && !/call Alice|\(not for me\) Read/.test(fresh.prompt), [fresh?.prompt, fresh?.resume, moved?.terminal, was0])
      context = null
    } finally {
      // (its settings back to the defaults: one left summoned_model "companion" and a later area's Talk key ask went unanswered)
      await api("PATCH", "config/plugin/companion", { mode: "off", agent: null, summoned_model: null, jobs_agent: null })
      sc.emit("close")
      Object.assign(cc, was)
      if (job) await asItsTool(() => api("POST", "ops/companion.job-stop", { id: job }, agent)).catch(() => {})
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}
