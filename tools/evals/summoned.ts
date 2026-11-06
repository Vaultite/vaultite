// The summoned companion's speed and how its answers sound aloud (a fixture's real asks, scored by score.ts spokenStyle).
//   node tools/evals/summoned.ts [--models haiku,sonnet] [--asks 4] [--fixture companion/summoned-<day>.json]   (DEBUG=1: entries)
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { freePort, stopTerminals, testServer, waitFor } from "../test/lib.ts"
import { spokenScore } from "./companion/score.ts"

const argv = process.argv.slice(2)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
const MODELS = (opt("--models") ?? "haiku,sonnet").split(","), ASKED = opt("--asks"), N = Number(ASKED ?? 4), FIXTURE = opt("--fixture")

const near = [{ id: "a1", role: "button", label: "Send", frame: { x: 800, y: 820, width: 80, height: 32 } },
  { id: "a2", role: "button", label: "Attach", frame: { x: 892, y: 820, width: 80, height: 32 } },
  { id: "a3", role: "row", label: "Alice Park, Lisbon trip: flights on Tuesday?", frame: { x: 300, y: 60, width: 460, height: 70 } },
  { id: "a4", role: "row", label: "Bob Lee, Invoice 2026-114 attached", frame: { x: 300, y: 134, width: 460, height: 70 } },
  { id: "a5", role: "text", label: "Hi! I found two flights for Tuesday, 7:05 and 13:20. The early one is cheaper. Which do you prefer?", frame: { x: 800, y: 170, width: 340, height: 50 } }]
