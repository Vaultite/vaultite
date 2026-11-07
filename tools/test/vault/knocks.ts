import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check } = $
  const K = await import("../../../plugins/core/companion/knocks.ts")
  const I = await import("../../../electron/islandlogic.ts")

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
    check("presences: each keeps its tint", ps.every((p) => p.tint === K.tintFor(p.id)) && K.tintFor("claude-1") === K.tintFor("claude-1"))
    const later = K.presencesOf(rows, [], seen, T + K.DONE_MS + 1)
    check("presences: a done one goes after a while; a knock gone, its session is as its terminal says",
      !later.some((p) => p.id === "codex-3") && later.find((p) => p.id === "claude-1")?.state === "working", later)
    const alone = K.presencesOf([], [{ ...K.makeKnock({ id: "k2", from: "", who: "Backup", line: "Finished" }, T), state: "showing" as const }], new Map(), T)
    check("presences: a knock from no terminal is a presence of its own", alone.length === 1 && alone[0].who === "Backup" && alone[0].state === "needs you" && !alone[0].terminal)
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
    check("knock op: no line, a wrong urgency or life is refused", st === 400 && st2 === 400 && st3 === 400, b)
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
