import { EventEmitter, once } from "./events.ts"

type Source = Iterable<Uint8Array> | AsyncIterable<Uint8Array>
type Done = (e?: Error | null) => void

class Stream extends EventEmitter {
  destroyed = false
  destroy(e?: Error) {
    if (this.destroyed) return this
    this.destroyed = true
    queueMicrotask(() => { if (e) this.emit("error", e); this.emit("close") })
    return this
  }
}

export class Readable extends Stream {
  readableEnded = false
  #source: Source
  #flowing = false
  #paused = false
  #wake: (() => void) | null = null
  constructor(source: Source = []) { super(); this.#source = source }
  static from(source: Source) { return new Readable(source) }

  async *[Symbol.asyncIterator]() {
    try {
      for await (const chunk of this.#source) { if (this.destroyed) return; yield chunk }
      this.readableEnded = true
    } finally { this.destroy() }
  }

  override on(name: string, fn: (...a: unknown[]) => void) {
    super.on(name, fn)
    if (name === "data") this.resume()
    return this
  }
  pause() { this.#paused = true; return this }
  resume() {
    this.#paused = false
    this.#wake?.()
    if (!this.#flowing) { this.#flowing = true; queueMicrotask(() => void this.#flow()) }
    return this
  }
  async #flow() {
    try {
      for await (const chunk of this.#source) {
        while (this.#paused && !this.destroyed) await new Promise<void>((ok) => { this.#wake = ok })
        if (this.destroyed) return
        this.emit("data", chunk)
      }
      this.readableEnded = true
      this.emit("end")
      this.destroy()
    } catch (e) { this.destroy(e instanceof Error ? e : new Error(String(e))) }
  }
  override destroy(e?: Error) { const out = super.destroy(e); this.#wake?.(); return out }

  pipe<W extends Writable>(to: W): W {
    this.on("data", (chunk) => { if (chunk instanceof Uint8Array && !to.write(chunk)) { this.pause(); to.once("drain", () => this.resume()) } })
    this.once("end", () => to.end())
    return to
  }
}

type WriteOpts = { write?: (chunk: Uint8Array, encoding: string, done: Done) => void; final?: (done: Done) => void }
export class Writable extends Stream {
  writable = true
  writableEnded = false
  writableFinished = false
  #o: WriteOpts
  constructor(o: WriteOpts = {}) { super(); this.#o = o }
  _write(chunk: Uint8Array, encoding: string, done: Done) { if (this.#o.write) this.#o.write(chunk, encoding, done); else done() }
  _final(done: Done) { if (this.#o.final) this.#o.final(done); else done() }

  write(chunk: Uint8Array | string, ...then: (BufferEncoding | Done)[]) {
    const done = then.find((x) => x instanceof Function)
    if (this.writableEnded || this.destroyed) { queueMicrotask(() => done?.(new Error("write after end"))); return false }
    this._write(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk), "utf8", (e) => { done?.(e); if (e) this.destroy(e) })
    return true
  }
  end(done?: Done) {
    if (this.writableEnded) { if (done) queueMicrotask(done); return this }
    this.writableEnded = true
    this.writable = false
    queueMicrotask(() => this._final((e) => {
      if (e) return void this.destroy(e)
      this.writableFinished = true
      done?.()
      this.emit("finish")
      this.destroy()
    }))
    return this
  }
}

export async function pipeline(from: Readable | Source, to: Writable) {
  const src = from instanceof Readable ? from : Readable.from(from), finished = once(to, "finish")
  src.once("error", (e) => to.destroy(e instanceof Error ? e : new Error(String(e))))
  src.pipe(to)
  try { await finished } catch (e) { src.destroy(); throw e }
}

export default { Readable, Writable, pipeline }
