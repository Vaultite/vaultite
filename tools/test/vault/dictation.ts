import { spawn, execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { WebSocketServer } from "ws"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, tmp, vault } = $
  const { vau } = $.vars
  // ---------- Dictation's cloud: Soniox's key is this machine's, the desktop app asks for it as it starts ----------
  const settings = ".vaultite/plugins/dictation/data.json"
  const config = path.join(process.env.VAULTITE_LOCAL!, "config.json")
  // (each a new mtime, as settings are read again by it)
  let t = Date.now() / 1000 + 10
  const set = async (data: Any) => {
    const f = path.join(VAULT, settings)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify(data))
    fs.utimesSync(f, ++t, t)
    await vault.sync()
  }
  // (Soniox's REST API stood in: a key it knows, one it refuses)
  const rest = http.createServer((req, res) => { res.statusCode = req.headers.authorization === "Bearer good-key-123" ? 200 : 401; res.end("{}") })
  await new Promise<void>((done) => rest.listen(0, "127.0.0.1", done))
  process.env.VAULTITE_SONIOX_API = `http://127.0.0.1:${(rest.address() as Any).port}`
  process.env.VAULTITE_SONIOX_URL = "ws://127.0.0.1:1/stand-in"
  try {
    let [st, c] = await api("GET", "dictation/cloud")
    check("dictation: no key, automatic is this Mac's", st === 200 && !c.key && !c.why, c)
    const [, sp0] = await api("GET", "dictation/speech")
    check("dictation: no key, the companion's voice is this Mac's", !sp0.key, sp0)
    await set({ engine: "soniox" })
    ;[, c] = await api("GET", "dictation/cloud")
    check("dictation: Soniox asked for without a key says how to set one", !c.key && /vau secret "Soniox API key" \| vau dictation key/.test(c.why), c)
    $.vars.stdinText = "wrong-key-456\n"
    let cr = await vau("dictation", "key")
    check("dictation key: one Soniox refuses isn't kept", cr.code === 1 && /refused/.test(cr.err) && !fs.existsSync(config), cr)
    $.vars.stdinText = "good-key-123\n"
    cr = await vau("dictation", "key")
    $.vars.stdinText = ""
    check("dictation key: piped in, checked and kept in data/config.json", cr.code === 0 && /Set the Soniox key/.test(cr.out) &&
      JSON.parse(fs.readFileSync(config, "utf8")).dictation?.soniox === "good-key-123", cr)
    cr = await vau("dictation", "key")
    check("dictation key: nothing piped says whether one is set", cr.code === 0 && /is set/.test(cr.out), cr)
    await set({ engine: "auto", languages: ["en", "pt"] })
    const [, sp] = await api("GET", "dictation/speech")
    check("dictation: with the key, the companion speaks with Soniox's voice", sp.key === "good-key-123" && sp.model === "tts-rt-v2" && /^wss?:\/\//.test(sp.url), { ...sp, key: !!sp.key })
    ;[st, c] = await api("GET", "dictation/cloud")
    check("dictation: with the key, automatic is Soniox's, with the languages set", st === 200 && c.key === "good-key-123" && c.url === process.env.VAULTITE_SONIOX_URL &&
      c.model === "stt-rt-v6" && JSON.stringify(c.languages) === '["en","pt"]', c)
    const remote = { headers: { "x-forwarded-for": "100.64.0.9" }, socket: { remoteAddress: "127.0.0.1" } } as Any
    const [sr] = await api("GET", "dictation/cloud", undefined, remote), [ssr] = await api("GET", "dictation/speech", undefined, remote)
    check("dictation: the key only for this machine's owner", sr === 403 && ssr === 403, [sr, ssr])
    await set({ engine: "parakeet" })
    ;[, c] = await api("GET", "dictation/cloud")
    check("dictation: a local recognizer picked keeps it local", !c.key, c)
    const inVault = (() => { try { return execFileSync("grep", ["-rl", "good-key-123", VAULT], { encoding: "utf8" }) } catch { return "" } })()
    check("dictation: the key is nowhere in the vault", !inVault, inVault)
    cr = await vau("dictation", "key", "--remove")
    check("dictation key --remove: gone", cr.code === 0 && !JSON.parse(fs.readFileSync(config, "utf8")).dictation, cr)
  } finally {
    fs.rmSync(path.join(VAULT, settings), { force: true })
    rest.close()
  }
  await helper($, tmp)
}

