// The companion's Anchor, Condition and Tours, apart from any screen: the language, re-finding a thing after the screen
// changed, and the player against a pretend screen. node tools/test_tours.ts
import { anchorOf, keepAnchor, refind, type Seen } from "../plugins/core/companion/anchor.ts"
import { check as checkOnce, conditionText, durationOf, type Env, type Input, parseCondition, watch } from "../plugins/core/companion/condition.ts"
import type { Condition as Check } from "../plugins/core/companion/uimodel.ts"
import { type Aim, type Fx, parseTour, play, plan, tourFromAnswer, tourText } from "../plugins/core/companion/tour.ts"

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

console.log(`${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
