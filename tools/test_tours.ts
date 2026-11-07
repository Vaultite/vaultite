// The companion's Anchor, Condition and Tours, apart from any screen: the language, re-finding a thing after the screen
// changed, and the player against a pretend screen. node tools/test_tours.ts
import "./test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { anchorOf, keepAnchor, refind, type Seen } from "../plugins/core/companion/anchor.ts"
import { check as checkOnce, conditionText, durationOf, type Env, type Input, parseCondition, watch } from "../plugins/core/companion/condition.ts"
import type { Condition as Check } from "../plugins/core/companion/uimodel.ts"
import type { Job } from "../plugins/core/companion/jobs.ts"
import { type Aim, askWords, type Fx, parseTour, play, plan, tourAsked, tourFromAnswer, tourText } from "../plugins/core/companion/tour.ts"

let failed = 0, passed = 0
function check(name: string, ok: unknown, info?: unknown) {
  if (ok) { passed++; return }
  failed++
  console.log(`FAIL ${name}${info === undefined ? "" : `\n     ${JSON.stringify(info)?.slice(0, 600)}`}`)
}
const throws = (f: () => unknown) => { try { f(); return "" } catch (e) { return (e as Error).message } }

// ---------- Condition: the language
{
  const c = parseCondition(`click "Share" and shows "Saved" or gone "Loading" within 10s`)
  check("condition: and binds tighter than or, within at the end", c.any.length === 2 && c.any[0].length === 2 && c.any[0][0].kind === "click" && c.within === 10_000 &&
    conditionText(c) === `click "Share" and shows "Saved" or gone "Loading" within 10s`, c)
  check("condition: bare words, times", parseCondition("type").any[0][0].kind === "type" && parseCondition("idle 1s").any[0][0].kind === "idle" &&
    (parseCondition("idle 500ms").any[0][0] as { ms: number }).ms === 500 && durationOf("2m") === 120_000 && durationOf("3") === 3000 && parseCondition("changed").any[0][0].kind === "check")
  check("condition: the screen's states are the ui model's checks", JSON.stringify(parseCondition(`expanded "Files" and not selected tab "Notes"`).any[0]) ===
    '[{"kind":"check","check":{"kind":"expanded","target":{"name":"Files"}}},{"kind":"check","check":{"kind":"selected","not":true,"target":{"role":"tab","name":"Notes"}}}]' &&
    parseCondition(`show "Saved"`).any[0][0].kind === "check" && conditionText(parseCondition(`gone "Loading" and click`)) === `gone "Loading" and click`, parseCondition(`expanded "Files" and not selected tab "Notes"`))
  check("condition: what's wrong is said", /needs a time/.test(throws(() => parseCondition("idle"))) && /no condition "wobble".*click, type/.test(throws(() => parseCondition("wobble"))) &&
    /quotes/.test(throws(() => parseCondition("shows Saved"))) && /missing/.test(throws(() => parseCondition("click and"))) && /empty/.test(throws(() => parseCondition(" "))) && /within 10s/.test(throws(() => parseCondition(`changed within soon`))))
}

