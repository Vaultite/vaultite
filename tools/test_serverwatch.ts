import { fork, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { check, exit, summary, tempDir, waitFor } from "./test/lib.ts"
import { ServerWatch, type ServerProc, type WatchHost, type WatchTiming } from "../electron/serverwatch.ts"
import { mainLog, openMainLog } from "../electron/mainlog.ts"
const began = Date.now()
const tmp = tempDir("vaultite-serverwatch-test-")

let pids = 1000
class Fake extends EventEmitter implements ServerProc {
  pid = ++pids
  exitCode: number | null = null
  alive = true
  kills: string[] = []
  how: { deaf?: boolean; stubborn?: boolean }
  constructor(how: { deaf?: boolean; stubborn?: boolean } = {}) { super(); this.how = how }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.kills.push(signal)
    if (!this.how.stubborn || signal === "SIGKILL") this.end(signal)
    return true
  }
  end(signal: NodeJS.Signals | null = null) {
    if (!this.alive) return
    this.alive = false
    if (this.how.deaf) return
    setImmediate(() => {
      this.exitCode = signal ? null : 1
      this.emit("exit", signal ? null : 1, signal)
    })
  }
}
const T: WatchTiming = { checkMs: 20, stopMs: 60, aliveMs: 30, quickMs: 80, tries: 3 }
const known = new Map<number, Fake>()
const isUp = (pid: number) => !!known.get(pid)?.alive

type Seen = { log: string[]; took: Fake[]; failed: { why: string; starting: boolean }[]; started: number }
function rig(first: Fake, starts: (n: number) => Fake | Error = () => new Fake(), o: { answers?: () => boolean; over?: () => string | null } = {}) {
  known.set(first.pid, first)
  const r: Seen = { log: [], took: [], failed: [], started: 0 }
  const later: Promise<Fake>[] = []
  const host: WatchHost<Fake> = {
    start: () => {
      const next = starts(++r.started)
      const held = later.shift()
      if (held) return held.then((f) => { known.set(f.pid, f); return f })
      if (next instanceof Error) return Promise.reject(next)
      known.set(next.pid, next)
      return Promise.resolve(next)
    },
    answers: async () => o.answers?.() ?? true,
    took: (next) => r.took.push(next),
    failed: (why, starting) => r.failed.push({ why, starting }),
    over: () => o.over?.() ?? null,
    log: (line) => r.log.push(line),
  }
  const watch = new ServerWatch(first, host, T, isUp)
  return { r, watch, later }
}
const settled = (w: ServerWatch<Fake>, r: { log: string[] }) => waitFor(() => w.status === "up" && r.log.some((l) => l.endsWith("answers")), 3000, 10)

