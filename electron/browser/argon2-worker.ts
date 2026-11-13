// Argon2 for argon2.ts, off the main process: hash-wasm's WebAssembly holds the thread for the whole derivation.
import { parentPort } from "node:worker_threads"
import { argon2d, argon2id } from "hash-wasm"
import { messageOf } from "./errors.ts"

type Ask = { id: number; password: Uint8Array; salt: Uint8Array; memory: number; iterations: number; length: number; parallelism: number; type: 0 | 2 }

parentPort?.on("message", async (a: Ask) => {
  try {
    const fn = a.type === 2 ? argon2id : argon2d
    const key = await fn({ password: a.password, salt: a.salt, memorySize: a.memory, iterations: a.iterations, parallelism: a.parallelism, hashLength: a.length, outputType: "binary" })
    parentPort?.postMessage({ id: a.id, key })
  } catch (e) {
    parentPort?.postMessage({ id: a.id, error: messageOf(e) })
  }
})