// ---------- Condition: watched over time, against a pretend clock and screen
function fakeEnv(o: { says?: (t: number) => string[]; inputs?: Input[]; sig?: (t: number) => string; where?: Record<string, { x: number; y: number; width: number; height: number }> } = {}): Env & { t: number } {
  const e = {
    t: 0,
    now: () => e.t,
    sleep: async (ms: number) => { e.t += ms },
    // (the ui model's check, as a pretend screen answers it)
    holds: async (c: Check, before?: string) => {
      const s = o.says?.(e.t) ?? [], ok = c.kind === "changed" ? (o.sig?.(e.t) ?? "same") !== before : s.includes(c.kind === "shows" ? c.text ?? "" : c.target?.name ?? "")
      return c.not ? !ok : ok
    },
    snapshot: async () => o.sig?.(e.t) ?? "same",
    inputs: (since: number) => (o.inputs ?? []).filter((i) => i.t >= since && i.t <= e.t),
    where: async (text: string) => o.where?.[text] ?? null,
  }
  return e as Env & { t: number }
}
{
  const r = await watch(parseCondition(`click "New chat"`), fakeEnv({ inputs: [{ kind: "click", t: 600, label: "Settings" }, { kind: "click", t: 1200, label: "New chat" }] }))
  check("wait: a click on the thing saying it, not on another", r.met && r.ms >= 1200 && r.ms < 1500, r)
  const byPoint = await watch(parseCondition(`click "Send"`), fakeEnv({ inputs: [{ kind: "click", t: 300, x: 105, y: 52 }], where: { Send: { x: 100, y: 40, width: 40, height: 20 } } }))
  check("wait: a click whose element has no words counts by its point inside the thing", byPoint.met, byPoint)
  const timeout = await watch(parseCondition(`shows "Saved" within 2s`), fakeEnv({ says: () => [] }))
  check("wait: within ends it unmet", !timeout.met && timeout.why === "timeout" && timeout.ms >= 2000 && timeout.ms < 2300, timeout)
  const gone = await watch(parseCondition(`gone "Loading"`), fakeEnv({ says: (t) => (t < 1000 ? ["Loading"] : []) }))
  check("wait: gone once the words leave", gone.met && gone.ms >= 1000, gone)
  const idle = await watch(parseCondition("type and idle 1s"), fakeEnv({ inputs: [{ kind: "type", t: 200 }, { kind: "type", t: 700 }] }))
  check("wait: typed, then a second with nothing", idle.met && idle.ms >= 1700 && idle.ms < 2000, idle)
  const changed = await watch(parseCondition("changed"), fakeEnv({ sig: (t) => (t < 750 ? "a" : "b") }))
  check("wait: changed from what it said at the start", changed.met && changed.ms >= 750, changed)
  const ctl = new AbortController(), env = fakeEnv()
  const stopping = watch(parseCondition("click"), { ...env, sleep: async (ms) => { env.t += ms; if (env.t > 500) ctl.abort() } }, { signal: ctl.signal })
  check("wait: stopped when its signal aborts", (await stopping).why === "stopped")
  const once = await checkOnce(parseCondition(`shows "Saved" or click`), fakeEnv({ says: () => ["Saved"] }))
  const cant = await checkOnce(parseCondition(`click "Share"`), fakeEnv())
  check("check: state tested once; what happens over time can't be, and says so", once.met && once.by === `shows "Saved"` && !cant.met && cant.cant?.[0] === `click "Share"`, [once, cant])
}

// ---------- Anchor: found again after the screen changed
{
  const win = { x: 100, y: 100, width: 1000, height: 800 }
  const share: Seen = { role: "button", label: "Share", frame: { x: 900, y: 120, width: 60, height: 24 }, inside: [{ role: "toolbar", label: "Toolbar" }, { role: "window", label: "Document" }] }
  const before: Seen[] = [share, { role: "button", label: "Share", frame: { x: 300, y: 700, width: 60, height: 24 }, inside: [{ role: "group", label: "Comments" }] }, { role: "button", label: "Comment", frame: { x: 830, y: 120, width: 60, height: 24 }, inside: [{ role: "toolbar", label: "Toolbar" }] }]
  const a = anchorOf(share, { app: "com.figma.Desktop", window: win })
  check("anchor: what it is and where in its window", a.role === "button" && a.label === "Share" && a.inside?.[0] === "Toolbar" && a.at!.x > 0.8 && a.at!.y < 0.1, a)
  const same = refind(a, before, { app: "com.figma.Desktop", window: win })
  check("anchor: of two that say it, the one in its container", same.ok && same.seen === share && same.how === "same", same)
  const moved = { x: 400, y: 300, width: 1000, height: 800 }, shift = (s: Seen): Seen => ({ ...s, frame: { ...s.frame, x: s.frame.x + 300, y: s.frame.y + 200 } })
  const m = refind(a, before.map(shift), { window: moved })
  check("anchor: the window moved, it moved with it", m.ok && m.seen.frame.x === 1200 && m.shown, m)
  const scrolled = before.map((s) => ({ ...s, frame: { ...s.frame, y: s.frame.y + 1500 } }))
  const off = refind(a, scrolled, { window: win })
  check("anchor: scrolled off its window, found but not shown, and which way", off.ok && !off.shown && off.dir === "down", off)
  const relabelled = before.map((s) => (s === share ? { ...s, label: "Share file" } : s))
  const rel = refind(a, relabelled, { window: win })
  check("anchor: its words changed, the same kind in the same container where it was", rel.ok && rel.how === "inside" && rel.seen.label === "Share file", rel)
  const counted = refind({ label: "Inbox (3)", role: "row" }, [{ role: "row", label: "Inbox (4)", frame: { x: 0, y: 0, width: 10, height: 10 } }])
  check("anchor: the same words but for a count", counted.ok && counted.how === "like", counted)
  const gone = refind(a, before.filter((s) => s !== share).map((s) => ({ ...s, inside: [{ role: "group", label: "Comments" }] })), { window: win })
  check("anchor: gone, said so rather than pointing at another", !gone.ok && gone.why === "gone" && /nothing on screen is button "Share" in "Toolbar"/.test(gone.text), gone)
  const elsewhere = refind(a, before, { app: "com.apple.Safari" })
  check("anchor: another app isn't where it is", !elsewhere.ok && elsewhere.why === "elsewhere")
  const ui = refind({ label: "Files", ui: "panel:files:files", app: "vaultite" }, [{ role: "group", label: "Notes", ui: "panel:files:files", frame: { x: 0, y: 0, width: 10, height: 10 } }])
  check("anchor: Vaultite's own by its id, whatever it says now", ui.ok && ui.how === "ui")
  let kept = keepAnchor([], a, 1)
  kept = keepAnchor(kept, { label: "Comment" }, 2)
  kept = keepAnchor(kept, a, 3)
  check("anchor: kept by name, the same one once, newest last", kept.length === 2 && kept[1].id === "k1" && kept[1].t === 3 && kept[0].id === "k2", kept)
}

