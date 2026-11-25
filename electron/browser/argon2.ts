// Argon2, which KDBX 4 files are keyed with (kdbx/ asks for it): Electron's crypto has none. hash-wasm's WebAssembly,
// five times noble's plain JS, in a worker so the process never stalls; noble's for Argon2 1.0, which it lacks.
import { argon2dAsync, argon2idAsync } from "@noble/hashes/argon2.js"
import crypto from "node:crypto"
import { Worker } from "node:worker_threads"
import type { Argon2Fn } from "./kdbx/crypto-engine.ts"

type Waiting = Map<number, { ok: (k: Uint8Array) => void; fail: (e: Error) => void }>
let worker: { w: Worker; waiting: Waiting } | null = null, asked = 0
function started() {
  const w = new Worker(new URL("./argon2-worker.ts", import.meta.url)), waiting: Waiting = new Map()
  w.on("message", (m: { id: number; key?: Uint8Array; error?: string }) => {
    const p = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.key) p?.ok(m.key); else p?.fail(new Error(m.error ?? "argon2 failed"))
    if (!waiting.size) w.unref()
  })
  const gone = (e: Error) => {
    if (worker?.w === w) worker = null
    for (const p of waiting.values()) p.fail(e)
    waiting.clear()
  }
  w.on("error", gone)
  w.on("exit", () => gone(new Error("argon2 worker exited")))
  return { w, waiting }
}
function inWorker(a: { password: Uint8Array; salt: Uint8Array; memory: number; iterations: number; length: number; parallelism: number; type: 0 | 2 }) {
  const { w, waiting } = worker ??= started()
  const id = ++asked
  w.ref()
  return new Promise<Uint8Array>((ok, fail) => { waiting.set(id, { ok, fail }); w.postMessage({ id, ...a }) })
}

function derive(...[password, salt, memory, iterations, length, parallelism, type, version]: Parameters<Argon2Fn>): Promise<Uint8Array> {
  const pw = new Uint8Array(password), s = new Uint8Array(salt)
  if (version === 0x13) return inWorker({ password: pw, salt: s, memory, iterations, length, parallelism, type })
  const fn = type === 2 ? argon2idAsync : argon2dAsync
  return fn(pw, s, { m: memory, t: iterations, p: parallelism, dkLen: length, version, asyncTick: 10 })
}

// A file keeps its KDF salt till it's saved again, and every read derives its key (kdbxfile.ts reads it fresh for
// each call): each derived key is kept, by a hash of all its inputs, so a file costs one derivation per save.
const kept = new Map<string, Promise<Uint8Array>>()
const KEEP = 8

export const argon2: Argon2Fn = (password, salt, memory, iterations, length, parallelism, type, version) => {
  const id = crypto.createHash("sha256").update(new Uint8Array(password)).update(new Uint8Array(salt))
    .update(JSON.stringify([memory, iterations, length, parallelism, type, version])).digest("hex")
  let p = kept.get(id)
  if (!p) {
    p = derive(password, salt, memory, iterations, length, parallelism, type, version)
    kept.set(id, p)
    p.catch(() => { if (kept.get(id) === p) kept.delete(id) })
    while (kept.size > KEEP) kept.delete(kept.keys().next().value!)
  } else { kept.delete(id); kept.set(id, p) }
  // (a copy: kdbx/ zeroes the key it's given once used)
  return p.then((k) => k.slice())
}

/** Forgets every derived key, zeroing each (one being derived, once it's done), and the worker's memory with them. */
export function forgetKeys() {
  for (const p of kept.values()) p.then((k) => k.fill(0), () => {})
  kept.clear()
  if (!worker || worker.waiting.size) return
  void worker.w.terminate()
  worker = null
}
