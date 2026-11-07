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
    fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "Notes", "Quillfeather.md"), "A name a recognizer wouldn't know.\n")
    fs.writeFileSync(path.join(VAULT, "Notes", "Hushed thing.md"), "---\nprivate: true\n---\nNot for anyone.\n")
    await vault.sync()
    let [st, c] = await api("GET", "dictation/cloud")
    check("dictation: no key, automatic is this Mac's", st === 200 && !c.key && !c.why, c)
    check("dictation: the recognizer is told Vaultite's words, the companion's name and the newest notes' names, not a private one's",
      ["Vaultite", "Claude", "Codex", "Quillfeather"].every((w) => c.terms?.includes(w)) && !c.terms.includes("Hushed thing") && c.terms.length <= 80, c.terms)

    // ---------- The dictionary (Dictionary.md): words added, learned from fixes, and told to every recognizer
    fs.mkdirSync(path.join(VAULT, "People"), { recursive: true }); fs.mkdirSync(path.join(VAULT, "Projects"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "People", "Alice Park.md"), "---\ntype: person\nname: Alice Park\n---\n")
    fs.writeFileSync(path.join(VAULT, "Projects", "Lighthouse.md"), "---\ntype: project\n---\n")
    await vault.sync()
    let dr = await vau("dictation", "add", "Vorssaint")
    const dict = () => fs.readFileSync(path.join(VAULT, "Dictionary.md"), "utf8")
    check("dictation add: the first word makes Dictionary.md", dr.code === 0 && dict() === "---\ntype: dictionary\n---\n\n- Vorssaint\n", { dr, text: fs.existsSync(path.join(VAULT, "Dictionary.md")) && dict() })
    dr = await vau("dictation", "add", "Olimpicos", "--said", "Olympicos")
    check("dictation add: what it mishears, as said: written", dr.code === 0 && dict().endsWith("- Vorssaint\n- Olympicos: Olimpicos\n") && /already/.test((await vau("dictation", "add", "vorssaint")).out), dict())
    ;[, c] = await api("GET", "dictation/cloud")
    check("dictation: the dictionary's words come first, then Vaultite's, the people's and projects' names",
      c.terms[0] === "Vorssaint" && c.terms[1] === "Olimpicos" && ["Alice Park", "Lighthouse", "@claude"].every((w, i) => i === 2 ? !c.terms.includes(w) : c.terms.includes(w)) && c.terms.includes("at Claude"), c.terms)
    check("dictation: what's written for what's said, Vaultite's then the dictionary's", JSON.stringify(c.replacements) === '[["at Claude","@claude"],["Olympicos","Olimpicos"]]', c.replacements)
    const fixed = (word: string, said: string) => api("POST", "ops/dictation.add", { word, said, fixed: true })
    let [, fr] = await fixed("Kaio", "Kyle")
    check("dictation: a fix teaches the word first", JSON.stringify(fr.added) === '{"word":"Kaio"}' && dict().includes("- Kaio\n") && !dict().includes("Kyle"), fr)
    ;[, fr] = await fixed("Kaio", "Kyle")
    check("dictation: misheard again, what it's misheard as", JSON.stringify(fr.added) === '{"word":"Kaio","said":"Kyle"}' && dict().includes("- Kyle: Kaio\n"), fr)
    await api("POST", "ops/dictation.remove", { word: "Kaio" }); await api("POST", "ops/dictation.remove", { word: "Kaio", said: "Kyle" })
    ;[, fr] = await fixed("Kaio", "Kyle")
    check("dictation: a word taken out (Undo) isn't learned from a fix again; added by name, it is", !fr.added && fr.unlearned && !dict().includes("Kaio") &&
      (await vau("dictation", "add", "Kaio")).code === 0 && dict().includes("- Kaio\n"), { fr, text: dict() })
    dr = await vau("dictation", "words")
    check("dictation words: the dictionary, the replacements and what's expected", dr.code === 0 && /Dictionary \(Dictionary\.md\): Vorssaint, "Olympicos" as Olimpicos, Kaio/.test(dr.out) && /Olympicos → Olimpicos/.test(dr.out), dr.out)
    // (dictation's replacements setting from before: its lines into the dictionary, the setting gone)
    await set({ replacements: ["at Claude: @claude", "Clyde: Claude", "Olympicos: Olimpicos"], keys: ["fn"] })
    const { DONE, migrate } = await import("../../../core/migrations.ts")
    vault.patchConfig("migrations", { done: DONE.filter((d) => d !== "dictation-dictionary-2026-11") })
    await migrate(vault, false)
    const after = JSON.parse(fs.readFileSync(path.join(VAULT, settings), "utf8"))
    check("migration: the replacements setting's lines go into Dictionary.md, once; Vaultite's own isn't copied", dict().endsWith("- Kaio\n- Clyde: Claude\n") && dict().split("Olympicos: Olimpicos").length === 2 &&
      !dict().includes("at Claude") && !("replacements" in after) && after.keys[0] === "fn", { text: dict(), after })
    fs.rmSync(path.join(VAULT, "Dictionary.md")); fs.rmSync(path.join(VAULT, "People", "Alice Park.md")); fs.rmSync(path.join(VAULT, "Projects", "Lighthouse.md"))
    await set({})

    const [, sp0] = await api("GET", "companion/voice")
    check("dictation: no key, the companion's voice isn't Soniox's", !sp0.soniox, sp0)
    await set({ engine: "soniox" })
    ;[, c] = await api("GET", "dictation/cloud")
    check("dictation: Soniox asked for without a key says how to set one", !c.key && /vau secret "Soniox API key" \| vau dictation key/.test(c.why), c)
    $.vars.stdinText = "wrong-key-456\n"
    let cr = await vau("dictation", "key")
    check("dictation key: one Soniox refuses isn't kept", cr.code === 1 && /refused/.test(cr.err) && !(fs.existsSync(config) && JSON.parse(fs.readFileSync(config, "utf8")).dictation), cr)
    $.vars.stdinText = "good-key-123\n"
    cr = await vau("dictation", "key")
    $.vars.stdinText = ""
    check("dictation key: piped in, checked and kept in data/config.json", cr.code === 0 && /Set the Soniox key/.test(cr.out) &&
      JSON.parse(fs.readFileSync(config, "utf8")).dictation?.soniox === "good-key-123", cr)
    cr = await vau("dictation", "key")
    check("dictation key: nothing piped says whether one is set", cr.code === 0 && /is set/.test(cr.out), cr)
    await set({ engine: "auto", languages: ["en", "pt"] })
    const [, sp] = await api("GET", "companion/voice")
    check("dictation: with the key, the companion may speak with Soniox's voice", sp.soniox?.key === "good-key-123" && sp.soniox.model === "tts-rt-v2" && /^wss?:\/\//.test(sp.soniox.url), { ...sp.soniox, key: !!sp.soniox?.key })
    ;[st, c] = await api("GET", "dictation/cloud")
    check("dictation: with the key, automatic is Soniox's, with the languages set", st === 200 && c.key === "good-key-123" && c.url === process.env.VAULTITE_SONIOX_URL &&
      c.model === "stt-rt-v6" && JSON.stringify(c.languages) === '["en","pt"]', c)
    const remote = { headers: { "x-forwarded-for": "100.64.0.9" }, socket: { remoteAddress: "127.0.0.1" } } as Any
    const [sr] = await api("GET", "dictation/cloud", undefined, remote), [ssr] = await api("GET", "companion/voice", undefined, remote)
    check("dictation: the key only for this machine's owner", sr === 403 && ssr === 403, [sr, ssr])
    await set({ engine: "parakeet" })
    ;[, c] = await api("GET", "dictation/cloud")
    check("dictation: a local recognizer picked keeps it local, still told the words to expect", !c.key && c.terms?.includes("Vaultite"), c)
    const inVault = (() => { try { return execFileSync("grep", ["-rl", "good-key-123", VAULT], { encoding: "utf8" }) } catch { return "" } })()
    check("dictation: the key is nowhere in the vault", !inVault, inVault)
    cr = await vau("dictation", "key", "--remove")
    check("dictation key --remove: gone", cr.code === 0 && !JSON.parse(fs.readFileSync(config, "utf8")).dictation, cr)
  } finally {
    fs.rmSync(path.join(VAULT, settings), { force: true })
    for (const n of ["Quillfeather.md", "Hushed thing.md"]) fs.rmSync(path.join(VAULT, "Notes", n), { force: true })
    rest.close()
  }
  await helper($, tmp)
}