// ---------- Tours: the format
const FILE = `
Some words before the steps.

1. Your chats are down the left [frame "Chats"].
2. Start one here [ring "New chat"]. (wait: click)
3. Type your question [point "Ask anything"].
   It can be anything. (wait: type and idle 1s)
4. (do: click "Send")
`
{
  const [t, problems] = parseTour({ type: "tour", site: "https://vaultite.app/x", anchors: { "New chat": { role: "button", inside: ["Sidebar"] } } }, FILE, "Start a chat")
  check("tour: its steps, their words and tags, waits and dos", !problems.length && t.steps.length === 4 && t.steps[0].said === "Your chats are down the left." && t.steps[0].tags[0].kind === "frame" &&
    t.steps[1].wait?.any[0][0].kind === "click" && t.steps[2].said === "Type your question. It can be anything." && t.steps[2].wait?.any[0].length === 2 &&
    t.steps[3].do?.[0].text === "Send" && t.steps[3].said === "" && t.site[0] === "vaultite.app" && t.title === "Start a chat" && t.anchors["New chat"].role === "button", [t, problems])
  const back = parseTour({ type: "tour", site: "vaultite.app", anchors: t.anchors }, tourText(t).replace(/^---[\s\S]*?---\n/, ""), "x")[0]
  check("tour: written back, it reads the same", JSON.stringify(back.steps.map((s) => [s.text, s.wait?.source, s.do])) === JSON.stringify(t.steps.map((s) => [s.text, s.wait ? conditionText(s.wait) : undefined, s.do])) &&
    /^---\ntype: tour\nsite: vaultite.app\nanchors:\n  "New chat": \{"role":"button","inside":\["Sidebar"\]\}\n---\n1\. /.test(tourText(t)), tourText(t))
  const [, bad] = parseTour({}, "1. Here [ring \"x\"] (wait: wobble)\n2. (do: fly)", "x")
  check("tour: a bad step says which and why", bad.length === 2 && /^step 1: no condition "wobble"/.test(bad[0]) && /^step 2: no do "fly"/.test(bad[1]), bad)
  check("tour: modes: guide waits for what do does; do does what guide waits for", plan(t.steps[3], "guide").wait?.any[0][0].kind === "click" && plan(t.steps[3], "guide").does.length === 0 &&
    plan(parseTour({}, `1. Here [ring "Go"] (wait: click "Go" and idle 1s)`, "x")[0].steps[0], "do").does[0].text === "Go" &&
    plan(parseTour({}, `1. Here [ring "Go"] (wait: click "Go" and idle 1s)`, "x")[0].steps[0], "do").wait?.source === "idle 1s" && !plan(t.steps[1], "show").wait)
  const saved = tourFromAnswer(`Your chats are down the left [frame a1]. They're kept a month. Start one here [ring a2 "New chat"], then type [point "Ask anything"].`, "Chats",
    { app: "com.apple.Safari", site: "claude.ai", window: { x: 0, y: 0, width: 1000, height: 800 }, near: [{ id: "a1", role: "group", label: "Chats", frame: { x: 0, y: 100, width: 200, height: 600 }, inside: [{ role: "region", label: "Sidebar" }] }, { id: "a2", role: "button", label: "New chat", frame: { x: 10, y: 60, width: 100, height: 30 } }] })
  check("tour: saved from an answer: a step a pointing sentence, ids as their words, anchors kept", saved.steps.length === 2 && saved.steps[0].text === `Your chats are down the left [frame "Chats"]. They're kept a month.` &&
    saved.steps[1].text === `Start one here [ring "New chat"], then type [point "Ask anything"].` && saved.anchors.Chats.inside?.[0] === "Sidebar" && saved.site[0] === "claude.ai", saved)
}

