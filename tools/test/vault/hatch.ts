import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { HATCH_DIR, api, check } = $
  // ---------- Hatch (plugins/core/hatch): an agent's home read as who it is, runs, memory, dreams, feed and setup ----------
  {
    const A = "1111aaaa-0000-4000-8000-000000000001", B = "2222bbbb-0000-4000-8000-000000000002"
    const run = (id: string, at: number) => fs.utimesSync(path.join(HATCH_DIR, "agents", `agent-${id}`), at / 1000, at / 1000)
    run(A, Date.now() - 7200000); run(B, Date.now() - 3600000)
    let [c, o] = await api("GET", "hatch")
    check("hatch: who it is (IDENTITY.md's name), its persona files and what's left to fill in them", c === 200 && o.name === "Wren" &&
      o.files[0].name === "IDENTITY.md" && o.files.find((f: Any) => f.name === "IDENTITY.md").unfilled.join() === "Vibe" &&
      o.files.find((f: Any) => f.name === "USER.md").unfilled.join() === "Timezone,Context" &&
      o.files.find((f: Any) => f.name === "PROACTIVE_PREFERENCES.md").unfilled.join() === "Never tell me about,When" &&
      o.files.find((f: Any) => f.name === "SOUL.md").unfilled.length === 0, o)
    check("hatch: its counts, connectors, jobs (archived ones too) and objectives", o.counts.runs === 2 && o.counts.dreams === 2 && o.counts.notes === 2 &&
      o.connectors.filter((x: Any) => x.status === "connected").map((x: Any) => x.name).join() === "google_calendar" &&
      o.jobs.find((j: Any) => j.id === "heartbeat").schedule === "every 30m" && o.jobs.find((j: Any) => j.id === "launch-check").schedule === "daily at 08:00 (America/Los_Angeles)" &&
      o.jobs.find((j: Any) => j.id === "tour").archived === true && o.jobs.find((j: Any) => j.id === "tour").enabled === false &&
      o.objectives.find((x: Any) => x.id === "shopping").outcome === "insufficient", o)
    ;[c, o] = await api("GET", "hatch/runs?limit=5")
    const [feedRun, talk] = o.runs ?? []
    check("hatch runs: newest first, each its kind (by what started it), a title, tool calls, model and tokens", c === 200 && o.total === 2 &&
      feedRun.id === B && feedRun.kind === "Feed" && feedRun.title === "Work this hour's beat." && feedRun.tools === 1 &&
      talk.kind === "Conversation" && talk.title === "What's left before the Lighthouse launch?" && talk.model === "made-up-model-1" && talk.tokens === 12000, o)
    ;[c, o] = await api("GET", `hatch/session/${A}`)
    check("hatch session: what the user said, the answer and a tool call with its result; guidance folds away, thinking is left out", c === 200 &&
      o.entries.map((e: Any) => e.kind === "tool" ? e.name : e.kind).join() === "Guidance,user,read,assistant" &&
      o.entries[2].result.includes("Press kit") && o.title === "Conversation: What's left before the Lighthouse launch?", o)
    ;[c] = await api("GET", "hatch/session/..%2Fetc")
    check("hatch session: not a path", c === 400, c)
    ;[c, o] = await api("GET", "hatch/memory?notes=1")
    check("hatch memory: MEMORY.md, the latest note's facts with their quotes, its bank (not an empty file)", c === 200 && o.facts.length === 2 &&
      o.days.length === 1 && o.days[0].date === "2026-10-10" && o.days[0].facts[1].kind === "preference" && o.days[0].facts[1].quote === "Keep it short." &&
      o.bank.find((b: Any) => b.name === "world").items[0] === "Lighthouse is a small studio." && o.notes === 2, o)
    ;[c, o] = await api("GET", "hatch/memory?notes=2")
    check("hatch memory: a note's other lines", o.days[1].notes.join() === "Prepared the first tip of the tour.", o.days)
    ;[c, o] = await api("GET", "hatch/dreams?dreams=1")
    check("hatch dreams: the newest, its prose only, and what it understands of the user", c === 200 && o.total === 2 &&
      o.dreams[0].text === "A quiet day: one question about the launch, answered in two lines." && o.synthesis.text.startsWith("Alice tests"), o)
    ;[c, o] = await api("GET", "hatch/feed?stories=5")
    check("hatch feed: newest slot first, each story with its links", c === 200 && o.stories.length === 2 && o.stories[0].title === "A new open model for code" &&
      o.stories[0].part === "midday" && o.stories[0].links.length === 2 && o.stories[0].text.includes("[scores well]"), o)
    const block = async (name: string, options = {}) => String((await api("GET", `render/block?name=${name}&options=${JSON.stringify(options)}`))[1])
    const text = (await block("hatch-memory", { notes: 1 })) + (await block("hatch-runs"))
    check("hatch: its blocks as text", text.includes("## What Wren knows") && text.includes("Alice prefers short answers. (preference, medium)") &&
      text.includes("Feed: Work this hour's beat."), text)
  }
}
