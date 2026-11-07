// Teach by showing, apart from any screen: their words, a lesson's acts made steps, a tour and a skill, and a draft
// promoted once it played through. node tools/test_teach.ts
import { type Act, clickedThing, keptValue, secretLike, kindFor, type Lesson, lessonSkillText, lessonTitle, lessonTour, lessonTourText, playedThrough, promoted, recentStretch, skillName, stepsOf, teachCommand, yours } from "../plugins/core/companion/teach.ts"
import { parseTour, plan } from "../plugins/core/companion/tour.ts"
import { parseText } from "../core/vault.ts"

let failed = 0, passed = 0
function check(name: string, ok: unknown, info?: unknown) {
  if (ok) { passed++; return }
  failed++
  console.log(`FAIL ${name}${info === undefined ? "" : `\n     ${JSON.stringify(info)?.slice(0, 900)}`}`)
}

// ---------- their words
{
  check("secrets never kept: tokens and keys, not words or addresses", secretLike("ghp_abcdEFGH1234") && secretLike("sk-proj-xyz") && secretLike("a8f3k29dk3mf93kdm3kfa") && !secretLike("laptop key") &&
    !secretLike("https://example.com/a1b2c3d4e5f6g7h8i9") && !secretLike("alice.park@example.com") && keptValue("eyJhbGciOi.x") === "" && keptValue('say "hi"\nthere') === "say 'hi' there")

  const c = (t: string, w = false) => teachCommand(t, w)
  check("start: watch me, with what it's about", c("Watch me add a deploy key")?.do === "start" && c("Watch me add a deploy key")?.rest === "add a deploy key" &&
    c("ok so let me show you how to rename a branch.")?.rest === "to rename a branch." && c("I'll show you how I do this")?.do === "start" && c("watch me")?.rest === "", c("ok so let me show you how to rename a branch."))
  check("start: not from words that only mention watching", !c("can you watch the build for me") && !c("what does watch mean") && !c("my watch is slow"))
  check("while watching: done, that's it, cancel; narration is narration", c("that's it", true)?.do === "done" && c("Done.", true)?.do === "done" && c("and that's how you do it", true)?.do === "done" &&
    c("never mind", true)?.do === "cancel" && c("cancel that", true)?.do === "cancel" && !c("done is greyed out here", true) && !c("now I click on settings", true) && !c("that's it", false))
  const l = c("make what I just did a skill"), t = c("Turn that into a tour called Start a chat."), w = c("save that as a walkthrough", true)
  check("from the last minutes: a skill or a tour, its name", l?.do === "last" && l.as === "skill" && l.rest === "" && t?.do === "last" && t.as === "tour" && t.rest === "Start a chat" && w?.as === "tour", { l, t, w })
}
{
  check("their words said back: first person to the player's", yours("So now I'm clicking on my settings") === "Now click on your settings." && yours("I click Save") === "Click Save." &&
    yours("and then I'm going to type the title") === "Then type the title." && yours("here's where you see all your keys") === "Here's where you see all your keys." &&
    yours("um we pick the repo we want") === "Pick the repo you want." && yours("first I open the menu") === "First, open the menu." && yours("") === "", [yours("So now I'm clicking on my settings"), yours("and then I'm going to type the title"), yours("um we pick the repo we want"), yours("first I open the menu")])
}