// ---------- Tours: the player, against a pretend screen
{
  const [t] = parseTour({ site: "vaultite.app" }, FILE, "Start a chat")
  const screen: Record<string, Aim> = { Chats: { ok: true, at: { x: 0, y: 0, width: 100, height: 400 }, shown: true, how: "same" }, "New chat": { ok: true, at: { x: 10, y: 10, width: 80, height: 20 }, shown: true, how: "same" },
    "Ask anything": { ok: true, at: { x: 300, y: 700, width: 400, height: 40 }, shown: true, how: "same" }, Send: { ok: true, at: { x: 720, y: 700, width: 30, height: 30 }, shown: true, how: "same" } }
  const log: string[] = []
  const fx = (over: Partial<Fx> = {}): Fx => ({
    aim: async (a) => screen[a.label] ?? { ok: false, why: "gone" },
    show: async (s, at) => { log.push(`show ${s.n} ${at.map((x) => (x?.ok ? x.at.x : "-")).join(",")}`) },
    say: async (w) => { log.push(`say ${w}`) },
    wait: async (c) => { log.push(`wait ${conditionText(c)}`); return { met: true, why: "met", ms: 5 } },
    act: async (d, at) => { log.push(`act ${d.action} ${at?.ok ? at.at.x : "-"}`); return { ok: true } },
    fallback: async (s, missing) => { log.push(`model ${s.n} ${missing.join("|")}`); return true },
    sleep: async () => {},
    ...over,
  })
  log.length = 0
  const shown = await play(t, "show", fx())
  check("player: show plays straight through, no waits, no dos", shown.ended === "done" && log.join(";") === "show 1 0;show 2 10;show 3 300;show 4 720", log)
  log.length = 0
  const guided = await play(t, "guide", fx())
  check("player: guide waits for him, and for his click where do would click", guided.ended === "done" && log.join(";") === `show 1 0;show 2 10;wait click;show 3 300;wait type and idle 1s;show 4 720;wait click "Send"`, log)
  log.length = 0
  const done = await play(t, "do", fx())
  check("player: do clicks Send itself, at where it is now", done.ended === "done" && log.at(-1) === "act click 720", log)
  // (a target gone: the model plays that step, then the tour goes on without it)
  log.length = 0
  const renamed = { ...screen }
  delete renamed["New chat"]
  const healed = await play(t, "show", fx({ aim: async (a) => renamed[a.label] ?? { ok: false, why: "gone" } }))
  check("player: a target not found goes to the model, and the tour goes on", healed.ended === "done" && healed.steps[1].how === "model" && log.includes("model 2 New chat") && log.includes("show 3 300"), log)
  const lost = await play(t, "show", fx({ aim: async (a) => renamed[a.label] ?? { ok: false, why: "gone" }, fallback: async () => false }))
  check("player: and when the model can't either, it stops there, saying what", lost.ended === "lost" && lost.steps.length === 2 && /New chat/.test(lost.steps[1].why ?? ""), lost)
  // (scrolled off: asked to scroll, played once it shows)
  log.length = 0
  let looks = 0
  const below = await play(t, "guide", fx({ aim: async (a) => (a.label === "Ask anything" && looks++ < 2 ? { ok: true, at: { x: 300, y: 1700, width: 400, height: 40 }, shown: false, dir: "down", how: "same" } : screen[a.label]) }))
  check("player: a target off screen: scroll down a bit, then the step", below.ended === "done" && log.includes("say It's further down: scroll down a bit.") && log.indexOf("show 3 300") > log.indexOf("say It's further down: scroll down a bit."), log)
  const ctl = new AbortController()
  const stopped = await play(t, "guide", fx({ wait: async () => { ctl.abort(); return { met: false, why: "stopped", ms: 1 } } }), ctl.signal)
  check("player: stopped mid-wait ends the tour there", stopped.ended === "stopped" && stopped.steps.at(-1)?.how === "stopped" && stopped.steps.length === 2, stopped)

  // (marks follow their target while its step is up: moved, then scrolled off, then back; still once it ends)
  const [one] = parseTour({}, `1. Share it here [ring "Share"]. (wait: click)`, "Follow")
  const at = (x: number, shown = true): Aim => ({ ok: true, at: { x, y: 40, width: 60, height: 20 }, shown, how: "same" })
  const seq = [at(100), at(100), at(103), at(180), at(180, false), at(180)]
  let looked = 0
  const followed: string[] = []
  const tick = (ms: number) => new Promise<void>((ok) => setTimeout(ok, Math.min(ms, 2)))
  const tracked = await play(one, "guide", fx({
    aim: async () => seq[Math.min(looked++, seq.length - 1)], sleep: tick,
    follow: (_s, a) => { followed.push(a.map((x) => (x?.ok ? String(x.at.x) : "-")).join(",")) },
    wait: async () => { for (let i = 0; i < 500 && followed.length < 3; i++) await tick(2); return { met: true, why: "met", ms: 5 } },
  }))
  const after = looked
  await tick(20)
  check("player: a mark follows its target: moved, gone off screen, back; a few points' wobble isn't a move", tracked.ended === "done" && followed.join(";") === "180;-;180", followed)
  check("player: and stops following once its step ends", looked === after, { looked, after })
}

