import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check } = $
  const K = await import("../../../plugins/core/companion/knocks.ts")
  const I = await import("../../../electron/islandlogic.ts")
  const H = await import("../../../electron/helperlogic.ts")
  const A = await import("../../../core/agenttint.ts")
  const O = await import("../../../electron/overlayhold.ts")

  // An overlay window (the island, the companion's) takes the pointer only over what its page marks, or through a press
  // begun on one; never over its see-through rest, nor off the window.
  {
    const win = { x: 400, y: 0, width: 700, height: 600 }, bar = { x: 300, y: 0, width: 120, height: 32 }
    check("overlay: takes the pointer over a box it was told", O.holding(win, [bar], { x: 760, y: 10 }))
    check("overlay: lets it through over its see-through rest, with or without boxes",
      !O.holding(win, [bar], { x: 700, y: 400 }) && !O.holding(win, [], { x: 760, y: 10 }))
    check("overlay: a press begun on one keeps it over the window, never off it",
      O.holding(win, [], { x: 700, y: 400 }, true) && !O.holding(win, [bar], { x: 1200, y: 10 }, true) && !O.holding(win, [bar], { x: 760, y: 700 }, true))
  }

  // The queue: one at a time, at a pause, the most urgent first; "not now" till the next break; ignored, expired, gone.
  {
    const T = 1_000_000
    const mk = (id: string, urgency: string, at = T, from = "") => K.makeKnock({ id, from, who: "Lighthouse", line: `line ${id}`, urgency, life: 600_000 }, at)
    const pause = (o: Partial<{ now: number; talking: boolean; still: number }> = {}) => ({ now: T + 1000, talking: false, still: 5000, ...o })
    const ks = [mk("a", "low", T - 10), mk("b", "normal", T - 5), mk("c", "high", T)]
    check("knocks: at a pause the most urgent comes first, then by age", K.pick(ks, pause())?.id === "c" && K.pick(ks.slice(0, 2), pause())?.id === "b")
    check("knocks: nothing comes while anyone talks, nor while they're away from this Mac",
      K.pick(ks, pause({ talking: true })) === null && K.pick(ks, pause({ still: K.AWAY_MS + 1 })) === null)
    check("knocks: an urgent one at any pause; a normal one once they're still a moment; a low one at a longer pause",
      K.pick(ks, pause({ still: 0 }))?.id === "c" && K.pick(ks.slice(0, 2), pause({ still: 500 })) === null &&
      K.pick(ks.slice(0, 2), pause({ still: 2000 }))?.id === "b" && K.pick(ks.slice(0, 1), pause({ still: 3000 })) === null && K.pick(ks.slice(0, 1), pause({ still: 7000 }))?.id === "a")
    const shown = K.actOn(ks[2], "show", T + 1000)
    check("knocks: one shows at a time: the one showing stays while others wait, talk or not",
      K.pick([ks[0], ks[1], shown], pause({ talking: true }))?.id === "c" && shown.state === "showing")
    check("knocks: its grace is about 3 s; it's told once it ran out with no not now",
      !K.graceOver(shown, T + 1000 + 2900) && K.graceOver(shown, T + 1000 + K.GRACE_MS) && K.actOn(shown, "told", T + 5000).state === "told")
    // A job's ready knock: its card held 15 s, at a real pause only, its time waiting while nobody is at the Mac.
    const ready = K.makeKnock({ id: "r", from: "", who: "Fix footer", line: "Ready to show you the footer", urgency: "high", life: 600_000, hold: K.READY_HOLD_MS }, T)
    check("knocks: a ready knock comes at a real pause, never mid-typing, even urgent", K.pick([ready], pause({ still: 0 })) === null &&
      K.pick([ready], pause({ still: 1000 })) === null && K.pick([ready], pause({ still: K.STILL_MS.normal }))?.id === "r")
    const up = K.actOn(ready, "show", T + 1000)
    check("knocks: its card stays up 15 s, not 3, then it's told (folds into the island)", K.holdOf(up) === 15_000 && K.holdOf(shown) === K.GRACE_MS &&
      !K.graceOver(up, T + 1000 + K.GRACE_MS) && !K.graceOver(up, T + 1000 + 14_900) && K.graceOver(up, T + 1000 + K.READY_HOLD_MS))
    check("knocks: one card at a time: an urgent one waits its turn behind a ready card", K.pick([up, ks[2]], pause())?.id === "r")
    const at = { talking: false, still: 2000 }
    check("knocks: a held card's time waits while nobody is at the Mac (locked, or still a while), and while anyone talks",
      !K.graceWaits(up, at) && K.graceWaits(up, { ...at, locked: true }) && K.graceWaits(up, { ...at, still: K.HERE_MS }) && K.graceWaits(up, { ...at, talking: true }) &&
      !K.graceWaits(shown, { ...at, still: K.HERE_MS }) && K.graceWaits(shown, { ...at, talking: true }) && !K.graceWaits(ready, { ...at, locked: true }))
    const off = K.actOn(up, "later", T + 3000)
    check("knocks: dismissed (not now), a ready card goes at once", off.state === "later" && K.pick([off], pause({ now: T + 4000 })) === null)
    let long = ""
    try { K.makeKnock({ id: "q", from: "", who: "", line: "x", hold: 10 * 60_000 }, T) } catch (e) { long = (e as Error).message }
    check("knocks: a hold is at most 2 minutes", /hold/.test(long))
    const later = K.actOn(shown, "later", T + 2000)
    check("knocks: not now puts it off: not at once, nor later while they've sat still since, but at their next break",
      K.pick([later], { now: T + 2000 + 5000, talking: false, still: 2000 }) === null &&
      K.pick([later], { now: T + 2000 + K.LATER_MS + 1000, talking: false, still: K.LATER_MS + 3000 }) === null &&
      K.pick([later], { now: T + 2000 + K.LATER_MS + 1000, talking: false, still: 2000 })?.id === "c")
    const ignored = K.actOn(ks[1], "ignore", T)
    check("knocks: an ignored one never comes, and stays ignored", K.pick([ignored], pause()) === null && K.actOn(ignored, "show", T).state === "ignored" && K.over(ignored))
    const old = K.expire(ks, T + 600_001)
    check("knocks: past its life it expires and never comes", old.every((k) => k.state === "expired") && K.pick(old, pause({ now: T + 600_001 })) === null)
    const two = K.addKnock([mk("x", "normal", T, "claude-1")], mk("y", "normal", T + 1, "claude-1"), () => false)
    check("knocks: a session's new knock replaces its last", two.find((k) => k.id === "x")?.state === "expired" && two.find((k) => k.id === "y")?.state === "waiting")
    const muted = K.addKnock([], mk("z", "high", T, "claude-2"), (f) => f === "claude-2")
    check("knocks: a muted session's knocks come ignored", muted[0].state === "ignored")
    let bad = ""
    try { K.makeKnock({ id: "q", from: "", who: "", line: "  ", urgency: "normal" }, T) } catch (e) { bad = (e as Error).message }
    let worse = ""
    try { K.makeKnock({ id: "q", from: "", who: "", line: "x", urgency: "loud" }, T) } catch (e) { worse = (e as Error).message }
    check("knocks: a knock needs its line and a known urgency; its life by urgency; a long line is cut", /line/.test(bad) && /urgency/.test(worse) &&
      K.makeKnock({ id: "q", from: "", who: "", line: "x", urgency: "high" }, T).until === T + K.LIVES.high &&
      K.makeKnock({ id: "q", from: "", who: "", line: "x".repeat(400) }, T).line.length === 140)
    const R = K.knockReply
    check("knocks: a short spoken answer to one is read as such", R("Not now.") === "later" && R("no, not now thanks") === "later" && R("later") === "later" &&
      R("Ignore that one") === "ignore" && R("skip it") === "ignore" && R("mute that session") === "mute" && R("ignore this session") === "mute" &&
      R("Show me") === "open" && R("okay, open it") === "open", [R("Not now."), R("no, not now thanks"), R("Ignore that one"), R("mute that session"), R("okay, open it")])
    check("knocks: anything else is an ask for the companion", R("not now, but remind me tomorrow to call Alice about the deploy") === null && R("what does this say") === null &&
      R("show me the logs for the lighthouse build") === null && R("") === null)
    check("knocks: durations as people write them", K.duration("90s") === 90_000 && K.duration("30m") === 1_800_000 && K.duration("2h") === 7_200_000 && K.duration("15") === 900_000 && Number.isNaN(K.duration("soon")))
  }

  // Presences: each agent's terminal at work, needing the user or just done; a knock makes its session need them.
  {
    const T = 2_000_000, seen = new Map<string, Any>()
    const rows = [{ id: "claude-1", agent: "claude", state: "working", name: "Lighthouse" }, { id: "claude-2", agent: "claude", state: "blocked" },
      { id: "codex-3", agent: "codex", state: "done", title: "Fix the tests" }, { id: "zsh-4", agent: null, state: "working" }, { id: "claude-5", agent: "claude", state: "idle" }]
    const k = { ...K.makeKnock({ id: "k1", from: "claude-1", who: "Lighthouse", line: "Ready to look" }, T), state: "told" as const, shown: T }
    const ps = K.presencesOf(rows, [k], seen, T)
    check("presences: agents at work, needing the user or done show (no shell, no idle agent), those needing them first",
      ps.map((p) => `${p.id}:${p.state}`).join() === "claude-1:needs you,claude-2:needs you,codex-3:done" && ps[0].line === "Ready to look" && ps[0].knock === "k1", ps)
    check("presences: each has its agent's own tint, the same on every machine, never the attention orange",
      ps.every((p) => p.tint === A.agentTint(p.id)) && A.agentTint("claude-1") === A.agentTint("claude-1@m4") && (A.AGENT_TINTS as readonly string[]).every((t) => t !== "orange" && t !== "red"))
    const jobs = K.presencesOf([{ id: "claude-6", agent: "claude", state: "done", name: "Tab list fix" }, { id: "claude-7", agent: "claude", state: "working", msg: "Running  npm test" },
      { id: "claude-8", agent: "claude", state: "working" }], [], new Map(), T, { ready: new Set(["claude-6"]) })
    check("presences: a job ready for review is ready (calm), not needs you; a working one says what it does now",
      jobs.map((p) => `${p.id}:${p.state}`).join() === "claude-6:ready,claude-7:working,claude-8:working" && jobs[1].step === "Running npm test" && !jobs[2].step, jobs)
    const held = { ...K.makeKnock({ id: "k3", from: "claude-8", who: "Fix", line: "Ready to show you", hold: K.READY_HOLD_MS }, T), state: "told" as const, shown: T }
    const blocked = { ...K.makeKnock({ id: "k4", from: "claude-2", who: "Ask", line: "Ready?", hold: K.READY_HOLD_MS }, T), state: "told" as const, shown: T }
    const both = K.presencesOf(rows.concat({ id: "claude-8", agent: "claude", state: "working" }), [held, blocked], new Map(), T)
    check("presences: a ready knock (held) is calm; one on a session blocked on them still needs them",
      both.find((p) => p.id === "claude-8")?.state === "ready" && both.find((p) => p.id === "claude-2")?.state === "needs you", both)
    check("presences: in the Agents panel's order and words", K.PRESENCE_GROUPS.map((g) => g.label).join() === "Needs you,Ready for review,Working,Done" &&
      both.map((p) => p.state).join() === "needs you,ready,working,done", both.map((p) => p.state))
    const news = K.presencesOf([{ id: "claude-9", agent: "claude", state: "done", needs: true }, { id: "claude-10", agent: "claude", state: "idle", needs: true }], [], new Map(), T)
    check("presences: an unread answer is something to look at (ready, calm), never needs you", news.map((p) => `${p.id}:${p.state}`).join() === "claude-9:ready,claude-10:ready", news)
    const later = K.presencesOf(rows, [], seen, T + K.DONE_MS + 1)
    check("presences: a done one goes after a while; a knock gone, its session is as its terminal says",
      !later.some((p) => p.id === "codex-3") && later.find((p) => p.id === "claude-1")?.state === "working", later)
    const alone = K.presencesOf([], [{ ...K.makeKnock({ id: "k2", from: "", who: "Backup", line: "Finished" }, T), state: "showing" as const }], new Map(), T)
    check("presences: a knock from no terminal is a presence of its own", alone.length === 1 && alone[0].who === "Backup" && alone[0].state === "needs you" && !alone[0].terminal)

    // The menu bar's menu says the island's counts: who waits on them (a few), then how many work and are ready.
    const P = (id: string, state: string, x: Any = {}) => ({ id, who: id, tint: "teal", state, since: T - 120_000, ...x })
    const m = H.menuNow({ now: T, jobs: [], decisions: [{ question: "Run it on prod?", from: "Lighthouse", created: null }],
      presences: [P("inbox", "needs you", { open: "view:inbox", line: "A decision waiting" }), P("a", "needs you", { line: "Which branch?" }), P("b", "needs you"), P("c", "needs you"),
        P("d", "ready"), P("e", "working"), P("f", "working"), P("g", "done")] as Any })
    check("menu: decisions first, the inbox's own knock not twice, three rows, all counted",
      m.needs.map((r: Any) => r.label).join("|") === "Run it on prod?|Which branch?|Waiting on you" && m.needCount === 4 && m.needs[1].sub === "a · 2m", m)
    check("menu: one row of how many work and are ready", m.count === "2 agents working · 1 ready" &&
      H.menuNow({ now: T, jobs: [], decisions: [], presences: [P("d", "ready")] as Any }).count === "1 ready for review", m.count)
    const off = H.menuNow({ now: T, decisions: [], presences: [], jobs: [{ id: "j1", title: "Deploy", state: "needs you", link: null, unseen: false, at: T, waits: { question: "Which account?", choices: [] } },
      { id: "j2", title: "Docs", state: "working", link: null, unseen: false, at: T }] })
    check("menu: with the island off, the jobs say it", off.needs[0]?.label === "Which account?" && off.needs[0].job === "j1" && off.count === "1 agent working", off)
    const px = H.cursorBitmap([255, 0, 0], 32)
    check("menu: an agent's cursor drawn in its colour, clear around it", px.length === 32 * 32 * 4 && px[(10 * 32 + 9) * 4 + 2] === 255 && px[(10 * 32 + 9) * 4 + 3] === 255 && px[(30 * 32 + 30) * 4 + 3] === 0)
    // (a full square stands in for the stone: the dot at its top right, a clear ring around it, the rest untouched)
    const dotted = H.dottedBitmap(Buffer.alloc(36 * 36 * 4, 255), 36), a = (x: number, y: number) => dotted[(y * 36 + x) * 4 + 3]
    check("menu bar badge: a dot cut out of the icon's top right, no number", a(29, 6) === 255 && a(29, 12) < 60 && a(23, 6) < 60 && a(18, 18) === 255 && a(2, 2) === 255,
      [a(29, 6), a(29, 12), a(23, 6), a(18, 18), a(2, 2)])
  }

  // The island's place: joined to the notch; right of another app's island there (Vorssaint's, as read on a 15-inch
  // MacBook Air: the notch 646-825, its window over it), aside while that one's open; top centre with no notch.
  {
    const d = { bounds: { x: 0, y: 0, width: 1470, height: 956 }, workArea: { x: 0, y: 33, width: 1470, height: 923 } }
    const notch = { x: 646, y: 0, width: 179, height: 32 }
    const vors = (x: number, width: number, height = 32) => ({ frame: { x, y: 0, width, height }, layer: 26, bundle: "com.vorssaint.utils" })
    const corner = { frame: { x: 0, y: 916, width: 40, height: 40 }, layer: 26 }, status = { frame: { x: 1200, y: 0, width: 30, height: 32 }, layer: 25 }
    const own = { frame: { x: 811, y: 0, width: 460, height: 340 }, layer: 1000, vaultite: true }
    const at = (ws: Any[]) => I.islandSpot(d, notch, I.islandsOn(d, notch, ws))
    const bare = at([]), collapsed = at([vors(645, 179), corner, status, own]), wide = at([vors(560, 350)]), open = at([vors(480, 510, 300)])
    check("island: on its own it runs on from the notch, as tall as it", bare.attached && bare.x === 825 && bare.bar === 32 && !bare.hidden, bare)
    check("island: Vorssaint at rest over the notch, its corner window, a status item and our own window change nothing", JSON.stringify(collapsed) === JSON.stringify(bare), collapsed)
    // (the M4's top as screen.swift read it: the menu bar, Thaw's bar across it, Control Center's status items)
    const bars = [{ frame: { x: 0, y: 0, width: 1470, height: 33 }, layer: 24 }, { frame: { x: 0, y: 0, width: 1470, height: 38 }, layer: 24, bundle: "com.stonerl.Thaw" }]
    const items = [951, 999, 1033, 1071].map((x) => ({ frame: { x, y: 0, width: 38, height: 33 }, layer: 25 }))
    const real = at([vors(645, 179), ...bars, ...items])
    check("island: the menu bar, a menu bar manager's bar and status items aren't islands; it rests clear of the first item",
      JSON.stringify(real) === JSON.stringify(bare) && I.roomAt(real, d, [...bars, ...items]) === 951 - 825 - I.GAP && I.roomAt(real, d, []) === Infinity, real)
    check("island: Vorssaint wide, ours sits to its right, apart", !wide.attached && wide.x === 560 + 350 + I.GAP, wide)
    check("island: Vorssaint opened down, ours steps aside", open.hidden === true, open)
    const plain = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } }
    const centre = I.islandSpot(plain, null, I.islandsOn(plain, null, []))
    check("island: with no notch, at the top centre of the menu bar", centre.align === "centre" && centre.x === 720 && centre.bar === 25, centre)
    const w = I.windowAt(bare, d, 700, 340), c = I.windowAt(centre, plain, 700, 340), edge = I.windowAt({ ...bare, x: 1400 }, d, 700, 340)
    check("island: its window reaches back under the notch, centres with none, and stays on its display", w.x === 825 - I.TUCK - I.REACH && w.y === 0 && c.x === 720 - 350 && edge.x === 1470 - 700, [w, c, edge])
    const second = { bounds: { x: 1470, y: -200, width: 1920, height: 1080 }, workArea: { x: 1470, y: -175, width: 1920, height: 1055 } }
    const s2 = I.islandSpot(second, null, [])
    check("island: on another display, at its own top", s2.y === -200 && s2.x === 1470 + 960 && s2.bar === 25, s2)
  }

  // The ops: a session knocks, the helpers hear it, the user (or the companion for them) puts it off or ignores it.
  {
    await api("PATCH", "config/plugin/companion", { mode: "quiet" })
    let [st, b] = await api("POST", "ops/companion.knock", { line: "Lighthouse tests pass: ready for you to look", urgency: "high", who: "Lighthouse" })
    const id = b.id
    check("knock op: a knock is made, waiting, high", st === 200 && b.state === "waiting" && b.urgency === "high" && b.who === "Lighthouse", [st, b])
    ;[st, b] = await api("POST", "ops/companion.knock", { line: "  ", urgency: "high" })
    const [st2] = await api("POST", "ops/companion.knock", { line: "x", urgency: "loud" })
    const [st3] = await api("POST", "ops/companion.knock", { line: "x", for: "soon" })
    const [st4] = await api("POST", "ops/companion.knock", { line: "x", hold: "10m" })
    check("knock op: no line, a wrong urgency, life or hold is refused", st === 400 && st2 === 400 && st3 === 400 && st4 === 400, b)
    const [, held] = await api("POST", "ops/companion.knock", { line: "Ready to look", who: "Held", hold: "15s" })
    check("knock op: --hold keeps its card up longer", held.hold === 15_000, held)
    await api("POST", "ops/companion.knocks", { ignore: held.id })
    ;[st, b] = await api("POST", "ops/companion.knocks", {})
    check("knocks op: lists it", st === 200 && b.knocks.some((k: Any) => k.id === id && k.state === "waiting"), b)
    ;[st, b] = await api("POST", "ops/companion.knocks", { later: id })
    check("knocks op: later puts it off", b.did?.state === "later", b)
    ;[st, b] = await api("POST", "ops/companion.knocks", { ignore: id.slice(-5) })
    check("knocks op: ignore (by the end of its id) ends it", b.did?.state === "ignored" && b.did.id === id, b)
    const [stX] = await api("POST", "ops/companion.knocks", { ignore: "nope" })
    check("knocks op: no such knock is a 404", stX === 404)
    await api("POST", "ops/companion.knock", { line: "Which account?", terminal: "claude-test1", who: "Deploy" })
    ;[st, b] = await api("POST", "ops/companion.knocks", { mute: (await api("POST", "ops/companion.knocks", {}))[1].knocks.find((k: Any) => k.from === "claude-test1").id })
    const [, after] = await api("POST", "ops/companion.knock", { line: "Still waiting", terminal: "claude-test1", who: "Deploy" })
    check("knocks op: mute ignores its session's knocks, the next ones too", b.did?.state === "ignored" && after.state === "ignored", [b.did, after])
  }
}
