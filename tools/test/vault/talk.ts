import { EventEmitter } from "node:events"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  // (the companion acting: its own tool call, not any agent's vau)
  const { asItsTool } = await import("../../../plugins/core/companion/chat.ts")
  const { app, api, check } = $
  const T = await import("../../../plugins/core/companion/talks.ts")
  const S = await import("../../../core/desktop/spoken.ts")

  check("talk: back (and its kin) is the app's own; words about going back to something aren't",
    ["back", "Back.", "go back", "okay, back to Claude", "thanks, that's all", "back to the companion", "done talking", "end the talk", "back now"].every(T.isBack) &&
    !["go back to the previous version", "what did you do back there?", "roll back the merge", "back up the files"].some(T.isBack))
  check("talk: a job talks by its title's first words, short enough for a cursor, never ending on a little word",
    T.talkName("Make a landing page") === "Make a landing page" && T.talkName("Announce every handoff in the companion's voice and the island") === "Announce every handoff" &&
    T.talkName("Fix the bug in the") === "Fix the bug" && T.talkName("") === "Job", [T.talkName("Announce every handoff in the companion's voice and the island"), T.talkName("Fix the bug in the")])
  {
    const a = S.voiceOf("Make a landing page", "Claude", "Adrian"), b = S.voiceOf("Make a landing page", "Claude", "Adrian")
    const all = new Set(Array.from({ length: 40 }, (_, i) => S.voiceOf(`Job ${i}`, "Claude", "Grace")))
    check("talk: each agent but the companion has a Soniox voice of its own, the same each time, never the companion's",
      S.voiceOf("claude", "Claude", "Adrian") === null && !!a && a === b && S.AGENT_VOICES.includes(a!) && !all.has("Grace") && all.size > 4, [a, [...all]])
  }

  // End to end: a job, the floor handed to it, the Talk key's words typed into its terminal (the companion's turn none),
  // its answer said by its own name; back, the floor the companion's again and the job told so.
  if (process.platform !== "win32") {
    const cScreen = await import("../../../plugins/core/companion/screensocket.ts")
    const { matchSocket } = await import("../../../core/plugins.ts")
    const heard: Any[] = [], sc = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send: (d: string) => heard.push(JSON.parse(d)), close() {}, ping() {}, terminate() {} })
    matchSocket(app.plugins, ["companion", "live"])![1].fn(sc as Any, {} as IncomingMessage, { wild: [], query: { screen: "1" } })
    const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "talk-"))
    const cc = app.plugins.find((p) => p.id === "claude-code")!.services, was = { ...cc }
    const osc = (s: string) => `printf '\\033]7501;state=${s}\\033\\\\'`
    // (a stand-in worker: rests, then each line typed in is a turn)
    cc["agent:claude"] = async () => ({ command: `sleep 0.3; ${osc("working")}; sleep 0.5; ${osc("idle")}; while IFS= read -r l; do ${osc("working")}; echo "$l" >> told.txt; sleep 1.5; ${osc("idle")}; done`, cwd: null })
    let turn: Any = null
    cc["agent-turn:claude"] = async () => turn
    const told = () => (fs.existsSync(path.join(tmp, "told.txt")) ? fs.readFileSync(path.join(tmp, "told.txt"), "utf8") : "")
    const says = async () => (await api("POST", "ops/companion.status", {}))[1].notes.filter((n: Any) => n.kind === "say").map((n: Any) => `${n.agent}: ${n.text}`)
    const over = { app: "com.example.notes", title: "Notes", screen: "Jobs\nMerge", sx: 10, sy: 20 }
    let job = ""
    try {
      await api("PATCH", "config/plugin/companion", { mode: "quiet", agent: "claude", summoned_model: "companion", jobs_agent: "claude" })
      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "write up the landing page plan", ...over })
      const [, b] = await asItsTool(() => api("POST", "ops/companion.handoff", { task: "Make a landing page", cwd: tmp }, agent))
      job = b.id
      turn = { text: "Wrote it.", files: [], at: Date.now() + 1500, final: true }
      await waitFor(async () => !["starting", "working"].includes((await api("POST", "ops/companion.job", { id: job }))[1].state), 10000, 100)

      cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "let me talk with that job", ...over, voice: true })
      const [ts, tb] = await api("POST", "ops/companion.talk", { job }, agent)
      const first = await waitFor(() => /Talk: the user wants to talk with you by voice[^\n]*as Make a landing page[^\n]*let me talk with that job/m.test(told()) && told(), 8000, 50)
      check("talk: handing a job the floor tells its worker how to talk, the ask that asked its first words", ts === 200 && tb.name === "Make a landing page" && !!first, [ts, tb, told()])
      turn = { text: "I wrote the plan [ring \"Jobs\"], in two parts.", files: [], at: Date.now() + 1000, final: true }
      const said = await waitFor(async () => (await says()).includes("Make a landing page: I wrote the plan, in two parts."), 10000, 100)
      check("talk: its turn's words are said by its own name, its tags out of them", !!said, await says())
      await (await import("../../../plugins/core/companion/chatturns.ts")).tend()
      const stays = (await api("POST", "ops/companion.status", {}))[1].agents.find((a: Any) => a.name === "Make a landing page")?.state
      check("talk: the watchdog leaves a talking job's cursor, which never calls next", stays === "watching", stays)

      const m = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "what's in part two?", ...over, voice: true }) as Any
      const next = await waitFor(() => /Talk: they said this to you by voice[^\n]*what's in part two\?/m.test(told()), 8000, 50)
      check("talk: the Talk key's next words go into its terminal, the job's, not the companion's", !!next && m?.live === job && m?.for === "Make a landing page", [told(), m?.for, m?.live])
      turn = { text: "Pricing and a signup form.", files: [], at: Date.now() + 1000, final: true }
      await waitFor(async () => (await says()).includes("Make a landing page: Pricing and a signup form."), 10000, 100)

      const back = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "Thanks, back to Claude.", ...over, voice: true }) as Any
      const ended = await waitFor(async () => (await says()).includes("Claude: Back.") && /^Talk over: they're back/m.test(told()), 8000, 50)
      check("talk: back is the app's: the companion says so, and the job is told to end with a line for its thread", !!ended && back?.live === job, [await says(), told()])
      const jobStates = heard.flatMap((x) => (x.t === "agent" && x.agent.name === "Make a landing page" ? [x.agent.state] : [])).filter((x, i, xs) => x !== xs[i - 1]).join(", ")
      const { state, log } = (await api("POST", "ops/companion.job", { id: job }))[1]
      check("talk: the job's cursor thinks on their words, watches once it said its turn, and goes when they're back", jobStates === "thinking, watching, thinking, watching, away",
        [jobStates, state, log?.slice(-4).map((x: Any) => `${x.from}>${x.to}`).join(" ")])
      const left = (await api("POST", "ops/companion.status", {}))[1]
      check("talk: once back, the job's cursor and words are gone", !left.agents.some((a: Any) => a.name === "Make a landing page") && !(await says()).some((t: string) => t.startsWith("Make a landing page:")), left.agents)
      const after = cScreen.screenMoment({ kind: "ask", agent: "Claude", text: "what's on my calendar?", ...over }) as Any
      check("talk: once back, the Talk key's asks are the companion's again", after?.for === "Claude" && !after?.live, after)
      const [os2] = await api("POST", "ops/companion.talk", { off: true }, agent)
      check("talk: ending a talk when none is on says so", os2 === 409)
    } finally {
      // (its settings back as the next tests expect: a summoned ask after it starts no session of the companion's)
      await api("PATCH", "config/plugin/companion", { mode: "off", summoned_model: "haiku" })
      sc.emit("close")
      Object.assign(cc, was)
      if (job) await asItsTool(() => api("POST", "ops/companion.job-stop", { id: job }, agent)).catch(() => {})
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}
