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
  const { chunker, languageIn, languageOf, sayable, speakable } = await import("../../../plugins/core/companion/spoken.ts")
  {
    check("voice: Markdown said as plain words: no code, ids or addresses, a link by its words",
      speakable("Click **Share** (a3), then see [the guide](https://x.com/g) or https://example.com/a. Run:\n```\nnpm test\n```\nDone 🎉") ===
        "Click Share, then see the guide or this link. Run: Done", speakable("x"))
    check("voice: a list's items and a heading end with a breath; arrows are said", speakable("## Steps\n- Open Settings → General\n- Pick one") === "Steps. Open Settings to General. Pick one",
      speakable("## Steps\n- Open Settings → General\n- Pick one"))
    const c = chunker(), whole = "Sure. That's the Share button: click it, then pick who. Version 3.5 is out. It has e.g. a new look. And"
    const got: [number, string][] = []
    for (let i = 1; i <= whole.length; i++) for (const p of c.feed(whole.slice(0, i))) got.push([i, p])
    check("voice: its first sentence goes as soon as it ends (the next word begun), not a number's dot nor e.g.", got[0]?.[1] === "Sure." && got[0][0] === 7 &&
      got.map((g) => g[1]).join(" ") === "Sure. That's the Share button: click it, then pick who. Version 3.5 is out. It has e.g. a new look." && c.flush() === "And", got)
    const many = chunker(), ready = many.feed("One. Two is here. Three is too. Four")
    check("voice: after the first, the sentences that are all here go together", JSON.stringify(ready) === '["One.","Two is here. Three is too."]', ready)
    const code = chunker(), inCode = [...code.feed("Run this:\n```\nls. a. b. \n```\nThen go. "), code.flush()]
    check("voice: never cut inside code, which isn't said", JSON.stringify(inCode) === '["Run this:","Then go."]', inCode)
    const abbr = chunker(), months = [...abbr.feed("Foi de 30 de out. a 3 de nov. Depois, nada. E"), abbr.flush()]
    check("voice: a dot before a lowercase word isn't a sentence's end (30 de out. a 3)", JSON.stringify(months) === '["Foi de 30 de out. a 3 de nov.","Depois, nada.","E"]', months)
    const long = chunker(), clause = long.feed(`${"word ".repeat(22)}and then, ${"more ".repeat(12)}`)
    check("voice: a long sentence is cut at a clause", clause.length === 1 && clause[0].endsWith("then,"), clause)
    check("voice: the language of its words, of the user's (Portuguese, English)", languageOf("Claro, esse botão abre a janela de compartilhar.", ["en", "pt"]) === "pt" &&
      languageOf("Sure, that button opens the share sheet.", ["pt", "en"]) === "en" && languageOf("Ok.", ["pt", "en"]) === "pt" && languageOf("Olá", ["en"]) === "en" && languageIn("Ok?") === null && languageIn("o que é isso?") === "pt")
  }

  {
    const said = (t: string, l = "en") => sayable(t, l)
    const cases: [string, string, string][] = [
      ["It ran Oct 30 – Nov 3, ~2-3 AM.", "en", "It ran October 30th to November 3rd, about 2 to 3 AM."],
      ["Due 11/05, see v0.1.209, e.g. the logs, etc.", "en", "Due November 5th, see version 0.1.209, for example the logs, et cetera."],
      ["On 2026-11-05 it's ~40% faster vs. before, i.e. quick.", "en", "On November 5th, 2026 it's about 40% faster versus before, that is quick."],
      ["Version 3.5 is out at 14:30; Nov 22nd ships, May 1 too", "en", "Version 3.5 is out at 14:30; November 22nd ships, May 1st too"],
      ["Vence 05/11, uns ~2-3 dias, ex.: o log, etc.", "pt", "Vence 5 de novembro, uns 2 a 3 dias, por exemplo o log, etcetera."],
      ["Foi de 30 de out. a 3 de nov.", "pt", "Foi de 30 de outubro a 3 de novembro."],
    ]
    const wrong = cases.filter(([t, l, want]) => said(t, l) !== want).map(([t, l]) => [t, said(t, l)])
    check("voice: what a voice misreads said as words: months and dates, ranges, ~, versions, e.g. and etc. (English and Portuguese)", !wrong.length, wrong)
  }

  // ---------- the voice of an answer: pieces ahead, in order, the fallback, stopping
  const { voice } = await import("../../../electron/voicelogic.ts")
  type Ev = [string, ...unknown[]]
  const rig = (o: { cloud?: boolean; firstMs?: number } = {}) => {
    const out: Ev[] = [], made: { n: number; text: string; to: Any; cancelled: boolean }[] = []
    const cloud = { make: (p: Any, to: Any) => { const m = { n: p.n, text: p.text, to, cancelled: false }; made.push(m); return () => { m.cancelled = true } } }
    const v = voice({ clouds: () => (o.cloud === false ? [] : [cloud]), hints: () => ["en", "pt"], ahead: 2, firstMs: o.firstMs ?? 5000, stallMs: 5000,
      out: { pcm: (n, b) => out.push(["pcm", n, b.length]), say: (n, t, l) => out.push(["say", n, t, l]), end: (n) => out.push(["end", n]), stop: () => out.push(["stop"]) } })
    return { v, out, made }
  }
  const pcm = (s: number) => Buffer.alloc(Math.round(s * 48_000))
  {
    const { v, out, made } = rig()
    v.start("what is this")
    v.text("s1", "One. Two. Three. Four. Five. Six")
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
    v.text("s1", "Hello there. This sentence is cut off midway by a dropped socket. And")
    v.text("s1", "Hello there. This sentence is cut off midway by a dropped socket. And this one waits. Then")
    made[0].to.audio(pcm(0.5)); made[0].to.end()
    // (half a second of "This sentence is cut off": its characters timed, the socket gone)
    const text = made[1].text, chars = [...text], ends = chars.map((_c, i) => (i + 1) * 0.04)
    made[1].to.audio(pcm(0.5), { chars, ends })
    made[1].to.fail("the socket closed")
    const says = out.filter((e) => e[0] === "say")
    check("voice: a dropped socket mid-piece: this Mac's voice goes on from the next word its audio hadn't said", says.length === 2 &&
      says[0][1] === made[1].n && String(says[0][2]) === text.slice(text.indexOf(" ", 12)).trim() && says[1][2] === "And this one waits." && says[0][3] === "en", { says, text })
    check("voice: the pieces still being made are let go", made.slice(2).every((m) => m.cancelled), made)
    v.text("s1", "Hello there. This sentence is cut off midway by a dropped socket. And this one waits. Then this. More")
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
    // (its sentences as heard: the player's start of each piece, the cloud's timing of its characters)
    const heard: Any[] = [], made: Any[] = []
    const cloud = { make: (p: Any, to: Any) => { made.push({ p, to }); return () => {} } }
    const v = voice({ clouds: () => [cloud], hints: () => ["en"], firstMs: 5000, stallMs: 5000, heard: (h) => heard.push(h),
      out: { pcm() {}, say() {}, end() {}, stop() {} } })
    v.start()
    v.text("s1", "First one here. Second one too. Third. X")
    const two = made[1], chars = [...two.p.text], ends = chars.map((_c: string, i: number) => Math.round((i + 1) * 100) / 1000)
    two.to.audio(pcm(2.2), { chars, ends })
    v.played(two.p.n, 5000)
    const early = heard.map((h) => h.text)
    two.to.end()
    check("voice: each sentence as heard, from its piece's start and its characters' timing (the last once all of it's made)", two.p.text === "Second one too. Third." &&
      JSON.stringify(early) === '["Second one too."]' && JSON.stringify(heard) === '[{"say":"s1","text":"Second one too.","at":5000,"dur":1500},{"say":"s1","text":"Third.","at":6600,"dur":600}]', heard)
    v.played(made[0].p.n, 3000)
    check("voice: none told for a piece without its timing, while it's still being made", heard.length === 2, heard)
    made[0].to.audio(pcm(1))
    made[0].to.end()
    check("voice: a cloud's piece that gave no timing tells its sentences by its audio's length, from the player's start", JSON.stringify(heard[2]) === '{"say":"s1","text":"First one here.","at":3000,"dur":1000}', heard)
    // (this Mac's voice: no audio here, its length the player's)
    const mac: Any[] = [], said: Any[] = []
    const m = voice({ clouds: () => [], hints: () => ["en"], heard: (h) => mac.push(h), out: { pcm() {}, say: (n) => said.push(n), end() {}, stop() {} } })
    m.start()
    m.text("s2", "One two three four. Five six seven. ")
    m.end()
    m.played(said[0], 1000)
    m.length(said[0], 3)
    check("voice: this Mac's piece tells its sentences over its length as the player says it, each by its share of the words",
      mac.length === 1 && mac[0].at === 1000 && mac[0].dur === 3000 && said.length === 2, [mac, said])
  }
  {
    const { v, out } = rig({ cloud: false })
    v.start("", "pt")
    v.text("s1", "Ok. Sure thing. ")
    check("voice: an answer in the language its ask was in, when that's known", out.filter((e) => e[0] === "say").every((e) => e[3] === "pt") && out.some((e) => e[0] === "say"), out)
  }
  {
    // (ElevenLabs first, Soniox when it fails, this Mac's when both have)
    const out: Ev[] = [], made: { by: string; n: number; text: string; to: Any; cancelled: boolean }[] = []
    const cloud = (by: string) => ({ make: (p: Any, to: Any) => { const m = { by, n: p.n, text: p.text, to, cancelled: false }; made.push(m); return () => { m.cancelled = true } } })
    const chain = [cloud("eleven"), cloud("soniox")]
    const v = voice({ clouds: () => chain, hints: () => ["en"], ahead: 2, firstMs: 5000, stallMs: 5000,
      out: { pcm: (n, b) => out.push(["pcm", n, b.length]), say: (n, t, l) => out.push(["say", n, t, l]), end: (n) => out.push(["end", n]), stop: () => out.push(["stop"]) } })
    v.start()
    v.text("s1", "One two three four five six. Next one here. ")
    v.end()
    const first = made[0], text = first.text, chars = [...text], ends = chars.map((_c, i) => (i + 1) * 0.05)
    first.to.audio(pcm(0.42), { chars, ends })
    first.to.fail("the socket closed")
    const next = made.filter((m) => m.by === "soniox")
    check("voice: the first cloud voice dropped mid-piece, the next makes the rest of it from the next word, and the pieces after",
      next.length === 2 && next[0].n === first.n && next[0].text === text.slice(8) && next[1].text === "Next one here." && made[1].cancelled, made.map((m) => [m.by, m.text, m.cancelled]))
    next[0].to.audio(pcm(0.2)); next[0].to.fail("refused")
    check("voice: and when that one fails too, this Mac's", out.filter((e) => e[0] === "say").length === 2 && out.filter((e) => e[0] === "pcm" && e[1] === first.n).length === 2, out)
  }
  {
    const { v, out, made } = rig({ firstMs: 60 })
    v.start()
    v.text("s1", "Slow. ")
    v.end()
    await sleep(120)
    check("voice: a piece whose first audio is late is this Mac's", out.some((e) => e[0] === "say" && e[2] === "Slow.") && made[0].cancelled, out)
  }
  {
    const out: Ev[] = [], made: Any[] = [], told: Any[] = []
    const w = voice({ clouds: () => [{ make: (_p: Any, to: Any) => { made.push({ to }); return () => {} } }], hints: () => ["en"], told: (e) => told.push(e),
      out: { pcm: (n, b) => out.push(["pcm", n, b.length]), say: (n, t, l) => out.push(["say", n, t, l]), end: (n) => out.push(["end", n]), stop: () => out.push(["stop"]) } })
    w.start()
    w.text("s1", "Out of credits. ")
    w.end()
    made.at(-1)!.to.end()
    check("voice: a cloud voice that ends a piece with no audio (out of credits) hands its words to the next voice, told so (not as slow)",
      out.some((e) => e[0] === "say" && e[2] === "Out of credits.") && told.some((e) => e.t === "fallback" && e.why === "it made no audio" && !e.slow), { out, told })
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
    v.end()
    check("voice: a new answer after it speaks again", made.length === before + 1 && made.at(-1)!.text === "Second answer.", made)
  }

  // ---------- the helper's say: its settings, and its cursor speaking (a level, sent as a place)
  {
    const { prefsOf, sceneFor, splitScene } = await import("../../../electron/helperlogic.ts")
    const decls = { dictation: {}, screen: {}, companion: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../../plugins/core/companion/manifest.json"), "utf8")).settings }
    const def = prefsOf({}, {}, {}, decls).voice, set = prefsOf({}, { voice: "always", voice_name: "Larissa", voice_speed: 3 }, {}, decls).voice
    check("voice: its settings, the manifest's defaults (when you speak; ElevenLabs' Brian first, Soniox's Adrian), a speed kept in range", def.mode === "auto" && def.name === "Adrian" && def.speed === 1 && def.provider === "auto" && def.eleven.voice === "nPczCjzI2devNBz1zQrb" && def.eleven.model === "eleven_flash_v2_5" &&
      set.mode === "always" && set.name === "Larissa" && set.speed === 1.3, { def, set })
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }
    const scene = (level: number) => sceneFor(d, { agents: [], summon: null, pill: null, speaking: { name: "Claude", level } }, { x: 1, y: 1 }, [d])
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
  {
    const { cloudVoice } = await import("../../../electron/tts.ts")
    const server = http.createServer(), wss = new WebSocketServer({ server })
    const got: Any[] = [], seen: { url: string; key: string }[] = []
    wss.on("connection", (ws, req) => {
      seen.push({ url: String(req.url), key: String(req.headers["xi-api-key"]) })
      // (as it was heard to: a context closed ends at once with its final word, its audio still to come dropped; one
      // whose text says "early" gets that word between its chunks; "bare" has no timings)
      ws.on("message", (d) => {
        const m = JSON.parse(String(d))
        got.push(m)
        if (m.close_context) return void ws.send(JSON.stringify({ audio: null, isFinal: true, contextId: m.context_id }))
        if (!m.flush) return
        const audio = Buffer.alloc(24_000).toString("base64"), id = m.context_id, bare = /bare/.test(m.text)
        const timed = (chars: string[]) => (bare ? {} : { alignment: { chars, charStartTimesMs: chars.map((_, i) => i * 50), charDurationsMs: chars.map(() => 50) } })
        const words = [...String(m.text)], half = Math.ceil(words.length / 2)
        ws.send(JSON.stringify({ audio, contextId: id, ...timed(words.slice(0, half)) }))
        if (/early/.test(m.text)) ws.send(JSON.stringify({ audio: null, isFinal: true, contextId: id }))
        setTimeout(() => { if (ws.readyState === ws.OPEN && !got.some((x) => x.close_context && x.context_id === id)) ws.send(JSON.stringify({ audio, contextId: id, ...timed(words.slice(half)) })) }, 120)
      })
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    const c = cloudVoice({ provider: "elevenlabs", url: `ws://127.0.0.1:${(server.address() as Any).port}`, key: "eleven-key-1", model: "eleven_flash_v2_5", voice: "nPczCjzI2devNBz1zQrb", speed: 1.1 })
    const heard: Any[] = []
    let timed: Any = null
    c.make({ n: 1, text: "Hi there.", language: "en" }, { audio: (b: Buffer, t?: Any) => { heard.push(["audio", b.length]); timed = t }, end: () => heard.push(["end"]), fail: (w: string) => heard.push(["fail", w]) })
    for (let i = 0; i < 100 && !heard.some((h) => h[0] === "end"); i++) await sleep(20)
    const piece = async (text: string) => {
      const h: string[] = [], t0 = Date.now()
      c.make({ n: 2, text, language: "en" }, { audio: () => h.push("audio"), end: () => h.push("end"), fail: (w: string) => h.push(`fail ${w}`) })
      for (let i = 0; i < 150 && !h.includes("end"); i++) await sleep(20)
      return { h: h.join(), ms: Date.now() - t0 }
    }
    const early = await piece("Its final word comes early."), bare = await piece("No timings, bare.")
    const u = new URL(seen[0]?.url ?? "/", "http://x")
    check("tts: ElevenLabs' socket for its voice and model, PCM at 24 kHz with timings, the key as a header", u.pathname === "/v1/text-to-speech/nPczCjzI2devNBz1zQrb/multi-stream-input" &&
      u.searchParams.get("model_id") === "eleven_flash_v2_5" && u.searchParams.get("output_format") === "pcm_24000" && u.searchParams.get("sync_alignment") === "true" && seen[0].key === "eleven-key-1", seen)
    const first = got.filter((m) => m.context_id === got[0]?.context_id)
    check("tts: a context per piece, opened, its text flushed, closed only once its audio is all in, at the speed set", first[0]?.text === " " && first[0].voice_settings?.speed === 1.1 &&
      first[1]?.text === "Hi there. " && first[1].flush === true && first[2]?.close_context === true && first.length === 3, got)
    check("tts: all its audio, then its end (the bug: closed with its text, it ended after its first chunk); timings follow the audio before",
      JSON.stringify(heard) === '[["audio",24000],["audio",24000],["end"]]' && JSON.stringify(timed?.ends?.slice(0, 3)) === "[0.05,0.1,0.15]" && timed?.ends?.[5] === 0.55, { heard, timed })
    check("tts: its final word before its last audio: that audio is still said, then it ends", early.h === "audio,audio,end", early)
    check("tts: audio without timings ends once it goes quiet a moment", bare.h === "audio,audio,end" && bare.ms >= 1000 && bare.ms < 2500, bare)
    c.close()
    wss.close(); server.close()
  }

  // ---------- ElevenLabs' key: this machine's, checked by a word said, never in the vault
  {
    const { api, vau } = { api: $.api, vau: $.vars.vau as (...a: string[]) => Promise<{ code: number; out: string; err: string }> }
    const config = path.join(process.env.VAULTITE_LOCAL!, "config.json")
    const asked: string[] = []
    const rest = http.createServer((req, res) => {
      asked.push(`${req.method} ${req.url}`)
      res.statusCode = req.headers["xi-api-key"] === "eleven-good-key-123" ? 200 : 401
      res.end()
    })
    await new Promise<void>((done) => rest.listen(0, "127.0.0.1", done))
    process.env.VAULTITE_ELEVENLABS_API = `http://127.0.0.1:${(rest.address() as Any).port}`
    try {
      const keys = async () => (await api("GET", "companion/voice"))[1]
      check("voice key: none, no ElevenLabs voice", !(await keys()).elevenlabs)
      $.vars.stdinText = "eleven-wrong-key-456\n"
      let r = await vau("voice", "key", "--provider", "elevenlabs")
      check("voice key: one ElevenLabs refuses isn't kept", r.code === 1 && /refused/.test(r.err) && !(await keys()).elevenlabs, r)
      $.vars.stdinText = "eleven-good-key-123\n"
      r = await vau("voice", "key", "--provider", "elevenlabs")
      $.vars.stdinText = ""
      const k = await keys()
      check("voice key: piped in, checked by a word said (speech alone may be allowed), kept in data/config.json", r.code === 0 && /Set the ElevenLabs key/.test(r.out) &&
        asked.some((a) => /^POST \/v1\/text-to-speech\/\w+/.test(a)) && JSON.parse(fs.readFileSync(config, "utf8")).companion?.elevenlabs === "eleven-good-key-123" &&
        k.elevenlabs?.key === "eleven-good-key-123" && /^wss:\/\//.test(k.elevenlabs.url), { r, asked })
      const inVault = (() => { try { return execFileSync("grep", ["-rl", "eleven-good-key-123", $.VAULT], { encoding: "utf8" }) } catch { return "" } })()
      check("voice key: nowhere in the vault", !inVault, inVault)
      r = await vau("voice", "key", "--provider", "elevenlabs", "--remove")
      check("voice key --remove: gone", r.code === 0 && !(await keys()).elevenlabs && !JSON.parse(fs.readFileSync(config, "utf8")).companion?.elevenlabs, r)
    } finally { rest.close(); delete process.env.VAULTITE_ELEVENLABS_API; $.vars.stdinText = "" }
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
    check("voice player: each piece says when it's heard (the drawing's pen keeps to it)", lines.filter((l) => l.type === "start").every((l) => typeof l.at === "number" && Math.abs(l.at - Date.now()) < 60_000), lines.filter((l) => l.type === "start"))
    check("voice player: pieces play in order, a cloud's PCM and then this Mac's voice made for the next, each told done", order === "start1,done1,start2,done2", lines.filter((l) => l.type !== "level"))
    check("voice player: its level as it plays", lines.some((l) => l.type === "level" && l.v > 0.3), lines.filter((l) => l.type === "level").slice(0, 5))
    // (its output device changing as it plays, as Bluetooth headphones do once the microphone closes: a fresh output, the
    // piece said again from the gap between words before where it went, then on to its end)
    const gapped = Buffer.from(tone)
    gapped.fill(0, 24_000, 28_800)
    send({ cmd: "pcm", n: 3, data: gapped.toString("base64") })
    send({ cmd: "reroute" })
    for (let i = 0; i < 100 && !lines.some((l) => l.type === "rerouted"); i++) await sleep(20)
    send({ cmd: "end", n: 3 })
    for (let i = 0; i < 100 && !lines.some((l) => l.type === "done" && l.n === 3); i++) await sleep(20)
    const again = lines.find((l) => l.type === "rerouted")?.again
    check("voice player: its output changing mid-piece, it plays on from the pause before where it went, to the piece's end", Math.abs(again - 0.41) < 0.02 &&
      lines.some((l) => l.type === "done" && l.n === 3), lines.filter((l) => l.type === "rerouted" || (l.type === "done" && l.n === 3)))
    // (the realtime voice's few words give way to the answer after them: what more comes of them is dropped, a breath between)
    send({ cmd: "pcm", n: 4, data: tone.toString("base64") })
    send({ cmd: "yield", n: 4, grace: 0.4 })
    send({ cmd: "pcm", n: 5, data: tone.toString("base64") })
    send({ cmd: "pcm", n: 4, data: tone.toString("base64") })
    send({ cmd: "end", n: 4 }); send({ cmd: "end", n: 5 })
    for (let i = 0; i < 100 && !lines.some((l) => l.type === "done" && l.n === 5); i++) await sleep(20)
    const gave = lines.filter((l) => (l.type === "start" || l.type === "done") && l.n >= 4).map((l) => `${l.type}${l.n}`).join()
    check("voice player: a piece giving way ends once the next has audio (what more comes of it dropped), the next played after it", gave === "start4,start5,done4,done5", gave)
    send({ cmd: "pcm", n: 6, data: tone.toString("base64") })
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
    check("voice player: what it played is the tone and the words said after it, not silence", secs > 2 && secs < 10 && peak > 300 && lines.some((l) => l.type === "stopped"), { secs, peak })
  }
}