// ---------- a lesson: GitHub in Safari, adding a deploy key
const win = { x: 0, y: 0, width: 1000, height: 800 }
const el = (role: string, label: string, x: number, y: number, inside: string[] = []) => ({ role, label, frame: { x, y, width: 80, height: 24 }, inside: inside.map((i) => ({ role: "group", label: i })) })
const t0 = 1_800_000_000_000
const acts: Act[] = [
  { t: t0, kind: "app", app: "com.apple.Safari", name: "Safari", title: "acme/site" },
  { t: t0 + 200, kind: "said", text: "Watch me add a deploy key" },
  { t: t0 + 1500, kind: "said", text: "First I open the repo's settings" },
  { t: t0 + 2500, kind: "click", x: 900, y: 100, el: el("link", "Settings", 860, 90, ["Repository"]), window: win },
  { t: t0 + 2600, kind: "click", x: 900, y: 100, el: el("link", "Settings", 860, 90, ["Repository"]), window: win },
  { t: t0 + 5000, kind: "click", x: 50, y: 400, el: el("link", "Deploy keys", 20, 390, ["Security"]), window: win },
  { t: t0 + 6000, kind: "said", text: "here's where you see all the keys" },
  { t: t0 + 8000, kind: "click", x: 300, y: 300 },
  { t: t0 + 9000, kind: "click", x: 900, y: 200, el: el("button", "Add deploy key", 860, 190), window: win },
  { t: t0 + 10_000, kind: "click", x: 400, y: 250, el: el("textbox", "Title", 380, 240), window: win },
  { t: t0 + 11_000, kind: "said", text: "I give it a name" },
  { t: t0 + 12_000, kind: "field", el: el("textbox", "Title", 380, 240), value: "lap", window: win },
  { t: t0 + 13_000, kind: "field", el: el("textbox", "Title", 380, 240), value: "laptop", window: win },
  { t: t0 + 13_500, kind: "key", key: "tab" },
  { t: t0 + 14_000, kind: "field", el: el("textarea", "Key", 380, 300), value: "ssh-ed25519 AAAA \"x\"", window: win },
  { t: t0 + 15_000, kind: "key", key: "enter" },
  { t: t0 + 16_000, kind: "said", text: "that's it" },
]
const lesson: Lesson = { from: t0, to: t0 + 17_000, acts, about: "add a deploy key" }
{
  const { steps, apps, intro, unnamed } = stepsOf(lesson)
  check("steps: a double click one, a click into a field and its typing one, Tab left out, Return ends the step before",
    steps.length === 5 && steps.map((s) => s.kind).join() === "click,click,click,field,field" && steps[3].value === "laptop" && steps[4].key === "enter" && unnamed === 1 && apps[0].app === "com.apple.Safari" && !intro.length, steps)
  check("steps: their words with the step they came before, or the one just done", steps[0].said[0] === "First I open the repo's settings" && steps[1].after[0] === "here's where you see all the keys" && steps[3].said[0] === "I give it a name" &&
    !steps.some((s) => s.said.some((w) => /watch me|that's it/i.test(w))), steps.map((s) => s.said))
}
{
  const { tour } = lessonTour(lesson, "Add a deploy key")
  const lines = tour.steps.map((s) => s.text)
  check("tour: their words, a mark on each thing, what each does", tour.steps.length === 5 && lines[0] === `First, open the repo's settings. [ring "Settings"]` && tour.steps[0].do?.[0].text === "Settings" &&
    tour.steps[3].do?.map((d) => d.action).join() === "type" && tour.steps[3].do?.[0].value === "laptop" && tour.steps[4].do?.map((d) => d.action).join() === "type,press" && lines[4].startsWith(`Type "ssh-ed25519 AAAA 'x'" in Key, then press Return.`) && lines[1].startsWith("Open Deploy keys. Here's where you see all the keys.") && tour.steps[4].do?.[0].value === "ssh-ed25519 AAAA 'x'" && tour.app[0] === "com.apple.Safari", tour.steps)
  check("tour: what tells each thing apart kept as an anchor", tour.anchors.Settings?.role === "link" && tour.anchors.Settings?.inside?.[0] === "Repository" && !!tour.anchors.Settings?.at && !("app" in tour.anchors.Settings), tour.anchors)
  const text = lessonTourText(tour, t0), [fm, body] = parseText(text), [again, problems] = parseTour(fm, body, "x")
  check("tour: its file a draft, read back the same", fm.status === "draft" && fm.type === "tour" && !problems.length && again.steps.length === 5 && again.steps[4].do?.[1]?.key === "enter" &&
    again.anchors.Settings?.role === "link" && again.steps[3].do?.[0].text === "Title", { text, problems })
  check("tour: guide waits for their click, do mode clicks", plan(again.steps[0], "guide").wait?.source === `click "Settings"` && plan(again.steps[0], "do").does[0].text === "Settings")
  check("kind: explained what's where is a tour, else a skill; asked wins", kindFor({ ...lesson, acts: [...acts, { t: t0 + 7000, kind: "said", text: "this is the list of keys" }] }) === "tour" &&
    kindFor({ ...lesson, acts: acts.filter((a) => a.kind !== "said") }) === "skill" && kindFor({ ...lesson, as: "tour" }) === "tour" && kindFor({ ...lesson, about: "make it a skill" }) === "skill")
  const skill = lessonSkillText(tour, { name: "add-a-deploy-key", at: t0, appNames: ["Safari"] }), [sfm, sbody] = parseText(skill), [st, sp] = parseTour(sfm, sbody, "x")
  check("skill: a SKILL.md agents find, a draft, its steps a tour the companion plays", sfm.name === "add-a-deploy-key" && /^Add a deploy key in Safari.*Use when asked to add a deploy key\.$/.test(String(sfm.description)) &&
    sfm.status === "draft" && sfm.origin === "ai" && /vau companion tour \.agents\/skills\/add-a-deploy-key\/SKILL\.md --mode do/.test(sbody) && !sp.length && st.steps.length === 5 && st.anchors.Settings?.role === "link", { skill, sp })
}
{
  check("title: what they called it, else where and when", lessonTitle({ ...lesson, about: "how to add a deploy key" }) === "Add a deploy key" && lessonTitle({ ...lesson, about: "" }, "Safari").startsWith("Safari lesson ") &&
    lessonTitle({ ...lesson, about: "this" }, "Figma").startsWith("Figma lesson") && skillName("Add a deploy key!") === "add-a-deploy-key" && skillName("…") === "lesson")
  const fresh = recentStretch([{ t: 0, kind: "click", x: 1, y: 1, el: el("button", "Old", 0, 0) }, { t: 100_000, kind: "app", app: "a", name: "A" }, { t: 101_000, kind: "said", text: "now save" }, { t: 102_000, kind: "click", x: 1, y: 1, el: el("button", "New", 0, 0) }, { t: 130_000, kind: "key", key: "cmd+s" }])
  check("what I just did: back to their last pause of a minute, the app and words just before kept", fresh.length === 4 && fresh[0].kind === "app" && !fresh.some((a) => a.kind === "click" && a.el?.label === "Old"), fresh)
  const things = [{ role: "group", label: "Toolbar", frame: { x: 0, y: 0, width: 500, height: 40 } }, { role: "text", label: "Share", frame: { x: 105, y: 10, width: 30, height: 14 } }, { role: "button", label: "Share", frame: { x: 100, y: 5, width: 60, height: 28 } }]
  check("the thing clicked: what acts there before its words or its toolbar", clickedThing(things, { x: 110, y: 15 })?.role === "button" && clickedThing(things, { x: 400, y: 20 })?.label === "Toolbar" && !clickedThing(things, { x: 900, y: 900 }))
}
{
  const draft = "---\nname: x\nstatus: draft\ntaught: 2026-11-06\n---\n\n# X\n", p = promoted(draft, Date.UTC(2026, 10, 7))
  check("promoted: draft gone, when it worked kept; not a draft, untouched", p === "---\nname: x\ntaught: 2026-11-06\ntested: 2026-11-07\n---\n\n# X\n" && promoted(p!, 0) === null && promoted("# no frontmatter", 0) === null, p)
  check("played through: to the end with every step found", playedThrough({ ended: "done", steps: [{ how: "played" }] }) && !playedThrough({ ended: "done", steps: [{ how: "model" }] }) && !playedThrough({ ended: "lost", steps: [{ how: "played" }] }))
}

console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