{
  const first = new Fake(), x = rig(first)
  x.watch.restart("an update")
  await waitFor(() => x.r.took.length === 1, 3000, 10)
  check("a restart stops its server and starts another, which is the window's", first.kills.join() === "SIGTERM" && x.r.took.length === 1 && x.watch.server === x.r.took[0], x.r.log)
}
{
  const first = new Fake({ deaf: true }), x = rig(first)
  x.watch.restart("an update")
  await waitFor(() => x.r.took.length === 1, 3000, 10)
  check("a restart whose exit goes unheard still brings a server back", x.r.took.length === 1 && x.r.log.some((l) => /exit unheard/.test(l)), x.r.log)
}
{
  const first = new Fake(), x = rig(first)
  await new Promise((r) => setTimeout(r, T.quickMs + 20))
  first.how.deaf = true
  first.end()
  await waitFor(() => x.r.took.length === 1, 3000, 10)
  check("a server that ends unheard, no restart asked, is started again", x.r.took.length === 1, x.r.log)
}
{
  const first = new Fake({ stubborn: true }), x = rig(first)
  x.watch.restart("an update")
  await waitFor(() => x.r.took.length === 1, 3000, 10)
  check("a server that won't stop is killed, then started again", first.kills.join() === "SIGTERM,SIGKILL" && x.r.took.length === 1, [first.kills, x.r.log])
}
{
  const x = rig(new Fake(), (n) => (n === 1 ? new Error("spawn EAGAIN") : new Fake()))
  x.watch.restart("an update")
  await settled(x.watch, x.r)
  check("a start that failed is tried again", x.r.started === 2 && x.r.took.length === 1 && !x.r.failed.length, x.r.log)
}
{
  const x = rig(new Fake(), () => { throw new Error("EMFILE: too many open files") })
  x.watch.restart("an update")
  await waitFor(() => x.r.failed.length, 3000, 10)
  check("one that keeps failing is tried 3 times, then the user is told once", x.r.started === 3 && x.r.failed.length === 1 && /EMFILE/.test(x.r.failed[0].why) && x.watch.status === "over", [x.r.started, x.r.failed])
}
{
  let deaf = true
  const x = rig(new Fake(), () => new Fake(), { answers: () => !deaf })
  x.watch.restart("an update")
  await waitFor(() => x.r.took.length === 2, 3000, 10)
  deaf = false
  await settled(x.watch, x.r)
  check("one that's up but doesn't answer on its port is started again", x.r.took.length === 2 && x.r.log.some((l) => /doesn't answer: stopping/.test(l)), x.r.log)
}
{
  const first = new Fake(), x = rig(first), stale = (p: Fake) => p === first
  x.watch.restart("8ed1c8a", stale)
  x.watch.restart("6ae4cd9", stale)
  await settled(x.watch, x.r)
  x.watch.restart("6ae4cd9 again", stale)
  await new Promise((r) => setTimeout(r, 100))
  check("restarts asked together are one; one with nothing newer to run is none", x.r.started === 1 && x.r.log.some((l) => /runs the newest already/.test(l)), x.r.log)
}
{
  let up: (f: Fake) => void = () => {}
  const booting = new Fake(), newer = new Fake()
  const y = rig(new Fake(), (n) => (n === 1 ? booting : newer))
  const slow = new Promise<Fake>((r) => { up = r })
  y.later.push(slow)
  y.watch.restart("b27e5de")
  await waitFor(() => y.watch.status === "starting", 3000, 10)
  y.watch.restart("3cc60d9", (p) => p !== newer)
  const killedBooting = booting.kills.length
  up(booting)
  await waitFor(() => y.r.took.length === 2, 3000, 10)
  check("a restart asked while one starts waits for it, then runs when that one is stale", killedBooting === 0 && y.r.took.length === 2 && y.watch.server === newer, y.r.log)
}
{
  const booting = new Fake()
  const y = rig(new Fake(), () => booting)
  y.watch.restart("b27e5de")
  y.watch.restart("3cc60d9", (p) => p !== booting)
  await settled(y.watch, y.r)
  check("… and not at all when the one that started runs the newest", y.r.started === 1 && booting.kills.length === 0, y.r.log)
}
{
  const first = new Fake(), x = rig(first)
  first.end()
  await waitFor(() => x.r.failed.length, 3000, 10)
  check("a server that stops as it started isn't started again: the user is told", x.r.started === 0 && x.r.failed[0]?.starting === true, x.r)
}
{
  const first = new Fake(), x = rig(first)
  await new Promise((r) => setTimeout(r, T.quickMs + 20))
  first.end()
  await waitFor(() => x.r.took.length === 1, 3000, 10)
  check("one that stops later is started again", x.r.took.length === 1 && !x.r.failed.length, x.r.log)
}
{
  const x = rig(new Fake(), () => new Fake(), { over: () => "the app quits" })
  x.watch.restart("an update")
  await new Promise((r) => setTimeout(r, 60))
  check("nothing starts once its window closed or the app quits, and the log says so", x.r.started === 0 && x.r.log.some((l) => /not started again: the app quits/.test(l)), x.r.log)
}

{
  const script = path.join(tmp, "server.mjs")
  fs.writeFileSync(script, "process.send?.('up'); setInterval(() => {}, 1000)\n")
  const run = () => new Promise<ChildProcess>((ok, fail) => {
    const c = fork(script, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] })
    c.once("message", () => ok(c))
    c.once("error", fail)
  })
  const first = await run(), log: string[] = [], took: ChildProcess[] = []
  const watch = new ServerWatch<ChildProcess>(first, { start: run, answers: async () => true, took: (c) => took.push(c), failed: () => {}, over: () => null, log: (l) => log.push(l) }, T)
  watch.restart("an update")
  await waitFor(() => took.length === 1, 10_000, 20)
  const ended = first.exitCode !== null || first.signalCode !== null
  check("a real server restarted: the first ended, another runs", ended && took.length === 1 && took[0].exitCode === null, log)
  watch.stop()
  for (const c of took) c.kill("SIGKILL")
}

{
  const dir = path.join(tmp, "logs")
  openMainLog(dir, 2000)
  for (let i = 0; i < 100; i++) mainLog(`MyVault: server pid ${i} stopped (exit 143, to run new code)`)
  const size = fs.statSync(path.join(dir, "main.log")).size, before = fs.statSync(path.join(dir, "main.log.1")).size
  const line = fs.readFileSync(path.join(dir, "main.log"), "utf8").trim().split("\n").at(-1) ?? ""
  check("the main process's log is capped (the one before kept beside it), each line stamped with its time and pid",
    size <= 2000 && before <= 2000 && new RegExp(`^\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z \\[${process.pid}\\] MyVault: server pid 99 `).test(line), [size, before, line])
}
await exit(summary("serverwatch", began))
