import fs from "node:fs"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Any, VaultTest } from "./harness.ts"

// How a shell's life ends, on real shells: what's told, once, and whether its tabs close when put back.
export default async ($: VaultTest) => {
  const { check } = $
  lifeProperties(check)
  if (process.platform === "win32") return
  const { waitFor } = await import("../lib.ts")
  const term = await import("../../../plugins/core/terminal/plugin.ts")
  const plug = term.plugin
  const svc = plug.services as Record<string, Any>
  const told: Any[] = [], emit = plug.emit
  plug.emit = function (type: string, data: Any = {}) {
    if (type === "terminal.ended") told.push(data)
    return emit.call(this, type, data)
  }
  const endedFile = path.join(plug.localDir(), "ended.json")
  const closes = () => { try { return new Set(JSON.parse(fs.readFileSync(endedFile, "utf8")) as string[]) } catch { return new Set<string>() } }
  const endOf = (id: string) => waitFor(() => told.find((x) => x.id === id), 15_000, 50)
  const socket = plug.sockets.find((s) => s.pattern.join("/") === "terminal/*")!
  const putBack = async (id: string) => {
    const sent: Any[] = []
    let code = 0
    const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (m: unknown) => sent.push(typeof m === "string" ? JSON.parse(m) : String(m)), close: (c: number) => { code = c; ws.readyState = 3 }, on: () => {}, terminate: () => {} }
    const req = { headers: { host: "127.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage
    await socket.fn(ws as never, req, { wild: [id], query: { attach: "1" } } as never)
    return { sent, code }
  }
  const start = (id: string, command: string) => $.api("POST", `terminals/${id}`, { command })
  await $.api("PATCH", "config/plugin/terminal", { shell: "/bin/sh" })
  try {
    await start("life-clean", "read x; exit $x")
    await start("life-fail", "read x; exit $x")
    await start("life-end", "sleep 60")
    await start("life-keep", "sleep 60")
    await $.api("POST", "terminals/life-clean/send", { text: "0", enter: true })
    await $.api("POST", "terminals/life-fail/send", { text: "3", enter: true })
    await $.api("DELETE", "terminals/life-end")
    await $.api("DELETE", "terminals/life-keep?keep=1")
    const [clean, fail, ended, kept] = await Promise.all(["life-clean", "life-fail", "life-end", "life-keep"].map(endOf))
    check("terminal life: a clean exit is told as it ended, not on purpose",
      clean?.code === 0 && clean.signal === 0 && !clean.onPurpose && !clean.lost, clean)
    check("terminal life: a failed exit is told with its code", fail?.code === 3 && fail.signal === 0 && !fail.onPurpose, fail)
    check("terminal life: one ended on purpose is told as a SIGHUP, on purpose", ended?.code === 0 && ended.signal === 1 && ended.onPurpose === true, ended)
    check("terminal life: one ended on purpose keeping its tabs is a SIGHUP, not on purpose", kept?.code === 0 && kept.signal === 1 && !kept.onPurpose, kept)
    await new Promise((r) => setTimeout(r, 1500))
    check("terminal life: each end is told once", ["life-clean", "life-fail", "life-end", "life-keep"].every((id) => told.filter((x) => x.id === id).length === 1), told)
    const shut = closes()
    check("terminal life: a clean exit and an end on purpose close their tabs, kept on this machine; a failed one and a kept one don't",
      shut.has("life-clean") && shut.has("life-end") && !shut.has("life-fail") && !shut.has("life-keep"), [...shut])
    check("terminal life: how each ended is asked of the service while it's kept",
      svc["terminal:ended"]("life-fail")?.code === 3 && svc["terminal:ended"]("life-end")?.signal === 1 && svc["terminal:ended"]("life-nothing") === null)
    const back = await putBack("life-end")
    check("terminal life: a tab put back of one ended for good is told it's gone, ended", back.code === 4004 && back.sent.some((m) => m.t === "gone" && m.ended === true), back)
    await start("life-clean", "sleep 60")
    const reopened = await waitFor(() => !closes().has("life-clean"), 5000, 100)
    check("terminal life: a shell started again under an ended id no longer closes its tabs", !!reopened, [...closes()])
    await $.api("DELETE", "terminals/life-clean")
    const again = await waitFor(() => told.filter((x) => x.id === "life-clean").length === 2 && told.filter((x) => x.id === "life-clean")[1], 15_000, 50)
    check("terminal life: started again, its next end is told too", again?.onPurpose === true, told.filter((x) => x.id === "life-clean"))
  } finally {
    plug.emit = emit
    await $.api("PATCH", "config/plugin/terminal", { shell: null })
  }
}

/** state.ts' Term on random event sequences, against what a shell's life promises: its end final and told as asked. */
async function lifeProperties(check: VaultTest["check"]) {
  const { byUs, closes, fresh, nowOf, step } = await import("../../../plugins/core/terminal/state.ts")
  type Ev = Parameters<typeof step>[1]
  let seed = 7
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }
  const pick = <T,>(xs: T[]) => xs[rand(xs.length)]
  const said = () => ({ seen: rand(2) === 0, status: pick([null, { state: "working" as const }, { state: "idle" as const }, { state: "blocked" as const }, { state: "blocked" as const, kind: "question" as const }]) })
  const events: (() => Ev)[] = [
    () => ({ type: "start" }), () => ({ type: "late" }), () => ({ type: "osc", said: said() }),
    () => ({ type: "hooks", text: pick(["working", "idle", "waiting:permission", "missing", null, "junk"]), at: pick([0, 1, 2]) }),
    () => ({ type: "ask", ask: pick([null, { id: "trust", says: "Trust?" }]) }), () => ({ type: "waits", kind: pick([null, "permission" as const, "question" as const]) }),
    () => ({ type: "backend", state: pick(["working", "idle", "waiting", undefined]) }), () => ({ type: "front", program: rand(2) === 0, seen: rand(40) * 100 }),
    () => ({ type: "seen", osc: rand(2) ? said() : null, hooks: pick([null, "working"]) }),
    () => ({ type: "end", keep: rand(2) === 0 }), () => ({ type: "exit", code: pick([0, 0, 3]), signal: pick([0, 0, 15]), lost: rand(4) === 0 }),
  ]
  const broken: unknown[] = []
  for (let run = 0; run < 3000 && broken.length < 3; run++) {
    let t = fresh(pick(["claude", ""]))
    // (the model: the first exit ends it, as an end on purpose before it asked)
    let asked: { keep: boolean } | null = null, exit: Extract<Ev, { type: "exit" }> | null = null
    const evs: Ev[] = []
    for (let i = 0, n = 1 + rand(30); i < n; i++) {
      const ev = pick(events)(), was = t
      evs.push(ev)
      t = step(t, ev, 1000 + i * 100)
      if (exit) { if (t !== was) broken.push({ why: "changed after its end", evs }); continue }
      if (ev.type === "end") asked = { keep: ev.keep }
      if (ev.type === "exit") exit = ev
      const p = t.phase
      const want = !exit ? null : asked ? { code: 0, signal: 1, lost: false } : { code: exit.code, signal: exit.signal, lost: exit.lost }
      if (!exit && p.state === "ended") broken.push({ why: "ended with no exit", evs })
      if (want && (p.state !== "ended" || p.code !== want.code || p.signal !== want.signal || p.lost !== want.lost)) broken.push({ why: "ended not as it exited", evs, p })
      if (JSON.stringify(byUs(t)) !== JSON.stringify(asked)) broken.push({ why: "on purpose not as asked", evs, t })
      const shut = asked ? !asked.keep : !!exit && !exit.code && !exit.signal && !exit.lost
      if (closes(t) !== shut) broken.push({ why: "tabs close wrongly", evs, t })
      if (exit && (nowOf(t) !== null || t.ending !== null)) broken.push({ why: "an ended one still says a state", evs, t })
    }
  }
  check("terminal life (3000 random runs): an end is final, told as it exited or as a SIGHUP when ended on purpose, and its tabs close only when ended on purpose without keep or clean", broken.length === 0, broken[0])
}
