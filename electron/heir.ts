// A server the last launch left running through its relaunch (server.ts, core/serving.ts' heir), taken over as this
// launch's own: told things over its host socket (host.ts), standing in for the ChildProcess of one servers.ts forked.
import { EventEmitter } from "node:events"
import type { Link } from "./host.ts"
import { codeOf } from "../core/values.ts"

export class Adopted extends EventEmitter {
  pid: number
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  private link: Link
  private timer: ReturnType<typeof setInterval>

  constructor(pid: number, link: Link) {
    super()
    this.pid = pid
    this.link = link
    // (not its parent, so no exit event: it's looked for)
    this.timer = setInterval(() => { if (!alive(pid)) this.ended() }, 1000)
    this.timer.unref()
  }
  get connected() { return this.exitCode === null }
  send(m: object) { this.link.send(m); return true }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    try { process.kill(this.pid, signal) } catch { this.ended() }
    return true
  }
  /** Let it be without ending it (the app relaunching again). */
  release() { clearInterval(this.timer); this.link.stop() }
  private ended() {
    if (this.exitCode !== null) return
    clearInterval(this.timer)
    this.link.stop()
    this.exitCode = 0
    this.emit("exit", 0, null)
  }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return codeOf(e) === "EPERM" } }
