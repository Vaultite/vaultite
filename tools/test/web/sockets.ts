import http from "node:http"
import { WebSocketServer, type WebSocket as Carrier } from "ws"
import { serveMux, type ServedSocket } from "../../../core/mux.ts"
import { readBinary, readText, textPieces, writeBinary, writeText, type TextFrame } from "../../../core/muxwire.ts"
import { check, freePort, section, waitFor } from "../lib.ts"
import { type Any, web } from "./lib.ts"

await section("sockets: the mux's frames", () => {
  const frames: TextFrame[] = [{ kind: "open", ch: 1, path: "terminal/a%40b?cols=80" }, { kind: "opened", ch: 36 }, { kind: "refused", ch: 7, status: 403, reason: "not yours" },
    { kind: "text", ch: 99999, data: "{\"t\":\"hi there\"}", more: false }, { kind: "text", ch: 2, data: "", more: true }, { kind: "close", ch: 3, code: 4001, reason: "the page closed" },
    { kind: "close", ch: 3, code: 1005, reason: "" }, { kind: "ping" }, { kind: "pong" }]
  check("sockets: every text frame reads back as it was written", frames.every((f) => JSON.stringify(readText(writeText(f))) === JSON.stringify(f)), frames.map((f) => readText(writeText(f))))
  check("sockets: what isn't a frame reads as none", ["", "x", "t ", "zz1 a", "t0 a", "o0 x", "c1 notanumber", "tzzzzzzzzzzzz a"].every((s) => readText(s) === null))
  const bytes = new Uint8Array([0, 1, 2, 255])
  const b = readBinary(writeBinary(0x01020304, true, bytes))
  check("sockets: a binary frame carries its channel, whether more follows, and its bytes", b?.ch === 0x01020304 && b.more && Buffer.from(b.data).equals(Buffer.from(bytes)), b)
  check("sockets: a binary frame for no channel, or too short, is none", readBinary(writeBinary(0, false, bytes)) === null && readBinary(new Uint8Array([0x62, 0, 0])) === null)
  const text = "a".repeat(9) + "😀" + "b".repeat(5)
  const pieces = textPieces(text, 10)
  check("sockets: a long text goes in pieces that never split a surrogate pair", pieces.join("") === text && pieces.every((p) => !/[\ud800-\udbff]$/.test(p)) && pieces.length === 2, pieces)
})

type Handler = (ws: ServedSocket) => void
const served = {
  echo: (ws) => ws.on("message", (data, binary) => ws.send(!binary ? String(data) : Array.isArray(data) ? Buffer.concat(data) : data)),
  bye: (ws) => ws.close(4001, "bye"),
  big: (ws) => ws.on("message", (n) => ws.send("x".repeat(Number(String(n))) + "😀")),
  flood: (ws) => { for (let i = 0; i < 64; i++) ws.send(Buffer.alloc(128 * 1024, i)); floodQueued = ws.bufferedAmount },
  pings: (ws) => { ws.on("pong", () => ws.send("pong")); ws.ping() },
  listens: (ws) => ws.on("close", (code, reason) => closes.push([code, String(reason)])),
} satisfies Record<string, Handler>
let floodQueued = 0
const closes: [number, string][] = []
let slowOpened = false
const carriers: Carrier[] = []
const serve = async (at: string) => {
  const name = at.split("?")[0]
  if (name === "slow") { await new Promise((r) => setTimeout(r, 300)); return () => { slowOpened = true } }
  const fn = Object.entries(served).find(([n]) => n === name)?.[1]
  if (!fn) throw Object.assign(new Error("not found"), { status: 404 })
  return fn
}
const server = http.createServer()
const wss = new WebSocketServer({ noServer: true })
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/api/mux") return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => { carriers.push(ws); serveMux(ws, serve) })
})
const port = await freePort()
await new Promise<void>((r) => server.listen(port, "127.0.0.1", r))
const g: Any = globalThis
const was = g.location
g.location = new URL(`http://127.0.0.1:${port}/`)

const opened = (s: Any) => new Promise<boolean>((r) => { s.onopen = () => r(true); s.onclose = () => r(false) })
const next = (s: Any) => new Promise<Any>((r) => { s.onmessage = (e: MessageEvent) => r(e.data) })
const ended = (s: Any) => new Promise<{ code: number; reason: string; clean: boolean; error: boolean }>((r) => {
  let error = false
  s.onerror = () => { error = true }
  s.onclose = (e: CloseEvent) => r({ code: e.code, reason: e.reason, clean: e.wasClean, error })
})

