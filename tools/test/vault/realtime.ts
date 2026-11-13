import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { WebSocketServer, type WebSocket } from "ws"
import type { Any, VaultTest } from "./harness.ts"
import { portOf } from "../../../core/listening.ts"

export default async ($: VaultTest) => {
  const { check, sleep } = $
  // The realtime voice front (electron/realtimefront.ts): the Talk key's audio to an OpenAI Realtime session, its answer
  // at once, a screen question handed to the summoned session. OpenAI is a stand-in socket; nothing plays.
  const { costOf, resampler, msOf } = await import("../../../electron/realtimelogic.ts")
  {
    const tone = (n: number, rate: number) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 300 * i) / rate) * 10_000), i * 2); return b }
    const whole = resampler()(tone(16_000, 16_000))
    const r = resampler(), parts = Buffer.concat([0, 1001, 4000, 9999, 16_000].slice(1).map((end, i, a) => r(tone(16_000, 16_000).subarray([0, ...a][i] * 2, end * 2))))
    let off = 0
    for (let i = 0; i < whole.length / 2; i++) off = Math.max(off, Math.abs(whole.readInt16LE(i * 2) - Math.round(Math.sin((2 * Math.PI * 300 * i) / 24_000) * 10_000)))
    check("realtime: the mic's 16 kHz made 24 kHz, the same tone, and the same in chunks as whole", Math.abs(whole.length / 2 - 24_000) <= 2 && off < 300 && parts.equals(whole), { n: whole.length / 2, off, parts: parts.length })
    check("realtime: an ask's cost from its usage (mini: audio in 10, cached 0.3, out 20 a million)", Math.abs(costOf("gpt-realtime-2.1-mini", { input_token_details: { text_tokens: 1000, audio_tokens: 500, cached_tokens: 800, cached_tokens_details: { text_tokens: 800, audio_tokens: 0 } }, output_token_details: { text_tokens: 20, audio_tokens: 200 } }) -
      (200 * 0.6 + 800 * 0.06 + 500 * 10 + 20 * 2.4 + 200 * 20) / 1e6) < 1e-12 && msOf(48_000) === 1000)
  }

  // ---------- the stand-in: OpenAI Realtime's events for small talk, and for a screen question (a tool call)
  let refuse = false, mute = false, broke = false, connections = 0, long = false // (long: its next answer is a story)
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
        if (long || (!m.response && !got.some((x) => x.type === "conversation.item.create"))) { long = false; storyId = id; story = setInterval(() => audio(200), 50); return }
        send({ type: "response.output_audio_transcript.delta", response_id: id, delta: m.response ? "(as told)" : `I'm good, thanks! (${bytes} bytes)` })
        audio(200); audio(200)
        send({ type: "response.done", response: { id, status: "completed", usage, output: [] } })
      }, 30)
    })
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const url = `ws://127.0.0.1:${portOf(server)}/v1/realtime`

  const { realtimeFront } = await import("../../../electron/realtimefront.ts")
  type Owner = { id: number }
  const rig = (o: { key?: boolean; pauseMs?: number } = {}) => {
    const ev: Any[] = []
    const f = realtimeFront<Owner>({
      config: async () => (o.key === false ? null : { url, key: "sk-test-1", model: "gpt-realtime-2.1-mini", voice: "cedar" }),
      name: () => "Claude",
      player: { stream: () => { const n = ev.filter((e) => e[0] === "stream").length + 1; ev.push(["stream", n]); return { pcm: (b: Buffer) => ev.push(["pcm", n, b.length]), end: () => ev.push(["end", n]), yield: (g?: number) => ev.push(["yield", n, g]) } }, stop: () => ev.push(["stop"]) },
      route: (owner, r) => ev.push(["route", owner.id, r]),
      log: (owner, t) => ev.push(["log", owner.id, t]),
      firstMs: 1000, routeMs: 3000, pauseMs: o.pauseMs,
      notice: (account, why) => ev.push(["notice", why, account]),
      paused: (p) => ev.push(["paused", p]),
    })
    return { f, ev }
  }
  const speak = (f: Any, ms = 600) => { for (let i = 0; i < ms / 100; i++) f.audio(Buffer.alloc(3200, 1)); f.speech() }
  const until = async (fn: () => unknown, ms = 3000) => { for (let i = 0; i < ms / 20 && !fn(); i++) await sleep(20); return !!fn() }
  const routes = (ev: Any[], id: number) => ev.filter((e) => e[0] === "route" && e[1] === id).map((e) => e[2])

  {
    // small talk: heard while held, answered alone on release; the summoned answer asked meanwhile is dropped
    const { f, ev } = rig()
    const p1 = { id: 1 }
    f.warm()
    f.press(p1)
    speak(f)
    await until(() => got.some((m) => m.type === "input_audio_buffer.append"))
    f.release("(Where they are: Notes.)")
    const took = f.heard(p1, "how are you")
    await until(() => routes(ev, 1).length)
    const update = got.find((m) => m.type === "session.update")?.session
    const appended = got.filter((m) => m.type === "input_audio_buffer.append").reduce((n, m) => n + m.n, 0)
    check("realtime: its session is the model and voice set, the key a header, PCM at 24 kHz both ways, no VAD (push to talk), one tool", auths[0] === "Bearer sk-test-1 gpt-realtime-2.1-mini" &&
      update?.audio.output.voice === "cedar" && update.audio.input.format.rate === 24_000 && update.audio.input.turn_detection === null && update.tools[0].name === "look_at_screen" && /look_at_screen/.test(update.instructions), update)
    const order = got.map((m) => m.type).filter((t) => t !== "input_audio_buffer.append" && t !== "session.update")
    check("realtime: held, the mic's audio streams (made 24 kHz); let go, where they are, the turn committed and answered", Math.abs(appended - 600 * 48) < 200 &&
      JSON.stringify(order) === JSON.stringify(["input_audio_buffer.clear", "conversation.item.create", "input_audio_buffer.commit", "response.create"]) && took === "held", { appended, order, took })
    const r = routes(ev, 1)[0], log = ev.find((e) => e[0] === "log")?.[2]
    check("realtime: small talk it answers alone, its audio played as it comes; its route says so (their words and its, for the box), timed and costed", ev.filter((e) => e[0] === "pcm").length === 2 && ev.some((e) => e[0] === "end") &&
      r?.to === "talk" && r.heard === "how are you" && /^I'm good/.test(r.said) && routes(ev, 1).length === 1 && log?.kind === "talk" && log.firstMs >= 0 && log.cost > 0 && !ev.some((e) => e[0] === "yield"), ev)
    // (a screen question: a few words, look_at_screen, and the summoned session's answer after them in the companion's voice)
    got.length = 0; ev.length = 0
    const p2 = { id: 2 }
    f.press(p2)
    speak(f)
    f.release("(Where they are: Mail, its window \"Inbox\".)")
    const held = f.heard(p2, "what does this button do")
    // (its tool's answer to the model can go after the turn's log: both waited for)
    await until(() => ev.some((e) => e[0] === "log") && got.some((m) => m.item?.type === "function_call_output"))
    const look = routes(ev, 2)
    check("realtime: a screen question: its few words played, its route `look` (the summoned answer goes after them, which they give way to), no read-back", held === "held" &&
      look.length === 1 && look[0].to === "look" && ev.some((e) => e[0] === "pcm") && ev.some((e) => e[0] === "yield" && e[2] === 0.25) &&
      got.filter((m) => m.type === "response.create").length === 1 && JSON.parse(got.find((m) => m.item?.type === "function_call_output")?.item.output ?? "{}").answer !== undefined, { ev, got: got.map((m) => m.type) })
    const lk = ev.find((e) => e[0] === "log")?.[2]
    check("realtime: a look's part is timed to its few words and costed alone (the answer isn't its)", lk?.kind === "look" && lk.firstMs >= 0 && lk.cost > 0 && lk.cost < 0.01, lk)
    f.answer(p2, "Sure, that's the Send button. It sends your reply to Alice.")
    await until(() => got.some((m) => m.type === "conversation.item.create" && /Send button/.test(JSON.stringify(m.item))))
    check("realtime: the summoned answer, whole, is told to its conversation (a follow-up knows it), and asks nothing", got.some((m) => m.type === "conversation.item.create" && /Send button/.test(JSON.stringify(m.item))) &&
      got.filter((m) => m.type === "response.create").length === 1 && f.talk().join("|") === `they: how are you|you: ${r.said}|they: what does this button do|you: Sure, that's the Send button. It sends your reply to Alice.`, f.talk())
    // (dictation's words after its route: the summoned answer goes straight after its few words)
    got.length = 0; ev.length = 0
    const p3 = { id: 3 }
    f.press(p3)
    speak(f)
    f.release("(Where they are: Mail, its window \"Inbox\".)")
    await until(() => routes(ev, 3).length)
    check("realtime: its route known before dictation's words, they're told it (`through`: no wait)", f.heard(p3, "and this one?") === "through", ev)
    await until(() => ev.some((e) => e[0] === "log"))
    // (barge-in: pressed while it speaks, it stops at once and the model hears how much was said; the old press hears nothing more)
    got.length = 0; ev.length = 0
    const p4 = { id: 4 }, p5 = { id: 5 }
    long = true // (still speaking when pressed again, however late the press: the turn before's last words can't end it)
    f.press(p4)
    speak(f)
    f.release()
    f.heard(p4, "tell me a story")
    await until(() => ev.some((e) => e[0] === "pcm"))
    // (what the press brings, from it on: the turn before can still be closing as it comes)
    const evAt = ev.length, gotAt = got.length
    f.press(p5)
    await until(() => got.slice(gotAt).some((m) => m.type === "conversation.item.truncate"))
    await sleep(100)
    check("realtime: the Talk key while it speaks stops its voice and response at once, the model told how much was heard; that press gets no route", ev.slice(evAt).some((e) => e[0] === "stop") &&
      got.slice(gotAt).some((m) => m.type === "conversation.item.truncate" && m.audio_end_ms >= 0) && !routes(ev, 4).length, got.map((m) => m.type))
    // (a press again right after let-go: the first press's words are the pipeline's alone, answered once)
    got.length = 0; ev.length = 0
    const p6 = { id: 6 }, p7 = { id: 7 }
    f.press(p6); speak(f); f.release()
    f.press(p7)
    await sleep(80)
    check("realtime: pressed again right after let-go, the first press is the pipeline's alone (no route, no answer of its own)", f.heard(p6, "what's this") === false && !routes(ev, 6).length &&
      !got.filter((m) => m.type === "response.create").length, ev)
    f.close()
  }
  {
    // the pipeline's: no speech (a drawn point), no key, or its socket refused
    const { f, ev } = rig()
    const p = { id: 1 }
    f.press(p); f.audio(Buffer.alloc(16_000)); f.release()
    check("realtime: a press with no speech in it (a point, a drawing) is the pipeline's", f.heard(p, "") === false)
    const off = rig({ key: false })
    off.f.press(p); speak(off.f); off.f.release()
    await sleep(50)
    check("realtime: without its key it's the pipeline's", off.f.heard(p, "hello") === false)
    refuse = true
    const q = { id: 2 }
    f.press(q); speak(f); f.release()
    await sleep(30)
    const took = f.heard(q, "what time is it")
    await until(() => routes(ev, 2).length || !took)
    check("realtime: its socket refused, the pipeline answers alone (its route says so, or dictation's words are the pipeline's)", took ? routes(ev, 2)[0]?.to === "pipeline" : true, ev)
    check("realtime: its key refused, it pauses (told once, why in its status) rather than trying each press", !f.available() && ev.filter((e) => e[0] === "notice").length === 1 &&
      ev.find((e) => e[0] === "notice")[2] === "auth" && ev.find((e) => e[0] === "paused")?.[1]?.account === "auth" && /401/.test(ev.find((e) => e[0] === "paused")[1].why), ev)
    refuse = false
    mute = true
    const quiet = rig(), r = { id: 3 }
    quiet.f.press(r); speak(quiet.f); quiet.f.release(); quiet.f.heard(r, "still there?")
    check("realtime: an answer that doesn't come in time is the pipeline's, and a slip like that pauses nothing", await until(() => routes(quiet.ev, 3)[0]?.to === "pipeline", 6000) &&
      quiet.f.available() && !quiet.ev.some((e) => e[0] === "notice" || e[0] === "paused"), quiet.ev)
    mute = false
    // (its socket dying after its few words and route: the summoned answer goes on as it is, nothing said again)
    got.length = 0
    const dying = rig(), d = { id: 4 }
    dying.f.press(d); speak(dying.f); dying.f.release("(Where they are: Mail, its window \"Inbox\".)"); dying.f.heard(d, "what's this button")
    await until(() => routes(dying.ev, 4).length)
    for (const c of wss.clients) c.terminate()
    await sleep(100)
    check("realtime: its socket dying after the look goes, the answer after its few words stands: one route, none of the pipeline's", routes(dying.ev, 4).length === 1 && routes(dying.ev, 4)[0].to === "look", dying.ev)
    f.close(); off.f.close(); quiet.f.close(); dying.f.close()
  }
  {
    // an account with no credits: one press fails over, the voice pauses (told once), presses skip it, one try later
    broke = true
    const { f, ev } = rig({ pauseMs: 600 })
    const p = { id: 1 }
    f.warm(); f.press(p); speak(f); f.release()
    await sleep(100)
    const took = f.heard(p, "are you there")
    if (took) await until(() => routes(ev, 1).length)
    const before = connections, asked = got.filter((m) => m.type === "response.create").length, q = { id: 2 }
    f.press(q); speak(f); f.release()
    await sleep(50)
    check("realtime: no credits, the press fails over, the user told once, and the next press skips it (no socket, no try)", (took ? routes(ev, 1)[0]?.to === "pipeline" : true) && f.heard(q, "again?") === false &&
      !f.available() && connections === before && got.filter((m) => m.type === "response.create").length === asked && ev.filter((e) => e[0] === "notice").length === 1 && /no credits/.test(ev.find((e) => e[0] === "notice")[1]), ev)
    await until(() => got.some((m) => m.type === "response.create" && m.response?.conversation === "none"), 3000)
    await sleep(100)
    check("realtime: paused a while, it tries once in the background (a word, outside the conversation); still refused, still paused, not told again",
      got.some((m) => m.type === "response.create" && m.response?.conversation === "none" && m.response.output_modalities[0] === "text") && !f.available() && ev.filter((e) => e[0] === "notice").length === 1, got.map((m) => m.type))
    broke = false
    // (on its next try, after another pause: a slow machine takes a while, so it's waited for, not timed)
    await until(() => f.available() && ev.some((e) => e[0] === "paused" && e[1] === null), 10_000)
    const r = { id: 3 }
    f.press(r); speak(f); f.release()
    const took3 = await until(() => ["held", "done"].includes(String(f.heard(r, "hello again"))), 3000)
    check("realtime: paid again, its next try finds it back, and presses go to it", f.available() && !!took3 && ev.some((e) => e[0] === "paused" && e[1] === null), ev)
    await until(() => routes(ev, 3).length)
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
    process.env.VAULTITE_OPENAI_API = `http://127.0.0.1:${portOf(rest)}`
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
      said.some((n: Any) => n.kind === "say" && n.text === "I'm good, thanks!" && n.answers?.realtime), said)
    // (its realtime voice paused, as the helper tells: in companion status, with why)
    ws.emit("message", JSON.stringify({ t: "realtime", paused: { account: "quota", why: "You have no credits remaining.", until: Date.now() + 600_000 } }))
    const st = await vau("companion", "status")
    check("realtime: companion status says it's paused, and why", /Realtime voice: paused, the OpenAI account has no credits \(You have no credits remaining\.\)/.test(st.out), st.out)
    ws.emit("close")
    await api("PATCH", "config/plugin/companion", { mode: mode ?? "quiet" })
  }
}