/** The helper (dictation.swift) against a stand-in Soniox: tokens, finalize, errors, a drop; this Mac's engine after. */
async function helper($: VaultTest, tmp: string) {
  const { check } = $
  if (process.platform !== "darwin") return
  const { dictationSwift } = await import("../../../electron/dictation-build.ts")
  let bin: string
  try { bin = await dictationSwift.build(path.join(os.tmpdir(), "vaultite-natives", "dictation-test")) } catch (e) { console.log(`  (skipped the helper: ${(e as Error).message})`); return }
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
  const run = (mode: string, key = "test-key", more: string[] = []) => new Promise<Any[]>((done) => {
    const c = spawn(bin, ["--file", audio, "--fast", ...more, "--engine", "apple", "--language", "en-US", "--words", "Alice Park,at Claude",
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
    // (the realtime voice hears the mic too: its audio told as it comes, 16-bit at 16 kHz; the file, then 2.5 s of silence)
    const tapped = await run("ok", "test-key", ["--tap"])
    const bytes = tapped.filter((e) => e.type === "audio").reduce((n, e) => n + Buffer.from(e.data, "base64").length, 0)
    const secs = Number(/estimated duration: ([\d.]+)/.exec(execFileSync("/usr/bin/afinfo", [audio], { encoding: "utf8" }))?.[1])
    check("dictation helper: tapped, the mic's audio is told as it's heard (16-bit, 16 kHz), and words still come", Math.abs(bytes / 32_000 - secs - 2.5) < 0.3 && finals(tapped).length === 3 && !es.some((e) => e.type === "audio"), { bytes, secs })
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
