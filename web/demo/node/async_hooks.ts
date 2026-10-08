// node:async_hooks for the demo's server. Browsers can't follow a context across awaits, so the worker runs one
// request at a time (worker.ts) and a context lasts until its function settles.
export class AsyncLocalStorage<T> {
  private store: T | undefined
  getStore() { return this.store }
  run<R>(store: T, fn: (...a: unknown[]) => R, ...args: unknown[]): R {
    const was = this.store
    this.store = store
    let out: R
    try { out = fn(...args) } catch (e) { this.store = was; throw e }
    if (out instanceof Promise) return out.finally(() => { this.store = was }) as R
    this.store = was
    return out
  }
  exit<R>(fn: (...a: unknown[]) => R, ...args: unknown[]): R { return this.run(undefined as T, fn, ...args) }
  enterWith(store: T) { this.store = store }
}
export default { AsyncLocalStorage }
