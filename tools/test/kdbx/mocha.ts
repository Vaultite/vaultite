// What upstream kdbxweb's tests (mocha and expect.js) use, so they run here nearly as written: describe/it, hooks,
// and expect, whose eql also compares bytes (expect.js' passes any two ArrayBuffers).
import fs from "node:fs"
import path from "node:path"

type Fn = () => unknown
type Test = { name: string; fn: Fn }
type Suite = { name: string; tests: Test[]; suites: Suite[]; before: Fn[]; after: Fn[]; beforeEach: Fn[]; afterEach: Fn[] }

const root: Suite = { name: "", tests: [], suites: [], before: [], after: [], beforeEach: [], afterEach: [] }
let current = root

export function describe(name: string, body: () => void) {
  const suite: Suite = { name, tests: [], suites: [], before: [], after: [], beforeEach: [], afterEach: [] }
  current.suites.push(suite)
  const parent = current
  current = suite
  body()
  current = parent
}
export const it = (name: string, fn: Fn) => { current.tests.push({ name, fn }) }
export const before = (fn: Fn) => { current.before.push(fn) }
export const after = (fn: Fn) => { current.after.push(fn) }
export const beforeEach = (fn: Fn) => { current.beforeEach.push(fn) }
export const afterEach = (fn: Fn) => { current.afterEach.push(fn) }

/** Runs every test declared so far, each told to `report` (its full name, and the error it threw, if one). */
export async function run(report: (name: string, error: unknown) => void, suite = root, names: string[] = [], each: { before: Fn[]; after: Fn[] } = { before: [], after: [] }) {
  const here = [...names, suite.name].filter(Boolean)
  const hooks = { before: [...each.before, ...suite.beforeEach], after: [...suite.afterEach, ...each.after] }
  for (const fn of suite.before) await fn()
  for (const t of suite.tests) {
    let error: unknown = null
    try {
      for (const fn of hooks.before) await fn()
      await t.fn()
    } catch (e) { error = e ?? new Error("rejected") }
    try { for (const fn of hooks.after) await fn() } catch (e) { error ??= e }
    report([...here, t.name].join(" > "), error)
  }
  for (const s of suite.suites) await run(report, s, here, hooks)
  for (const fn of suite.after) await fn()
}

/** A fixture from tools/fixtures/kdbx (upstream's resources/), as an ArrayBuffer of its own. */
export function fixture(name: string): ArrayBuffer {
  const b = fs.readFileSync(path.join(import.meta.dirname, "../../fixtures/kdbx", name))
  return new Uint8Array(b).buffer
}

// ---------- expect ----------

const show = (v: unknown) => {
  if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength})`
  if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.byteLength})`
  const kind = v && typeof v === "object" && v.constructor !== Object && !Array.isArray(v) ? `${v.constructor.name} ` : ""
  try { return kind + (JSON.stringify(v)?.slice(0, 200) ?? String(v)) } catch { return kind + String(v) }
}

function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  return null
}

/** expect.js' eql: == between primitives, dates by time, bytes by bytes, objects key by key. */
export function eql(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const ab = bytesOf(a) ?? (Array.isArray(a) ? a : null), bb = bytesOf(b) ?? (Array.isArray(b) ? b : null)
  if ((bytesOf(a) || bytesOf(b)) && ab && bb) return ab.length === bb.length && [...ab].every((x, i) => x === bb[i])
  if (bytesOf(a) || bytesOf(b)) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a == b
  // (maps by their keys: expect.js passed any two, and upstream's expectations hold a binary's ref where it has its hash)
  if (a instanceof Map || b instanceof Map) {
    const keys = (m: object) => (m instanceof Map ? [...m.keys()] : Object.keys(m))
    const ka = keys(a), kb = new Set(keys(b))
    return ka.length === kb.size && ka.every((k) => kb.has(k))
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.hasOwn(b, k) && eql((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

class Assertion {
  readonly value: unknown
  readonly negate: boolean
  constructor(value: unknown, negate = false) { this.value = value; this.negate = negate }
  private assert(ok: boolean, what: string) {
    if (ok === this.negate) throw new Error(`expected ${show(this.value)} ${this.negate ? "not " : ""}${what}`)
  }
  get to() { return this }
  get not() { return new Assertion(this.value, !this.negate) }
  ok() { this.assert(!!this.value, "to be truthy"); return this }
  get be() {
    return Object.assign((expected: unknown) => { this.assert(this.value === expected, `to be ${show(expected)}`); return this }, {
      ok: () => this.ok(), a: (t: unknown) => this.a(t), an: (t: unknown) => this.a(t), eql: (e: unknown) => this.eql(e),
      greaterThan: (n: number) => { this.assert((this.value as number) > n, `to be above ${n}`); return this },
    })
  }
  a(type: unknown) {
    const v = this.value
    const ok = typeof type === "string" ? (type === "array" ? Array.isArray(v) : type === "object" ? typeof v === "object" && v !== null : typeof v === type)
      : v instanceof (type as new (...a: unknown[]) => unknown)
    this.assert(ok, `to be a ${typeof type === "string" ? type : (type as { name: string }).name}`)
    return this
  }
  eql(expected: unknown) { this.assert(eql(this.value, expected), `to eql ${show(expected)}`); return this }
  contain(x: unknown) {
    const v = this.value as string | unknown[]
    this.assert(typeof v === "string" ? v.includes(x as string) : v.indexOf(x) >= 0, `to contain ${show(x)}`)
    return this
  }
  throwException(check?: (e: unknown) => void) {
    let thrown = false, error: unknown
    try { (this.value as () => unknown)() } catch (e) { thrown = true; error = e }
    this.assert(thrown, "to throw")
    if (thrown && check) check(error)
    return this
  }
  fail(message?: string): never { throw new Error(message ?? "explicit failure") }
}

export function expect(value?: unknown) {
  return new Assertion(value)
}
