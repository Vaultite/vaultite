// The Swift helpers' lines, real and malformed, as recorder, dictation and voice read them; and what each was sent.
import { fakeHelpers } from "./fakes.ts"
import { caught, done, J, out, ROOT, threw, tick, until } from "./quiet.ts"

const F = fakeHelpers()
const sent = (h: string) => { const s = F.sent(h); F.clear(h); return s }

const R = await import(`${ROOT}/recorder.ts`)
let stopped = 0
R.onVideoStopped(() => stopped++)
F.answer("capture", { start: ['{"id": "$id", "ok": true}'], hold: ['{"event": "stopped"}', "not json", '{"event": 5}', '{"id": "$id", "ok": true}'],
  save: ['{"id": "$id", "ok": true, "file": "/c/clip.mp4", "ms": 900, "width": 10, "height": 20, "frames": [{"t": 1, "file": "/c/f1.png"}]}'] })
out.videoAt = await caught(R.videoAt({ x: 1, y: 2 }, [5], ["com.x"], 3000))
out.videoOn = R.videoOn()
out.holdVideo = await caught(R.holdVideo(7))
out.stopped = stopped
out.saveClip = await caught(R.saveClip(1000, 2000, [{ t: 1000, rect: { x: 0, y: 0, width: 10, height: 20 } }]))
F.answer("capture", { save: ['{"id": "$id", "ok": true, "file": 5, "ms": "x"}'], start: ['{"id": "$id", "ok": "yes", "why": 3}'] })
out.badSave = await caught(R.saveClip(1000, 2000, []))
out.badStart = await caught(R.videoAt({ x: 1, y: 2 }, [], [], 3000))
F.answer("capture", { save: ['{"id": "$id", "ok": false, "why": "no frames"}'], stop: "exit" })
out.noSave = await caught(R.saveClip(1000, 2000, []))
await R.stopVideo()
out.captureSent = sent("capture").map((m) => ({ ...m, file: m.file && "…", frames: m.frames && "…" }))
out.captureThrew = threw()

const D = await import(`${ROOT}/dictation.ts`)
const told: unknown[] = []
const sink = { tell: (m: { type: string }) => told.push(m) }
F.answer("dictation", {
  check: ['{"type": "engines", "apple": true, "parakeet": true, "locale": "fr-FR", "at": 1}'],
  start: ['{"type": "ready"}', '{"type": "devices", "devices": [{"uid": "m1", "name": "Mic", "transport": "usb", "input": true, "output": false}], "input": "m1", "output": "o1"}', '{"type": "pending", "id": 1, "text": "hel"}',
    '{"type": "pending", "id": 9, "text": "other"}', "junk", '{"type": 5}', '{"type": "mic-held", "name": "AirPods"}', '{"type": "level", "id": 1, "v": 0.4}',
    '{"type": "final", "id": 1, "text": "hello"}', '{"type": "final", "id": 1, "text": 7}', '{"type": "audio", "id": 1, "data": "AAA="}', '{"type": "end", "id": 1, "reason": "stop"}'],
})
out.engines = await caught(D.dictationEngines("fr"))
out.dictate = await caught(D.dictate(sink, { language: "en", silence: 2 }))
await until(() => told.length >= 6)
await tick(100)
out.told = told.splice(0)
out.micHeld = D.micHeld()
out.devices = await caught(D.helperDevices())
F.answer("dictation", { check: ['{"type": "engines", "apple": "yes", "locale": 5}'], start: ['{"type": "devices", "devices": "x", "input": 3}', '{"type": "end", "id": 2}'] })
out.badEngines = await caught(D.dictationEngines(""))
out.badDictate = await caught(D.dictate(sink, {}))
await until(() => told.length >= 1)
await tick(100)
out.badTold = told.splice(0)
out.badDevices = await caught(D.helperDevices())
out.dictationSent = sent("dictation").map((m) => ({ ...m, file: m.file && "…" }))
out.dictationThrew = threw()
D.stopDictation()

const Vo = await import(`${ROOT}/voice.ts`)
const heard: unknown[] = []
F.answer("voice", { say: ['{"type": "output", "name": "Speakers", "transport": "built-in", "rate": 48000}', '{"type": "start", "n": 1, "at": 5}', '{"type": "level", "v": 0.5}',
  '{"type": "length", "n": 1, "s": 1.5}', "junk", '{"type": "start", "n": "1", "at": "x"}', '{"type": "level", "v": "x"}', '{"type": "rerouted", "why": "headset", "again": 2}'],
end: ['{"type": "done", "n": 1}'] })
const prefs = { mode: "always", provider: "auto", name: "", eleven: { voice: "", model: "" }, speed: 1 }
const voice = Vo.companionVoice({ port: () => null, prefs: () => prefs, hints: () => ["en"], level: (on: boolean, v: number) => heard.push(["level", on, v]), told: (e: { t: string }) => heard.push(e) })
voice.begin("what's this?")
voice.text("a", "It's a cat.")
voice.end("a")
await until(() => heard.length >= 5)
await tick(200)
out.voiceHeard = heard.map((e) => J(e).replace(/"at":\d{6,}/, '"at":"…"'))
voice.stop()
voice.quit()
out.voiceSent = sent("voice").map((m) => m.cmd)
out.voiceThrew = threw()

done()
