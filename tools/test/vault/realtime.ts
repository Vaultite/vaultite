import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { WebSocketServer, type WebSocket } from "ws"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check, sleep } = $
  // The realtime voice front (electron/realtimefront.ts): the Talk key's audio to an OpenAI Realtime session, its answer
  // at once, a screen question handed to the summoned session. OpenAI is a stand-in socket; nothing plays.
  const { costOf, resampler, msOf, verbatim } = await import("../../../electron/realtimelogic.ts")
  {
    const tone = (n: number, rate: number) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 300 * i) / rate) * 10_000), i * 2); return b }
    const whole = resampler()(tone(16_000, 16_000))
    const r = resampler(), parts = Buffer.concat([0, 1001, 4000, 9999, 16_000].slice(1).map((end, i, a) => r(tone(16_000, 16_000).subarray([0, ...a][i] * 2, end * 2))))
    let off = 0
    for (let i = 0; i < whole.length / 2; i++) off = Math.max(off, Math.abs(whole.readInt16LE(i * 2) - Math.round(Math.sin((2 * Math.PI * 300 * i) / 24_000) * 10_000)))
    check("realtime: the mic's 16 kHz made 24 kHz, the same tone, and the same in chunks as whole", Math.abs(whole.length / 2 - 24_000) <= 2 && off < 300 && parts.equals(whole), { n: whole.length / 2, off, parts: parts.length })
    check("realtime: an ask's cost from its usage (mini: audio in 10, cached 0.3, out 20 a million)", Math.abs(costOf("gpt-realtime-2.1-mini", { input_token_details: { text_tokens: 1000, audio_tokens: 500, cached_tokens: 800, cached_tokens_details: { text_tokens: 800, audio_tokens: 0 } }, output_token_details: { text_tokens: 20, audio_tokens: 200 } }) -
      (200 * 0.6 + 800 * 0.06 + 500 * 10 + 20 * 2.4 + 200 * 20) / 1e6) < 1e-12 && msOf(48_000) === 1000 && /word for word/.test(verbatim("Hi.")))
  }

  // ---------- the stand-in: OpenAI Realtime's events for small talk, and for a screen question (a tool call)
  let refuse = false, mute = false, broke = false, connections = 0
  const server = http.createServer(), wss = new WebSocketServer({ server, verifyClient: (_i, done) => done(!refuse, 401) })
  const got: Any[] = [], auths: string[] = []
  wss.on("connection", (ws: WebSocket, req) => {
    connections++
    auths.push(`${req.headers.authorization} ${new URL(String(req.url), "http://x").searchParams.get("model")}`)
    let rn = 0, items = 0, bytes = 0, story: ReturnType<typeof setInterval> | null = null, storyId = ""
    const send = (m: object) => ws.send(JSON.stringify(m))
    ws.on("message", (d) => {
      const m = JSON.parse(String(d))
      got.push(m.type === "input_audio_buffer.append" ? { type: m.type, n: Buffer.from(m.audio, "base64").length } : m)
      if (m.type === "session.update") send({ type: "session.updated", session: m.session })
      if (m.type === "input_audio_buffer.append") bytes += Buffer.from(m.audio, "base64").length
      if (m.type === "response.cancel" && story) { clearInterval(story); story = null; send({ type: "response.done", response: { id: storyId, status: "cancelled", output: [] } }) }
      if (m.type !== "response.create" || mute) return
      // (OpenAI's answer to an account with no credits)
      if (broke) return send({ type: "error", error: { type: "insufficient_quota", code: "insufficient_quota", message: "You have no credits remaining. Add credits to continue using the API." } })
      const id = `resp_${++rn}`, item = `item_${++items}`, usage = { input_tokens: 300, output_tokens: 60, input_token_details: { text_tokens: 200, audio_tokens: 100, cached_tokens: 0 }, output_token_details: { text_tokens: 10, audio_tokens: 50 } }
      send({ type: "response.created", response: { id } })
      const audio = (ms: number) => send({ type: "response.output_audio.delta", response_id: id, item_id: item, delta: Buffer.alloc(ms * 48).toString("base64") })
      const look = !m.response && got.some((x) => x.type === "conversation.item.create" && /Mail/.test(JSON.stringify(x.item))) && !got.some((x) => x.item?.type === "function_call_output")
      setTimeout(() => {
        if (look) {
          send({ type: "response.output_audio_transcript.delta", response_id: id, delta: "Let me look." }); audio(300)
          send({ type: "response.output_item.added", response_id: id, item: { type: "function_call", call_id: "call_1", name: "look_at_screen" } })
          send({ type: "response.function_call_arguments.done", response_id: id, call_id: "call_1", name: "look_at_screen", arguments: JSON.stringify({ question: "what is this button" }) })
          send({ type: "response.done", response: { id, status: "completed", usage, output: [{ type: "function_call", call_id: "call_1", name: "look_at_screen", arguments: "{}" }] } })
          return
        }
        // (no word of where they are: a long one, faster than it plays, till it's cancelled)
        if (!m.response && !got.some((x) => x.type === "conversation.item.create")) { storyId = id; story = setInterval(() => audio(200), 50); return }
        send({ type: "response.output_audio_transcript.delta", response_id: id, delta: m.response ? "(as told)" : `I'm good, thanks! (${bytes} bytes)` })
        audio(200); audio(200)
        send({ type: "response.done", response: { id, status: "completed", usage, output: [] } })
      }, 30)
    })
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const url = `ws://127.0.0.1:${(server.address() as Any).port}/v1/realtime`

  const { realtimeFront } = await import("../../../electron/realtimefront.ts")
  const rig = (o: { key?: boolean; pauseMs?: number } = {}) => {
    const ev: Any[] = []
    const f = realtimeFront({
      config: async () => (o.key === false ? null : { url, key: "sk-test-1", model: "gpt-realtime-2.1-mini", voice: "cedar" }),
      name: () => "Claude",
      player: { stream: () => { const n = ev.filter((e) => e[0] === "stream").length + 1; ev.push(["stream", n]); return { pcm: (b: Buffer) => ev.push(["pcm", n, b.length]), end: () => ev.push(["end", n]) } }, stop: () => ev.push(["stop"]) },
      look: (q) => ev.push(["look", q]),
      answered: (r) => ev.push(["answered", r]),
      fallback: (h) => ev.push(["fallback", h]),
      state: (s) => ev.push(["state", s]),
      log: (t) => ev.push(["log", t]),
      heard: (h) => ev.push(["heard", h]),
      heardMs: 300, lookMs: 3000, firstMs: 1000, pauseMs: o.pauseMs,
      notice: (account, why) => ev.push(["notice", why, account]),
      paused: (p) => ev.push(["paused", p]),
    })
    return { f, ev }
  }
  const speak = (f: Any, ms = 600) => { for (let i = 0; i < ms / 100; i++) f.audio(Buffer.alloc(3200, 1)); f.speech() }
  const until = async (fn: () => unknown, ms = 3000) => { for (let i = 0; i < ms / 20 && !fn(); i++) await sleep(20); return !!fn() }

  {
    // small talk: heard while held, answered on release, its words kept for the box
    const { f, ev } = rig()
    f.warm()
    f.press()
    speak(f)
    await until(() => got.some((m) => m.type === "input_audio_buffer.append"))
    f.release("(Where they are: Notes.)")
    const took = f.heard("how are you")
    await until(() => ev.some((e) => e[0] === "answered"))
    const update = got.find((m) => m.type === "session.update")?.session
    const appended = got.filter((m) => m.type === "input_audio_buffer.append").reduce((n, m) => n + m.n, 0)
    check("realtime: its session is the model and voice set, the key a header, PCM at 24 kHz both ways, no VAD (push to talk), one tool", auths[0] === "Bearer sk-test-1 gpt-realtime-2.1-mini" &&
      update?.audio.output.voice === "cedar" && update.audio.input.format.rate === 24_000 && update.audio.input.turn_detection === null && update.tools[0].name === "look_at_screen" && /look_at_screen/.test(update.instructions), update)
    const order = got.map((m) => m.type).filter((t) => t !== "input_audio_buffer.append" && t !== "session.update")
    check("realtime: held, the mic's audio streams (made 24 kHz); let go, where they are, the turn committed and answered", Math.abs(appended - 600 * 48) < 200 &&
      JSON.stringify(order) === JSON.stringify(["input_audio_buffer.clear", "conversation.item.create", "input_audio_buffer.commit", "response.create"]) && took, { appended, order })
    const a = ev.find((e) => e[0] === "answered")?.[1], log = ev.find((e) => e[0] === "log")?.[1]
    check("realtime: its audio plays as it comes, then its answer is kept (their words and its), its first words timed and costed", ev.filter((e) => e[0] === "pcm").length === 2 && ev.some((e) => e[0] === "end") &&
      a?.heard === "how are you" && /^I'm good/.test(a.said) && log?.kind === "talk" && log.firstMs >= 0 && log.cost > 0 && ev.some((e) => e[0] === "state" && e[1] === "done") && !ev.some((e) => e[0] === "fallback"), ev)
    // (a screen question: a few words, then look_at_screen; the higher model's say said as written)
    got.length = 0; ev.length = 0
    f.press()
    speak(f)
    f.release("(Where they are: Mail, its window \"Inbox\".)")
    f.heard("what does this button do")
    await until(() => ev.some((e) => e[0] === "look"))
    const look = ev.find((e) => e[0] === "look")?.[1]
    check("realtime: a screen question says a few words and hands the ask to the higher model, with their words and the talk before", look?.question === "what does this button do" &&
      look.talk.join("|") === `they: how are you|you: ${a.said}` && ev.some((e) => e[0] === "state" && e[1] === "thinking") && ev.some((e) => e[0] === "pcm"), ev)
    const t = Date.now()
    check("realtime: only its screen round's says are its own (an older ask's aren't)", f.owns(t) && !f.owns(t - 60_000))
    f.agent("thinking")
    f.text("n1", "Sure, that's")
    f.text("n1", "Sure, that's the Send button. It")
    await until(() => got.some((m) => m.type === "response.create" && m.response))
    const out = got.find((m) => m.item?.type === "function_call_output"), first = got.find((m) => m.type === "response.create" && m.response)
    check("realtime: its answer goes back as the tool's output once a sentence or so is written, said word for word", out?.item.call_id === "call_1" && JSON.parse(out.item.output).answer === "Sure, that's the Send button." &&
      first?.response.tool_choice === "none" && first.response.instructions.includes("Sure, that's the Send button."), { out, first })
    f.text("n1", "Sure, that's the Send button. It sends your reply to Alice right away. Want")
    f.text("n1", "Sure, that's the Send button. It sends your reply to Alice right away. Want the details?")
    f.agent("watching")
    await until(() => ev.some((e) => e[0] === "log" && e[1].kind === "look"))
    const rest = got.filter((m) => m.type === "response.create" && m.response).map((m) => m.response.instructions)
    const lk = ev.find((e) => e[0] === "log")?.[1]
    check("realtime: the rest of the say follows in pieces, in order; the turn ends with the higher model's, timed to its answer", rest.length === 3 && rest[1].includes("It sends your reply to Alice right away.") && rest[2].includes("Want the details?") &&
      lk?.answerMs >= lk.firstMs && !f.owns(Date.now()), { rest, lk })
    const lines = ev.filter((e) => e[0] === "heard").map((e) => e[1])
    check("realtime: each sentence of its answer is told as it's heard, in order, so its marks keep to it", lines.map((h) => h.text).join("|") === "Sure, that's the Send button.|It sends your reply to Alice right away.|Want the details?" &&
      lines.every((h, i) => h.dur > 0 && (!i || h.at >= lines[i - 1].at)), lines)
    // (barge-in: pressed while it speaks, it stops at once and the model hears how much was said)
    got.length = 0; ev.length = 0
    f.press()
    speak(f)
    f.release()
    f.heard("tell me a story")
    await until(() => ev.some((e) => e[0] === "pcm"))
    f.press()
    await until(() => got.some((m) => m.type === "conversation.item.truncate"))
    check("realtime: the Talk key while it speaks stops its voice and response at once, the model told how much was heard", ev.some((e) => e[0] === "stop") &&
      got.some((m) => m.type === "conversation.item.truncate" && m.audio_end_ms >= 0) && !ev.some((e) => e[0] === "answered" && e[1].heard === "tell me a story"), got.map((m) => m.type))
    f.close()
  }
  {
    // the pipeline's: no speech (a drawn point), no key, or its socket refused
    const { f, ev } = rig()
    f.press(); f.audio(Buffer.alloc(16_000)); f.release()
    check("realtime: a press with no speech in it (a point, a drawing) is the pipeline's", f.heard("") === false)
    const off = rig({ key: false })
    off.f.press(); speak(off.f); off.f.release()
    await sleep(50)
    check("realtime: without its key it's the pipeline's", off.f.heard("hello") === false)
    refuse = true
    f.press(); speak(f); f.release()
    await sleep(30)
    const took = f.heard("what time is it")
    await until(() => ev.some((e) => e[0] === "fallback"))
    check("realtime: its socket refused, the pipeline answers the same ask with dictation's words", took ? ev.some((e) => e[0] === "fallback" && e[1] === "what time is it") : true, ev)
    check("realtime: its key refused, it pauses (told once, why in its status) rather than trying each press", !f.available() && ev.filter((e) => e[0] === "notice").length === 1 &&
      ev.find((e) => e[0] === "notice")[2] === "auth" && ev.find((e) => e[0] === "paused")?.[1]?.account === "auth" && /401/.test(ev.find((e) => e[0] === "paused")[1].why), ev)
    refuse = false
    mute = true
    const quiet = rig()
    quiet.f.press(); speak(quiet.f); quiet.f.release(); quiet.f.heard("still there?")
    check("realtime: an answer that doesn't come in time goes to the pipeline, and a slip like that pauses nothing", await until(() => quiet.ev.some((e) => e[0] === "fallback" && e[1] === "still there?"), 6000) &&
      quiet.f.available() && !quiet.ev.some((e) => e[0] === "notice" || e[0] === "paused"), quiet.ev)
    mute = false
    f.close(); off.f.close(); quiet.f.close()
  }
  {
    // an account with no credits: one press fails over, the voice pauses (told once), presses skip it, one try later
    broke = true
    const { f, ev } = rig({ pauseMs: 600 })
    f.warm(); f.press(); speak(f); f.release()
    await sleep(100)
    const heardAt = Date.now()
    // (refused before its words settled: the pipeline has it at once; after, the front hands it back)
    const took = f.heard("are you there")
    if (took) await until(() => ev.some((e) => e[0] === "fallback"))
    const cost = took ? Date.now() - heardAt : 0
    console.log(`  (a refused press fails over ${cost} ms after dictation's words, on a stand-in on this machine)`)
    const before = connections, asked = got.filter((m) => m.type === "response.create").length
    f.press(); speak(f); f.release()
    await sleep(50)
    check("realtime: no credits, the press fails over, the user told once, and the next press skips it (no socket, no try)", (took ? ev.some((e) => e[0] === "fallback") : true) && f.heard("again?") === false &&
      !f.available() && connections === before && got.filter((m) => m.type === "response.create").length === asked && ev.filter((e) => e[0] === "notice").length === 1 && /no credits/.test(ev.find((e) => e[0] === "notice")[1]), ev)
    await until(() => got.some((m) => m.type === "response.create" && m.response?.conversation === "none"), 3000)
    await sleep(100)
    check("realtime: paused a while, it tries once in the background (a word, outside the conversation); still refused, still paused, not told again",
      got.some((m) => m.type === "response.create" && m.response?.conversation === "none" && m.response.output_modalities[0] === "text") && !f.available() && ev.filter((e) => e[0] === "notice").length === 1, got.map((m) => m.type))
    broke = false
    await until(() => f.available(), 3000)
    f.press(); speak(f); f.release()
    await sleep(50)
    check("realtime: paid again, its next try finds it back, and presses go to it", f.available() && f.heard("hello again") === true && ev.some((e) => e[0] === "paused" && e[1] === null), ev)
    await until(() => ev.some((e) => e[0] === "answered"))
    f.close()
  }
  wss.close(); server.close()

  // ---------- its key: this machine's, checked with OpenAI, never in the vault; the app's socket hears what it answered
  {
    const { api, vau } = { api: $.api, vau: $.vars.vau as (...a: string[]) => Promise<{ code: number; out: string; err: string }> }
    const config = path.join(process.env.VAULTITE_LOCAL!, "config.json")
    // (a key restricted to Realtime lists no models: it's checked by a client secret asked for, free)
    const rest = http.createServer((req, res) => { res.statusCode = req.url !== "/v1/realtime/client_secrets" || req.method !== "POST" ? 403 : req.headers.authorization === "Bearer sk-good-openai-key-1234567" ? 200 : 401; res.end("{}") })
    await new Promise<void>((done) => rest.listen(0, "127.0.0.1", done))
    process.env.VAULTITE_OPENAI_API = `http://127.0.0.1:${(rest.address() as Any).port}`
    try {
      const keys = async () => (await api("GET", "companion/realtime"))[1]
      check("realtime key: none, no realtime voice", !(await keys()).key)
      $.vars.stdinText = "sk-wrong-openai-key-000000\n"
      let r = await vau("voice", "key", "--provider", "openai")
      check("realtime key: one OpenAI refuses isn't kept", r.code === 1 && /refused/.test(r.err) && !(await keys()).key, r)
      $.vars.stdinText = "sk-good-openai-key-1234567\n"
      r = await vau("voice", "key", "--provider", "openai")
      $.vars.stdinText = ""
      const k = await keys()
      check("realtime key: piped in, checked, kept in data/config.json, given to the desktop app with its socket", r.code === 0 && /Set the OpenAI key/.test(r.out) &&
        JSON.parse(fs.readFileSync(config, "utf8")).companion?.openai === "sk-good-openai-key-1234567" && k.key === "sk-good-openai-key-1234567" && /^wss:\/\/api\.openai\.com/.test(k.url), { r, k })
      const inVault = (() => { try { return execFileSync("grep", ["-rl", "sk-good-openai-key", $.VAULT], { encoding: "utf8" }) } catch { return "" } })()
      check("realtime key: nowhere in the vault", !inVault, inVault)
      const told = await vau("companion", "status")
      check("realtime key: companion status says what its voice runs on here, never the key", /Voice here: hears with .*; speaks with .*this Mac's; realtime on \(OpenAI gpt-realtime-2\.1-mini\)\./.test(told.out) &&
        !told.out.includes("sk-good-openai"), told.out)
      r = await vau("voice", "key", "--provider", "openai", "--remove")
      check("realtime key --remove: gone", r.code === 0 && !(await keys()).key && !JSON.parse(fs.readFileSync(config, "utf8")).companion?.openai, r)
    } finally { rest.close(); delete process.env.VAULTITE_OPENAI_API; $.vars.stdinText = "" }

    // (on, as the companion area may have left it off)
    const mode = (await api("GET", "config/plugin/companion"))[1]?.mode
    await api("PATCH", "config/plugin/companion", { mode: "quiet" })
    const c = await import("../../../plugins/core/companion/plugin.ts")
    const { EventEmitter } = await import("node:events")
    const live = c.plugin.sockets.find((x: Any) => x.pattern.join("/") === "companion/live")!
    const ws: Any = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, got: [] as Any[], close() {}, send(t: string) { ws.got.push(JSON.parse(t)) } })
    live.fn(ws, { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as Any, { query: { screen: "1" }, wild: [] })
    ws.emit("message", JSON.stringify({ t: "answered", agent: "Claude", heard: "how are you", said: "I'm good, thanks!" }))
    const said = ws.got.filter((m: Any) => m.t === "said").at(-1)?.said ?? []
    check("realtime: what it answered alone is kept as their ask and its say (their box), never said again by the pipeline's voice", said.some((n: Any) => n.kind === "ask" && n.text === "how are you") &&
      said.some((n: Any) => n.kind === "say" && n.text === "I'm good, thanks!" && !n.answers), said)
    // (its realtime voice paused, as the helper tells: in companion status, with why)
    ws.emit("message", JSON.stringify({ t: "realtime", paused: { account: "quota", why: "You have no credits remaining.", until: Date.now() + 600_000 } }))
    const st = await vau("companion", "status")
    check("realtime: companion status says it's paused, and why", /Realtime voice: paused, the OpenAI account has no credits \(You have no credits remaining\.\)/.test(st.out), st.out)
    ws.emit("close")
    await api("PATCH", "config/plugin/companion", { mode: mode ?? "quiet" })
  }
}