try {
  const { openSocket }: { openSocket(path: string): Any } = await web("core/sockets.ts")

  await section("sockets: channels over one WebSocket", async () => {
    const a = openSocket("echo"), b = openSocket("echo?x=1"), c = openSocket("echo")
    check("sockets: channels open as sockets do", (await Promise.all([opened(a), opened(b), opened(c)])).every(Boolean) && a.readyState === 1)
    check("sockets: three sockets are one WebSocket", carriers.length === 1, carriers.length)
    const got = next(b)
    b.send("hello")
    check("sockets: text goes both ways on its own channel", await got === "hello")
    b.binaryType = "arraybuffer"
    const sent = new Uint8Array(300 * 1024).map((_, i) => i % 251), back = next(b)
    b.send(sent)
    const echoed: unknown = await back
    check("sockets: binary goes both ways, in pieces put back together", echoed instanceof ArrayBuffer && Buffer.from(echoed).equals(Buffer.from(sent)))
    const blob = next(c)
    c.send(new Uint8Array([1, 2, 3]))
    const asBlob: unknown = await blob
    check("sockets: binary comes as a Blob unless asked for ArrayBuffers, as a WebSocket's", asBlob instanceof Blob && asBlob.size === 3)
    let threw = false
    const fresh = openSocket("echo")
    try { fresh.send("too soon") } catch { threw = true }
    check("sockets: sending before it opens throws, as a WebSocket's", threw)
    await opened(fresh)
    for (const s of [a, b, c, fresh]) s.close()
  })

  await section("sockets: opens, closes and refusals", async () => {
    const nope = openSocket("nothing-here"), fine = openSocket("echo"), fineOpened = opened(fine)
    const e = await ended(nope)
    check("sockets: a refused channel errors and closes 1006, as a refused WebSocket", e.code === 1006 && e.error && !e.clean, e)
    check("sockets: and the others carry on", await fineOpened && fine.readyState === 1)
    const bye = await ended(openSocket("bye"))
    check("sockets: the server's close code and reason reach the page", bye.code === 4001 && bye.reason === "bye" && bye.clean && !bye.error, bye)
    const l = openSocket("listens")
    await opened(l)
    l.close(4000, "page gone")
    check("sockets: the page's close reaches its handler with its code and reason", await waitFor(() => closes.some(([c, r]) => c === 4000 && r === "page gone"), 3000, 20), closes)
    const slow = openSocket("slow")
    const gone = ended(slow)
    slow.close()
    const g2 = await gone
    await new Promise((r) => setTimeout(r, 500))
    check("sockets: a channel closed while it opens closes 1006 and is never served", g2.code === 1006 && !slowOpened, { g2, slowOpened })
    const p = openSocket("pings")
    check("sockets: a handler's ping hears its pong", await next(p) === "pong")
    p.close(); fine.close()
  })

  await section("sockets: one channel's flood doesn't hold the others", async () => {
    const f = openSocket("flood"), e = openSocket("echo")
    f.binaryType = "arraybuffer"
    let flooded = 0, atReply = -1
    f.onmessage = (m: MessageEvent) => { flooded += m.data.byteLength }
    await opened(e)
    e.onmessage = () => { atReply = flooded }
    e.send("hi")
    await waitFor(() => flooded === 64 * 128 * 1024, 15000, 20)
    check("sockets: a flooding channel waits in its own queue (its bufferedAmount)", floodQueued > 4 * 1024 * 1024, floodQueued)
    check("sockets: and another's reply goes out before the flood ends", atReply >= 0 && atReply < flooded, { atReply, flooded })
    f.close(); e.close()
  })

  await section("sockets: the window's WebSocket dropped", async () => {
    const a = openSocket("echo"), b = openSocket("echo")
    await Promise.all([opened(a), opened(b)])
    const before = carriers.length
    const ea = ended(a), eb = ended(b)
    carriers.at(-1)!.terminate()
    const [x, y] = await Promise.all([ea, eb])
    check("sockets: every channel closes 1006 with an error, as its own socket would", [x, y].every((r) => r.code === 1006 && r.error), [x, y])
    const again = openSocket("echo")
    check("sockets: a channel opened after reconnects the one WebSocket", await opened(again) && carriers.length === before + 1, carriers.length)
    let reopened: Any = null
    again.onclose = () => { reopened = openSocket("echo") }
    carriers.at(-1)!.terminate()
    await waitFor(() => reopened, 3000, 20)
    check("sockets: one reopened as its channel closes waits for the next WebSocket, not closed with the rest", await opened(reopened) && carriers.length === before + 2, carriers.length)
    reopened.close()
  })
} finally {
  g.location = was
  for (const c of carriers) c.terminate()
  wss.close()
  server.close()
}
