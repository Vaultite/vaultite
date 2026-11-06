import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { WebSocketServer, type WebSocket } from "ws"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check, tmp, sleep } = $
  // The companion's voice (electron/voice.ts): words made plain and cut as they stream, made ahead, played in order, this
  // Mac's from where the cloud stopped. Nothing plays a sound: the player writes a file, the cloud is a stand-in.
  const { chunker, languageOf, speakable } = await import("../../../plugins/core/companion/spoken.ts")
  {
    check("voice: Markdown said as plain words: no code, ids or addresses, a link by its words",
      speakable("Click **Share** (a3), then see [the guide](https://x.com/g) or https://example.com/a. Run:\n```\nnpm test\n```\nDone 🎉") ===
        "Click Share, then see the guide or this link. Run: Done", speakable("x"))
    check("voice: a list's items and a heading end with a breath; arrows are said", speakable("## Steps\n- Open Settings → General\n- Pick one") === "Steps. Open Settings to General. Pick one",
      speakable("## Steps\n- Open Settings → General\n- Pick one"))
    const c = chunker(), whole = "Sure. That's the Share button: click it, then pick who. Version 3.5 is out. It has e.g. a new look. And"
    const got: [number, string][] = []
    for (let i = 1; i <= whole.length; i++) for (const p of c.feed(whole.slice(0, i))) got.push([i, p])
    check("voice: its first sentence goes as soon as it ends (at the next space), not a number's dot nor e.g.", got[0]?.[1] === "Sure." && got[0][0] === 6 &&
      got.map((g) => g[1]).join(" ") === "Sure. That's the Share button: click it, then pick who. Version 3.5 is out. It has e.g. a new look." && c.flush() === "And", got)
    const many = chunker(), ready = many.feed("One. Two is here. Three is too. Four")
    check("voice: after the first, the sentences that are all here go together", JSON.stringify(ready) === '["One.","Two is here. Three is too."]', ready)
    const code = chunker(), inCode = code.feed("Run this:\n```\nls. a. b. \n```\nThen go. ")
    check("voice: never cut inside code, which isn't said", JSON.stringify(inCode) === '["Run this:","Then go."]', inCode)
    const long = chunker(), clause = long.feed(`${"word ".repeat(22)}and then, ${"more ".repeat(12)}`)
    check("voice: a long sentence is cut at a clause", clause.length === 1 && clause[0].endsWith("then,"), clause)
    check("voice: the language of its words, of the user's (Portuguese, English)", languageOf("Claro, esse botão abre a janela de compartilhar.", ["en", "pt"]) === "pt" &&
      languageOf("Sure, that button opens the share sheet.", ["pt", "en"]) === "en" && languageOf("Ok.", ["pt", "en"]) === "pt" && languageOf("Olá", ["en"]) === "en")
  }

  // ---------- the voice of an answer: pieces ahead, in order, the fallback, stopping
  const { voice } = await import("../../../electron/voicelogic.ts")
  type Ev = [string, ...unknown[]]
  const rig = (o: { cloud?: boolean; firstMs?: number } = {}) => {
    const out: Ev[] = [], made: { n: number; text: string; to: Any; cancelled: boolean }[] = []
    const cloud = { make: (p: Any, to: Any) => { const m = { n: p.n, text: p.text, to, cancelled: false }; made.push(m); return () => { m.cancelled = true } } }
    const v = voice({ cloud: () => (o.cloud === false ? null : cloud), hints: () => ["en", "pt"], ahead: 2, firstMs: o.firstMs ?? 5000, stallMs: 5000,
      out: { pcm: (n, b) => out.push(["pcm", n, b.length]), say: (n, t, l) => out.push(["say", n, t, l]), end: (n) => out.push(["end", n]), stop: () => out.push(["stop"]) } })
    return { v, out, made }
  }
  const pcm = (s: number) => Buffer.alloc(Math.round(s * 48_000))
  {
    const { v, out, made } = rig()
    v.start("what is this")
    v.text("s1", "One. Two. Three. Four. Five. ")
    check("voice: the next pieces are made ahead, a few at a time", made.length === 2 && made[0].text === "One." && made[1].text === "Two. Three. Four. Five.", made.map((m) => m.text))
    made[1].to.audio(pcm(0.1)); made[1].to.end()
    check("voice: a later piece made first waits for the one before", !out.some((e) => e[1] === made[1].n), out)
    made[0].to.audio(pcm(0.2)); made[0].to.audio(pcm(0.2))
    check("voice: the first piece plays as its audio comes", out.filter((e) => e[0] === "pcm" && e[1] === made[0].n).length === 2, out)
    made[0].to.end()
    check("voice: then the next, in order, each told its end", JSON.stringify(out.map((e) => e.slice(0, 2))) === JSON.stringify([["pcm", 1], ["pcm", 1], ["end", 1], ["pcm", 2], ["end", 2]]), out)
  }
  {
    const { v, out, made } = rig()
    v.start()
    v.text("s1", "Hello there. This sentence is cut off midway by a dropped socket. ")
    v.text("s1", "Hello there. This sentence is cut off midway by a dropped socket. And this one waits. ")
    made[0].to.audio(pcm(0.5)); made[0].to.end()
    // (half a second of "This sentence is cut off": its characters timed, the socket gone)
    const text = made[1].text, chars = [...text], ends = chars.map((_c, i) => (i + 1) * 0.04)
    made[1].to.audio(pcm(0.5), { chars, ends })
    made[1].to.fail("the socket closed")
    const says = out.filter((e) => e[0] === "say")
    check("voice: a dropped socket mid-piece: this Mac's voice goes on from the next word its audio hadn't said", says.length === 2 &&
      says[0][1] === made[1].n && String(says[0][2]) === text.slice(text.indexOf(" ", 12)).trim() && says[1][2] === "And this one waits." && says[0][3] === "en", { says, text })
    check("voice: the pieces still being made are let go", made.slice(2).every((m) => m.cancelled), made)
    v.text("s1", "Hello there. This sentence is cut off midway by a dropped socket. And this one waits. Then this. ")
    check("voice: and the rest of the answer is this Mac's", out.at(-2)?.[0] === "say" && out.at(-2)?.[2] === "Then this." && made.length === 3, out)
  }
  {
    const { v, out } = rig({ cloud: false })
    v.start("o que é isso")
    v.text("s1", "Isso é o botão de compartilhar. Clique nele")
    v.end()
    check("voice: no cloud voice (no key): this Mac's says each piece, in the answer's language", JSON.stringify(out.filter((e) => e[0] === "say").map((e) => [e[2], e[3]])) ===
      '[["Isso é o botão de compartilhar.","pt"],["Clique nele","pt"]]', out)
  }
  {
    const { v, out, made } = rig({ firstMs: 60 })
    v.start()
    v.text("s1", "Slow. ")
    await sleep(120)
    check("voice: a piece whose first audio is late is this Mac's", out.some((e) => e[0] === "say" && e[2] === "Slow.") && made[0].cancelled, out)
  }
  {
    const { v, out, made } = rig()
    v.start()
    v.text("s1", "First answer. It goes on. ")
    made[0].to.audio(pcm(0.2))
    v.stop()
    made[0].to.audio(pcm(0.2)); made[1]?.to.end()
    check("voice: stopped, it's silenced at once, what it was making let go, and what comes late is dropped", out.at(-1)?.[0] === "stop" && made.every((m) => m.cancelled) &&
      out.filter((e) => e[0] === "pcm").length === 1, out)
    v.text("s1", "First answer. It goes on. More words. ")
    check("voice: and its says' words after that aren't spoken", out.at(-1)?.[0] === "stop", out)
    const before = made.length
    v.start("again")
    v.text("s2", "Second answer. ")
    check("voice: a new answer after it speaks again", made.length === before + 1 && made.at(-1)!.text === "Second answer.", made)
  }

  // ---------- the helper's say: its settings, and its cursor speaking (a level, sent as a place)
  {
    const { prefsOf, sceneFor, splitScene } = await import("../../../electron/helperlogic.ts")
    const decls = { dictation: {}, screen: {}, companion: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../../plugins/core/companion/manifest.json"), "utf8")).settings }
    const def = prefsOf({}, {}, {}, decls).voice, set = prefsOf({}, { voice: "always", voice_name: "Larissa", voice_speed: 3 }, {}, decls).voice
    check("voice: its settings, the manifest's defaults (when you speak, Hazel), a speed kept in range", def.mode === "auto" && def.name === "Hazel" && def.speed === 1 &&
      set.mode === "always" && set.name === "Larissa" && set.speed === 1.3, { def, set })
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }
    const scene = (level: number) => sceneFor(d, { agents: [], summon: null, ink: null, pill: null, speaking: { name: "Claude", level } }, { x: 1, y: 1 }, [d])
    const a = splitScene(scene(0.2)), b = splitScene(scene(0.8))
    check("voice: its level changes only the places the overlay is sent, not what it draws", a.shape === b.shape && a.at.level === 0.2 && b.at.level === 0.8 && a.shape.includes('"speaking":{"name":"Claude"}'), { a, b })
  }

  // ---------- Soniox's TTS, stood in: its socket, a stream per piece, cancel, a dropped socket
  {
    const { cloudVoice } = await import("../../../electron/tts.ts")
    const server = http.createServer(), wss = new WebSocketServer({ server })
    const got: Any[] = [], auths: string[] = []
    let sock: WebSocket | null = null
    wss.on("connection", (ws, req) => {
      sock = ws
      auths.push(String(req.headers.authorization))
      ws.on("message", (d) => {
        const m = JSON.parse(String(d))
        got.push(m)
        if (m.text_end) {
          const audio = Buffer.alloc(4800).toString("base64")
          ws.send(JSON.stringify({ stream_id: m.stream_id, audio, audio_end: false, timestamps: { characters: [...m.text].slice(0, 3), character_end_times_seconds: [0.01, 0.02, 0.03] } }))
          if (!m.text.includes("hold")) { ws.send(JSON.stringify({ stream_id: m.stream_id, audio, audio_end: true })); ws.send(JSON.stringify({ stream_id: m.stream_id, terminated: true })) }
        }
      })
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    const url = `ws://127.0.0.1:${(server.address() as Any).port}`
    const c = cloudVoice({ provider: "soniox", url, key: "test-key-1", model: "tts-rt-v2", voice: "Hazel", speed: 1.1 })
    const heard: Any[] = []
    const to = (n: number) => ({ audio: (b: Buffer, t?: Any) => heard.push(["audio", n, b.length, t?.chars.length]), end: () => heard.push(["end", n]), fail: (w: string) => heard.push(["fail", n, w]) })
    c.make({ n: 1, text: "Hello there.", language: "en" }, to(1))
    for (let i = 0; i < 100 && !heard.some((h) => h[0] === "end"); i++) await sleep(20)
    const config = got.find((m) => m.model)
    check("tts: Soniox's socket with the key as a header, a stream's config (its voice, PCM at 24 kHz, timings) then its text, whole", auths[0] === "Bearer test-key-1" && !config?.api_key &&
      config?.voice === "Hazel" && config.audio_format === "pcm_s16le" && config.sample_rate === 24000 && config.return_timestamps === true && config.language === "en" && config.speed === 1.1 &&
      got.some((m) => m.stream_id === config.stream_id && m.text === "Hello there." && m.text_end === true), got)
    check("tts: its audio comes, with its characters' timings, then its end", JSON.stringify(heard) === '[["audio",1,4800,3],["audio",1,4800,3],["end",1]]', heard)
    const cancel = c.make({ n: 2, text: "Please hold.", language: "en" }, to(2))
    for (let i = 0; i < 100 && !heard.some((h) => h[1] === 2); i++) await sleep(20)
    cancel()
    for (let i = 0; i < 50 && !got.some((m) => m.cancel); i++) await sleep(20)
    check("tts: a piece let go is cancelled on the socket", got.some((m) => m.cancel === true && !("text" in m)), got)
    c.make({ n: 3, text: "Please hold on.", language: "en" }, to(3))
    for (let i = 0; i < 100 && !heard.some((h) => h[1] === 3); i++) await sleep(20)
    sock!.terminate()
    for (let i = 0; i < 100 && !heard.some((h) => h[0] === "fail"); i++) await sleep(20)
    check("tts: its socket dropped mid-piece, the piece fails (and this Mac's voice takes over)", heard.some((h) => h[0] === "fail" && h[1] === 3), heard)
    c.close()
    wss.close(); server.close()
  }

  // ---------- the player (voice.swift): writes a file here, never the speakers
  let tools = process.platform === "darwin"
  try { if (tools) execFileSync("/usr/bin/xcode-select", ["-p"], { stdio: "ignore" }) } catch { tools = false }
  if (tools) {
    const { buildVoice } = await import("../../../electron/voice-build.ts")
    const bin = await buildVoice(path.join(tmp, "voice-helper"))
    const wav = path.join(tmp, "voice.wav")
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, VOICE_OUT: wav } })
    const lines: Any[] = []
    let buf = ""
    child.stdout.on("data", (b: Buffer) => { buf += b; for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) try { lines.push(JSON.parse(buf.slice(0, i))) } catch { /* not JSON */ } })
    const send = (m: object) => child.stdin.write(JSON.stringify(m) + "\n")
    // (a second of a 220 Hz tone, as a cloud voice's PCM)
    const tone = Buffer.alloc(48_000)
    for (let i = 0; i < 24_000; i++) tone.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / 24_000) * 8000), i * 2)
    send({ cmd: "say", n: 2, text: "And then this Mac's own voice.", language: "en" })
    for (let i = 0; i < tone.length; i += 9600) send({ cmd: "pcm", n: 1, data: tone.subarray(i, i + 9600).toString("base64") })
    send({ cmd: "end", n: 1 }); send({ cmd: "end", n: 2 })
    for (let i = 0; i < 300 && !lines.some((l) => l.type === "done" && l.n === 2); i++) await sleep(20)
    const order = lines.filter((l) => l.type === "start" || l.type === "done").map((l) => `${l.type}${l.n}`).join()
    check("voice player: pieces play in order, a cloud's PCM and then this Mac's voice made for the next, each told done", order === "start1,done1,start2,done2", lines.filter((l) => l.type !== "level"))
    check("voice player: its level as it plays", lines.some((l) => l.type === "level" && l.v > 0.3), lines.filter((l) => l.type === "level").slice(0, 5))
    send({ cmd: "pcm", n: 3, data: tone.toString("base64") })
    send({ cmd: "stop" })
    for (let i = 0; i < 100 && !lines.some((l) => l.type === "stopped"); i++) await sleep(20)
    child.stdin.end()
    await new Promise((done) => child.once("exit", done))
    const info = execFileSync("/usr/bin/afinfo", [wav], { encoding: "utf8" })
    const secs = Number(/estimated duration: ([\d.]+)/.exec(info)?.[1])
    const data = fs.readFileSync(wav)
    let peak = 0
    // (the words this Mac's voice said, between the two tones)
    for (let i = 44 + 48_000; i < data.length - 48_000; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)))
    check("voice player: what it played is the tone and the words said after it, not silence", secs > 2 && secs < 8 && peak > 300 && lines.some((l) => l.type === "stopped"), { secs, peak })
  }
}
