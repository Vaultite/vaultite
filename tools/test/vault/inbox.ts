import fs from "node:fs"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Any, VaultTest } from "./harness.ts"
import type { Turn } from "../../../plugins/core/inbox/needs.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  const { CLAUDE_DIR, VAULT, api, app, check, exists, read, sleep, tmp, write } = $
  const { vau } = $.vars
  let cr: Any
  // Inbox (plugins/core/inbox): results are files in Inbox/, events are kept on this machine (VAULTITE_LOCAL), hooks become events.
  {
    const { byThread, categoryOf, findEvent, fromHook, previewOf, prune, settled, waitsOnYou } = await import("../../../plugins/core/inbox/plugin.ts")
    const { judge, sure, SYSTEM } = await import("../../../plugins/core/inbox/needs.ts")
    const { service } = await import("../../../core/plugins.ts")
    check("inbox push: by default only what waits on you (a session that needs you, its report), not a quiet turn, an error or news",
      waitsOnYou({ kind: "waiting" }) && !waitsOnYou({ kind: "done" }) && !waitsOnYou({ kind: "error" }) && !waitsOnYou({ kind: "info" }))
    let [st, b] = await api("POST", "inbox", { title: "Plant care apps compared", body: "## Findings\n- One", from: "Claude", source: "https://example.com/tools" })
    check("inbox: a result is a file in Inbox/, new", st === 201 && read("Inbox/Plant care apps compared.md").startsWith("---\ntype: inbox\nstatus: new\nfrom: Claude\nsource: https://example.com/tools\ncreated: '") &&
      read("Inbox/Plant care apps compared.md").includes("## Findings"), [st, b])
    ;[st, b] = await api("POST", "inbox", { title: "Plant care apps, again", body: "Updated", source: "https://example.com/tools" })
    check("inbox: the same source again updates it", st === 201 && b.id === "Inbox/Plant care apps, again" && !exists("Inbox/Plant care apps compared.md") && read("Inbox/Plant care apps, again.md").includes("Updated"), [st, b])
    ;[st, b] = await api("PUT", "inbox/Plant care apps, again", { status: "done" })
    check("inbox: marked done, archived: into Inbox/.archive/", st === 200 && b.status === "done" && b.id === "Inbox/.archive/Plant care apps, again" && !exists("Inbox/Plant care apps, again.md") &&
      /status: done[\s\S]*archived: true/.test(read("Inbox/.archive/Plant care apps, again.md")) && read("Inbox/.archive/Plant care apps, again.md").includes("from: Claude"), b)
    ;[st, b] = await api("PUT", "inbox/Inbox/.archive/Plant care apps, again", { status: "new" })
    check("inbox: new again is out of the archive", st === 200 && b.id === "Inbox/Plant care apps, again" && !exists("Inbox/.archive/Plant care apps, again.md") &&
      read("Inbox/Plant care apps, again.md").includes("status: new") && !read("Inbox/Plant care apps, again.md").includes("archived"), b)
    ;[st, b] = await api("PUT", "inbox/Plant care apps, again", { archived: true })
    check("inbox: archived is done", st === 200 && b.status === "done" && read("Inbox/.archive/Plant care apps, again.md").includes("status: done"), b)
    ;[st, b] = await api("PUT", "inbox/Inbox/.archive/Plant care apps, again", { archived: false })
    check("inbox: unarchived is new", st === 200 && b.status === "new" && exists("Inbox/Plant care apps, again.md"), b)
    write("Inbox/Written by hand.md", "---\ntype: inbox\nstatus: maybe\n---\n\nA file.\n")
    ;[, b] = await api("GET", "inbox/Written by hand")
    const [, v] = await api("GET", "vault")
    check("inbox: a file written there is one, its bad status reported", b.title === "Written by hand" && v.problems.some((p: Any) => p.file === "Inbox/Written by hand.md" && /status/.test(p.problem)), [b, v.problems])
    write("Inbox/Written by hand.md", "---\ntype: inbox\nstatus: new\n---\n\nA file.\n")

    ;[st, b] = await api("POST", "inbox/events", { source: "backup", kind: "done", title: "Backup finished", body: "12 GB", link: "Notes/Backup.md" })
    check("inbox events: posted", st === 201 && b.event.id && b.event.kind === "done" && b.event.link === "Notes/Backup.md", [st, b])
    {
      const [, heard] = await api("POST", "ops/events.list", { types: ["inbox.event"] })
      const evs = (heard.events ?? heard) as Any[]
      check("inbox events: the vault's events hear of it (inbox.event)", evs.some((e: Any) => e.type === "inbox.event" && e.id === b.event.id && e.kind === "done" && e.link === "Notes/Backup.md"), heard)
    }
    ;[st, b] = await api("POST", "inbox/events", { source: "backup", kind: "done", title: "Backup finished", body: "13 GB" })
    let [, list] = await api("GET", "inbox/events")
    {
      // Only the backup's: an area run before this one (vault-plugins) can leave an event of its own.
      const backups = list.events.filter((e: Any) => e.source === "backup")
      check("inbox events: the same thing again soon after is one event, updated", backups.length === 1 && backups[0].body === "13 GB" &&
        backups[0].link === "Notes/Backup.md" && backups[0].read !== true, list)
    }
    {
      // Messages (vau notify) from one terminal in a row: each different one is its own event; the same words again merge.
      const msg = (title: string) => api("POST", "inbox/events", { source: "vau", kind: "info", title, terminal: "claude-m3ss4ges" })
      const ids = new Set<string>()
      for (const t of ["Imported 12 meals", "Wrote the weekly review", "Imported 12 meals"]) ids.add((await msg(t))[1].event.id)
      const [, l] = await api("GET", "inbox/events")
      check("inbox events: different messages from one terminal stay apart, the same one merges", ids.size === 2 &&
        l.events.filter((e: Any) => e.terminal === "claude-m3ss4ges").length === 2, l.events)
      for (const id of ids) await api("DELETE", `inbox/events/${id}`)
    }
    {
      // One of a kind (a key): a new one takes the place of its source's event with that key; inbox:drop takes it away.
      await api("POST", "inbox/events", { source: "lessons", kind: "info", title: "3 cards to review", key: "cards-due" })
      await api("POST", "inbox/events", { source: "lessons", kind: "info", title: "5 cards to review", key: "cards-due", link: "detail:review" })
      let [, l] = await api("GET", "inbox/events")
      const mine = (x: Any) => x.events.filter((e: Any) => e.source === "lessons")
      check("inbox events: a key keeps one of a kind, the newest", mine(l).length === 1 && mine(l)[0].title === "5 cards to review" && mine(l)[0].link === "detail:review", mine(l))
      ;(app.plugins.find((p) => p.id === "inbox")!.service("inbox:drop") as (source: string, key: string) => void)("lessons", "cards-due")
      ;[, l] = await api("GET", "inbox/events")
      check("inbox events: inbox:drop takes one of a kind away", mine(l).length === 0, mine(l))
    }
    ;[st] = await api("POST", "inbox/events", { source: "x" })
    check("inbox events: a title is required", st === 400, st)
    ;[st, b] = await api("POST", "inbox/events", { title: "Odd", kind: "Not A Kind", terminal: "../x" })
    check("inbox events: an unknown kind is info, a bad terminal left out", b.event.kind === "info" && !("terminal" in b.event) && b.event.source === "vau", b)
    {
      const title = "A long title ".repeat(40).trim(), body = "First line.\n\n" + "word ".repeat(400) + "\nLast line."
      ;[st, b] = await api("POST", "inbox/events", { title, body })
      check("inbox events: the title and body are kept whole (the body's lines too)", st === 201 && b.event.title === title && b.event.body === body.trim(), b.event)
      await api("DELETE", `inbox/events/${b.event.id}`)
      const day = 86_400_000, now = Date.now()
      const ev = (i: number, read: boolean, ago: number) => ({ id: `p${i}`, t: now - ago, source: "vau", kind: "info", title: `${i}`, read })
      const kept = prune([ev(0, false, 30 * day), ev(1, true, 30 * day), ...Array.from({ length: 500 }, (_, i) => ev(i + 2, i % 2 === 0, i * 1000))])
      check("inbox events: pruning keeps every unread one, old or past the cap; read ones go after the days, past 200",
        kept.some((e) => e.id === "p0") && !kept.some((e) => e.id === "p1") && kept.filter((e) => !e.read).length === 251 && kept.filter((e) => e.read).length === 200, kept.length)
    }
    // Needs you or done: what a turn's own words settle (an error, nothing said, a question last), else the model's
    // one word (once per turn), else it needs you.
    check("needs: an error, a question last, nothing said; the rest left to the model",
      sure({ text: "x", error: true })?.why === "error" && sure({ text: "Merged.\n\nShould I deploy it now?" })?.needs === true &&
      sure({ text: "Which one:\n```\nwhy?\n```\nRun it?" })?.needs === true && sure({ text: "  " })?.needs === false && sure({ text: "Merged and pushed." }) === null)
    {
      // Turns as real agents ended them (Claude Code on haiku), each the same verdict every time: by rule, or else for
      // the model (null), whose answers on these were measured stable (needs.ts' SYSTEM).
      const cases: [string, Turn, boolean | null][] = [
        ["a question last", { prompt: "Ask me a question.", text: "What would you like to work on in `lighthouse`? For example, I could look through the notes or set up something new.\n\nWhich one?" }, true],
        ["a question, then a short closing line", { prompt: "Ask me about my favorite color.", text: "What's your favorite color?\n\nTake your time." }, true],
        ["a choice, then what it'll do", { prompt: "Name the plugin", text: "Should it be called **Lighthouse** or **Beacon**?\n\nI'll set it up as soon as you pick." }, true],
        ["a question in a heading isn't one", { prompt: "Write the FAQ", text: "Wrote the FAQ into `Docs/FAQ.md`.\n\n## What is Lighthouse?\nAdded 6 answers." }, null],
        ["the user asked what: its answer", { prompt: "What's using the disk?", text: "Mostly caches (41 GB) and `node_modules` (14 GB).\n\nLet me know if you want me to clear the caches." }, true],
        ["the user asked how it's going", { prompt: "How is the migration going?", text: "Half done: 120 of 240 notes migrated, no errors so far." }, true],
        ["a request put as a question is left to the model", { prompt: "Can you fix the build?", text: "Fixed the build: a stale import in `core/index.ts`. Committed on main." }, null],
        ["here's what I found, to a look-and-tell", { prompt: "What kinds of files are in this folder? Look and tell me what you found.", text: "This folder is a vault of about 200 Markdown notes: daily notes, logs and projects." }, null],
        ["a report of work done", { prompt: "Create hello.txt containing hi.", text: "Created `hello.txt` containing `hi`." }, null],
        ["a failure", { prompt: "Read /nonexistent/config.yaml and tell me its port.", text: "The file doesn't exist, so I can't tell you its port setting." }, null],
        ["nothing said", { prompt: "Go on", text: "" }, false],
      ]
      const off = cases.filter(([, t, want]) => (sure(t)?.needs ?? null) !== want)
      check("needs: what a turn's words settle, the same each time; the rest for the model", !off.length, off.map(([why, t]) => [why, sure(t)]))
      check("needs: the model is asked for one word, told to keep the unsure on needs you", /exactly one word: NEEDS_YOU or DONE/.test(SYSTEM) && /When unsure, NEEDS_YOU/.test(SYSTEM))
      const { lastTurn } = await import("../../../core/agents.ts")
      const at = "2026-01-01T10:00:00Z", later = "2026-01-01T10:00:05Z"
      const said = lastTurn([{ kind: "user", text: "Go", at }, { kind: "assistant", text: "Looking.", at }, { kind: "tool", id: "1", name: "Bash", summary: "ls", input: "", result: "", error: false, at: later }])
      const answered = lastTurn([{ kind: "user", text: "Go", at }, { kind: "assistant", text: "Looking.", at }, { kind: "tool", id: "1", name: "Bash", summary: "ls", input: "", result: "", error: false, at }, { kind: "assistant", text: "Found 3.", at: later }])
      const none = lastTurn([{ kind: "user", text: "Go", at }])
      check("lastTurn: words before a tool call aren't the turn's last; no answer yet has no time",
        said.text === "Looking." && !said.final && answered.text === "Found 3." && answered.final && answered.at === Date.parse(later) && none.text === "" && none.at === 0 && !none.final, [said, answered, none])
    }
    {
      let asked = 0
      const said = (word: string) => async () => { asked++; return { text: word, truncated: false } }
      const done = await judge({ prompt: "Fix it", text: "Fixed and pushed to main." }, said("DONE"))
      const again = await judge({ prompt: "Fix it", text: "Fixed and pushed to main." }, said("NEEDS_YOU"))
      const odd = await judge({ prompt: "Fix it", text: "Fixed, odd word." }, said("Maybe"))
      const failed = await judge({ prompt: "Fix it", text: "Fixed, model down." }, async () => { throw new Error("rate limited") })
      const none = await judge({ text: "Fixed, no model here." }, null)
      check("needs: the model's word, once per turn; a word it doesn't know, a failure or no model: it needs you",
        !done.needs && done.by === "model" && !again.needs && asked === 2 && odd.needs && failed.needs && failed.by === "fallback" && none.needs, [done, again, odd, failed, none, asked])
    }
    // Hooks: Terminal's state command (state and prev), Claude Code's and Codex's JSON: a change of the session's state.
    check("hook: Stop is a turn's end with its last message; a prompt is working again", (fromHook({ hook_event_name: "Stop", last_assistant_message: "Done." }) as Any)?.text === "Done." &&
      (fromHook({ hook_event_name: "UserPromptSubmit", session_id: "s1" }) as Any)?.state === "working" && fromHook({ hook_event_name: "PostToolUse" }) === null)
    check("hook: Claude Code's Notification, but not its idle prompt", (fromHook({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }) as Any)?.msg === "Claude needs your permission to use Bash" &&
      fromHook({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" }) === null)
    check("hook: Codex's notify is a turn's end, its words and what was asked", (fromHook({ type: "agent-turn-complete", "thread-id": "t1", "last-assistant-message": "**Merged** and pushed.\nMore", "input-messages": ["Merge it"] }) as Any)?.text === "**Merged** and pushed.\nMore" &&
      (fromHook({ type: "agent-turn-complete", "input-messages": ["Merge it"] }) as Any)?.prompt === "Merge it")
    check("hook: what a waiting agent asks", (fromHook({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "x" }) as Any)?.kind === "permission" &&
      (fromHook({ hook_event_name: "Notification", notification_type: "elicitation_dialog", tool_input: { questions: [{ question: "Which port?" }] } }) as Any)?.msg === "Asks: Which port?")
    const rows = async () => { await settled(); return (await api("GET", "inbox/events"))[1].events as Any[] }
    ;[st, b] = await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Notification", notification_type: "permission_prompt", session_id: "abc", message: "Claude needs your permission to use Bash" })
    let row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("a session asking: its row needs you, saying what it asks, told (nt), named for the agent when nothing else names it", st === 200 && row?.kind === "waiting" && row.ask === "permission" &&
      row.body === "Claude needs your permission to use Bash" && row.session === "abc" && row.source === "claude" && row.title === "Claude Code session" && !row.read && row.nt === row.t, [st, row])
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "UserPromptSubmit" })
    check("answered (it works again: a prompt): read", (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")?.read === true)
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "Two ways:\n\n1. **Await** it\n2. Retry\n\nWhich one?" })
    let all = await rows()
    row = all.find((e) => e.terminal === "claude-k3j2h1g0")
    check("its turn ends with a question: the same row needs you, its answer whole, a plain preview",
      all.filter((e) => e.terminal === "claude-k3j2h1g0").length === 1 && row?.kind === "waiting" && row.ask === "answer" && !row.read &&
      row.body.includes("1. **Await** it") && row.preview === "Two ways: Await it Retry Which one?", row)
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "" })
    row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("a quiet turn after (it went on by itself): its answer still to read, as it was", !row?.read && row?.preview?.startsWith("Two ways"), row)
    await api("POST", "inbox/events/read", { ids: [row.id] })
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "" })
    row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("read, then a turn done with nothing for you: quiet (read, done, not told again)", row?.read === true && row.kind === "done" && !row.ask && !row.body, row)
    ;[st, b] = await api("POST", "inbox/hook?agent=codex", { type: "agent-turn-complete", "thread-id": "t9", cwd: "/tmp/lighthouse", "last-assistant-message": "Shall I merge it?" })
    row = (await rows()).find((e) => e.session === "t9")
    check("an agent's own hook outside the app: its folder names the session", row?.title === "lighthouse" && row.kind === "waiting" && row.source === "codex", row)
    await api("POST", "inbox/hook?agent=codex", { type: "agent-turn-complete", "thread-id": "t9", cwd: "/tmp/lighthouse", "last-assistant-message": "Should it be squashed?" })
    all = await rows()
    check("its next turn: the same row, told again only a minute later (the same need, unread)", all.filter((e) => e.session === "t9").length === 1 &&
      all.find((e) => e.session === "t9")?.nt === row.nt && all.find((e) => e.session === "t9")?.preview === "Should it be squashed?", all.filter((e) => e.session === "t9"))
    ;[st, b] = await api("POST", "inbox/hook?agent=claude", { hook_event_name: "PostToolUse" })
    check("hook route: anything else isn't news", st === 200 && !(await rows()).some((e) => e.source === "claude" && !e.terminal && !e.session), b)
    {
      // Terminal's stream (the service "inbox:state", OSC 7501's states): a turn's end reads its last message from the
      // agent's transcript ("agent-turn:<agent>"), judged by the model when its words don't settle it.
      const tell = service(app.plugins, "inbox:state") as (c: Any) => void
      const cc = app.plugins.find((p) => p.id === "claude-code")!
      const was = { turn: cc.services["agent-turn:claude"], sample: cc.services.sample }
      let read = { session: "sess-osc", prompt: "Look at the release and tell me what it needs.", text: "A version bump first, then the tag.", at: 0, final: true }
      let asked: Any = null
      cc.services["agent-turn:claude"] = async (terminal: string) => (terminal === "claude-osc75010" ? { ...read, at: Date.now() } : null)
      cc.services.sample = async (a: Any) => { asked = a; return { text: "NEEDS_YOU", truncated: false } }
      const at = Date.now()
      tell({ terminal: "claude-osc75010", agent: "claude", state: "working", from: "osc7501", at })
      tell({ terminal: "claude-osc75010", agent: "claude", state: "done", from: "osc7501", at })
      tell({ terminal: "claude-osc75010", agent: "claude", state: "done", from: "hooks", at })
      let r = (await rows()).filter((e) => e.terminal === "claude-osc75010")
      check("inbox:state: a turn's end, its message from the transcript, asked of a quick model with what the user said; said twice, once",
        r.length === 1 && r[0].kind === "waiting" && r[0].ask === "answer" && r[0].session === "sess-osc" && r[0].body === read.text &&
        asked?.tier === "quick" && asked.prompt.includes("Look at the release and tell me what it needs.") && asked.prompt.includes(read.text), [r, asked?.prompt])
      cc.services.sample = async () => ({ text: "DONE", truncated: false })
      await api("POST", "inbox/events/read", { ids: [r[0].id] })
      read = { ...read, prompt: "Tag it", text: "Tagged v1.2.0 and pushed." }
      tell({ terminal: "claude-osc75010", agent: "claude", state: "working", from: "osc7501", at })
      tell({ terminal: "claude-osc75010", agent: "claude", state: "blocked", kind: "permission", msg: "Run git push?", from: "osc7501", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75010")
      check("inbox:state: blocked asking permission needs you", r[0]?.kind === "waiting" && r[0].ask === "permission" && r[0].body === "Run git push?" && !r[0].read, r)
      tell({ terminal: "claude-osc75010", agent: "claude", state: "working", from: "osc7501", at })
      tell({ terminal: "claude-osc75010", agent: "claude", state: "idle", from: "osc7501", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75010")
      check("inbox:state: answered, then done with nothing for you: quiet", r[0]?.read === true && r[0].kind === "done" && r[0].body === "Tagged v1.2.0 and pushed.", r)
      // OSC 7501's done comes before Claude Code writes its last answer: the transcript has the turn's earlier words (or
      // none), then the answer a moment later. The answer is what's judged.
      let reads = 0
      cc.services["agent-turn:claude"] = async (terminal: string) => terminal !== "claude-osc75011" ? null : ++reads < 3
        ? { session: "sess-late", prompt: "Ask me a question.", text: reads === 1 ? "" : "Let me look first.", at: reads === 1 ? 0 : Date.now(), final: false }
        : { session: "sess-late", prompt: "Ask me a question.", text: "What would you like to work on?", at: Date.now(), final: true }
      tell({ terminal: "claude-osc75011", agent: "claude", state: "working", from: "osc7501", at })
      tell({ terminal: "claude-osc75011", agent: "claude", state: "done", from: "osc7501", at })
      await settled()
      r = (await rows()).filter((e) => e.terminal === "claude-osc75011")
      check("inbox:state: its done before the transcript has the answer: waits for it, needs you", r[0]?.kind === "waiting" && r[0].body === "What would you like to work on?" && !r[0].read && reads === 3, [r, reads])
      // Ended by the user (End session, vau terminal end): its row is dealt with. One that ended by itself keeps it.
      const term = app.plugins.find((p) => p.id === "terminal")!
      term.emit("terminal.ended", { id: "claude-osc75011", code: 0, signal: 0 })
      await new Promise((ok) => setTimeout(ok, 50))
      check("a session that exited by itself keeps its answer to read", (await rows()).find((e) => e.terminal === "claude-osc75011")?.read === false)
      term.emit("terminal.ended", { id: "claude-osc75011", code: 0, signal: 1, onPurpose: true })
      await new Promise((ok) => setTimeout(ok, 50))
      check("a session the user ended: its row is read", (await rows()).find((e) => e.terminal === "claude-osc75011")?.read === true)
      await api("DELETE", `inbox/events/${r[0].id}`) // (the block's newest events below are the ones before it)
      // Codex says no done: its turn ends working -> idle. Its session's name is its own (the terminal's says the folder).
      const cx = app.plugins.find((p) => p.id === "codex")!, cxTurn = cx.services["agent-turn:codex"]
      cx.services["agent-turn:codex"] = async (terminal: string) => (terminal === "codex-osc75012" ? { session: "cx-sess", title: "Answer 2+2",
        prompt: "What is 2+2? Answer in one short sentence.", text: "2 + 2 = 4.", at: Date.now(), final: true } : null)
      cc.services.sample = async () => ({ text: "NEEDS_YOU", truncated: false })
      for (const state of ["idle", "working", "idle"]) tell({ terminal: "codex-osc75012", agent: "codex", state, from: "osc7501", at })
      // (starting up, it says it works, then idle, with no session yet: no turn)
      for (const state of ["idle", "working", "idle"]) tell({ terminal: "codex-osc75013", agent: "codex", state, from: "osc7501", at })
      await settled()
      r = (await rows()).filter((e) => e.terminal === "codex-osc75012" || e.terminal === "codex-osc75013")
      check("inbox:state: Codex's working -> idle is a turn's end: its answer to the user's question needs you, titled as its session; starting up isn't a turn",
        r.length === 1 && r[0].kind === "waiting" && r[0].ask === "answer" && r[0].body === "2 + 2 = 4." && r[0].title === "Answer 2+2" && r[0].session === "cx-sess", r)
      await api("DELETE", `inbox/events/${r[0].id}`)
      cx.services["agent-turn:codex"] = cxTurn
      cc.services["agent-turn:claude"] = was.turn; cc.services.sample = was.sample
    }
    ;[st, b] = await api("POST", "inbox/hook?agent=claude&terminal=claude-p9p9p9p9", { hook_event_name: "Notification", notification_type: "permission_prompt", session_id: "perm", message: "Claude needs your permission to use Bash" })
    const permId = (await rows()).find((e) => e.session === "perm")?.id
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: permId, answer: "approve" })
    check("answer: approving needs the terminal running (its question on screen)", st >= 400, [st, b])
    await (await import("../../../plugins/core/inbox/plugin.ts")).stillWaiting(0)
    ;[, list] = await api("GET", "inbox/events")
    check("a permission whose terminal no longer asks it (here: none runs) is read", list.events.find((e: Any) => e.id === permId)?.read === true, list.events)
    const done = list.events.find((e: Any) => e.kind === "done")
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: done.id, answer: "approve" })
    check("answer: only a permission is approved", st === 409, [st, b])
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: done.id, answer: "read" })
    ;[, list] = await api("GET", "inbox/events")
    check("answer: read marks it read", st === 200 && list.events.find((e: Any) => e.id === done.id)?.read === true, [st, b])
    check("push: Approve and Deny for a permission it shows whole, Reply for a session's answer, else Mark read",
      categoryOf({ id: "a", t: 0, source: "claude", kind: "waiting", ask: "permission", terminal: "claude-x", title: "x", body: "Bash" }) === "permission" &&
      categoryOf({ id: "a", t: 0, source: "claude", kind: "waiting", ask: "answer", session: "s", title: "x" }) === "reply" &&
      categoryOf({ id: "a", t: 0, source: "vau", kind: "info", title: "x" }) === "event")
    check("a preview is one plain line", previewOf("## Done\n\n- **Fixed** the [[Notes/Sidebar|sidebar]]\n- `npm test` passes, see [the PR](https://x.y)\n\n```\ncode\n```") ===
      "Done Fixed the Notes/Sidebar npm test passes, see the PR")
    {
      const es: Any[] = [{ id: "a1", t: 1 }, { id: "b2@m1", t: 2 }, { id: "c3@m1", t: 3 }, { id: "c3@m4", t: 4 }]
      check("an event by its id: as listed, bare as its machine's notification said it (one only), or @ this machine",
        findEvent(es, "b2@m1", "m4")?.id === "b2@m1" && findEvent(es, "b2", "m4")?.id === "b2@m1" && !findEvent(es, "c3", "m4") && findEvent(es, "a1@m4", "m4")?.id === "a1" && !findEvent(es, "a1@m9", "m4"))
    }
    {
      const old: Any[] = [
        { id: "o1", t: 5, source: "claude", kind: "done", title: "Claude Code finished", body: "Beacon docs", terminal: "claude-old1", read: true },
        { id: "o2", t: 4, source: "claude", kind: "done", title: "Claude Code finished", body: "Beacon docs", terminal: "claude-old1", read: true },
        { id: "o3", t: 3, source: "claude", kind: "done", title: "Claude Code: Fix done · Sidebar", body: "Fixed.", link: "Inbox/Fix done · Sidebar.md", session: "s-old" },
        { id: "o4", t: 2, source: "vau", kind: "info", title: "Imported 12 meals" },
        { id: "o5", t: 1, source: "claude", kind: "waiting", title: "Claude Code is waiting for you", body: "Claude needs your permission", ask: "permission", terminal: "claude-old2", read: true },
      ]
      const now = byThread(old)
      check("events from before, one row per session: the newest, named after the session; a report's titled as the report; messages as they were",
        now.length === 4 && now[0].id === "o1" && now[0].title === "Beacon docs" && !now[0].body && now[1].title === "Fix done · Sidebar" && now[1].ask === "report" &&
        now[2].title === "Imported 12 meals" && now[3].ask === "permission", now)
    }
    {
      const push = await import("../../../plugins/core/inbox/push.ts")
      const p = push.payload({ title: "Claude Code is waiting for you", body: "Bash", category: "permission", thread: "claude-x", urgent: true, data: { event: "e1" } }) as Any
      check("push: the payload carries its buttons' category and the event", p.aps.category === "permission" && p.aps["interruption-level"] === "time-sensitive" && p.aps["thread-id"] === "claude-x" && p.event === "e1" && p.aps.alert.body === "Bash", p)
      ;[st, b] = await api("POST", "inbox/devices", { token: "nothex", topic: "app.example.ios" })
      check("push: a device needs a token", st === 400, [st, b])
      ;[st, b] = await api("POST", "inbox/devices", { token: "AB".repeat(32), topic: "app.example.ios", env: "sandbox", name: "Sam's iPhone" })
      const [, devs] = await api("GET", "inbox/devices")
      check("push: a device registers, kept on this machine, not ready without a key", st === 201 && b.ready === false && devs.devices.length === 1 && devs.devices[0].token === "abababab…" && devs.devices[0].name === "Sam's iPhone", [b, devs])
      ;[st, b] = await api("POST", "ops/inbox.push", { title: "Hi" })
      check("push: sending without a key says so", st === 409, [st, b])
      const key = (await import("node:crypto")).generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      fs.writeFileSync(path.join(process.env.VAULTITE_LOCAL!, "apns-test.p8"), key.privateKey.export({ type: "pkcs8", format: "pem" }))
      check("push: a key in data/ makes it ready", push.configured({ key_id: "K1", team_id: "T1", key: "apns-test.p8" }))
      await api("DELETE", `inbox/devices/${"ab".repeat(32)}`)
      const [, after] = await api("GET", "inbox/devices")
      check("push: a device is forgotten", after.devices.length === 0, after)
      await api("POST", "inbox/devices", { token: "cd".repeat(32), topic: "app.example.ios", name: "Sam's iPhone", widgets: true })
      await api("POST", "inbox/devices", { token: "ef".repeat(32), topic: "app.example.ios", name: "Sam's iPhone", widgets: true })
      const [, widgets] = await api("GET", "inbox/devices")
      check("push: a phone's widgets keep one token, the newest", widgets.devices.length === 1 && widgets.devices[0].widgets === true && widgets.devices[0].token === "efefefef…", widgets)
      await api("DELETE", `inbox/devices/${"ef".repeat(32)}`)
    }
    ;[st, b] = await api("POST", "ops/inbox.voice", { text: "Remind me to call Alice about the trip on Friday please, thanks", from: "Apple Watch" })
    check("voice: kept in the inbox, named by its first words", st === 200 && b.path === "Inbox/Remind me to call Alice about the trip…" + ".md" &&
      read("Inbox/Remind me to call Alice about the trip….md").includes("from: Apple Watch") && b.terminal === null, [st, b])
    {
      // From the phone: its words and the recording, kept as an attachment above them (unless voice_audio is off).
      const audio = Buffer.from("a phone's recording").toString("base64")
      const [as, ab] = await api("POST", "ops/inbox.voice", { text: "Buy oat milk", from: "iPhone", audio, ext: "m4a" })
      const embed = /^!\[\[(Voice note [^\]]+\.m4a)\]\]\n\nBuy oat milk$/m.exec(as === 200 ? read(ab.path) : "")
      check("voice: the recording is kept, embedded above what was said", !!embed && read(`Attachments/${embed[1]}`) === "a phone's recording", [as, ab, as === 200 && read(ab.path)])
      if (embed) fs.rmSync(path.join(VAULT, "Attachments", embed[1]))
      if (as === 200) fs.rmSync(path.join(VAULT, ab.path))
      const conf = path.join(VAULT, ".vaultite/plugins/inbox/data.json"), was = exists(".vaultite/plugins/inbox/data.json") ? fs.readFileSync(conf, "utf8") : null
      fs.mkdirSync(path.dirname(conf), { recursive: true })
      fs.writeFileSync(conf, JSON.stringify({ ...(was ? JSON.parse(was) : {}), voice_audio: false }))
      const [ws, wb] = await api("POST", "ops/inbox.voice", { text: "Buy rye bread", from: "iPhone", audio, ext: "m4a" })
      check("voice: voice_audio off keeps only the words", ws === 200 && !read(wb.path).includes("![[") && read(wb.path).includes("Buy rye bread"), [ws, wb])
      if (was === null) fs.rmSync(conf); else fs.writeFileSync(conf, was)
      if (ws === 200) fs.rmSync(path.join(VAULT, wb.path))
    }
    {
      const conf = path.join(VAULT, ".vaultite/plugins/inbox/data.json"), was = exists(".vaultite/plugins/inbox/data.json") ? fs.readFileSync(conf, "utf8") : null
      fs.writeFileSync(conf, JSON.stringify({ ...(was ? JSON.parse(was) : {}), dispatch: "claude" }))
      const [vs, vb] = await api("POST", "ops/inbox.voice", { text: "word ".repeat(1600), from: "Apple Watch" })
      check("voice: a recording left running is kept, not handed to an agent", vs === 200 && vb.terminal === null && vb.why.includes("1600 words") && exists(vb.path), [vs, vb])
      if (was === null) fs.rmSync(conf); else fs.writeFileSync(conf, was)
      fs.rmSync(path.join(VAULT, vb.path))
    }
    ;[st, b] = await api("POST", "ops/inbox.done", { path: "Inbox/Remind me to call Alice about the trip….md", title: "Call Alice about the trip" })
    check("inbox.done: named anew and archived", st === 200 && b.path === "Inbox/.archive/Call Alice about the trip.md" &&
      read("Inbox/.archive/Call Alice about the trip.md").includes("status: done") && !exists("Inbox/Remind me to call Alice about the trip….md"), [st, b])
    ;[st] = await api("POST", "ops/inbox.done", { path: "Inbox/Nothing here.md" })
    check("inbox.done: a result that isn't there", st === 404, st)
    const id = list.events.at(-1).id
    ;[, b] = await api("POST", "inbox/events/read", { ids: [id] })
    ;[, list] = await api("GET", "inbox/events")
    check("inbox events: read by id", list.events.find((e: Any) => e.id === id)?.read === true && b.unread === list.unread, [b, list.unread])
    ;[st, b] = await api("POST", "inbox/events/unread", { ids: [id] })
    ;[, list] = await api("GET", "inbox/events")
    let one = list.events.find((e: Any) => e.id === id)
    check("inbox events: unread by hand, kept so", st === 200 && one?.read === false && one.kept === true && b.unread === list.unread, [st, b, one])
    ;[st] = await api("POST", "inbox/events/unread", {})
    check("inbox events: unread needs ids", st === 400, st)
    ;[, b] = await api("POST", "inbox/events/read", { ids: [id] })
    ;[, list] = await api("GET", "inbox/events")
    one = list.events.find((e: Any) => e.id === id)
    check("inbox events: read again, no longer kept", one?.read === true && !("kept" in one), one)
    const keptAt = path.join(tmp, "local", "inbox")
    await waitFor(() => fs.readdirSync(keptAt).some((d) => fs.existsSync(path.join(keptAt, d, "events.json"))), 3000, 50)
    const kept = fs.readdirSync(keptAt)
    check("inbox events: kept on this machine, not in the vault", kept.length === 1 && fs.existsSync(path.join(tmp, "local", "inbox", kept[0], "events.json")) && !exists("Inbox/events.json"), kept)
    write("Dashboards/Qa inbox.md", "---\ntype: dashboard\n---\n\n```block-inbox\nevents: 3\n```\n")
    let [, r] = await api("GET", "render?path=Dashboards/Qa inbox.md")
    check("inbox block: as text, results and events", r.includes("[[Inbox/Written by hand|Written by hand]]") && r.includes("lighthouse: Should it be squashed? · needs you"), r.slice(0, 600))
    ;[st] = await api("DELETE", `inbox/events/${id}`)
    ;[, list] = await api("GET", "inbox/events")
    check("inbox events: forgotten one by one", st === 200 && !list.events.some((e: Any) => e.id === id), list.events.length)
    // An agent's report: its session named for the reply, questions and a reply box; an event links it, and the agent's
    // turn ending right after keeps its words.
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Lighthouse docs updated", work: "change", tldr: "The setup page is rewritten.\nPublish it?", summary: "Rewrote the **setup** page.\n- New screenshots",
      questions: ["Publish it?"], session: "sess-report-1", agent: "claude" })
    let rep = read("Inbox/Change needs you · Lighthouse docs updated.md")
    check("report: a result naming its session, with its questions and a reply box", st === 200 && b.path === "Inbox/Change needs you · Lighthouse docs updated.md" &&
      rep.includes("agent: claude") && rep.includes("session: sess-report-1") && rep.includes("## Open questions\n\n- Publish it?") &&
      rep.trimEnd().endsWith("```block-reply\n```") && rep.includes("from: Claude Code"), [st, b, rep])
    check("report: its tl;dr on top, a callout", rep.split("---\n")[2]?.startsWith("\n> [!tldr] In short\n> The setup page is rewritten.\n> Publish it?\n\nRewrote"), rep)
    ;[, list] = await api("GET", "inbox/events")
    const repEvent = list.events.find((e: Any) => e.session === "sess-report-1")
    check("report: its session's row is the report, needing you, linking it", repEvent?.link === "Inbox/Change needs you · Lighthouse docs updated.md" && repEvent.title === "Change needs you · Lighthouse docs updated" &&
      repEvent.kind === "waiting" && repEvent.ask === "report" && repEvent.body === "The setup page is rewritten.\nPublish it?" && !repEvent.read, repEvent)
    await api("POST", "inbox/hook?agent=claude", { hook_event_name: "Stop", session_id: "sess-report-1", last_assistant_message: "Done." })
    await settled()
    ;[, list] = await api("GET", "inbox/events")
    const merged = list.events.filter((e: Any) => e.session === "sess-report-1")
    check("report: the turn ending after it leaves the report's row as it is", merged.length === 1 && merged[0].title === "Change needs you · Lighthouse docs updated" && merged[0].ask === "report", merged)
    {
      // Its event goes where the result goes: Done archives it (and reads the event, it's dealt with), Back to review
      // brings it back; one linking where a result was before it was archived links where it is now.
      await api("POST", "ops/inbox.report", { title: "Moves along", work: "fix", tldr: "x", summary: "x", session: "sess-moves" })
      const ev = async () => (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.session === "sess-moves")
      await api("PUT", "inbox/Inbox/Fix done · Moves along", { status: "done" })
      let e = await ev()
      check("report done: its event links the archived file, read", e?.link === "Inbox/.archive/Fix done · Moves along.md" && e.read === true, e)
      await api("PUT", "inbox/Inbox/.archive/Fix done · Moves along", { status: "new" })
      e = await ev()
      check("report back to review: its event follows it back", e?.link === "Inbox/Fix done · Moves along.md", e)
      await api("PUT", "inbox/Inbox/Fix done · Moves along", { status: "done" })
      const [, old] = await api("POST", "inbox/events", { source: "vau", kind: "done", title: "Before the move", link: "Inbox/Fix done · Moves along.md" })
      e = (await api("GET", "inbox/events"))[1].events.find((x: Any) => x.id === old.event.id)
      check("an event from before a result was archived links where it is now", e?.link === "Inbox/.archive/Fix done · Moves along.md", e)
      await api("DELETE", `inbox/events/${old.event.id}`)
      // What's dealt with: the last done first, an archived one whatever its status says (archived by hand) included.
      write("Inbox/.archive/Archived by hand.md", `---\ntype: inbox\nstatus: new\ncreated: '2999-01-01 00:00:00'\n---\n\nOld.\n`)
      fs.utimesSync(path.join(VAULT, "Inbox/.archive/Archived by hand.md"), new Date(2000, 0, 1), new Date(2000, 0, 1))
      await api("PUT", "inbox/Inbox/.archive/Fix done · Moves along", { status: "new" })
      await api("PUT", "inbox/Inbox/Fix done · Moves along", { status: "done" })
      const [, all] = await api("GET", "inbox")
      const ids = all.map((r: Any) => r.id), at = (id: string) => ids.indexOf(id)
      check("dealt with: after what's to review, the last done first, one archived by hand not before it",
        at("Inbox/.archive/Fix done · Moves along") > -1 && at("Inbox/.archive/Fix done · Moves along") < at("Inbox/.archive/Archived by hand") &&
        all.findIndex((r: Any) => r.archived) > all.findLastIndex((r: Any) => !r.archived), ids)
      fs.rmSync(path.join(VAULT, "Inbox/.archive/Archived by hand.md"))
    }
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "No summary", work: "fix", tldr: "x", summary: " " })
    check("report: needs a summary", st === 400, [st, b])
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "No tldr", work: "fix", summary: "x" })
    check("report: needs a tldr and its work", st === 400 && /tldr/.test(b.error) && (await api("POST", "ops/inbox.report", { title: "No work", tldr: "x", summary: "x" }))[0] === 400, [st, b])
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Half the docs", work: "research", state: "stuck", tldr: "x", summary: "x" })
    check("report: the state said", b.path === "Inbox/Research stuck · Half the docs.md", b)
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Bad shot", work: "fix", tldr: "x", summary: "x", images: ["/tmp/notes.txt"] })
    check("report: screenshots are images", st === 400 && /png, jpg/.test(b.error), [st, b])
    const shot = path.join(tmp, "after.png")
    fs.writeFileSync(shot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"))
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Shot named", work: "fix", tldr: "x", summary: "x", images: [shot] })
    const shotText = st === 200 ? read(`${b.path}`) : ""
    check("report: a screenshot is saved under the day and the report's name", /!\[\[\d{4}-\d\d-\d\d Shot named - after\.png\]\]/.test(shotText), [st, b, shotText])
    const cliOut = await vau("inbox", "report", "From the command line", "--work", "feature", "--tldr", "Did it", "--summary", "Did it", "--questions", "First?", "Second?", "--session", "sess-cli")
    rep = read("Inbox/Feature needs you · From the command line.md")
    check("report: vau takes a list's values after its flag", cliOut.code === 0 && rep.includes("- First?\n- Second?") && rep.includes("session: sess-cli"), [cliOut, rep])
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "One question", work: "fix", tldr: "x", summary: "x", questions: "Ship it, or wait?" })
    check("report: a question given as text keeps its commas", st === 200 && read("Inbox/Fix needs you · One question.md").includes("- Ship it, or wait?\n"), [st, b])
    ;[st, b] = await api("POST", "ops/inbox.reply", { to: "Inbox/Written by hand.md", text: "hi" })
    check("reply: only to a report that names its session", st === 409, [st, b])
    ;[st, b] = await api("POST", "ops/inbox.reply", { to: "Inbox/Nope.md", text: "hi" })
    check("reply: to a report that's there", st === 404, [st, b])
    // Where a reply goes once the session ended: resumed while its prompt cache lasts (the TTL its transcript wrote with),
    // else a new session; a handed terminal ends when the turn that reported does.
    {
      const { service } = await import("../../../core/plugins.ts")
      const sid = "7c1d2e3f-4a5b-4c6d-8e7f-901234567890"
      const tfile = path.join(CLAUDE_DIR, "projects", "-Users-sam-beacon", `${sid}.jsonl`)
      fs.mkdirSync(path.dirname(tfile), { recursive: true })
      fs.writeFileSync(tfile, JSON.stringify({ type: "assistant", sessionId: sid, cwd: "/Users/sam/beacon", message: { role: "assistant", content: [{ type: "text", text: "Done." }],
        usage: { input_tokens: 3, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 812 } } } }) + "\n")
      const look = service(app.plugins, "agent-session:claude") as (id: string) => Any
      const info = look(sid)
      check("agent session: a transcript written with the hour-long cache", info?.ttl === 3600 && info.transcript === tfile && info.account === "default" && Date.now() - info.last < 60_000, info)
      check("agent session: else five minutes, and none for a session that isn't here", look("0a1b2c3d-1111-4222-8333-444455556666")?.ttl === 300 && look("9f9f9f9f-0000-4000-8000-000000000000") === null)
      ;[st, b] = await api("POST", "ops/inbox.report", { title: "Beacon fixed", work: "fix", tldr: "Fixed it.", summary: "Fixed it.", session: sid, agent: "claude" })
      ;[st, b] = await api("POST", "ops/inbox.reply-plan", { to: "Inbox/Fix done · Beacon fixed.md" })
      check("reply plan: its session resumed while it's cached", st === 200 && b.how === "resume" && b.ttl === 3600 && b.ago < 60, [st, b])
      const old = (Date.now() - 2 * 3600_000) / 1000
      fs.utimesSync(tfile, old, old)
      ;[st, b] = await api("POST", "ops/inbox.reply-plan", { to: "Inbox/Fix done · Beacon fixed.md" })
      check("reply plan: a new session once it isn't", st === 200 && b.how === "new" && b.ago >= 7200, [st, b])
      fs.utimesSync(tfile, Date.now() / 1000 - 56 * 60, Date.now() / 1000 - 56 * 60)
      ;[st, b] = await api("POST", "ops/inbox.reply-plan", { to: "Inbox/Fix done · Beacon fixed.md" })
      check("reply plan: with five minutes to spare", b.how === "new", b)
      const handedOf = () => { const d = fs.readdirSync(path.join(tmp, "local", "inbox"))[0]; try { return JSON.parse(fs.readFileSync(path.join(tmp, "local", "inbox", d, "handed.json"), "utf8")) } catch { return [] } }
      ;(service(app.plugins, "inbox:handed") as (t: string) => void)("claude-handed1")
      check("handed: dispatch marks its terminal", handedOf().includes("claude-handed1"), handedOf())
      const out = await vau("inbox", "report", "Handed off", "--work", "fix", "--tldr", "Did it.", "--summary", "Did it.", "--terminal", "claude-handed1")
      check("handed: its report says the terminal ends with the turn", out.code === 0 && out.out.includes("this terminal ends when this turn does"), out)
      await api("POST", "inbox/hook?agent=claude&terminal=claude-handed1", { hook_event_name: "Stop" })
      check("handed: the turn that reported ends it", !handedOf().includes("claude-handed1"), handedOf())
      await api("POST", "ops/inbox.report", { title: "Not handed", work: "fix", tldr: "Did it.", summary: "Did it.", terminal: "claude-mine1", agent: "claude" })
      await api("POST", "inbox/hook?agent=claude&terminal=claude-mine1", { hook_event_name: "Stop" })
      check("handed: a terminal nobody handed a task stays", !handedOf().includes("claude-mine1"))
      // The same session's next report goes on in its file (after the reply, which archived it): one file per exchange.
      await api("POST", "ops/inbox.report", { title: "Thread start", work: "fix", tldr: "Ship it?", summary: "First round.", questions: ["Ship it?"], terminal: "claude-thread1", agent: "claude" })
      await api("POST", "ops/inbox.done", { path: "Inbox/Fix needs you · Thread start.md" })
      await sleep(1100) // (times are to the second)
      await api("POST", "ops/inbox.report", { title: "Came between", work: "fix", tldr: "x", summary: "x", terminal: "claude-between1", agent: "claude" })
      await sleep(1100)
      ;[st, b] = await api("POST", "ops/inbox.report", { title: "Shipped", work: "fix", tldr: "Shipped it.", summary: "Second round.", terminal: "claude-thread1", agent: "claude" })
      const thread = read("Inbox/Fix done · Thread start.md")
      check("thread: the next report goes on in the same file, back to new, its title saying where it stands", st === 200 && b.path === "Inbox/Fix done · Thread start.md" && b.thread === true &&
        !exists("Inbox/.archive/Fix needs you · Thread start.md") && thread.includes("status: new") &&
        /First round\.[\s\S]*## Fix done · Shipped\n\n> \[!tldr\] In short\n> Shipped it\.\n\nSecond round\.\n\n```block-reply\n```\n?$/.test(thread) &&
        thread.split("```block-reply").length === 2 && /\nupdated: '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'\n/.test(thread), [st, b, thread])
      {
        const [, items] = await api("GET", "inbox")
        const newOnes = items.filter((x: Any) => x.status === "new").map((x: Any) => x.id)
        check("thread: its latest report puts it before a result that came after it started", newOnes.indexOf("Inbox/Fix done · Thread start") > -1 &&
          newOnes.indexOf("Inbox/Fix done · Thread start") < newOnes.indexOf("Inbox/Fix done · Came between"), newOnes.slice(0, 5))
      }
      await api("POST", "ops/inbox.report", { title: "Elsewhere", work: "fix", tldr: "x", summary: "x", terminal: "claude-thread2", agent: "claude" })
      check("thread: another session's report is a file of its own", exists("Inbox/Fix done · Elsewhere.md"))
    }
    const [, r0] = await api("GET", "render?path=Inbox/Change needs you · Lighthouse docs updated.md")
    check("reply block: as text, how to reply", r0.includes(`vau inbox reply "Inbox/Change needs you · Lighthouse docs updated.md"`), r0)
    // vau inbox
    cr = await vau("inbox")
    check("vau inbox: what's new", cr.code === 0 && cr.out.includes("To review:") && cr.out.includes("Inbox/Written by hand.md") && cr.out.includes("unread"), cr)
    {
      const [, l] = await api("GET", "inbox/events")
      const eid = l.events[0].id
      check("vau inbox: events with their ids", cr.out.includes(`(${eid})`), cr.out)
      cr = await vau("inbox", "unread", eid)
      let [, l2] = await api("GET", "inbox/events")
      check("vau inbox unread <id>", cr.code === 0 && l2.events[0].read === false && l2.events[0].kept === true, [cr, l2.events[0]])
      cr = await vau("inbox", "read", eid)
      ;[, l2] = await api("GET", "inbox/events")
      check("vau inbox read <id>", cr.code === 0 && l2.events[0].read === true, [cr, l2.events[0]])
      cr = await vau("inbox", "unread")
      check("vau inbox unread: needs ids", cr.code !== 0, cr)
    }
    $.vars.stdinText = ""
    cr = await vau("inbox", "add", "From", "the CLI", "--body", "Some text", "--from", "Sam")
    check("vau inbox add: a result", cr.code === 0 && read("Inbox/From the CLI.md").includes("from: Sam") && read("Inbox/From the CLI.md").includes("Some text"), cr)
    cr = await vau("inbox", "hook", "codex", JSON.stringify({ type: "agent-turn-complete", "thread-id": "t10", cwd: "/x/beacon" }))
    await settled()
    ;[, list] = await api("GET", "inbox/events")
    check("vau inbox hook: Codex's JSON as its last argument", cr.code === 0 && list.events[0].session === "t10" && list.events[0].title === "beacon", list.events[0])
    cr = await vau("inbox", "clear")
    ;[, list] = await api("GET", "inbox/events")
    check("vau inbox clear", cr.code === 0 && !list.events.length, list)
    // One inbox on several machines: another machine's events followed and shown here (`<id>@<machine>`), and reading,
    // dismissing or answering one is done on that machine, which keeps it.
    {
      const { followMachines } = await import("../../../plugins/core/inbox/plugin.ts")
      const { WebSocketServer } = await import("ws")
      const seen: string[] = []
      let theirs: Any[] = [
        { id: "p1", t: Date.now() - 1000, source: "claude", kind: "done", title: "Claude Code finished", terminal: "claude-aa11bb22", session: "s-box" },
        { id: "p2", t: Date.now() - 5000, source: "vau", kind: "info", title: "Backup finished", read: true },
        { id: "p9@else", t: Date.now() - 6000, source: "vau", kind: "info", title: "Followed from a third machine" },
      ]
      const peer = (await import("node:http")).createServer((req, res) => {
        let raw = ""
        req.on("data", (c) => { raw += c })
        req.on("end", () => {
          seen.push(`${req.method} ${req.url} ${raw}`)
          const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
          if (req.url === "/api/machines/self") return json(200, { instance: "peer-inbox", host: "box", platform: "darwin", version: "0.1.0", plugins: ["inbox"] })
          if (req.url?.startsWith("/api/inbox/events")) return json(200, { ok: true, unread: 0 })
          if (req.url?.startsWith("/api/ops/inbox.")) return json(200, { id: "p6", answer: "approve", title: "x", terminal: "claude-aa11bb22", how: "type" })
          json(404, { error: "no such thing" })
        })
      })
      const wss = new WebSocketServer({ server: peer })
      const socks: Any[] = []
      wss.on("connection", (ws, req) => { seen.push(`WS ${req.url}`); socks.push(ws); ws.send(JSON.stringify({ t: "events", events: theirs })) })
      await new Promise<void>((r) => peer.listen(0, "127.0.0.1", () => r()))
      const port = (peer.address() as { port: number }).port
      write(".vaultite/plugins/machines/data.json", JSON.stringify({ machines: [{ id: "box", label: "Box", url: `http://127.0.0.1:${port}` }] }))
      await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Here, not there" })
      await followMachines()
      await waitFor(async () => (await api("GET", "inbox/events"))[1].events.some((e: Any) => e.id === "p1@box"), 3000, 50)
      let [, l] = await api("GET", "inbox/events")
      const p1 = l.events.find((e: Any) => e.id === "p1@box")
      check("inbox machines: another machine's events followed (its own only), named by machine, its terminal there",
        seen.includes("WS /api/inbox/live?local=1") && p1?.machine === "box" && p1.machineLabel === "Box" && p1.terminal === "claude-aa11bb22@box" &&
        l.events.some((e: Any) => e.title === "Here, not there") && !l.events.some((e: Any) => e.id.startsWith("p9")) &&
        l.unread === l.events.filter((e: Any) => !e.read).length, l)
      ;[, l] = await api("GET", "inbox/events?local=1")
      check("inbox machines: ?local=1 is this machine's events only", !l.events.some((e: Any) => e.machine) && l.events.some((e: Any) => e.title === "Here, not there"), l.events)
      let [st2, b2] = await api("POST", "inbox/events/read", { ids: ["p1@box"] })
      ;[, l] = await api("GET", "inbox/events")
      check("inbox machines: one read here is read there (and here at once)", st2 === 200 && seen.includes(`POST /api/inbox/events/read?local=1 {"ids":["p1"]}`) &&
        l.events.find((e: Any) => e.id === "p1@box")?.read === true, [st2, b2, seen])
      theirs = [{ ...theirs[0], read: true }, { id: "p3", t: Date.now(), source: "claude", kind: "waiting", title: "Claude Code is waiting for you" }, theirs[1]]
      for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
      await waitFor(async () => (await api("GET", "inbox/events"))[1].events[0]?.id === "p3@box", 3000, 50)
      ;[, l] = await api("GET", "inbox/events")
      check("inbox machines: its changes arrive live", l.events[0]?.id === "p3@box" && l.events[0].read !== true, l.events.slice(0, 2))
      {
        // A result it reported, done here: its event there is read there (it's dealt with), and links the archived file.
        await api("POST", "inbox", { title: "Reported from the box", body: "x" })
        theirs = [{ id: "p5", t: Date.now() - 50, source: "claude", kind: "done", title: "Reported", link: "Inbox/Reported from the box.md" }, ...theirs]
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await waitFor(async () => (await api("GET", "inbox/events"))[1].events.some((e: Any) => e.id === "p5@box"), 3000, 50)
        await api("PUT", "inbox/Inbox/Reported from the box", { status: "done" })
        await waitFor(() => seen.includes(`POST /api/inbox/events/read?local=1 {"ids":["p5"]}`), 3000, 50)
        ;[, l] = await api("GET", "inbox/events")
        const p5 = l.events.find((e: Any) => e.id === "p5@box")
        check("inbox machines: a result done here reads its event there, which links where it is now",
          seen.includes(`POST /api/inbox/events/read?local=1 {"ids":["p5"]}`) && p5?.read === true && p5.link === "Inbox/.archive/Reported from the box.md", [p5, seen.slice(-3)])
        theirs = theirs.filter((e) => e.id !== "p5")
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await waitFor(async () => !(await api("GET", "inbox/events"))[1].events.some((e: Any) => e.id === "p5@box"), 3000, 50)
      }
      {
        // Another machine following this one (local=1) isn't told of the followed machines' changes: two machines that
        // follow each other would echo forever (two Macs once sent 17 lists a second, and ran out of memory).
        const { EventEmitter } = await import("node:events")
        const { matchSocket } = await import("../../../core/plugins.ts")
        const watcher = (local: boolean) => {
          const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got: [] as string[], send(m: string) { ws.got.push(m) }, close() {},
            ping() { ws.emit("pong") }, terminate() {} }) // (the inbox pings its sockets every 15 s: a slow run reaches it)
          matchSocket(app.plugins, ["inbox", "live"])![1].fn(ws as Any, {} as IncomingMessage, { wild: [], query: local ? { local: "1" } : {} })
          return ws
        }
        const there = watcher(true), here = watcher(false)
        await sleep(100)
        there.got.length = here.got.length = 0
        theirs = [...theirs, { id: "p4", t: Date.now() - 100, source: "vau", kind: "info", title: "Another there" }]
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await waitFor(() => here.got.length > 0, 3000, 25)
        await sleep(150)
        const after = here.got.length
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await sleep(150)
        check("inbox machines: their changes go to this machine's apps, not back to the machines (no echo); the same list again is nothing",
          !there.got.length && after === 1 && here.got.length === 1, [there.got.length, after, here.got.length])
        await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Mine, for the machines" })
        await waitFor(() => there.got.length > 0, 3000, 25)
        check("inbox machines: this machine's own changes still go to the machines", there.got.length === 1, there.got.length)
        there.emit("close"); here.emit("close")
      }
      ;[st2] = await api("POST", "inbox/events/unread", { ids: ["p2@box"] })
      check("inbox machines: unread there", st2 === 200 && seen.includes(`POST /api/inbox/events/unread?local=1 {"ids":["p2"]}`), seen)
      {
        // A session there asking permission: answered there (where its terminal is), by its id here or bare (a phone
        // answering that machine's notification through this server); a reply too.
        theirs = [{ id: "mvp6abcd-a1b2c3", t: Date.now(), source: "claude", kind: "waiting", ask: "permission", title: "Beacon", body: "Run git push?", terminal: "claude-aa11bb22", session: "s-box" }, ...theirs]
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await waitFor(async () => (await api("GET", "inbox/events"))[1].events.some((e: Any) => e.id === "mvp6abcd-a1b2c3@box"), 3000, 50)
        seen.length = 0
        const [a1] = await api("POST", "ops/inbox.answer", { id: "mvp6abcd-a1b2c3@box", answer: "approve" })
        const [a2] = await api("POST", "ops/inbox.answer", { id: "mvp6abcd-a1b2c3", answer: "deny" })
        const [a3] = await api("POST", "ops/inbox.reply", { to: "mvp6abcd-a1b2c3@box", text: "Push it" })
        check("inbox machines: a permission there approved, denied and replied to there", a1 === 200 && a2 === 200 && a3 === 200 &&
          seen.includes(`POST /api/ops/inbox.answer {"id":"mvp6abcd-a1b2c3","answer":"approve"}`) && seen.includes(`POST /api/ops/inbox.answer {"id":"mvp6abcd-a1b2c3","answer":"deny"}`) &&
          seen.includes(`POST /api/ops/inbox.reply {"to":"mvp6abcd-a1b2c3","text":"Push it"}`), [a1, a2, a3, seen])
      }
      ;[st2] = await api("POST", "inbox/events/p3@box/answer", { answer: "deny" })
      check("inbox machines: a gate answered on its machine (where it waits)", st2 === 200 && seen.includes(`POST /api/inbox/events/p3/answer {"answer":"deny"}`), seen)
      ;[st2] = await api("DELETE", "inbox/events/p3@box")
      ;[, l] = await api("GET", "inbox/events")
      check("inbox machines: dismissed there, gone here", st2 === 200 && seen.includes("DELETE /api/inbox/events/p3 ") && !l.events.some((e: Any) => e.id === "p3@box"), [seen, l.events])
      seen.length = 0
      ;[st2] = await api("POST", "inbox/events/read", {})
      ;[, l] = await api("GET", "inbox/events")
      check("inbox machines: all read is every machine's", st2 === 200 && seen.includes("POST /api/inbox/events/read?local=1 {}") && l.unread === 0, [seen, l.unread])
      ;[st2] = await api("POST", "inbox/events/read?local=1", { ids: ["p1@box"] })
      check("inbox machines: a change asked of one machine is never passed on", st2 === 200 && !seen.some((x) => x.includes('"p1"')), seen)
      for (const s of socks) s.terminate()
      wss.close()
      await new Promise<void>((r) => peer.close(() => r()))
      await sleep(100)
      ;[st2] = await api("POST", "inbox/events/read", { ids: ["p1@box"] })
      ;[, l] = await api("GET", "inbox/events")
      check("inbox machines: one that doesn't answer says so; its events go with it", st2 === 502 && !l.events.some((e: Any) => e.machine), [st2, l.events])
      fs.rmSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"))
      await followMachines()
    }
  }
}
