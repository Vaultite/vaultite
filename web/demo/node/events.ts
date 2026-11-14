type Listener = (...a: unknown[]) => void

export class EventEmitter {
  #on = new Map<string, Listener[]>()
  on(name: string, fn: Listener) { this.#on.set(name, [...(this.#on.get(name) ?? []), fn]); return this }
  addListener(name: string, fn: Listener) { return this.on(name, fn) }
  once(name: string, fn: Listener) {
    const one: Listener = (...a) => { this.off(name, one); fn(...a) }
    return this.on(name, one)
  }
  off(name: string, fn: Listener) { this.#on.set(name, (this.#on.get(name) ?? []).filter((f) => f !== fn)); return this }
  removeListener(name: string, fn: Listener) { return this.off(name, fn) }
  removeAllListeners(name?: string) { if (name === undefined) this.#on.clear(); else this.#on.delete(name); return this }
  listenerCount(name: string) { return this.#on.get(name)?.length ?? 0 }
  emit(name: string, ...a: unknown[]) {
    const fns = this.#on.get(name) ?? []
    if (name === "error" && !fns.length) throw a[0]
    for (const fn of fns) fn(...a)
    return fns.length > 0
  }
}

export function once(e: EventEmitter, name: string) {
  return new Promise<unknown[]>((ok, no) => {
    const heard: Listener = (...a) => { e.off(name, heard).off("error", failed); ok(a) }
    const failed: Listener = (err) => { e.off(name, heard).off("error", failed); no(err) }
    e.on(name, heard)
    if (name !== "error") e.on("error", failed)
  })
}

export default { EventEmitter, once }