/** The helper (dictation.swift) against a stand-in Soniox: tokens, finalize, errors, a drop; this Mac's engine after. */
async function helper($: VaultTest, tmp: string) {
  const { check } = $
  if (process.platform !== "darwin") return
  const { buildDictation } = await import("../../../electron/dictation-build.ts")
  let bin: string
  try { bin = await buildDictation(path.join(os.tmpdir(), "vaultite-natives", "dictation-test")) } catch (e) { console.log(`  (skipped the helper: ${(e as Error).message})`); return }
  const audio = path.join(tmp, "two.aiff")
  // (`say -o` writes a file, nothing is played)
  execFileSync("say", ["-o", audio, "Remember to buy milk and bread. [[slnc 1500]] Then call Alice Park about the lighthouse project."])
  type Seen = { config: Any; auth: string; ctl: string[]; closed: boolean }
  const seen: Seen[] = []
  const srv = http.createServer()
  const wss = new WebSocketServer({ noServer: true })
  srv.on("upgrade", (req, sock, head) => {
    if (req.headers.authorization !== "Bearer test-key") return sock.end("HTTP/1.1 401 Unauthorized\r\n\r\n")
    const mode = req.url!.slice(1)
    wss.handleUpgrade(req, sock, head, (ws) => {
      const s: Seen = { config: null, auth: req.headers.authorization!, ctl: [], closed: false }
      seen.push(s)
      let bytes = 0, segs = 0, gone = false
      ws.on("error", () => {})
      ws.on("message", (d: Buffer, binary: boolean) => {
        if (gone) return
        if (binary) {
          bytes += d.length
          return ws.send(JSON.stringify({ tokens: [{ text: " pend", is_final: false }] }))
        }
        if (!s.config) {
          s.config = JSON.parse(d.toString())
          if (mode === "drop-first") { gone = true; return (ws as Any)._socket.end() }
          if (mode === "error") ws.send(JSON.stringify({ tokens: [], error_code: 400, error_type: "invalid_request", error_message: "Invalid model" }))
          return
        }
        const m = JSON.parse(d.toString())
        s.ctl.push(m.type)
        if (m.type !== "finalize" || (mode === "silent" && segs)) return
        // (the final words for the audio so far, then <fin>)
        const ms = bytes / 32
        ws.send(JSON.stringify({ tokens: [{ text: " Seg", is_final: true, start_ms: ms - 20, end_ms: ms - 10 }, { text: `ment ${++segs}.`, is_final: true, start_ms: ms - 10, end_ms: ms },
          { text: "<fin>", is_final: true }] }), () => {
          // (dropped once its first words are out: no close frame, but what was sent arrives first; read on, so it's no reset)
          if (mode !== "drop") return
          gone = true
          ;(ws as Any)._socket.end()
        })
      })
      ws.on("close", () => { s.closed = true })
    })
  })
  await new Promise<void>((done) => srv.listen(0, "127.0.0.1", done))
  const port = (srv.address() as Any).port
  const run = (mode: string, key = "test-key") => new Promise<Any[]>((done) => {
    const c = spawn(bin, ["--file", audio, "--fast", "--engine", "apple", "--language", "en-US", "--words", "Alice Park,at Claude",
      "--cloud", JSON.stringify({ url: `ws://127.0.0.1:${port}/${mode}`, key, languages: ["en", "pt"] })], { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    c.stdout.on("data", (d) => (out += d))
    const t = setTimeout(() => c.kill(), 30_000)
    c.on("exit", () => { clearTimeout(t); done(out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type !== "level")) })
  })
  const finals = (es: Any[]) => es.filter((e) => e.type === "final").map((e) => e.text)
  try {
    let es = await run("ok")
    const s = seen.at(-1)!
    check("dictation helper: Soniox gets the format, the said words as context and the languages", s?.config?.audio_format === "pcm_s16le" && s.config.sample_rate === 16000 &&
      s.config.model === "stt-rt-v6" && JSON.stringify(s.config.context?.terms) === '["Alice Park","at Claude"]' && JSON.stringify(s.config.language_hints) === '["en","pt"]', s)
    check("dictation helper: pending words, then finals at each pause and the stop, whole words", es.some((e) => e.type === "pending" && e.text === "pend") &&
      JSON.stringify(finals(es)) === '["Segment 1.","Segment 2.","Segment 3."]' && s.ctl.filter((x) => x === "finalize").length === 3, [finals(es), s.ctl])
    const end = es.at(-1)
    for (let i = 0; i < 100 && !s.closed; i++) await $.sleep(10)
    // (the stand-in answers at once: what's left is the helper's own path from the stop to the last words)
    check("dictation helper: the last words a moment after the stop, the socket closed", end?.type === "end" && end.reason === "stop" && end.settled < 150 && s.closed, end)
    es = await run("drop")
    const fb = es.findIndex((e) => e.type === "fallback"), local = finals(es.slice(fb + 1)).join(" ")
    check("dictation helper: dropped mid-stream, what Soniox settled stays and this Mac hears the rest", fb > 0 && finals(es.slice(0, fb)).join() === "Segment 1." &&
      /dropped/.test(es[fb].message) && (/lighthouse/i.test(local) && !/milk/i.test(local) || es.some((e) => e.code === "cloud")) && es.at(-1).type === "end", es.filter((e) => e.type !== "pending"))
    es = await run("drop-first")
    check("dictation helper: dropped before any final word, this Mac hears it all", /dropped/.test(es.find((e) => e.type === "fallback")?.message) &&
      (/milk/i.test(finals(es).join(" ")) && /lighthouse/i.test(finals(es).join(" ")) || es.some((e) => e.code === "cloud")) && es.at(-1).type === "end", es.filter((e) => e.type !== "pending"))
    es = await run("ok", "wrong-key")
    check("dictation helper: a refused key, this Mac hears it all", /refused the key/.test(es.find((e) => e.type === "fallback")?.message) &&
      (/milk/i.test(finals(es).join(" ")) && /lighthouse/i.test(finals(es).join(" ")) || es.some((e) => e.code === "cloud")) && es.at(-1).type === "end", es.filter((e) => e.type !== "pending"))
    es = await run("error")
    check("dictation helper: Soniox's error is the fallback's reason", /Invalid model/.test(es.find((e) => e.type === "fallback")?.message) && es.at(-1).type === "end", es.filter((e) => e.type !== "pending"))
    es = await run("silent")
    check("dictation helper: no answer to the stop, this Mac finishes", /in time/.test(es.find((e) => e.type === "fallback")?.message) && finals(es)[0] === "Segment 1." && es.at(-1).type === "end",
      es.filter((e) => e.type !== "pending"))
  } finally {
    srv.close()
    wss.close()
  }
}
