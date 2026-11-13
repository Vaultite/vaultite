import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import type { Turn } from "../../../plugins/core/inbox/needs.ts"
import { waitFor } from "../lib.ts"
import { portOf, request } from "../fakes.ts"
import { messageOf } from "../../../core/values.ts"

export default async ($: VaultTest) => {
  const { CLAUDE_DIR, VAULT, api, app, check, exists, read, sleep, tmp, write } = $
  const { vau } = $.vars
  let cr: Any
  /** A request from the app on this machine: only the user's surfaces approve or deny what waits on them. */
  const asApp = request({ host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" }, { remote: "127.0.0.1" })
  // Inbox (plugins/core/inbox): results are files in Inbox/, events are kept on this machine (VAULTITE_LOCAL), hooks become events.
  {
    const { asThreads, byThread, categoryOf, findEvent, previewOf, prune, settled } = await import("../../../plugins/core/inbox/plugin.ts")
    const { fromHook, stillOpen } = await import("../../../plugins/core/inbox/rows.ts")
    const { lists, countOf, waitsOnYou } = await import("../../../plugins/core/inbox/threads.ts")
    const { judge, sure, SYSTEM } = await import("../../../plugins/core/inbox/needs.ts")
    const { choiceOf } = await import("../../../core/agents.ts")
    const { service } = await import("../../../core/plugins.ts")
    {
      // Decisions as given (decisions.ts): text or an object, checked; the same question said again; an answer by its number or words.
      const { specOf, sameQuestion, answerOf, titleOf } = await import("../../../plugins/core/inbox/decisions.ts")
      const t = specOf("Ship the sidebar to the phone too? | Yes: the phone gets it today | Not yet: desktop only* | why: The sidebar job is live on desktop.")
      const o = specOf({ question: "Which account for tonight's deploy?", options: ["Work: the team sees it", { label: "Personal", does: "only you see it" }], default: "personal", blocking: true, why: "The Lighthouse deploy job asks." })
      const bad = ["Ship? | Yes: a | No: b", "Ship it now? | Yes: a* | No: b*", "Ship the docs? | Yes* | No: b | why: c", "Ship the docs? | Yes: a* | No: b",
        { question: "Ship?", options: ["Yes: a"], default: "Yes", why: "c" }, { question: "", options: ["A: a", "B: b"], default: "A", why: "c" }]
        .map((x) => { try { specOf(x); return "" } catch (e) { return messageOf(e) } })
      check("decision specs: text with its default starred and its why, an object; what's wrong said", t.options.join() === "Yes,Not yet" && t.effects.join() === "the phone gets it today,desktop only" &&
        t.default === "Not yet" && t.why === "The sidebar job is live on desktop." && !t.blocking && t.title === "Ship the sidebar to the phone too" && !t.warn &&
        o.default === "Personal" && o.effects[1] === "only you see it" && o.blocking && bad.every(Boolean) && /what it causes/.test(bad[2]) && /say why/.test(bad[3]), [t, o, bad])
      check("decision specs: a question that doesn't name its subject is warned of", !!specOf("Start the first two steps? | Start: a job starts* | Wait: nothing yet | why: x").warn &&
        !!specOf("Ship it? | Yes: a* | No: b | why: x").warn, [])
      check("decisions: the same question in other words is one, a different one isn't", sameQuestion("Keep the quieter island?", "keep the quieter island") &&
        sameQuestion("Should we ship the new sidebar to the phone?", "Ship the new sidebar to the phone too?") && !sameQuestion("Ship the sidebar?", "Ship the footer?"))
      check("decision answers: by number, by words, by the only option they start, else their own", answerOf(["Work", "Personal"], "2").answer === "Personal" &&
        answerOf(["Work", "Personal"], "work").answer === "Work" && answerOf(["Desktop only", "Ship it"], "desk").answer === "Desktop only" && answerOf(["A", "B"], "Neither, ask Alice").own &&
        titleOf("Faces by the notch for every agent terminal, or only for the sessions you started yourself?").length <= 60)
    }
    check("inbox push: by default only what waits on you (a session open for you, an ask), not what an agent works on, a done one, or a message",
      waitsOnYou({ kind: "session", state: "open" }) && waitsOnYou({ kind: "waiting", state: "open" }) && !waitsOnYou({ kind: "session", state: "working" }) &&
      !waitsOnYou({ kind: "session", state: "done" }) && !waitsOnYou({ kind: "error", state: "open" }) && !waitsOnYou({ kind: "info", state: "open" }))
    {
      // The lists every surface draws (threads.ts): a thread stands for its report; reading leaves it listed; snoozed and
      // done out of the way; the badge counts what needs you and what's to review.
      const now = Date.now()
      const ev = (id: string, kind: string, state: string, more: Any = {}) => ({ id, t: now - id.length, kind, state, ...more })
      const es = [ev("s1", "session", "open", { read: true, link: "Inbox/Fix done · A.md" }), ev("s2", "session", "working"), ev("s3", "session", "done", { link: "Inbox/.archive/Fix done · C.md" }),
        ev("m1", "info", "open"), ev("m2", "info", "done", { read: true }), ev("w1", "waiting", "open"), ev("z1", "session", "open", { snoozed: now + 60_000 })]
      const rs = [{ id: "Inbox/Fix done · A", status: "new" }, { id: "Inbox/Plants", status: "new", created: "2026-10-01 10:00:00" }, { id: "Inbox/Later", status: "new", snoozed: "2999-01-01 08:00:00" },
        { id: "Inbox/.archive/Fix done · C", status: "done", archived: true }, { id: "Inbox/.archive/Old", status: "done", archived: true }]
      const l = lists(es, rs)
      const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join()
      check("inbox lists: a thread read is still what needs you, its report not listed apart; what's snoozed and done out of the way",
        ids(l.needs) === "s1,w1" && ids(l.review) === "Inbox/Plants" && ids(l.working) === "s2" && ids(l.messages) === "m1" &&
        ids(l.snoozed.events) === "z1" && ids(l.snoozed.results) === "Inbox/Later" && ids(l.done.events) === "s3,m2" && ids(l.done.results) === "Inbox/.archive/Old" && countOf(l) === 3, l)
      const seen = lists(es.map((e) => (e.id === "m1" ? { ...e, state: "done", read: true } : e)), rs, new Set(["m1"]))
      check("inbox lists: a message read while shown stays where it was (fresh), not under Done", ids(seen.messages) === "m1" && !seen.done.events.some((e) => e.id === "m1"), seen.messages)
      const after = lists(es.map((e) => (e.id === "s1" ? { ...e, state: "done" } : e)), rs)
      check("inbox lists: its thread done, a report still new is to review again (the thread no longer stands for it)", ids(after.review).includes("Inbox/Fix done · A"), after.review)
      const pin = lists(es.map((e) => (e.id === "s2" || e.id === "m1" || e.id === "s3" ? { ...e, pinned: true } : e)), rs.map((r) => (r.id === "Inbox/Plants" ? { ...r, pinned: true } : r)))
      check("inbox lists: what's pinned is on top whatever it waits on, out of the other lists; a done one isn't; the badge counts what's pinned to review",
        ids(pin.pinned.events) === "s2,m1" && ids(pin.pinned.results) === "Inbox/Plants" && !pin.working.length && !pin.messages.length && !pin.review.length &&
        ids(pin.done.events) === "s3,m2" && countOf(pin) === 3, pin)
    }
    check("a thread after a quiet turn: what it said stays to read while the same turn goes on; the user's next message, or an ask gone, settles it",
      stillOpen({ state: "open", ask: "answer", turn: "a" }, "a") && stillOpen({ state: "open", ask: "answer" }) && !stillOpen({ state: "open", ask: "answer", turn: "a" }, "b") &&
      stillOpen({ state: "open", ask: "report", turn: "a" }, "b") && !stillOpen({ state: "open", ask: "permission" }) && !stillOpen({ state: "working", ask: "answer" }))
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
    {
      const [, sb] = await api("GET", "state?since=0")
      const inState = (id: string) => JSON.parse(String(sb)).state.inbox.find((r: Any) => r.id === id)
      check("inbox: the state leaves an archived result's body out (its file keeps it)", inState("Inbox/.archive/Plant care apps, again")?.body === "" &&
        read("Inbox/.archive/Plant care apps, again.md").includes("Updated"), inState("Inbox/.archive/Plant care apps, again"))
    }
    ;[st, b] = await api("PUT", "inbox/Inbox/.archive/Plant care apps, again", { archived: false })
    check("inbox: unarchived is new", st === 200 && b.status === "new" && exists("Inbox/Plant care apps, again.md"), b)
    write("Inbox/Written by hand.md", "---\ntype: inbox\nstatus: maybe\n---\n\nA file.\n")
    ;[, b] = await api("GET", "inbox/Written by hand")
    const [, v] = await api("GET", "vault")
    check("inbox: a file written there is one, its bad status reported", b.title === "Written by hand" && v.problems.some((p: Any) => p.file === "Inbox/Written by hand.md" && /status/.test(p.problem)), [b, v.problems])
    write("Inbox/Written by hand.md", "---\ntype: inbox\nstatus: new\n---\n\nA file.\n")

    ;[st, b] = await api("POST", "inbox/events", { source: "backup", kind: "done", title: "Backup finished", body: "12 GB", link: "Notes/Backup.md" })
    check("inbox events: posted, open", st === 201 && b.event.id && b.event.kind === "done" && b.event.state === "open" && b.event.link === "Notes/Backup.md", [st, b])
    {
      const [bad] = await api("POST", "inbox/events", { source: "claude", kind: "session", title: "Not here" })
      check("inbox events: a session's state isn't posted as an event (inbox/sessions)", bad === 400, bad)
    }
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
      // A browser's session (claude.ai's, by its address): each turn it finishes is its progress on one row, quietly,
      // however far apart; needing the user opens that row; another session has its own.
      const url = "https://claude.ai/code/session_01LighthouseNotes", other = "https://claude.ai/code/session_01BeaconDocs"
      const news = (kind: string, body: string, session = url) => api("POST", "inbox/events", { source: "claude.ai", kind, title: kind === "done" ? "Claude Code finished" : "Claude Code needs you", body, session })
      await news("done", "Lighthouse notes: 40 of 120 migrated")
      await news("done", "Lighthouse notes: 80 of 120 migrated")
      const quiet = (await api("GET", "inbox/events"))[1].events.filter((e: Any) => e.session === url)
      await news("waiting", "Lighthouse notes: which folder for the 3 notes with no date?")
      const asking = (await api("GET", "inbox/events"))[1].events.filter((e: Any) => e.session === url)
      await news("done", "Beacon docs: published", other)
      await news("done", "Lighthouse notes: 120 of 120 migrated")
      const [, l] = await api("GET", "inbox/events")
      const mine = l.events.filter((e: Any) => e.session === url), theirs = l.events.filter((e: Any) => e.session === other)
      check("inbox events: a browser's session is one row, its finished turns quiet (done, read), needing you opens it",
        quiet.length === 1 && quiet[0].state === "done" && quiet[0].read === true && !quiet[0].nt && asking.length === 1 && asking[0].id === quiet[0].id &&
        asking[0].kind === "waiting" && asking[0].state === "open" && !asking[0].read && mine.length === 1 && mine[0].state === "done" &&
        mine[0].body === "Lighthouse notes: 120 of 120 migrated" && theirs.length === 1 && theirs[0].state === "done", [quiet, asking, mine, theirs])
      for (const e of [...mine, ...theirs]) await api("DELETE", `inbox/events/${e.id}`)
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
      const ev = (i: number, done: boolean, ago: number) => ({ id: `p${i}`, t: now - ago, source: "vau", kind: "session", state: done ? "done" as const : i % 3 ? "open" as const : "working" as const, title: `${i}`, read: true })
      const kept = prune([ev(0, false, 30 * day), ev(1, true, 30 * day), ...Array.from({ length: 500 }, (_, i) => ev(i + 2, i % 2 === 0, i * 1000))])
      check("inbox events: pruning keeps every open or working one, old, read or past the cap; done ones go after the days, past 200",
        kept.some((e) => e.id === "p0") && !kept.some((e) => e.id === "p1") && kept.filter((e) => e.state !== "done").length === 251 && kept.filter((e) => e.state === "done").length === 200, kept.length)
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
        ["it says nothing needs them", { prompt: "Keep an eye on the Lighthouse deploys", text: "Both deploys are green. Alice Park's question is still waiting in the inbox.\n\nNothing else needs you right now." }, false],
        ["a turn its own watcher started: its progress", { prompt: "<task-notification>build 412</task-notification>", text: "Build 412 passed; the next check runs at 10:00 UTC.", auto: true }, false],
        ["a turn its own schedule started, failing: still its progress", { prompt: "Nightly sweep", text: "GitHub is down, so the sweep couldn't fetch; retrying at 03:00.", auto: true }, false],
        ["a turn it started itself that asks", { prompt: "Nightly sweep", text: "The deploy failed twice.\n\nShould I roll it back?", auto: true }, true],
      ]
      const off = cases.filter(([, t, want]) => (sure(t)?.needs ?? null) !== want)
      check("needs: what a turn's words settle, the same each time; the rest for the model", !off.length, off.map(([why, t]) => [why, sure(t)]))
      check("needs: the model is asked for one word, told to keep the unsure on needs you", /exactly one word: NEEDS_YOU, ANSWER or DONE/.test(SYSTEM) && /When unsure between NEEDS_YOU and another, NEEDS_YOU/.test(SYSTEM))
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
    check("a session asking: its thread needs you, saying what it asks, told (nt), named for the agent when nothing else names it", st === 200 && row?.kind === "session" && row.state === "open" && row.ask === "permission" &&
      row.body === "Claude needs your permission to use Bash" && row.session === "abc" && row.source === "claude" && row.title === "Claude Code session" && !row.read && row.nt === row.t, [st, row])
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "UserPromptSubmit" })
    row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("answered (it works again: a prompt): its agent is working on it, read", row?.state === "working" && row.read === true, row)
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "Two ways:\n\n1. **Await** it\n2. Retry\n\nWhich one?" })
    let all = await rows()
    row = all.find((e) => e.terminal === "claude-k3j2h1g0")
    check("its turn ends with a question: the same thread needs you again, its answer whole, a plain preview",
      all.filter((e) => e.terminal === "claude-k3j2h1g0").length === 1 && row?.state === "open" && row.ask === "reply" && !row.read &&
      row.body.includes("1. **Await** it") && row.preview === "Two ways: Await it Retry Which one?", row)
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "" })
    row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("a quiet turn after (it went on by itself): its answer still to read, as it was", row?.state === "open" && !row.read && row.preview?.startsWith("Two ways"), row)
    await api("POST", "inbox/events/read", { ids: [row.id] })
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "" })
    row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("read (opened, not answered), then another quiet turn: it still needs you, reading doesn't settle it", row?.state === "open" && row.read === true && row.ask === "reply", row)
    const toldAt = row.nt
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "UserPromptSubmit", session_id: "abc" })
    await api("POST", "inbox/hook?agent=claude&terminal=claude-k3j2h1g0", { hook_event_name: "Stop", session_id: "abc", last_assistant_message: "" })
    row = (await rows()).find((e) => e.terminal === "claude-k3j2h1g0")
    check("the user wrote to it, then a turn done with nothing for them: done, quietly (not told again)", row?.state === "done" && row.read === true && !row.ask && !row.body && row.nt === toldAt, row)
    ;[st, b] = await api("POST", "inbox/hook?agent=codex", { type: "agent-turn-complete", "thread-id": "t9", cwd: "/tmp/lighthouse", "last-assistant-message": "Shall I merge it?" })
    row = (await rows()).find((e) => e.session === "t9")
    check("an agent's own hook outside the app: its folder names the session", row?.title === "lighthouse" && row.kind === "session" && row.state === "open" && row.source === "codex", row)
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
        r.length === 1 && r[0].state === "open" && r[0].ask === "reply" && r[0].session === "sess-osc" && r[0].body === read.text &&
        asked?.tier === "quick" && asked.prompt.includes("Look at the release and tell me what it needs.") && asked.prompt.includes(read.text), [r, asked?.prompt])
      cc.services.sample = async () => ({ text: "DONE", truncated: false })
      await api("POST", "inbox/events/read", { ids: [r[0].id] })
      read = { ...read, prompt: "Tag it", text: "Tagged v1.2.0 and pushed." }
      tell({ terminal: "claude-osc75010", agent: "claude", state: "working", from: "osc7501", at })
      tell({ terminal: "claude-osc75010", agent: "claude", state: "blocked", kind: "permission", msg: "Run git push?", from: "osc7501", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75010")
      check("inbox:state: blocked asking permission needs you", r[0]?.state === "open" && r[0].ask === "permission" && r[0].body === "Run git push?" && !r[0].read, r)
      tell({ terminal: "claude-osc75010", agent: "claude", state: "working", from: "osc7501", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75010")
      check("inbox:state: answered (working again): its agent is on it", r[0]?.state === "working" && r[0].read === true, r)
      tell({ terminal: "claude-osc75010", agent: "claude", state: "working", from: "osc7501", at })
      tell({ terminal: "claude-osc75010", agent: "claude", state: "idle", from: "osc7501", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75010")
      check("inbox:state: answered, then done with nothing for you: done, quiet", r[0]?.read === true && r[0].state === "done" && r[0].body === "Tagged v1.2.0 and pushed.", r)
      {
        // A turn the session started itself (its monitor's notice, a schedule): its progress on its row, quietly, never
        // asked of the model; what the user still has to answer stays open.
        let judged = 0
        cc.services.sample = async () => { judged++; return { text: "NEEDS_YOU", truncated: false } }
        read = { session: "sess-loop", prompt: "Which Beacon release should I tag?", text: "Should it be v2.0 or v2.1?", at: 0, final: true }
        cc.services["agent-turn:claude"] = async (terminal: string) => (terminal === "claude-loop0001" ? { ...read, at: Date.now() } : null)
        tell({ terminal: "claude-loop0001", agent: "claude", state: "working", from: "osc7501", at })
        tell({ terminal: "claude-loop0001", agent: "claude", state: "done", from: "osc7501", at })
        const asked = (await rows()).find((e) => e.terminal === "claude-loop0001")
        read = { ...read, prompt: "<task-notification>Monitor event: Beacon CI</task-notification>", text: "Beacon CI is green again; your tag question is still open.", auto: true } as Any
        tell({ terminal: "claude-loop0001", agent: "claude", state: "working", from: "osc7501", at })
        tell({ terminal: "claude-loop0001", agent: "claude", state: "done", from: "osc7501", at })
        const kept = (await rows()).find((e) => e.terminal === "claude-loop0001")
        await api("POST", "inbox/events/read", { ids: [kept.id] })
        await api("POST", "inbox/events/done", { ids: [kept.id] })
        read = { ...read, text: "Beacon CI ran twice more; both passed." }
        tell({ terminal: "claude-loop0001", agent: "claude", state: "working", from: "osc7501", at })
        tell({ terminal: "claude-loop0001", agent: "claude", state: "done", from: "osc7501", at })
        const loop = (await rows()).filter((e) => e.terminal === "claude-loop0001")
        check("inbox:state: a turn the session started itself is its progress, quiet, not judged; an open question it left stays open",
          asked?.state === "open" && asked.ask === "reply" && kept?.state === "open" && kept.ask === "reply" && kept.body === "Should it be v2.0 or v2.1?" &&
          loop.length === 1 && loop[0].state === "done" && loop[0].read === true && loop[0].body === "Beacon CI ran twice more; both passed." && judged === 0, [asked, kept, loop, judged])
        cc.services.sample = async () => ({ text: "DONE", truncated: false })
      }
      {
        // The setting `muted`: a session in an account the user muted (its agent's plugin says whose) makes no thread.
        const acct = cc.services["agent-account:claude"]
        cc.services["agent-account:claude"] = async (terminal: string) => (terminal === "claude_contact-mute0001" ? { id: "contact", label: "Contact" } : { id: "default", label: "Work" })
        await api("PATCH", "config/plugin/inbox", { muted: ["Contact"] })
        tell({ terminal: "claude_contact-mute0001", agent: "claude", state: "blocked", kind: "permission", msg: "Run it?", from: "osc7501", at })
        tell({ terminal: "claude-mute0002", agent: "claude", state: "blocked", kind: "permission", msg: "Run it?", from: "osc7501", at })
        const m = await rows()
        check("muted: a session in a muted account makes no thread, another account's does", !m.some((e) => e.terminal === "claude_contact-mute0001") && m.some((e) => e.terminal === "claude-mute0002"), m)
        await api("PATCH", "config/plugin/inbox", { muted: null })
        cc.services["agent-account:claude"] = acct
      }
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
      check("inbox:state: its done before the transcript has the answer: waits for it, needs you", r[0]?.state === "open" && r[0].body === "What would you like to work on?" && !r[0].read && reads === 3, [r, reads])
      // Ended by the user (End session, vau terminal end): its row is dealt with. One that ended by itself keeps it.
      const term = app.plugins.find((p) => p.id === "terminal")!
      term.emit("terminal.ended", { id: "claude-osc75011", code: 0, signal: 0 })
      await new Promise((ok) => setTimeout(ok, 50))
      check("a session that exited by itself keeps its answer to read", (await rows()).find((e) => e.terminal === "claude-osc75011")?.state === "open")
      term.emit("terminal.ended", { id: "claude-osc75011", code: 0, signal: 1, onPurpose: true })
      await new Promise((ok) => setTimeout(ok, 50))
      check("a session the user ended: its thread is done", (await rows()).find((e) => e.terminal === "claude-osc75011")?.state === "done")
      await api("DELETE", `inbox/events/${r[0].id}`) // (the block's newest events below are the ones before it)
      // Codex says no done: its turn ends working -> idle. Its session's name is its own (the terminal's says the folder).
      const cx = app.plugins.find((p) => p.id === "codex")!, cxTurn = cx.services["agent-turn:codex"]
      cx.services["agent-turn:codex"] = async (terminal: string) => (terminal === "codex-osc75012" ? { session: "cx-sess", title: "Answer 2+2",
        prompt: "What is 2+2?", text: "2 + 2 = 4.", at: Date.now(), final: true } : null)
      cc.services.sample = async () => ({ text: "NEEDS_YOU", truncated: false })
      for (const state of ["idle", "working", "idle"]) tell({ terminal: "codex-osc75012", agent: "codex", state, from: "osc7501", at })
      // (starting up, it says it works, then idle, with no session yet: no turn)
      for (const state of ["idle", "working", "idle"]) tell({ terminal: "codex-osc75013", agent: "codex", state, from: "osc7501", at })
      await settled()
      r = (await rows()).filter((e) => e.terminal === "codex-osc75012" || e.terminal === "codex-osc75013")
      check("inbox:state: Codex's working -> idle is a turn's end: an answer that only tells is done quietly, unread, never told, titled as its session; starting up isn't a turn",
        r.length === 1 && r[0].state === "done" && r[0].ask === "answer" && !r[0].read && !r[0].nt && r[0].body === "2 + 2 = 4." && r[0].title === "Answer 2+2" && r[0].session === "cx-sess", r)
      await api("DELETE", `inbox/events/${r[0].id}`)
      {
        // The setting `answers`: inbox keeps an answer to read in the inbox, told; a model's ANSWER is one too.
        await api("PATCH", "config/plugin/inbox", { answers: "inbox" })
        for (const state of ["working", "idle"]) tell({ terminal: "codex-osc75012", agent: "codex", state, from: "osc7501", at })
        await settled()
        r = (await rows()).filter((e) => e.terminal === "codex-osc75012")
        check("answers: inbox keeps an answer to read open, unread", r.length === 1 && r[0].state === "open" && r[0].ask === "answer" && !r[0].read, r)
        await api("DELETE", `inbox/events/${r[0].id}`)
        await api("PATCH", "config/plugin/inbox", { answers: null })
        cx.services["agent-turn:codex"] = async (terminal: string) => (terminal === "codex-osc75014" ? { session: "cx-sess2", prompt: "Look at the logs and tell me what you see.", text: "Two restarts overnight, both after the update.", at: Date.now(), final: true } : null)
        cc.services.sample = async () => ({ text: "ANSWER", truncated: false })
        for (const state of ["idle", "working", "idle"]) tell({ terminal: "codex-osc75014", agent: "codex", state, from: "osc7501", at })
        await settled()
        r = (await rows()).filter((e) => e.terminal === "codex-osc75014")
        check("answers: the model's ANSWER, by default, is done quietly too", r.length === 1 && r[0].state === "done" && r[0].ask === "answer" && !r[0].read && !r[0].nt, r)
        await api("DELETE", `inbox/events/${r[0].id}`)
      }
      // A question in its own words (agent-asking), whatever its hooks call it: Claude Code's say permission.
      const askWas = cc.services["agent-asking:claude"]
      const qs = [{ question: "How should it sign builds?", header: "Signing", options: [{ label: "Local cert (Recommended)", description: "Made here once" }, { label: "Not now" }] }]
      cc.services["agent-asking:claude"] = async (terminal: string) => (terminal === "claude-osc75014" ? { kind: "question", questions: qs } : null)
      tell({ terminal: "claude-osc75014", agent: "claude", state: "working", from: "hooks", at })
      tell({ terminal: "claude-osc75014", agent: "claude", state: "blocked", kind: "permission", from: "hooks", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75014")
      check("inbox:state: a question its hooks call a permission is a question, whole: its options in the body, a line saying them",
        r[0]?.ask === "question" && r[0].questions?.[0].options.length === 2 && r[0].body.includes("1. **Local cert (Recommended)**: Made here once") &&
        r[0].preview === "How should it sign builds? Local cert (Recommended) or Not now" && categoryOf(r[0]) === "reply", r)
      check("choice: a number, a name (Recommended or not, any case), else typed; a multi-select's by commas", JSON.stringify([choiceOf(qs[0], "2"),
        choiceOf(qs[0], "local cert"), choiceOf(qs[0], "Use the M4's"), choiceOf({ ...qs[0], multi: true }, "1, not now")]) === '[[2],[1],"Use the M4\'s",[1,2]]')
      const as = (client: string, agent: string | null = null) => request({ host: "127.0.0.1:8793", "x-vaultite-client": client, ...(agent ? { "x-vaultite-agent": agent } : {}) }, { remote: "127.0.0.1" })
      const [byAgent] = await api("POST", "ops/inbox.answer", { id: r[0].id, answer: "pick", picks: ["1"] }, as("cli", "claude-code"))
      ;[st, b] = await api("POST", "ops/inbox.answer", { id: r[0].id, answer: "pick", picks: ["1"] }, as("app/desktop"))
      check("pick: the user's alone (an agent's refused), and only while its terminal shows the question", byAgent === 403 && st === 409 && /doesn't show/.test(b.error), [byAgent, st, b])
      // Shown there: its agent's keys, each written apart, for an option, an answer typed in its own row, or Chat about this.
      {
        const { pickIn } = await import("../../../plugins/core/inbox/plugin.ts")
        const sent: string[][] = [[]]
        const ctx = { api: async (method: string, _route: string, body?: Any) => (method === "POST" ? (sent.at(-1)!.push(body.text), {}) : { text: ["How should it", "sign builds?", "❯ 1. Local cert"].join("\n") }) }
        const keys = async (picks: string[] | "chat", typed?: string[], ev: Any = r[0]) => { sent.push([]); await pickIn(ctx, { ...ev }, picks, typed); return sent.at(-1)!.join("|") }
        const k = [await keys(["2"]), await keys(["Use the M4's"]), await keys([""], ["Use the M4's"]), await keys("chat")]
        check("pick in its terminal: a session's thread (kind session), by an option, typed as its own (a reply's or its row's), or Chat about this",
          JSON.stringify(k) === JSON.stringify(["2", "3|Use the M4's|\r", "3|Use the M4's|\r", "4"]), k)
        const closed = { ...r[0], questions: [{ ...qs[0], closed: true }] }
        const errs = await Promise.all([keys("chat", [], closed), keys(["Use the M4's"], [], closed)].map((p) => p.then(() => null, (x: Any) => x.message)))
        check("pick in its terminal: a dialog read off its screen takes only its options", /no Chat about this/.test(errs[0]) && /takes one of its 2 options/.test(errs[1]) &&
          JSON.stringify(choiceOf(closed.questions[0], "not now")) === "[2]", errs)
        check("choice: a multi-select's picks go with what's typed in its own row; that alone is typed", JSON.stringify([choiceOf({ ...qs[0], multi: true }, "1", "Feta, aged"),
          choiceOf({ ...qs[0], multi: true }, "", "Feta"), choiceOf(qs[0], "", "Mine")]) === '[{"options":[1],"text":"Feta, aged"},"Feta","Mine"]')
      }
      tell({ terminal: "claude-osc75014", agent: "claude", state: "working", from: "hooks", at })
      r = (await rows()).filter((e) => e.terminal === "claude-osc75014")
      check("answered in its terminal: working, read, nothing left to pick", r[0]?.state === "working" && r[0].read === true && !r[0].questions, r)
      await api("DELETE", `inbox/events/${r[0].id}`)
      cc.services["agent-asking:claude"] = askWas
      cx.services["agent-turn:codex"] = cxTurn
      cc.services["agent-turn:claude"] = was.turn; cc.services.sample = was.sample
    }
    ;[st, b] = await api("POST", "inbox/hook?agent=claude&terminal=claude-p9p9p9p9", { hook_event_name: "Notification", notification_type: "permission_prompt", session_id: "perm", message: "Claude needs your permission to use Bash" })
    const permId = (await rows()).find((e) => e.session === "perm")?.id
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: permId, answer: "approve" }, asApp)
    check("answer: approving needs the terminal running (its question on screen)", st >= 400 && st !== 403, [st, b])
    await (await import("../../../plugins/core/inbox/plugin.ts")).stillWaiting(0)
    ;[, list] = await api("GET", "inbox/events")
    check("a permission whose terminal no longer asks it, the terminal gone (here: none runs): done", list.events.find((e: Any) => e.id === permId)?.state === "done", list.events)
    const done = list.events.find((e: Any) => e.state === "done" && e.kind === "session" && !e.ask)
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: done.id, answer: "approve" })
    check("answer: only a permission is approved", st === 409, [st, b])
    ;[st, b] = await api("POST", "ops/inbox.answer", { id: done.id, answer: "read" })
    ;[, list] = await api("GET", "inbox/events")
    check("answer: read marks it read", st === 200 && list.events.find((e: Any) => e.id === done.id)?.read === true, [st, b])
    check("push: Approve and Deny for a permission it shows whole, Reply for a session's answer, else Mark read",
      categoryOf({ id: "a", t: 0, source: "claude", kind: "session", state: "open", ask: "permission", terminal: "claude-x", title: "x", body: "Bash" }) === "permission" &&
      categoryOf({ id: "a", t: 0, source: "claude", kind: "session", state: "open", ask: "answer", session: "s", title: "x" }) === "reply" &&
      categoryOf({ id: "a", t: 0, source: "vau", kind: "info", state: "open", title: "x" }) === "event")
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
      const v3 = asThreads([...now, { id: "g1", t: 0, source: "mcp", kind: "waiting", gate: true, answer: "approve", title: "x" }, { id: "g2", t: 0, source: "mcp", kind: "waiting", gate: true, title: "y" },
        { id: "w1", t: 0, source: "example.com", kind: "waiting", session: "https://example.com/", title: "A site asks" }, { id: "z1", t: 0, source: "claude", kind: "waiting", terminal: "claude-z", read: true, snoozed: 9e12, title: "z" }] as Any)
      const st = Object.fromEntries(v3.map((e) => [e.id, `${e.kind}:${e.state}`]))
      check("events of version 2 get their state: a session's row its thread (read: done, unread: open), a gate answered done, a browser's ask still one, snoozed still to come back",
        st.o1 === "session:done" && st.o3 === "session:done" && st.o4 === "info:open" && st.o5 === "session:done" && st.g1 === "waiting:done" && st.g2 === "waiting:open" &&
        st.w1 === "waiting:open" && st.z1 === "session:open", st)
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
    ;[st, b] = await api("POST", "ops/inbox.done", { item: "Inbox/Remind me to call Alice about the trip….md", title: "Call Alice about the trip" })
    check("inbox.done: named anew and archived", st === 200 && b.path === "Inbox/.archive/Call Alice about the trip.md" &&
      read("Inbox/.archive/Call Alice about the trip.md").includes("status: done") && !exists("Inbox/Remind me to call Alice about the trip….md"), [st, b])
    ;[st] = await api("POST", "ops/inbox.done", { item: "Inbox/Nothing here.md" })
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
    // An agent's report: a record (archived as it comes, its thread done quietly), its questions decisions of their own,
    // each a file with its options and default; the one an agent waits on told. Its TL;DR on top, details folded.
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "Lighthouse docs updated", work: "change", tldr: "The setup page is rewritten.\nLive on the preview.", summary: "Rewrote the **setup** page.\n- New screenshots",
      decision: ["Publish it today? | Publish: it goes out now* | Wait: it waits for Monday | why: The Lighthouse docs job is done.", { question: "Which domain should the docs use?", options: ["docs.lighthouse.test: a subdomain", "lighthouse.test/docs: under the site"], default: "lighthouse.test/docs", blocking: true, why: "The subdomain needs a DNS change." }],
      session: "sess-report-1", agent: "claude" })
    let rep = read("Inbox/.archive/Change needs you · Lighthouse docs updated.md")
    check("report: archived as it comes, naming its session, with its decisions and a reply box", st === 200 && b.path === "Inbox/.archive/Change needs you · Lighthouse docs updated.md" && b.inbox === false &&
      rep.includes("agent: claude") && rep.includes("session: sess-report-1") && rep.includes("work: change") && !rep.includes("Open questions") &&
      rep.trimEnd().endsWith("```block-reply\n```") && rep.includes("from: Claude Code") && b.decisions.length === 2, [st, b, rep])
    check("report: a one-line TL;DR on top, its decisions, then the details folded", rep.split("---\n")[2]?.startsWith("\n> [!tldr] In short\n> The setup page is rewritten. Live on the preview.\n\n```block-decisions\n```\n\n> [!info]- Details\n> Rewrote the **setup** page.\n> - New screenshots"), rep)
    const pub = read("Inbox/Publish it today.md"), dom = read("Inbox/Which domain should the docs use.md")
    check("decisions: a file each, its question, options, default, the report that asked and its session", /question: Publish it today\?/.test(pub) && /options: \[Publish, Wait\]/.test(pub) && /effects: \[it goes out now, it waits for Monday\]/.test(pub) &&
      /default: Publish/.test(pub) && !/blocking: true/.test(pub) && pub.includes("report: '[[Change needs you · Lighthouse docs updated]]'") && pub.includes("session: sess-report-1") &&
      pub.includes("```block-decisions") && /blocking: true/.test(dom) && dom.includes("The subdomain needs a DNS change."), [pub, dom])
    const [, said] = await api("GET", "render?path=Inbox/Publish it today.md")
    check("decisions: keep what their report said as they were asked, read cold later", pub.includes("gist: The setup page is rewritten. Live on the preview.") &&
      String(said).includes("Its report: The setup page is rewritten."), said)
    ;[, list] = await api("GET", "inbox/events")
    const repEvent = list.events.find((e: Any) => e.session === "sess-report-1")
    check("report: its session's thread is done with it, quietly (not told), linking it", repEvent?.link === "Inbox/.archive/Change needs you · Lighthouse docs updated.md" && repEvent.state === "done" &&
      repEvent.ask === "report" && repEvent.read === true && !repEvent.nt, repEvent)
    const told = list.events.find((e: Any) => e.link === "Inbox/Which domain should the docs use.md")
    check("decision waiting: told by an event linking it (toast, push), not the session's row", told?.kind === "waiting" && told.state === "open" && !!told.nt && !told.session &&
      told.title === "Which domain should the docs use?" && !list.events.some((e: Any) => e.link === "Inbox/Publish it today.md"), told)
    {
      const ls = lists(list.events, (await api("GET", "inbox"))[1])
      check("lists: the decisions on top, the one waiting first; its event not a row apart; the report under Reports", ls.decisions.map((r: Any) => r.id).join() === "Inbox/Which domain should the docs use,Inbox/Publish it today" &&
        !ls.needs.some((e: Any) => e.id === told.id) && ls.reports.some((r: Any) => r.id === "Inbox/.archive/Change needs you · Lighthouse docs updated") && countOf(ls) >= 2, ls.decisions)
      cr = await vau("inbox")
      check("vau inbox: decisions first, the report not listed", /^Decisions:\n  \[waits on you\] Which domain[^]*\[went with Publish\] Publish it today/.test(cr.out) && !cr.out.includes("Lighthouse docs updated"), cr.out)
      cr = await vau("inbox", "reports")
      check("vau inbox reports: one line each, linked, with its TL;DR", cr.out.includes("- [[Change needs you · Lighthouse docs updated]]: The setup page is rewritten. Live on the preview."), cr.out)
    }
    await api("POST", "inbox/hook?agent=claude", { hook_event_name: "Stop", session_id: "sess-report-1", last_assistant_message: "Done." })
    await settled()
    ;[, list] = await api("GET", "inbox/events")
    const merged = list.events.filter((e: Any) => e.session === "sess-report-1")
    check("report: the turn ending after it leaves the report's thread as it is", merged.length === 1 && merged[0].ask === "report" && merged[0].state === "done", merged)
    {
      // The same question again (another agent, another wording of it in a few words) is that decision; a bad one says why.
      ;[st, b] = await api("POST", "ops/inbox.ask", { question: "Publish it today", options: ["Publish: now", "Wait: Monday"], default: "Wait", blocking: true, why: "Codex's docs job.", agent: "codex", session: "sess-codex-1" })
      check("inbox.ask: the same question open already is that one, waiting now", st === 200 && b.merged === true && b.path === "Inbox/Publish it today.md" && /blocking: true/.test(read("Inbox/Publish it today.md")), [st, b])
      const bad = await Promise.all([{ question: "Ship?", options: ["Yes: a"], default: "Yes", why: "c" }, { question: "Ship?", options: ["Yes: a", "No: b"], default: "Maybe", why: "c" },
        { question: "Ship?", options: ["Yes: a", "No: b"], why: "c" }, { question: "Ship?", options: ["Yes", "No: b"], default: "No", why: "c" }, { question: "Ship?", options: ["Yes: a", "No: b"], default: "No" }]
        .map((x) => api("POST", "ops/inbox.ask", x)))
      check("inbox.ask: two options at least, each saying what it causes, a default among them, a why", bad.every(([c, x]) => c === 400 && /option|default|why/.test(x.error)), bad)
      ;[st, b] = await api("POST", "ops/inbox.report", { title: "No default", work: "fix", tldr: "x", summary: "x", decision: ["Ship it? | Yes: a | No: b | why: c"] })
      check("report: a decision's text marks its default", st === 400 && /\*/.test(b.error), [st, b])
      // Answered: archived with its answer; a default kept goes nowhere, an answer it waits on goes to its session.
      // (Claude Code's host stands in: what it's given is what the session would be told)
      const host = app.plugins.find((p) => p.services["agent-reply:claude"]) ?? app.plugins.find((p) => p.id === "inbox")!
      const real = host.services["agent-reply:claude"]
      const got: Any[] = []
      host.services["agent-reply:claude"] = async (session: string, text: string) => { got.push([session, text]); return true }
      ;[st, b] = await api("POST", "ops/inbox.decide", { item: "Inbox/Which domain should the docs use.md", answer: "2" })
      const ans = read("Inbox/.archive/Which domain should the docs use.md")
      check("inbox.decide: by its number, archived with its answer; its agent told, into its report", st === 200 && b.decided[0].answer === "lighthouse.test/docs" && /answer: lighthouse\.test\/docs/.test(ans) &&
        /answered: '\d{4}/.test(ans) && got.length === 1 && got[0][0] === "sess-report-1" && /Which domain should the docs use\?.*lighthouse\.test\/docs/.test(got[0][1]) &&
        read("Inbox/.archive/Change needs you · Lighthouse docs updated.md").includes("> [!note] You replied"), [st, b, got])
      check("inbox.decide: its event is done with it", (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.id === told.id)?.state === "done")
      ;[st, b] = await api("POST", "ops/inbox.decide", { item: "Inbox/Which domain should the docs use.md", answer: "1" })
      check("inbox.decide: once", st === 409, [st, b])
      ;[st, b] = await api("POST", "ops/inbox.decide", { item: "Inbox/.archive/Which domain should the docs use.md", undo: true })
      check("inbox.decide --undo: open again, its answer gone", st === 200 && exists("Inbox/Which domain should the docs use.md") && !/^answer: (?!null)\S/m.test(read("Inbox/Which domain should the docs use.md")), [st, b])
      ;[st, b] = await api("POST", "ops/inbox.decide", { item: "Inbox/Which domain should the docs use.md", moot: "The docs moved to the wiki" })
      check("inbox.decide --moot: closed, saying why, nobody told", st === 200 && /closed: The docs moved to the wiki/.test(read("Inbox/.archive/Which domain should the docs use.md")) && got.length === 1, [st, b, got])
      got.length = 0
      await api("POST", "ops/inbox.ask", { question: "Keep the quieter island?", options: ["Keep: it stays quiet", "Go back: it spins again"], default: "Keep", why: "The island job.", session: "sess-island", agent: "claude" })
      ;[st, b] = await api("POST", "ops/inbox.decide", { defaults: true })
      check("inbox.decide --defaults: every open one's default; a default an agent took isn't sent, one it waits on is", st === 200 && b.decided.length === 2 &&
        b.decided.every((d: Any) => d.answer) && got.length === 1 && got[0][0] === "sess-report-1" && /Publish it today\?.*Publish/.test(got[0][1]) && exists("Inbox/.archive/Keep the quieter island.md"), [st, b, got])
      if (real) host.services["agent-reply:claude"] = real; else delete host.services["agent-reply:claude"]
      // (the sessions those answers resumed: not this test's)
      for (const e of (await rows()).filter((x) => ["sess-codex-1"].includes(x.session ?? ""))) await api("DELETE", `inbox/events/${e.id}`)
      // Progress: a session's own row, quietly, each line replacing the last.
      await vau("inbox", "progress", "Two of five fixes in", "--session", "sess-progress", "--agent", "claude")
      await vau("inbox", "progress", "Three of five", "--session", "sess-progress", "--agent", "claude")
      const pr = (await rows()).filter((x) => x.session === "sess-progress")
      check("inbox.progress: its row working, the latest line, never told", pr.length === 1 && pr[0].state === "working" && pr[0].progress === "Three of five" && pr[0].read && !pr[0].nt, pr)
      ;[st] = await api("POST", "ops/inbox.progress", { text: "x" })
      check("inbox.progress: a session's only", st === 400)
      await api("DELETE", `inbox/events/${pr[0].id}`)
    }
    {
      // The thread done (its Done, vau inbox done <id>): out of what needs you, its report archived with it; undone, open again.
      await api("POST", "ops/inbox.report", { title: "Done by its thread", work: "fix", tldr: "x", summary: "x", public: true, session: "sess-done-thread", agent: "claude" })
      const th = (await rows()).find((e) => e.session === "sess-done-thread")
      const [ds, db] = await api("POST", "ops/inbox.settle", { item: th.id })
      let now = (await rows()).find((e) => e.id === th.id)
      check("inbox.settle <id>: the thread is settled, its report archived", ds === 200 && db.done === true && now?.state === "done" && now.link === "Inbox/.archive/Fix done · Done by its thread.md" &&
        exists("Inbox/.archive/Fix done · Done by its thread.md") && !exists("Inbox/Fix done · Done by its thread.md"), [ds, db, now])
      await api("POST", "ops/inbox.settle", { item: th.id, undo: true })
      now = (await rows()).find((e) => e.id === th.id)
      check("inbox.settle <id> --undo: open again, its record staying archived", now?.state === "open" && exists("Inbox/.archive/Fix done · Done by its thread.md"), now)
      cr = await vau("inbox", "done", th.id)
      check("vau inbox done <id>: settle's old name still settles it", cr.code === 0 && (await rows()).find((e) => e.id === th.id)?.state === "done", cr)
      await vau("inbox", "settle", th.id, "--undo")
      cr = await vau("inbox", "settle", th.id)
      check("vau inbox settle <id>", cr.code === 0 && /^Settled/.test(cr.out) && (await rows()).find((e) => e.id === th.id)?.state === "done", cr)
    }
    {
      // Its event goes where the result goes: Done archives it (and reads the event, it's dealt with), Back to review
      // brings it back; one linking where a result was before it was archived links where it is now.
      await api("POST", "ops/inbox.report", { title: "Moves along", work: "fix", tldr: "x", summary: "x", public: true, session: "sess-moves" })
      const ev = async () => (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.session === "sess-moves")
      await api("PUT", "inbox/Inbox/Fix done · Moves along", { status: "done" })
      let e = await ev()
      check("report done: its thread is done, linking the archived file", e?.link === "Inbox/.archive/Fix done · Moves along.md" && e.state === "done", e)
      await api("PUT", "inbox/Inbox/.archive/Fix done · Moves along", { status: "new" })
      e = await ev()
      check("report back to review: its thread follows it back, open again", e?.link === "Inbox/Fix done · Moves along.md" && e.state === "open", e)
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
    fs.mkdirSync(path.join(VAULT, "Guides/Proofs/Blue save"), { recursive: true }); fs.writeFileSync(path.join(VAULT, "Guides/Proofs/Blue save/Blue save.mp4"), "x")
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "With its demo", work: "feature", tldr: "x", summary: "x", video: "Guides/Proofs/Blue save/Blue save.mp4", images: [shot] })
    const demo = st === 200 ? read(`${b.path}`) : ""
    const [bst, bb] = await api("POST", "ops/inbox.report", { title: "Bad demo", work: "fix", tldr: "x", summary: "x", video: shot })
    check("report: a job's demo video is embedded by its vault path, above the screenshots; a picture isn't one",
      demo.indexOf("![[Guides/Proofs/Blue save/Blue save.mp4]]") > 0 && demo.indexOf("![[Guides/Proofs/Blue save/Blue save.mp4]]") < demo.indexOf("after.png]]") && bst === 400 && /mp4/.test(bb.error), [st, b, demo, bb])
    fs.rmSync(path.join(VAULT, "Guides/Proofs/Blue save"), { recursive: true, force: true })
    const cliOut = await vau("inbox", "report", "From the command line", "--work", "feature", "--tldr", "Did it", "--summary", "Did it", "--decision", "First of the two? | A: a* | B: b | why: w", "Second of the two? | C: c | D: d* | why: w", "--session", "sess-cli")
    rep = read("Inbox/.archive/Feature done · From the command line.md")
    check("report: vau takes a list's values after its flag", cliOut.code === 0 && exists("Inbox/First of the two.md") && /default: D/.test(read("Inbox/Second of the two.md")) && rep.includes("session: sess-cli"), [cliOut, rep])
    ;[st, b] = await api("POST", "ops/inbox.report", { title: "One question", work: "fix", tldr: "x", summary: "x", decision: "Ship it, or wait? | Ship it, now: it goes out* | Wait: it doesn't | why: w" })
    check("report: a decision given as text keeps its commas", st === 200 && /question: Ship it, or wait\?/.test(read("Inbox/Ship it, or wait.md")) && read("Inbox/Ship it, or wait.md").includes("Ship it, now"), [st, b])
    await api("POST", "ops/inbox.decide", { defaults: true })
    ;[st, b] = await api("POST", "ops/inbox.reply", { to: "Inbox/Written by hand.md", text: "hi" })
    check("reply: only to a report that names its session", st === 409, [st, b])
    ;[st, b] = await api("POST", "ops/inbox.reply", { to: "Inbox/Nope.md", text: "hi" })
    check("reply: to a report that's there", st === 404, [st, b])
    // A reply typed at an agent's prompt: Enter once it shows there, sent once it works on it, Escape and Enter again when
    // not, else an error (not lost); a dialog over the prompt (its keys taken, nothing shown) gets no Enter.
    {
      const { submit } = await import("../../../plugins/core/inbox/plugin.ts")
      const fake = (works: (sent: string[]) => boolean, shows = true) => {
        const sent: string[] = []
        const api = async (method: string, route: string, body?: unknown) => {
          if (method === "POST") { sent.push(JSON.stringify(body)); return {} }
          if (route.includes("/capture")) {
            const prompt = shows && sent.length ? "❯ Ship it" : "❯ yes, ship it"
            return { text: ["Want me to ship it?", "────", prompt, "────"].join("\n") }
          }
          return { sessions: [{ id: "claude-k3j2h1g0", state: works(sent) ? "working" : "idle" }] }
        }
        return { sent, ctx: { api } as unknown as Parameters<typeof submit>[0] }
      }
      const at = fake((s) => s.length > 1)
      await submit(at.ctx, "claude-k3j2h1g0", "Ship it", 1)
      const vim = fake((s) => s.length > 3)
      await submit(vim.ctx, "claude-k3j2h1g0", "Ship it", 1)
      const lost = fake(() => false)
      const err = await submit(lost.ctx, "claude-k3j2h1g0", "Ship it", 1).then(() => null, (e: Any) => e)
      const dialog = fake(() => false, false)
      const over = await submit(dialog.ctx, "claude-k3j2h1g0", "Ship it", 1).then(() => null, (e: Any) => e)
      check("reply typed in: Enter once it shows, Escape and Enter again when it doesn't start, an error when it still doesn't",
        at.sent.length === 2 && at.sent[1] === '{"text":"","enter":true}' && vim.sent.length === 4 && vim.sent[2] === '{"text":"\\u001b","enter":false}' &&
        lost.sent.length === 4 && err?.status === 409 && /didn't start on it/.test(err.message), [at.sent, vim.sent, lost.sent, err?.message])
      check("reply typed in: no Enter when it doesn't show at the prompt (a dialog has the keys), an error",
        dialog.sent.length === 1 && over?.status === 409 && /didn't take it/.test(over.message), [dialog.sent, over?.message])
    }
    {
      const { typable } = await import("../../../plugins/core/inbox/plugin.ts")
      const at = typable([{ id: "zsh-k3j2h1g0", agent: null, busy: false }, { id: "claude-a1b2c3d4", agent: "claude", busy: false }, { id: "claude-e5f6g7h8", agent: "claude", busy: true }])
      check("reply typed in: only into its agent running, never a shell at its prompt (a report names its terminal)", !at("zsh-k3j2h1g0") && !at("claude-a1b2c3d4") && at("claude-e5f6g7h8") && !at("nope"))
    }
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
      ;[st, b] = await api("POST", "ops/inbox.reply-plan", { to: "Inbox/.archive/Fix done · Beacon fixed.md" })
      check("reply plan: its session resumed while it's cached", st === 200 && b.how === "resume" && b.ttl === 3600 && b.ago < 60, [st, b])
      const old = (Date.now() - 2 * 3600_000) / 1000
      fs.utimesSync(tfile, old, old)
      ;[st, b] = await api("POST", "ops/inbox.reply-plan", { to: "Inbox/.archive/Fix done · Beacon fixed.md" })
      check("reply plan: a new session once it isn't", st === 200 && b.how === "new" && b.ago >= 7200, [st, b])
      fs.utimesSync(tfile, Date.now() / 1000 - 56 * 60, Date.now() / 1000 - 56 * 60)
      ;[st, b] = await api("POST", "ops/inbox.reply-plan", { to: "Inbox/.archive/Fix done · Beacon fixed.md" })
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
      // (replied to before the turn that reported ended: never ended under the reply)
      ;(service(app.plugins, "inbox:handed") as (t: string) => void)("claude-handed2")
      ;[st, b] = await api("POST", "ops/inbox.report", { title: "Handed, then replied", work: "fix", tldr: "Did it.", summary: "Did it.", terminal: "claude-handed2", agent: "claude" })
      await api("POST", "ops/inbox.reply", { to: "Inbox/.archive/Fix done · Handed, then replied.md", text: "Also the footer" })
      await api("POST", "inbox/hook?agent=claude&terminal=claude-handed2", { hook_event_name: "Stop" })
      check("handed: replied to before its turn ended, that turn's end doesn't end it (its next report will)", handedOf().includes("claude-handed2"), handedOf())
      // The same session's next report goes on in its file: one file per exchange, its title saying where it stands.
      await api("POST", "ops/inbox.report", { title: "Thread start", work: "fix", tldr: "Ship it?", summary: "First round.", decision: { question: "Ship the thread fix?", options: ["Ship: it goes out", "Hold: it waits"], default: "Ship", blocking: true, why: "The thread job." }, terminal: "claude-thread1", agent: "claude" })
      await sleep(1100) // (times are to the second)
      await api("POST", "ops/inbox.report", { title: "Came between", work: "fix", tldr: "x", summary: "x", terminal: "claude-between1", agent: "claude" })
      await sleep(1100)
      ;[st, b] = await api("POST", "ops/inbox.report", { title: "Shipped", work: "fix", tldr: "Shipped it.", summary: "Second round.", settles: ["Inbox/Ship the thread fix.md"], terminal: "claude-thread1", agent: "claude" })
      const thread = read("Inbox/.archive/Fix done · Thread start.md")
      check("thread: the next report goes on in the same file, its title saying where it stands", st === 200 && b.path === "Inbox/.archive/Fix done · Thread start.md" && b.thread === true &&
        !exists("Inbox/.archive/Fix needs you · Thread start.md") && thread.includes("status: done") &&
        /First round\.[\s\S]*## Fix done · Shipped\n\n> \[!tldr\] In short\n> Shipped it\.\n\n> \[!info\]- Details\n> Second round\.\n\n```block-reply\n```\n?$/.test(thread) &&
        thread.split("```block-reply").length === 2 && thread.split("```block-decisions").length === 2 && /\nupdated: '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'\n/.test(thread), [st, b, thread])
      check("settles: the decision that work settled closes, saying by what", b.closed[0] === "Inbox/.archive/Ship the thread fix.md" &&
        read("Inbox/.archive/Ship the thread fix.md").includes("closed: Settled by [[Fix needs you · Thread start]]") || read("Inbox/.archive/Ship the thread fix.md").includes("Settled by [[Fix"), [b, read("Inbox/.archive/Ship the thread fix.md")])
      await api("POST", "ops/inbox.report", { title: "Elsewhere", work: "fix", tldr: "x", summary: "x", terminal: "claude-thread2", agent: "claude" })
      check("thread: another session's report is a file of its own", exists("Inbox/.archive/Fix done · Elsewhere.md"))
    }
    const [, r0] = await api("GET", "render?path=Inbox/.archive/Change needs you · Lighthouse docs updated.md")
    check("reply block: as text, how to reply", r0.includes(`vau inbox reply "Inbox/.archive/Change needs you · Lighthouse docs updated.md"`), r0)
    check("decisions block: as text, the report's decisions and their answers", r0.includes("answered: Publish") && r0.includes("Which domain should the docs use?") && r0.includes("vau inbox decide"), r0)
    {
      // A session's host (an agent run outside a terminal, as the Agent SDK runs one) tells its state (inbox:session, POST
      // inbox/sessions): the same thread a hook makes, answered and replied to through its host.
      const host = service(app.plugins, "inbox:session") as (b: Any) => Promise<Any>
      const inbox = app.plugins.find((p) => p.id === "inbox")!
      const got: Any[] = []
      inbox.services["agent-reply:sdk"] = async (session: string, text: string) => { got.push([session, text]); return true }
      inbox.services["agent-answer:sdk"] = async (session: string, a: Any) => { got.push([session, a]); return true }
      let e = await host({ agent: "sdk", session: "sdk-1", state: "waiting", ask: "question", title: "Lighthouse rollout",
        questions: [{ question: "Which region first?", options: [{ label: "EU" }, { label: "US", description: "the bigger one" }] }] })
      check("inbox:session: waiting with its questions is a thread that needs you, named by its host, told", e?.kind === "session" && e.state === "open" && e.ask === "question" &&
        e.title === "Lighthouse rollout" && e.questions?.[0].options[1].description === "the bigger one" && e.preview === "Which region first? EU or US" && !e.read, e)
      ;[st, b] = await api("POST", "ops/inbox.answer", { id: e.id, answer: "pick", picks: ["US"] }, asApp)
      const now = async () => (await rows()).find((x) => x.id === e.id)
      check("a host's session: its pick goes to its host, then it's working", st === 200 && JSON.stringify(got[0]) === '["sdk-1",{"picks":[[2]]}]' && (await now())?.state === "working", [st, b, got])
      const regions = [{ question: "Which regions next?", multi: true, options: [{ label: "EU" }, { label: "US" }] }]
      e = await host({ agent: "sdk", session: "sdk-1", state: "waiting", ask: "question", questions: regions })
      ;[st, b] = await api("POST", "ops/inbox.answer", { id: e.id, answer: "pick", picks: ["2"], typed: ["APAC, later"] }, asApp)
      check("a host's session: a multi-select's picks go with what's typed in its own row", st === 200 && JSON.stringify(got.at(-1)) === '["sdk-1",{"picks":[{"options":[2],"text":"APAC, later"}]}]', [st, b, got])
      e = await host({ agent: "sdk", session: "sdk-1", state: "waiting", ask: "question", questions: regions })
      const [byAgent] = await api("POST", "ops/inbox.answer", { id: e.id, answer: "chat" })
      ;[st, b] = await api("POST", "ops/inbox.answer", { id: e.id, answer: "chat" }, asApp)
      check("a host's session: Chat about this goes to its host (the user's alone), then it's working", byAgent === 403 && st === 200 &&
        JSON.stringify(got.at(-1)) === '["sdk-1",{"chat":true}]' && (await now())?.state === "working", [byAgent, st, b, got])
      e = await host({ agent: "sdk", session: "sdk-1", state: "done", prompt: "Roll it out", text: "Rolled out to US. Should I do EU next?" })
      check("inbox:session: a turn ending with a question: open again, its host's", e?.state === "open" && e.ask === "reply" && !e.read && e.host === true, e)
      const asked = await host({ agent: "sdk", session: "sdk-2", state: "waiting", ask: "permission", text: "Run the migration?" })
      ;[st, b] = await api("POST", "ops/inbox.answer", { id: asked.id, answer: "approve" }, asApp)
      check("a host's session asking permission: approved through its host, then working", st === 200 && JSON.stringify(got.at(-1)) === '["sdk-2",{"answer":"approve"}]' &&
        categoryOf(asked) === "permission" && (await rows()).find((x) => x.id === asked.id)?.state === "working", [st, b, got])
      await api("DELETE", `inbox/events/${asked.id}`)
      ;[st, b] = await api("POST", "ops/inbox.reply", { to: e.id, text: "Yes, EU next" })
      check("a host's session: a reply goes to its host, its thread working", st === 200 && b.how === "host" && JSON.stringify(got.at(-1)) === '["sdk-1","Yes, EU next"]' &&
        (await now())?.state === "working", [st, b, got])
      ;[st] = await api("POST", "inbox/sessions", { agent: "sdk", session: "sdk-1", state: "done", prompt: "Yes, EU next", text: "" })
      await settled()
      check("POST inbox/sessions: a turn done with nothing for you after your reply: done", st === 202 && (await now())?.state === "done", [st, await now()])
      const bad = [await api("POST", "inbox/sessions", { agent: "sdk", state: "done" }), await api("POST", "inbox/sessions", { agent: "sdk", session: "x", state: "sleeping" }),
        await api("POST", "inbox/sessions", { agent: "sdk", session: "x", state: "waiting", ask: "coffee" })]
      check("POST inbox/sessions: its id, a state it knows and an ask it knows are needed", bad.every(([code]) => code === 400), bad)
      const forked = await host({ agent: "sdk", session: "sdk-1-fork", thread: e.id, state: "done", prompt: "Fork it", text: "Forked. Which branch should the fork track?" })
      check("inbox:session: a thread named by its host (a fork's new session id) is that thread, following the new session",
        forked?.id === e.id && forked.session === "sdk-1-fork" && forked.state === "open" && (await rows()).filter((x) => x.source === "sdk" && x.session?.startsWith("sdk-1")).length === 1, forked)
      const perm = await host({ agent: "sdk", session: "sdk-3", state: "waiting", ask: "permission", text: "Delete the old branch?" })
      await api("POST", "inbox/events/snooze", { ids: [perm.id], until: Date.now() + 3_600_000 })
      check("a permission asked isn't snoozed: it would wait unseen", !(await rows()).find((x) => x.id === perm.id)?.snoozed)
      await api("DELETE", `inbox/events/${perm.id}`)
      inbox.services["agent-chat-new:sdk"] = async (a: Any) => { got.push(["new", a.prompt.slice(0, 20)]); return { id: "sdk-new-1" } }
      ;[st, b] = await api("POST", "ops/inbox.reply", { to: e.id, text: "Track main", how: "new" })
      const moved = (await rows()).find((x) => x.id === e.id)
      check("a reply in a new session: its host starts a chat (agent-chat-new), the thread following it", st === 200 && b.how === "new" && got.at(-1)?.[0] === "new" &&
        moved?.session === "sdk-new-1" && moved.host === true && !moved.terminal && moved.state === "working", [st, b, moved])
      await api("POST", "ops/inbox.report", { title: "Hosted report", work: "fix", tldr: "Done it.", summary: "x", session: "sdk-rep", agent: "sdk" })
      ;[st, b] = await api("POST", "ops/inbox.reply", { to: "Inbox/.archive/Fix done · Hosted report.md", text: "Thanks, ship it" })
      const rt = (await rows()).find((x) => x.session === "sdk-rep")
      check("a reply to a hosted session's report: its host takes it, the report archived, its thread working", st === 200 && b.how === "host" &&
        /^\["sdk-rep","\(A reply to your report/.test(JSON.stringify(got.at(-1))) && exists("Inbox/.archive/Fix done · Hosted report.md") && rt?.state === "working", [st, b, rt])
      delete inbox.services["agent-reply:sdk"]; delete inbox.services["agent-answer:sdk"]; delete inbox.services["agent-chat-new:sdk"]
      await api("DELETE", `inbox/events/${e.id}`)
      if (rt) await api("DELETE", `inbox/events/${rt.id}`)
    }
    {
      // A notice done by its source (inbox:done: a paused plugin allowed again), and the done ones cleared.
      await api("POST", "inbox/events", { source: "plugins", kind: "waiting", key: "paused:beacon", title: "Beacon is paused" })
      ;(service(app.plugins, "inbox:done") as (s: string, k: string) => void)("plugins", "paused:beacon")
      let l = (await api("GET", "inbox/events"))[1]
      check("inbox:done: one of a kind is done", l.events.find((x: Any) => x.key === "paused:beacon")?.state === "done", l.events.slice(0, 2))
      const open = l.events.filter((x: Any) => x.state !== "done").length
      ;[st] = await api("DELETE", "inbox/events?done=1")
      l = (await api("GET", "inbox/events"))[1]
      check("inbox events: the done ones cleared, the rest kept", st === 200 && !l.events.some((x: Any) => x.state === "done") && l.events.length === open && open > 0, [open, l.events.length])
    }
    // vau inbox
    cr = await vau("inbox")
    check("vau inbox: what needs you, then what's to review", cr.code === 0 && /Needs you:[^]*To review:/.test(cr.out) && cr.out.includes("Inbox/Written by hand.md"), cr)
    {
      const [, l] = await api("GET", "inbox/events")
      const eid = l.events.find((e: Any) => e.state === "open" && e.kind === "session").id
      const one = async () => (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.id === eid)
      check("vau inbox: events with their ids", cr.out.includes(`(${eid})`), cr.out)
      cr = await vau("inbox", "unread", eid)
      check("vau inbox unread <id>", cr.code === 0 && (await one()).read === false && (await one()).kept === true, [cr, await one()])
      cr = await vau("inbox", "read", eid)
      check("vau inbox read <id>: read, still open (a thread is done only by done)", cr.code === 0 && (await one()).read === true && (await one()).state === "open", [cr, await one()])
      await vau("inbox", "done", eid)
      const brief = await vau("inbox"), listed = await vau("inbox", "--done")
      const [, opened] = await api("GET", "inbox/events?open=1&all=1")
      check("inbox events ?open=1: only what isn't done (the widgets', the watch's)", opened.events.length > 0 && !opened.events.some((x: Any) => x.state === "done") && !opened.events.some((x: Any) => x.id === eid), opened.events.length)
      check("vau inbox: settled ones counted, listed with --done", /\nSettled: 1 \(vau inbox --done/.test(brief.out) && new RegExp(`\\nSettled:\\n.*\\(${eid}\\)`).test(listed.out), [brief.out.slice(-200), listed.out.slice(-300)])
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
        { id: "p1", t: Date.now() - 1000, source: "claude", kind: "session", state: "open", title: "Claude Code finished", terminal: "claude-aa11bb22", session: "s-box" },
        { id: "p2", t: Date.now() - 5000, source: "vau", kind: "info", state: "done", title: "Backup finished", read: true },
        { id: "p9@else", t: Date.now() - 6000, source: "vau", kind: "info", state: "open", title: "Followed from a third machine" },
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
      const port = portOf(peer)
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
      theirs = [{ ...theirs[0], read: true }, { id: "p3", t: Date.now(), source: "claude", kind: "waiting", state: "open", title: "Claude Code is waiting for you" }, theirs[1]]
      for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
      await waitFor(async () => (await api("GET", "inbox/events"))[1].events[0]?.id === "p3@box", 3000, 50)
      ;[, l] = await api("GET", "inbox/events")
      check("inbox machines: its changes arrive live", l.events[0]?.id === "p3@box" && l.events[0].read !== true, l.events.slice(0, 2))
      {
        // A result it reported, done here: its thread there is done there (it's dealt with), and links the archived file.
        await api("POST", "inbox", { title: "Reported from the box", body: "x" })
        theirs = [{ id: "p5", t: Date.now() - 50, source: "claude", kind: "session", state: "open", ask: "report", title: "Reported", session: "s-rep", link: "Inbox/Reported from the box.md" }, ...theirs]
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await waitFor(async () => (await api("GET", "inbox/events"))[1].events.some((e: Any) => e.id === "p5@box"), 3000, 50)
        await api("PUT", "inbox/Inbox/Reported from the box", { status: "done" })
        await waitFor(() => seen.includes(`POST /api/inbox/events/done?local=1 {"ids":["p5"]}`), 3000, 50)
        ;[, l] = await api("GET", "inbox/events")
        const p5 = l.events.find((e: Any) => e.id === "p5@box")
        check("inbox machines: a report done here makes its thread there done, which links where it is now",
          seen.includes(`POST /api/inbox/events/done?local=1 {"ids":["p5"]}`) && p5?.state === "done" && p5.link === "Inbox/.archive/Reported from the box.md", [p5, seen.slice(-3)])
        seen.length = 0
        const [d5] = await api("POST", "inbox/events/done", { ids: ["p1@box"] })
        check("inbox machines: one done here is done there", d5 === 200 && seen.includes(`POST /api/inbox/events/done?local=1 {"ids":["p1"],"done":true}`) &&
          (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.id === "p1@box")?.state === "done", seen)
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
          matchSocket(app.plugins, ["inbox", "live"])![1].fn(ws as Any, request(), { wild: [], query: local ? { local: "1" } : {} })
          return ws
        }
        const there = watcher(true), here = watcher(false)
        await sleep(100)
        there.got.length = here.got.length = 0
        theirs = [...theirs, { id: "p4", t: Date.now() - 100, source: "vau", kind: "info", state: "open", title: "Another there" }]
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
        theirs = [{ id: "mvp6abcd-a1b2c3", t: Date.now(), source: "claude", kind: "session", state: "open", ask: "permission", title: "Beacon", body: "Run git push?", terminal: "claude-aa11bb22", session: "s-box" }, ...theirs]
        for (const s of socks) s.send(JSON.stringify({ t: "events", events: theirs }))
        await waitFor(async () => (await api("GET", "inbox/events"))[1].events.some((e: Any) => e.id === "mvp6abcd-a1b2c3@box"), 3000, 50)
        seen.length = 0
        const [a1] = await api("POST", "ops/inbox.answer", { id: "mvp6abcd-a1b2c3@box", answer: "approve" }, asApp)
        const [a2] = await api("POST", "ops/inbox.answer", { id: "mvp6abcd-a1b2c3", answer: "deny" }, asApp)
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

  // A gate (a permission the server waits on: an MCP app's tool, inbox:ask) is the user's to answer, never an agent's.
  {
    const ask = app.plugins.find((p) => p.id === "inbox")!.service("inbox:ask") as (b: Any) => Promise<string>
    const answerOf = app.plugins.find((p) => p.id === "inbox")!.service("inbox:answer") as (id: string, ms?: number) => Promise<string>
    // (each from this machine, as its owner: what tells them apart is who they say they are)
    const from = (client: string, agent: string | null = null) => request({ host: "127.0.0.1:8793", "x-vaultite-client": client, ...(agent ? { "x-vaultite-agent": agent } : {}) }, { remote: "127.0.0.1" })
    const gate = await ask({ source: "mcp", key: "gate-agents", title: "Grok Bot asks to run file.delete", body: "file.delete {}" })
    const tries = [
      await api("POST", "ops/inbox.answer", { id: gate, answer: "approve" }, from("mcp")),
      await api("POST", "ops/inbox.answer", { id: gate, answer: "approve" }, from("cli", "claude-code")),
      await api("POST", "ops/inbox.answer", { id: gate, answer: "deny" }, from("cli", "codex")),
      await api("POST", `inbox/events/${gate}/answer`, { answer: "approve" }, from("mcp")),
      await api("POST", `inbox/events/${gate}/answer`, { answer: "approve" }, from("app/desktop", "claude-code")),
      await api("POST", `inbox/events/${gate}/answer`, { answer: "approve" }, from("a-script")),
      // (vau naming no agent too: the server can't tell a person's shell from an agent's that unset its variables)
      await api("POST", "ops/inbox.answer", { id: gate, answer: "approve" }, from("cli")),
    ]
    check("inbox gates: an agent (MCP, vau with or without an agent, a script) can't answer one, by the op or the route", tries.every(([st, b]) => st === 403 && /only you/.test(String(b.error)))
      && await answerOf(gate) === "waiting", tries)
    const [relayed] = await api("POST", "ops/inbox.answer", { id: gate, answer: "approve" }, from("machine/studio"))
    check("inbox gates: another machine passing on the user's answer answers it", relayed === 200 && await answerOf(gate) === "approve", relayed)
    const gate2 = await ask({ source: "mcp", key: "gate-phone", title: "Grok Bot asks to run file.move", body: "file.move {}" })
    const [phone] = await api("POST", "ops/inbox.answer", { id: gate2, answer: "deny" }, from("iphone"))
    check("inbox gates: the phone's notification answers it", phone === 200 && await answerOf(gate2) === "deny", phone)
    const gate3 = await ask({ source: "mcp", key: "gate-app", title: "Grok Bot asks to run file.copy", body: "file.copy {}" })
    const [inApp] = await api("POST", `inbox/events/${gate3}/answer`, { answer: "approve" }, from("app/desktop"))
    check("inbox gates: the app's buttons answer it", inApp === 200 && await answerOf(gate3) === "approve", inApp)
    // (asked in a session's request, it says which session: Go to session opens it)
    const { requestWriter } = await import("../../../core/vault.ts")
    const gate4 = await requestWriter.run({ client: "cli", agent: "claude-code", terminal: "claude-asker123", session: "sess-asker" },
      () => ask({ source: "share", key: "gate-from", title: "Claude Code asks to share Lighthouse", body: "share.create {}" }))
    const asker = (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.id === gate4)?.from
    check("inbox gates: one asked in a session's request names that session, its terminal and its agent",
      asker?.terminal === "claude-asker123" && asker?.session === "sess-asker" && asker?.agent === "claude" && !!asker?.title, asker)
    const loose = (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.id === gate)
    check("inbox gates: one asked outside a session's request names none", !!loose && !loose.from, loose)

    // An agent asking permission in a terminal: the same, by the op or the terminal's own route.
    const [, asked] = await api("POST", "inbox/events", { source: "claude", kind: "waiting", ask: "permission", title: "Beacon", body: "Run git push?", terminal: "claude-perm1234" })
    const perm = asked?.id ?? (await api("GET", "inbox/events"))[1].events.find((e: Any) => e.terminal === "claude-perm1234")?.id
    const refused = [
      await api("POST", "ops/inbox.answer", { id: perm, answer: "approve" }, from("mcp")),
      await api("POST", "ops/inbox.answer", { id: perm, answer: "approve" }, from("cli", "claude-code")),
      await api("POST", "ops/inbox.answer", { id: perm, answer: "deny" }, from("cli")),
      await api("POST", "terminals/claude-perm1234/answer", { answer: "approve" }, from("cli", "codex")),
      await api("POST", "terminals/claude-perm1234/answer", { answer: "approve" }, from("cli")),
      await api("POST", "terminals/claude-perm1234/answer", { answer: "approve" }, from("a-script")),
    ]
    check("inbox permissions: an agent, vau or a script can't approve or deny a terminal's question, by the op or the terminal's route", !!perm && refused.every(([st, b]) => st === 403 && /only you/.test(String(b.error))), refused)
    // (the user's surfaces get past that: here its terminal isn't running, so it's that which stops them)
    const allowed = [
      await api("POST", "ops/inbox.answer", { id: perm, answer: "approve" }, from("app/desktop")),
      await api("POST", "ops/inbox.answer", { id: perm, answer: "deny" }, from("iphone")),
      await api("POST", "terminals/claude-perm1234/answer", { answer: "approve" }, from("app/desktop")),
    ]
    check("inbox permissions: the app and the phone answer it", allowed.every(([st]) => st !== 403), allowed)
    const [readIt] = await api("POST", "ops/inbox.answer", { id: perm, answer: "read" }, from("cli", "claude-code"))
    check("inbox permissions: marking one read is anyone's", readIt === 200, readIt)
  }

  // Snooze: out of the inbox until a time, then back on top, unread, told again.
  {
    const { choices, parseUntil } = await import("../../../plugins/core/inbox/snooze.ts")
    const { wake } = await import("../../../plugins/core/inbox/plugin.ts")
    const tue = new Date(2026, 9, 20, 10, 0) // a Tuesday morning
    const keys = choices(tue).map((c) => c.key)
    const fri = new Date(2026, 9, 23, 19, 0)
    check("snooze: Gmail's choices, this evening only while it's to come, this weekend only before Friday",
      keys.join() === "1h,3h,evening,tomorrow,weekend,week" && choices(fri).map((c) => c.key).join() === "1h,3h,tomorrow,week" &&
      choices(tue).find((c) => c.key === "week")!.at.getTime() === new Date(2026, 9, 26, 8).getTime(), keys)
    check("snooze: until as an agent writes it", parseUntil("tomorrow", tue)?.getTime() === new Date(2026, 9, 21, 8).getTime() &&
      parseUntil("2h", tue)?.getTime() === tue.getTime() + 7_200_000 && parseUntil("2026-10-24 9:30", tue)?.getTime() === new Date(2026, 9, 24, 9, 30).getTime() &&
      parseUntil("next week", tue)?.getDay() === 1 && parseUntil("soonish", tue) === null)

    await api("POST", "inbox", { title: "Snooze me", body: "Later." })
    cr = await vau("inbox", "snooze", "Inbox/Snooze me.md", "--until", "3h")
    let list = await vau("inbox")
    check("vau inbox snooze: the result keeps its time, out of what's to review, listed as snoozed",
      cr.code === 0 && /^snoozed: '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'$/m.test(read("Inbox/Snooze me.md")) && !/To review:[^]*Snooze me[^]*Snoozed:/.test(list.out) && /Snoozed:\n.*Inbox\/Snooze me\.md/.test(list.out), [cr, list.out])
    cr = await vau("inbox", "snooze", "Inbox/Snooze me.md", "--until", "yesterday-ish")
    check("vau inbox snooze: a time it can't read is refused", cr.code !== 0, cr)
    const stampNow = (ms = 0) => { const d = new Date(Date.now() + ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace("T", " ") }
    await $.nextSecond() // (its time a second later than anything before: on top however fast the run, not tied)
    await api("PUT", "inbox/Snooze me", { snoozed: stampNow() })
    let [, items] = await api("GET", "inbox")
    const firstOpen = () => items.find((r: Any) => r.status === "new")?.id
    list = await vau("inbox")
    check("snooze: its time come, it's back on top, with nothing written", firstOpen() === "Inbox/Snooze me" && /To review:\n  Inbox\/Snooze me\.md/.test(list.out) && /^snoozed: '/m.test(read("Inbox/Snooze me.md")), [items.map((r: Any) => r.id), list.out])
    await wake()
    await vau("inbox", "snooze", "Inbox/Snooze me.md", "--until", "tomorrow")
    cr = await vau("inbox", "snooze", "Inbox/Snooze me.md", "--until", "now")
    ;[, items] = await api("GET", "inbox")
    check("vau inbox snooze --until now: back at once, on top", cr.code === 0 && firstOpen() === "Inbox/Snooze me" && /Back in the inbox/.test(cr.out), [cr, read("Inbox/Snooze me.md")])
    await vau("inbox", "snooze", "Inbox/Snooze me.md", "--until", "tomorrow")
    cr = await vau("inbox", "wake", "Inbox/Snooze me.md")
    ;[, items] = await api("GET", "inbox")
    check("vau inbox wake: back at once, on top", cr.code === 0 && firstOpen() === "Inbox/Snooze me" && /Woken/.test(cr.out), [cr, read("Inbox/Snooze me.md")])
    let [, b] = await api("PUT", "inbox/Snooze me", { snoozed: "2099-01-01 08:00:00" })
    ;[, b] = await api("PUT", "inbox/Snooze me", { status: "done" })
    check("snooze: done isn't snoozed any more", b.status === "done" && !b.snoozed, b)

    const [, ev] = await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Look at this later" })
    let [st] = await api("POST", "inbox/events/snooze", { ids: [ev.event.id], until: Date.now() - 1 })
    check("inbox events snooze: a time to come", st === 400, st)
    // (its time is what was asked, not later than the read: a slow runner's read may come after it)
    const until = Date.now() + 200
    ;[st] = await api("POST", "inbox/events/snooze", { ids: [ev.event.id], until })
    let [, l] = await api("GET", "inbox/events")
    let e = l.events.find((x: Any) => x.id === ev.event.id)
    check("inbox events snooze: still open, out of the lists meanwhile, with its time", st === 200 && e.state === "open" && e.snoozed === until, e)
    await sleep(Math.max(0, until - Date.now()) + 50)
    await wake()
    ;[, l] = await api("GET", "inbox/events")
    e = l.events.find((x: Any) => x.id === ev.event.id)
    check("inbox events snooze: its time come, unread on top and told again", l.events[0].id === ev.event.id && e.read === false && !e.snoozed && e.nt === e.t, e)
    await api("POST", "inbox/events/snooze", { ids: [ev.event.id], until: Date.now() + 3_600_000 })
    await api("POST", "inbox/events/unread", { ids: [ev.event.id] })
    ;[, l] = await api("GET", "inbox/events")
    e = l.events.find((x: Any) => x.id === ev.event.id)
    check("inbox events snooze: marked unread, it's back", e.read === false && !e.snoozed, e)

    await api("POST", "inbox", { title: "Pin me", body: "Keep it on top." })
    cr = await vau("inbox", "pin", "Inbox/Pin me.md")
    list = await vau("inbox")
    check("vau inbox pin: the result is pinned in its file, listed under Pinned, not To review",
      cr.code === 0 && /^pinned: true$/m.test(read("Inbox/Pin me.md")) && /Pinned:\n  Inbox\/Pin me\.md/.test(list.out) && !/To review:[^]*Pin me/.test(list.out), [cr, list.out])
    cr = await vau("inbox", "pin", "Inbox/Pin me.md", "--off")
    check("vau inbox pin --off: unpinned, to review again", cr.code === 0 && !/^pinned: true/m.test(read("Inbox/Pin me.md")) && /Unpinned/.test(cr.out), [cr, read("Inbox/Pin me.md")])
    await vau("inbox", "pin", "Inbox/Pin me.md")
    ;[, b] = await api("PUT", "inbox/Pin me", { status: "done" })
    check("pin: done unpins it", b.status === "done" && !b.pinned && !/^pinned: true/m.test(read("Inbox/.archive/Pin me.md")), b)
    const [, pe] = await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Pin this event" })
    ;[st] = await api("POST", "inbox/events/pin", { ids: [pe.event.id] })
    ;[, l] = await api("GET", "inbox/events")
    e = l.events.find((x: Any) => x.id === pe.event.id)
    check("inbox events pin: pinned, still open", st === 200 && e.pinned === true && e.state === "open", e)
    await api("POST", "inbox/events/read", { ids: [pe.event.id] })
    ;[, l] = await api("GET", "inbox/events")
    e = l.events.find((x: Any) => x.id === pe.event.id)
    check("inbox events pin: a pinned message read stays, till it's done", e.read === true && e.state === "open" && e.pinned === true, e)
    await api("POST", "inbox/events/pin", { ids: [pe.event.id], pinned: false })
    ;[, l] = await api("GET", "inbox/events")
    e = l.events.find((x: Any) => x.id === pe.event.id)
    check("inbox events pin: a read message unpinned is settled, as a read one is", e.state === "done" && !e.pinned, e)
    await api("POST", "inbox/events/done", { ids: [pe.event.id], done: false })
    await api("POST", "inbox/events/pin", { ids: [pe.event.id] })
    cr = await vau("inbox")
    check("vau inbox: a pinned event is listed under Pinned", new RegExp(`Pinned:\\n[^]*\\(${pe.event.id}\\)`).test(cr.out) && !new RegExp(`Messages:[^]*${pe.event.id}`).test(cr.out), cr.out)
    await api("POST", "inbox/events/done", { ids: [pe.event.id] })
    ;[, l] = await api("GET", "inbox/events")
    e = l.events.find((x: Any) => x.id === pe.event.id)
    cr = await vau("inbox", "pin", pe.event.id)
    check("inbox events: done unpins it, and what's done can't be pinned", e.state === "done" && !e.pinned && cr.code !== 0, [e, cr])

    {
      // With no phone or watch paired, vau says nothing went, and settle is Settled whichever name it's asked by.
      const textOf = (id: string) => app.ops().find((o: Any) => o.op.id === id)!.op.text as (r: Any) => string
      check("vau inbox push: no phone signed up, nothing sent (not \"Sent to 0 devices\")", /^Nothing sent: no phone/.test(textOf("inbox.push")({ sent: 0, failed: [] })) &&
        textOf("inbox.push")({ sent: 1, failed: [] }) === "Sent to 1 device.")
      check("vau inbox answer: settle and done read Settled", textOf("inbox.answer")({ answer: "settle", title: "A" }) === "Settled: A." && textOf("inbox.answer")({ answer: "done", title: "A" }) === "Settled: A.")
      const waits = { path: "Inbox/Ship it.md", question: "Ship it?", options: ["Ship", "Wait"], effects: ["today", ""], default: "Wait", blocking: true, from: "Claude", where: "Sidebar",
        gist: "Done on desktop", why: "The phone is untested", snoozed: "2026-10-24 09:00" }
      const went = { path: "Inbox/Keep.md", question: "Keep it?", options: ["Keep", "Drop"], effects: [], default: "Keep", blocking: false, from: null, where: null, gist: null, why: null }
      const texts: [string, Any, string][] = [
        ["inbox.decisions", { decisions: [waits, went], recent: [{ question: "Old?", answer: "Yes", path: "Inbox/Old.md" }, { question: "Moot?", closed: "Gone", path: "Inbox/Moot.md" }] },
          "Waiting on the user (2):\n1. [waits on you] Ship it?\n   Ship: today · Wait (default)\n   The phone is untested\n   Its report: Done on desktop\n   Inbox/Ship it.md · from Claude (Sidebar) · snoozed until 2026-10-24 09:00\n" +
          "2. [went with Keep] Keep it?\n   Keep (default) · Drop\n   Inbox/Keep.md\n\nDealt with in the last day:\n  Old?: answered Yes  (Inbox/Old.md)\n  Moot?: closed (Gone)  (Inbox/Moot.md)"],
        ["inbox.decisions", { decisions: [] }, "No decision waits on the user."],
        ["inbox.ask", { merged: true, path: "Inbox/Ship it.md", session: true }, "The same question was open already: Inbox/Ship it.md (it says you asked it too). Their answer comes back to this session."],
        ["inbox.ask", { merged: false, path: "Inbox/Ship it.md", blocking: true, session: false, warn: "No why" }, "Asked: Inbox/Ship it.md (it comes first, with a push to the phone).\nWarning: No why"],
        ["inbox.decide", { decided: [], sent: [], failed: [] }, "No decision was open."],
        ["inbox.decide", { decided: [{ path: "a.md", question: "A?", reopened: true }], sent: [], failed: [] }, "Done:\n  Open again: A?"],
        ["inbox.decide", { decided: [{ question: "A?", closed: "moot" }, { question: "B?", answer: "Go", told: false }, { question: "C?", answer: "Stay", told: true }], sent: ["x.md", "y.md"], failed: ["z.md: gone"] },
          "3 done:\n  Closed: A?\n  Answered \"Go\": B? (kept the default: nothing to tell)\n  Answered \"Stay\": C?\nSent to 2 sessions.\nCouldn't send: z.md: gone"],
        ["inbox.settle", { path: "Inbox/A.md", done: true }, "Settled: Inbox/A.md."],
        ["inbox.done", { id: "e1", title: "T", done: false }, "Back in the inbox: T."],
        ["inbox.wake", { item: "Inbox/A.md", woke: true }, "Woken, back on top: Inbox/A.md."],
        ["inbox.wake", { item: "Inbox/A.md", woke: false }, "Not snoozed: Inbox/A.md."],
        ["inbox.snooze", { item: "Inbox/A.md", until: "2026-10-24 09:00", when: "Saturday 9:00" }, "Snoozed until Saturday 9:00 (2026-10-24 09:00): Inbox/A.md."],
        ["inbox.snooze", { item: "Inbox/A.md", until: null, when: null }, "Back in the inbox: Inbox/A.md."],
        ["inbox.pin", { item: "e1", title: "T", pinned: true }, "Pinned: T."],
        ["inbox.pin", { item: "Inbox/A.md", pinned: false }, "Unpinned: Inbox/A.md."],
        ["inbox.hold", { hold: null }, "Not held."],
        ["inbox.read", { all: true }, "Every event is read."],
        ["inbox.read", { all: false, unread: 3 }, "Read. 3 unread."],
        ["inbox.unread", { unread: 2 }, "Unread. 2 unread."],
        ["inbox.clear", { done: true }, "Forgot the settled events."],
        ["inbox.clear", { done: false }, "Forgot every event."],
        ["inbox.answer", { answer: "read", title: "A" }, "Read: A."],
        ["inbox.answer", { answer: "reply", title: "A", terminal: "claude-a1" }, "Sent to claude-a1."],
        ["inbox.answer", { answer: "pick", title: "A", terminal: null }, "Sent."],
        ["inbox.answer", { answer: "approve", title: "A", terminal: "claude-a1" }, "Approved in claude-a1."],
        ["inbox.answer", { answer: "deny", title: "A", terminal: null }, "Denied: A."],
      ]
      const wrong = texts.flatMap(([id, r, want]) => { const got = textOf(id)(r); return got === want ? [] : [[id, got, want]] })
      check("vau inbox: what its asking and settling ops print, for each kind of answer", !wrong.length, wrong)
      const didOf = (id: string, p: Any) => app.ops().find((o: Any) => o.op.id === id)!.op.did?.(p)?.text
      const dids: [string, Any, string][] = [
        ["inbox.ask", { question: "Ship it?" }, "Asked \"Ship it?\""], ["inbox.decide", { defaults: true }, "Accepted every default"], ["inbox.decide", { item: "Inbox/A.md" }, "Decided \"Inbox/A.md\""],
        ["inbox.settle", { item: "Inbox/A.md", undo: true }, "Brought back \"Inbox/A.md\" in the inbox"], ["inbox.wake", { item: "e1" }, "Woke \"e1\" in the inbox"],
        ["inbox.snooze", { item: "e1" }, "Snoozed \"e1\" in the inbox"], ["inbox.pin", { item: "e1", off: true }, "Unpinned \"e1\" in the inbox"],
        ["inbox.hold", { until: "30m" }, "Held the inbox: 30m"], ["inbox.hold", {}, "Read the inbox's hold"], ["inbox.read", { ids: ["a"] }, "Marked 1 inbox event read"],
        ["inbox.read", {}, "Marked the inbox read"], ["inbox.unread", { ids: ["a", "b"] }, "Marked 2 inbox events unread"], ["inbox.clear", { done: true }, "Cleared the inbox's settled events"],
      ]
      const wrongDid = dids.flatMap(([id, p, want]) => { const got = didOf(id, p); return got === want ? [] : [[id, got, want]] })
      check("vau inbox: what its asking and settling ops tell Activity they did", !wrongDid.length, wrongDid)
    }

    const nine = new Date(2026, 9, 20, 9, 0)
    check("snooze: a time alone is its next one", parseUntil("07:30", nine)?.getTime() === new Date(2026, 9, 21, 7, 30).getTime() &&
      parseUntil("9:45", nine)?.getTime() === new Date(2026, 9, 20, 9, 45).getTime() && parseUntil("25:00", nine) === null)
    cr = await vau("inbox", "hold", "30m", "--label", "Practice guitar")
    const { keptOf } = await import("../../../core/kept.ts")
    check("vau inbox hold: held till then, kept by the server for every machine", cr.code === 0 && /Held until .*\(Practice guitar\)/.test(cr.out) &&
      keptOf(VAULT).get<Any>("inbox/hold")?.label === "Practice guitar" && keptOf(VAULT).isShared("inbox/hold") && !exists(".vaultite/plugins/inbox/hold.json"), [cr, keptOf(VAULT).get("inbox/hold")])
    const [, held] = await api("POST", "inbox/events", { source: "vau", kind: "info", title: "Told while held" })
    ;[, l] = await api("GET", "inbox/events")
    check("inbox hold: what comes is kept unread, not told", held.event.read !== true && !held.event.nt && l.hold?.label === "Practice guitar", [held, l.hold])
    cr = await vau("inbox", "hold", "off")
    await wake()
    ;[, l] = await api("GET", "inbox/events")
    const sum = l.events.find((x: Any) => x.source === "inbox" && /^During Practice guitar: \d+ new/.test(x.title))
    check("inbox hold off: one line of what came, told", cr.code === 0 && !l.hold && sum && sum.nt === sum.t, [cr, l.hold, l.events.slice(0, 3)])
    cr = await vau("inbox", "hold", "yesterday-ish")
    check("vau inbox hold: a time it can't read is refused", cr.code !== 0, cr)
  }
}
