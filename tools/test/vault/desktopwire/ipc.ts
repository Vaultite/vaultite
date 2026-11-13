// The helper's other readers fed real and malformed input: calls' arguments, kept files, samples, OpenAI's events.
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { WebSocketServer } from "ws"
import { caught, done, J, out, quietHelper, ROOT, threw, tick, tried, until } from "./quiet.ts"

const DATA = process.env.VAULTITE_FAKE_HELPERS ?? ""
let placeIs: unknown = null
const page = { isDestroyed: () => false, send: (_: string, m: { id: number }) => setTimeout(() => At.placeTold(page, { id: m.id, place: placeIs }), 5) }
const { H, close } = await quietHelper(() => ({ page, bounds: { x: 0, y: 0, width: 1000, height: 800 }, zoom: 1 }))
const At = await import(`${ROOT}/helperat.ts`)
const A = await import(`${ROOT}/helperask.ts`)
const window7 = { bundle: "com.apple.Notes", name: "Notes", pid: 5, window: 7, title: "Groceries", frame: { x: 0, y: 0, width: 800, height: 600 } }
A.stubs.set("window", window7)
A.stubs.set("text", { ok: true, text: "Milk, eggs" })
const calls: [string, unknown[]][] = [["screen:text", [{ app: "com.apple.Notes" }]], ["screen:text", [{ window: 7, max: 50 }]], ["screen:shot", [{ window: 7 }]],
  ["screen:timeline", [{ last: 30, kinds: ["click", "key"], said: "x" }]], ["screen:walk", [{ do: "status" }]], ["screen:changed", [{ before: "/nowhere.png", window: 7 }]],
  ["screen:text", ["x"]], ["screen:text", [{ window: 7.5, app: 5 }]], ["screen:timeline", [{ last: "30", kinds: "click", box: { x: 1 } }]], ["screen:walk", [5]], ["screen:nope", [{}]]]
for (const [i, [name, args]] of calls.entries()) out[`screen-${i}-${name}`] = await caught(H.screenCall(name, args))
for (const [i, args] of [[{ text: "" }], [{ text: 5 }], [null], [{ text: "Hi", after: "yes", provider: "x" }]].entries()) out[`voice-${i}`] = await caught(H.voiceCall("voice:sample", args))

const thing = { role: "button", label: "Save", frame: { x: 10, y: 20, width: 60, height: 24 } }
for (const [i, place] of [{ path: "Notes/a.md", line: 3, pane: "t1", ui: "tab:t1", under: "Save", near: [thing], junk: { x: 1 } }, { line: 3 }, "x", { line: {}, near: "x" }, {}, null].entries()) {
  placeIs = place
  const { displays: _, ...got } = Object(await caught(At.pointedAt("Ada", { x: 30, y: 40 }, { ...window7, vaultite: true }, false)))
  out[`place-${i}`] = got
}
const List = await import(`${ROOT}/dictationlist.ts`)
const sink = { tell: () => {} }
for (const [i, where] of [{ kind: "note", path: " Notes/a.md ", name: "" }, { kind: "app", bundle: "com.x", name: "X" }, { kind: "nope" }, "x", null, { kind: "field", path: 5 }].entries()) {
  const k = List.keepFor(sink, where)
  k?.words(`words ${i}`, false)
  k?.end("stop")
}
out.listed = tried(() => List.dictationsCall("dictations:list", [{ q: "words", limit: 10 }]).items.map((d: { where: unknown; text: string; landing: string }) => [d.where, d.text, d.landing]).sort((a: string[], b: string[]) => J(a).localeCompare(J(b))))
out.listedBad = tried(() => List.dictationsCall("dictations:list", [{ q: 5, limit: "x" }]).items.length)
fs.appendFileSync(path.join(DATA, "dictations", fs.readdirSync(path.join(DATA, "dictations"))[0]), '\nnot json\n{"t":1,"id":5,"ev":"start"}\n{"t":2,"id":"dx","ev":"words","text":7}\n')
out.listedJunk = tried(() => List.dictationsCall("dictations:list", [{}]).items.length)
out.forget = tried(() => List.dictationsCall("dictations:forget", [{ id: 5 }]))

const T = await import(`${ROOT}/talklog.ts`), P = await import(`${ROOT}/presslog.ts`)
const presses = P.pressLog(() => path.join(DATA, "talk"), "talk", () => Date.parse("2026-11-12T10:00:00"))
const p = presses.start("talk", "down", { front: "com.apple.Notes" })
p.step("heard", { words: 2 })
p.end("sent", { chars: 9 })
p.step("late")
const talked = async (a: unknown) => J(await caught(T.talkCall("talk:presses", [a]))).replace(/"t":\d+/g, '"t":"…"').replace(/talk-[a-z0-9]+-1/g, "talk-…")
out.talked = await talked({ day: "2026-11-12" })
fs.appendFileSync(path.join(DATA, "talk", "talk-2026-11-12.jsonl"), 'junk\n{"t":"x"}\n')
for (const [i, a] of [{ day: "2026-11-12" }, { day: "12 Nov" }, { press: "../x" }, { name: "display-1-2.png" }, { name: 5 }, "x"].entries())
  out[`talk-${i}`] = J(await caught(T.talkCall(i < 2 ? "talk:presses" : i < 3 ? "talk:audio" : "talk:shot", [a]))).replace(/"t":\d+/g, '"t":"…"').replace(/talk-[a-z0-9]+-1/g, "talk-…")

const M = await import(`${ROOT}/markwatch.ts`)
out.samples = [{ w: 1, h: 1, px: "AA==" }, { w: 2, h: 1, px: "AA==" }, { w: "1", h: 1, px: "AA==" }, null, 5].map((v) => J(tried(() => M.sampleFrom(v))))

const R = await import(`${ROOT}/realtime.ts`)
const server = http.createServer(), wss = new WebSocketServer({ server })
const events = [{ type: "session.updated" }, { type: "response.created", response: { id: "r1" } }, { type: "response.output_audio.delta", response_id: "r1", item_id: "i1", delta: "AAAA" },
  { type: "response.output_audio_transcript.delta", response_id: "r1", delta: "Hi" }, { type: "response.output_item.added", response_id: "r1", item: { type: "function_call", call_id: "c1", name: "look" } },
  { type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "look", arguments: "{}" },
  { type: "response.done", response: { id: "r1", status: "completed", usage: { input_tokens: 3 }, output: [{ type: "function_call", call_id: "c1", name: "look", arguments: "{}" }, { type: "message" }] } },
  { type: "error", error: { code: "insufficient_quota", message: "no credits" } }, { type: "error", error: { code: "response_cancel_not_active" } },
  5, null, "x", { type: 5 }, { type: "response.done" }, { type: "response.done", response: { id: 5, output: "x", status_details: { error: { message: 7 } } } }, { type: "error" },
  { type: "response.output_audio_transcript.delta", delta: 5 }]
wss.on("connection", (ws) => { for (const e of events) ws.send(J(e)) })
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
const heard: unknown[] = []
const on = Object.fromEntries(["ready", "audio", "said", "call", "began", "done", "error"].map((k) => [k, (...a: unknown[]) => heard.push([k, ...a.map((x) => (Buffer.isBuffer(x) ? x.length : x))])]))
const session = R.realtimeSession({ url: `ws://127.0.0.1:${J(server.address()).match(/"port":(\d+)/)?.[1]}/v1/realtime`, key: "k", model: "m", voice: "v", instructions: "", tools: [] }, on)
await until(() => heard.length >= 13, 3000)
await tick(100)
out.realtime = heard
session.close?.()
server.close()
out.threw = threw()
close()
done()