// ---------- Proofs: a job's change shown, its befores flipped, then Keep and merge, Needs changes or Not yet
{
  const P = await import("../plugins/core/companion/proof.ts"), J = await import("../plugins/core/companion/jobs.ts"), T = await import("../plugins/core/companion/tour.ts")
  const [t, problems] = parseTour({ job: "j3k9x2a" }, `1. The save button is blue now [ring "Save"]. (before: "Guides/Proofs/The blue save button/before 1.png")\n2. And it says so in Jobs [point "Jobs"].`, "The blue save button")
  check("proof: a step's before is its picture, its job the tour's; written back as read", !problems.length && t.job === "j3k9x2a" && t.steps[0].before === "Guides/Proofs/The blue save button/before 1.png" &&
    t.steps[0].said === "The save button is blue now." && !t.steps[1].before && tourText(t).includes("job: j3k9x2a") &&
    JSON.stringify(parseTour({ job: "j3k9x2a" }, tourText(t).split("---\n").pop()!, "x")[0].steps) === JSON.stringify(t.steps), [t, problems, tourText(t)])
  check("proof: a before with nothing to lay it over is refused", /needs a tag/.test(parseTour({}, "1. It's blue now. (before: a.png)", "x")[1].join()))
  const waits: number[] = [], screen2: Record<string, Aim> = { Save: { ok: true, at: { x: 1, y: 2, width: 80, height: 24 }, shown: true, how: "same" }, Jobs: { ok: true, at: { x: 5, y: 5, width: 40, height: 20 }, shown: true, how: "same" } }
  const befores: (string | undefined)[] = []
  await play(t, "show", { aim: async (a) => screen2[a.label] ?? { ok: false, why: "gone" }, show: async (s) => { befores.push(s.before) }, say: async () => {}, wait: async () => ({ met: true, why: "met", ms: 1 }),
    act: async () => ({ ok: true }), fallback: async () => false, sleep: async (ms) => { waits.push(ms) } })
  check("proof: a step with a before stays up for its flips (before, now, before, now), one without as its words take",
    befores[0] === t.steps[0].before && befores[1] === undefined && waits[0] >= P.FLIPS.at(-1)![0] + 1000 && waits[1] < waits[0] && P.FLIPS.map((f) => f[1]).join() === "false,true,false", { waits, befores })
  const job = { title: "Make the save button blue", state: "ready for review" as const }
  check("proof: a ready job's knock says what it shows, else its title", P.readyLine(job, "The blue save button") === "Ready to show you the blue save button" &&
    P.readyLine(job, "GitHub's new badge.") === "Ready to show you GitHub's new badge" && P.readyLine(job) === "Ready to show you: Make the save button blue" &&
    P.readyLine({ ...job, state: "done" }) === "Done: Make the save button blue")
  check("proof: only a turn just ended with something is shown (ready for review or done, from working)", P.readyNow({ state: "ready for review" }, "working") && P.readyNow({ state: "done" }, "needs you") &&
    !P.readyNow({ state: "done" }, "ready for review") && !P.readyNow({ state: "failed" }, "working") && !P.readyNow({ state: "needs you" }, "working"))
  const keep = ["Keep", "keep it", "Yes, keep it.", "looks good", "that's great thanks", "ship it", "it works", "perfect", "Keep and merge", "merge it", "ok merge it"]
  const broken = ["Still broken", "it's still broken", "not fixed", "No, still not working", "it doesn't work", "broken", "Needs changes", "needs work"]
  const later = ["Not yet", "not now", "later", "keep it but don't merge", "don't merge it yet", "leave it for now"]
  const neither = ["keep the old colour on the header please", "why is it blue", "show me again", "why didn't you answer my previous message?", "yes", ""]
  check("proof: its choice said in a few words (keep and merge, needs changes, not yet); anything else is a real ask", keep.every((x) => P.choiceSaid(x) === "keep") && broken.every((x) => P.choiceSaid(x) === "broken") &&
    later.every((x) => P.choiceSaid(x) === "later") && neither.every((x) => P.choiceSaid(x) === null), [...keep, ...broken, ...later, ...neither].map((x) => [x, P.choiceSaid(x)]))
  check("proof: after an offer to merge first, a plain yes or no answers it", P.choiceSaid("yes", "offer") === "keep" && P.choiceSaid("Merge it first", "offer") === "keep" && P.choiceSaid("no thanks", "offer") === "later" &&
    P.choiceSaid("Not yet", "offer") === "later" && P.choiceSaid("what branch?", "offer") === null)
  // (the choice says what happens: a change of its own merges, one with none just keeps; every button's words answer it)
  const coded = { state: "ready for review" as const, where: { repo: "site" } as unknown as Job["where"], result: { diff: "1 file changed, +1 -0" } }, note = { ...coded, where: { repo: "" } as unknown as Job["where"] }
  const cs = [P.choicesFor(coded), P.choicesFor(note), P.choicesFor(coded, "offer")]
  check("proof: a job with a change of its own asks Keep and merge, Needs changes, Not yet; one with none, Keep or Needs changes; each button its own answer",
    cs[0].buttons.join() === "Keep and merge,Needs changes,Not yet" && cs[1].buttons.join() === "Keep,Needs changes" && cs[2].buttons.join() === "Merge it first,Not yet" &&
    cs.every((c, i) => c.buttons.every((b) => P.choiceSaid(b, i === 2 ? "offer" : "proof") !== null)) && !J.landable({ ...coded, land: { asked: 1, at: 2, merged: true } }) &&
    J.landable({ ...coded, state: "done" }) && !J.landable({ ...coded, state: "working" }), cs)
  check("proof: a worker's last message says whether it merged what they kept", J.mergedSaid("Merged: squashed into main as abc123.") === true && J.mergedSaid("**Merged** into main") === true &&
    J.mergedSaid("Not merged: CI is red on main.") === false && J.mergedSaid("I couldn't merge it: conflicts") === null && J.mergedSaid("Couldn't merge: conflicts") === false && J.mergedSaid("Done.") === null)
  check("proof: once merging what they kept, its knock says how it went", P.readyLine({ ...job, land: { asked: 1, at: 2, merged: true } }) === "Merged: Make the save button blue" &&
    P.readyLine({ ...job, land: { asked: 1, at: 2, merged: false } }, "The blue save button") === "Didn't merge: Make the save button blue")
  check("proof: only words asking to see it show a job (never another ask)", ["show me", "let's see the header", "what did it do?", "can I look at it"].every(P.asksToSee) &&
    !["why didn't you answer my previous message?", "merge it", "keep it", "close that"].some(P.asksToSee))
  const said = P.summaryOf({ title: "x", result: { text: "Made the save button blue in the toolbar. Also tidied its hover.", diff: "2 files changed, +8 -3", files: ["web/src/a.tsx", "web/src/b.css"] } })
  check("proof: nothing to show: its own words' gist and its diff, plainly", said === "Made the save button blue in the toolbar. 2 files changed, +8 -3: a.tsx, b.css." &&
    P.summaryOf({ title: "Fix it" }) === `It didn't say what changed for "Fix it".`, said)
  const [nat] = parseTour({}, `1. The Jobs heading is bold now [ring "Jobs"], in the menu bar's Vaultite menu.\n2. And here [point "Settings"].`, "Bold jobs")
  const [site] = parseTour({ site: ["example.com"] }, `1. In the menu bar [ring "Jobs"].`, "x")
  check("proof: a step naming the Mac's own UI (the menu bar, the notch) is found, so tour-save warns; on a site it isn't", T.nativeSteps(nat).join() === "1" && !T.nativeSteps(site).length &&
    !T.nativeSteps(parseTour({}, `1. Docked panels stay [ring "Files"].`, "x")[0]).length, T.nativeSteps(nat))
  check("proof: a tour's open (where its change shows) is written back as read", parseTour({ open: "Notes/Plan.md" }, tourText({ ...t, open: "Notes/Plan.md" }).split("---\n").pop()!, "x")[0].open === "Notes/Plan.md" &&
    tourText({ ...t, open: "Notes/Plan.md" }).includes("open: Notes/Plan.md"))
  check("proof: a step's before draws on its agent's own before layer", P.layerOwner(P.beforeLayer("Claude")) === "Claude" && P.layerOwner("Claude") === "Claude" && P.beforeLayer("Ada") !== "Ada")
}