type Ask = { text?: string; sx: number; sy: number; kind?: string; id?: string; app?: string; title?: string; under?: string; screen?: string; near?: unknown[] }
const DEMO: Ask[] = [
  { text: "what does this button do?", sx: 830, sy: 836 },
  { text: "how do I add a file to my reply?", sx: 930, sy: 836 },
  { text: "which flight is cheaper?", sx: 950, sy: 200 },
  { text: "who sent me the invoice?", sx: 400, sy: 170 },
  { text: "what's in my inbox?", sx: 60, sy: 84 },
].slice(0, N)
// (a fixture: real asks, each with its own window's text, what was under the pointer and near it)
const ASKS: Ask[] = FIXTURE ? (JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, FIXTURE), "utf8")).asks as Ask[]).slice(0, ASKED ? N : undefined) : DEMO
const screenText = "Lighthouse Mail\nInbox (3)\nDrafts\nSent\nArchive\nAlice Park\nLisbon trip: flights on Tuesday?\nBob Lee\nInvoice 2026-114 attached\nLighthouse Team\nWeekly digest\nLisbon trip: flights on Tuesday?\nFrom Alice Park, 9:41\nHi! I found two flights for Tuesday, 7:05 and 13:20.\nThe early one is cheaper. Which do you prefer?\nSend\nAttach"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-summoned-eval-"))
const VAULT = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local"), shot = path.join(tmp, "screens", "display-1-1.png")
fs.mkdirSync(path.dirname(shot), { recursive: true })
fs.copyFileSync(path.join(import.meta.dirname, "companion", "screen.png"), shot)
const S = await import("../../core/sandbox.ts")
S.makeSandbox(VAULT, S.localToday())
const port = await freePort(), url = `http://127.0.0.1:${port}`
const server = testServer({ stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL } })
type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (id: string, params: object = {}): Promise<Any> => (await fetch(`${url}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/web" }, body: JSON.stringify(params) })).json()
const quick = () => call("companion.status").then((r) => r.summoned?.id as string | null)
const idle = async (id: string) => !!(await waitFor(async () => (await call("claude-code.chat-list")).sessions?.find((s: Any) => s.id === id)?.state === "idle", 120_000, 200))
const rowsOf = async () => ((await call("companion.timings")).rows as Any[]).filter((r) => r.as === "Claude (summoned)" && (r.kind === "ask" || r.kind === "point"))
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }
const sec = (ms?: number) => (ms === undefined || Number.isNaN(ms) ? "-" : (ms / 1000).toFixed(1))

let code = 0
const out: string[] = []
try {
  if (!await waitFor(async () => (await fetch(`${url}/api/state`)).ok, 60_000)) throw new Error("the sandbox server didn't start")
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/companion/live?screen=1`)
  await new Promise((r, j) => { ws.once("open", r); ws.once("error", j) })
  for (const model of MODELS) {
    await fetch(`${url}/api/config/plugin/companion`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "quiet", agent: "claude", summoned_model: model }) })
    await new Promise((r) => setTimeout(r, 300))
    // (its Talk key pressed: a session up, as while they speak; one ask first so its prompt is cached, as in use)
    ws.send(JSON.stringify({ t: "summoning" }))
    const id = await waitFor(quick, 30_000, 200)
    if (!id || !await idle(id)) throw new Error(`${model}: its summoned session didn't start`)
    const seen = (await rowsOf()).length, sessions = [id]
    for (const [i, a] of [{ text: "hi, just checking you're there", sx: 700, sy: 500 } as Ask, ...ASKS].entries()) {
      ws.send(JSON.stringify({ t: "moment", kind: a.kind ?? "ask", agent: "Claude", ...(a.text ? { text: a.text } : {}), app: a.app ?? "com.example.mail", window: 9, title: a.title ?? "Lighthouse Mail",
        sx: a.sx, sy: a.sy, screen: a.screen ?? screenText, shot, shotAt: { x: 0, y: 0, width: 1440, height: 900 }, ...(a.under ? { under: a.under } : {}),
        ...(FIXTURE ? (a.near?.length ? { near: a.near } : {}) : { near }) }))
      const done = await waitFor(async () => { const r = (await rowsOf()).slice(seen); return r.length > i && r[i].total !== undefined ? r[i] : null }, 90_000, 300)
      // (past its fresh_after asks it hands over to a fresh session: each one's entries are read)
      const now = await quick()
      if (now && !sessions.includes(now)) sessions.push(now)
      if (!done) {
        const read = await call("claude-code.chat-read", { id: await quick(), limit: 12 })
        throw new Error(`${model}: ask ${i} got no answer: ${JSON.stringify({ rows: (await rowsOf()).slice(seen), entries: read.entries?.map((e: Any) => [e.k, String(e.text ?? e.name ?? "").slice(0, 300), String(e.result ?? "").slice(0, 200)]) })}`)
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    const all = (await rowsOf()).slice(seen), rows = all.slice(1), cold = all[0]
    out.push(`\n${model}: its first ask, the session just up: ${sec((cold?.handoff ?? 0) + (cold?.word ?? NaN))} s to its first word`)
    // (what it said and where it pointed: by an element's id near the pointer, or a point)
    const said = ((await call("claude-code.chat-read", { id: await quick(), limit: 200 })).entries as Any[])
      .filter((e) => e.k === "tool" && /__say$/.test(e.name)).slice(-rows.length).map((e) => (typeof e.input === "string" ? JSON.parse(e.input) : e.input) as Any)
    const firsts = rows.map((r) => (r.handoff ?? 0) + (r.word ?? NaN))
    out.push(`${model}: then ask to first word ${firsts.map(sec).join(", ")} s (median ${sec(med(firsts))}); first action ${rows.map((r) => r.op ?? "-").join(", ")}; whole turn ${sec(med(rows.map((r) => r.total)))} s median`)
    if (!FIXTURE) {
      for (const n of said) out.push(`  ${n.ax ? `[${n.ax}] ` : n.sx !== undefined ? `[${n.sx},${n.sy}] ` : "[-] "}${String(n.text).replace(/\s+/g, " ").slice(0, 110)}`)
      console.log(out.slice(-2 - said.length).join("\n"))
    } else {
      // (each ask's answer as heard: its says and a drawing's words, in the turn that ask began)
      // (in the order they happened: the history and the live entries come merged, not in order)
      const entries = (await Promise.all(sessions.map(async (s) => (await call("claude-code.chat-read", { id: s, limit: 1000 })).entries as Any[]))).flat()
        .sort((a, b) => String(a.at).localeCompare(String(b.at))), turns: { words: string[]; pointed: boolean }[] = []
      for (const e of entries) {
        if (e.k === "user") { turns.push({ words: [], pointed: false }); continue }
        const input = (typeof e.input === "string" ? JSON.parse(e.input) : e.input) as Any, turn = turns.at(-1)
        if (!turn || e.k !== "tool" || !input) continue
        if (/__say$/.test(e.name) && input.text) turn.words.push(String(input.text))
        if (/__draw$/.test(e.name) && input.say) turn.words.push(String(input.say))
        if (/__(say|look|draw)$/.test(e.name) && (input.ax || input.sx !== undefined || input.marks)) turn.pointed = true
      }
      if (process.env.DEBUG) console.log(JSON.stringify({ sessions, n: entries.length, turns: turns.map((t) => t.words.length), kinds: entries.map((e) => `${e.k}${e.name ? `:${String(e.name).split("__").pop()}` : ""}@${String(e.at).slice(11, 23)}`) }))
      const heard = turns.slice(-ASKS.length)
      if (heard.filter((t) => !t.words.length).length > ASKS.length / 2) out.push(`${model}: its words weren't found for most asks (its session's entries, DEBUG=1): this run's speech score doesn't count`)
      const sc = spokenScore(heard.map((t) => t.words.join(" ")))
      out.push(`${model}: as speech, ${sc.clean}/${sc.of} clean, ${sc.short}/${sc.of} in 30 words or fewer; words median ${sc.words.median}, mean ${sc.words.mean}, most ${sc.words.most}; pointed in ${heard.filter((t) => t.pointed).length}/${sc.of}`,
        `${model}: faults ${Object.entries(sc.tally).sort((a, b) => b[1] - a[1]).map(([f, k]) => `${f} ${k}`).join(", ") || "none"}`)
      heard.forEach((t, i) => out.push(`  ${(ASKS[i].id ?? String(i + 1)).padEnd(16)} ${sc.rows[i].faults.length ? `[${sc.rows[i].faults.join(", ")}]` : "[clean]"} ${t.words.join(" ").replace(/\s+/g, " ")}`))
      console.log(out.slice(-4 - heard.length).join("\n"))
    }
    if (process.env.DEBUG) console.log(((await call("claude-code.chat-read", { id: await quick(), limit: 40 })).entries as Any[]).map((e) => `${e.k}${e.name ? `:${e.name}` : ""}${e.at ? ` ${e.at}` : ""} ${JSON.stringify(e.input ?? "").slice(0, 200)}`).join("\n"))
  }
  ws.close()
} catch (e) { console.error(`summoned eval: ${(e as Error).message}`); code = 2 } finally {
  await call("companion.stop", { all: true }).catch(() => {})
  server.kill()
  stopTerminals(port)
  const keeper = spawnSync("pgrep", ["-f", `vaultite-chatd1-vaultite-${port}\\.sock`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
  for (const pid of keeper) try { process.kill(Number(pid)) } catch { /* gone */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
process.exit(code)
