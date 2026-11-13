// A vault window's own server kept running (main.ts): a restart that brings none back is started again, failures told.

export type ServerProc = {
  pid?: number
  exitCode: number | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: "exit", fn: (code: number | null, signal: NodeJS.Signals | null) => void): void
}

export type WatchHost<P extends ServerProc = ServerProc> = {
  start(): Promise<P>
  answers(): Promise<boolean>
  took(next: P): void
  failed(why: string, starting: boolean): void
  over(): string | null
  log(line: string): void
}

export type WatchTiming = {
  checkMs: number
  stopMs: number
  aliveMs: number
  quickMs: number
  tries: number
}
export const WATCH_TIMING: WatchTiming = { checkMs: 10_000, stopMs: 20_000, aliveMs: 30_000, quickMs: 10_000, tries: 3 }

type State = "up" | "stopping" | "starting" | "down" | "over"
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return e instanceof Error && "code" in e && e.code === "EPERM" } }
const said = (e: Error | string) => (e instanceof Error ? e.message : e).split("\n")[0]

export class ServerWatch<P extends ServerProc = ServerProc> {
  private cur: P
  private state: State = "up"
  private since = Date.now()
  private crashes: number[] = []
  private meant = false
  private again: { why: string; stale?: (p: P) => boolean } | null = null
  private tries = 0
  private misses = 0
  private stopAt = 0
  private check: ReturnType<typeof setTimeout> | undefined
  private heard = new WeakSet<P>()
  private readonly ticker: ReturnType<typeof setInterval>
  private readonly h: WatchHost<P>
  private readonly t: WatchTiming
  private readonly isUp: (pid: number) => boolean

  constructor(first: P, h: WatchHost<P>, t: WatchTiming = WATCH_TIMING, isUp: (pid: number) => boolean = isAlive) {
    this.h = h
    this.t = t
    this.isUp = isUp
    this.cur = first
    this.follow(first)
    this.ticker = setInterval(() => { if (this.state === "up") this.lookFor() }, t.aliveMs)
    this.ticker.unref?.()
  }

  get server() { return this.cur }
  get status() { return this.state }

  restart(why: string, stale?: (p: P) => boolean) {
    if (this.end()) return
    if (this.state === "stopping" || this.state === "down") return this.h.log(`restart (${why}): one is under way already`)
    if (this.state === "starting") { this.again = { why, stale }; return this.h.log(`restart (${why}): once the one starting is up`) }
    if (stale && !stale(this.cur)) return this.h.log(`restart (${why}): pid ${this.cur.pid} runs the newest already`)
    this.stopFor(`restart (${why})`)
  }

  stop() {
    this.state = "over"
    clearTimeout(this.check)
    clearInterval(this.ticker)
  }

  private stopFor(why: string) {
    this.h.log(`${why}: stopping pid ${this.cur.pid}`)
    this.meant = true
    this.state = "stopping"
    this.stopAt = Date.now()
    this.cur.kill()
    this.arm()
  }

  private follow(p: P) {
    p.once("exit", (code, signal) => this.exited(p, `exit ${signal ?? code}`))
  }

  private end() {
    if (this.state === "over") return true
    const why = this.h.over()
    if (!why) return false
    this.h.log(`not started again: ${why}`)
    this.stop()
    return true
  }

  private exited(p: P, how: string) {
    if (this.heard.has(p)) return
    this.heard.add(p)
    if (p !== this.cur) return
    try { this.decide(how) } catch (e) {
      this.h.log(`its exit's handling failed: ${e instanceof Error ? e.stack : String(e)}`)
      this.state = "down"
      this.arm()
    }
  }

  private decide(how: string) {
    const now = Date.now(), meant = this.meant
    this.h.log(`server pid ${this.cur.pid} stopped (${how}${meant ? ", to run new code" : ""})`)
    if (this.end()) return
    this.meant = false
    this.crashes = this.crashes.filter((at) => now - at < 60_000)
    if (!meant && (now - this.since < this.t.quickMs || this.crashes.length >= 3)) {
      return this.fail(`the server stopped (${how})`, now - this.since < this.t.quickMs && !this.crashes.length)
    }
    if (!meant) this.crashes.push(now)
    this.start()
  }

  private start() {
    this.state = "starting"
    this.tries++
    this.h.log(`starting it again (try ${this.tries})`)
    this.arm()
    Promise.resolve().then(() => this.h.start()).then((next) => this.started(next), (e) => {
      if (this.state !== "starting") return
      this.h.log(`it didn't start: ${said(e)}`)
      this.state = "down"
      if (this.tries >= this.t.tries) this.fail(e instanceof Error ? e.message : String(e), false)
    })
  }

  private started(next: P) {
    if (this.end()) return void next.kill()
    this.cur = next
    this.since = Date.now()
    this.state = "up"
    this.follow(next)
    this.h.log(`server pid ${next.pid} is up`)
    this.h.took(next)
    const again = this.again
    this.again = null
    if (again) this.restart(again.why, again.stale)
  }

  private fail(why: string, starting: boolean) {
    this.h.log(`gave up: ${why}`)
    this.stop()
    this.h.failed(why, starting)
  }

  private arm() {
    clearTimeout(this.check)
    this.check = setTimeout(() => void this.look(), this.t.checkMs)
    this.check.unref?.()
  }

  private async look() {
    if (this.end()) return
    if (this.state === "starting") return this.arm()
    if (this.state === "down") { this.h.log("no server: starting it again"); return this.start() }
    if (this.lookFor()) return
    if (this.state === "stopping") return this.stopping()
    if (await this.h.answers().catch(() => false)) {
      if (this.tries) this.h.log(`server pid ${this.cur.pid} answers`)
      this.tries = this.misses = 0
      return
    }
    if (this.state !== "up") return
    this.h.log(`server pid ${this.cur.pid} doesn't answer`)
    if (++this.misses < 3) return this.arm()
    this.misses = 0
    if (this.tries >= this.t.tries) return this.fail("its server doesn't answer on its port", false)
    this.stopFor("it doesn't answer")
  }

  private lookFor() {
    const p = this.cur
    if (this.heard.has(p) || (p.exitCode === null && (!p.pid || this.isUp(p.pid)))) return false
    this.h.log(`server pid ${p.pid ?? "?"} is gone (exit ${p.exitCode ?? "?"}), its exit unheard`)
    this.exited(p, "gone")
    return true
  }

  private stopping() {
    const waited = Date.now() - this.stopAt
    if (waited >= 2 * this.t.stopMs) {
      this.h.log(`server pid ${this.cur.pid} still there ${Math.round(waited / 1000)} s after it was told to stop: started again all the same`)
      this.exited(this.cur, "never stopped")
      return
    }
    if (waited >= this.t.stopMs) { this.h.log(`server pid ${this.cur.pid} didn't stop in ${Math.round(waited / 1000)} s: killed`); this.cur.kill("SIGKILL") }
    this.arm()
  }
}