// ---------- Tours asked for by name, and a step's own drawing
{
  const [t, problems] = parseTour({ ask: ["What's new?", "show me what you built"] }, `1. Here's your latest screenshot. (draw: {"type": "image", "src": "screenshot", "at": "top-right"})
2. And a sketch. (draw: [{"type": "paper", "w": 120, "h": 80, "items": [{"type": "text", "x": 10, "y": 10, "text": "hi (there)"}]}])`, "What's new")
  check("tour: draw notes parse as companion draw's marks, out of the words", !problems.length && t.steps[0].said === "Here's your latest screenshot." && t.steps[0].draw?.[0].src === "screenshot" &&
    t.steps[1].draw?.length === 1 && t.steps[1].said === "And a sketch.", { problems, steps: t.steps })
  const again = parseTour({ ask: t.ask }, tourText(t).replace(/^---[\s\S]*?---\n/, ""), "What's new")[0]
  check("tour: its file says its ask phrases and draws, read back the same", /^ask: \["What's new\?","show me what you built"\]$/m.test(tourText(t)) && JSON.stringify(again.steps.map((x) => x.draw)) === JSON.stringify(t.steps.map((x) => x.draw)), tourText(t))
  check("tour: a draw that isn't marks is said", /draw: marks as companion draw takes them/.test(parseTour({}, "1. Look. (draw: a card)", "x")[1].join()) && /its type/.test(parseTour({}, "1. Look. (draw: [{}])", "x")[1].join()))
  const all: { id: string; ask?: string[] }[] = [{ id: "a", ask: ["What's new?", "show me what you built"] }, { id: "b" }]
  check("tour: asked by its phrase, said whole, politely or not", tourAsked(all, "what's new")?.id === "a" && tourAsked(all, "Hey Claude, what's new?")?.id === "a" &&
    tourAsked(all, "Show me what you built, please.")?.id === "a" && askWords("Okay, so what’s new?") === "whats new")
  check("tour: a question that only has the phrase in it is the model's", !tourAsked(all, "what's new in this email?") && !tourAsked(all, "new") && !tourAsked(all, "") && !tourAsked(all.slice(1), "what's new"))
}

console.log(`${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
