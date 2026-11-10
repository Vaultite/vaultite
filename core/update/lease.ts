// A process holding the code root it runs (a keeper, a server, the app): the root store's gc keeps a leased root while
// its process lives (core/update/store.ts). Both sides use this file: leases/<sha>.<pid>.json, a pid and its start.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)
export type Lease = { pid: number; started: string; what: string }

/** When a process started (`ps`), to tell it from a later one with its pid; null when it isn't running. */
export async function processStart(pid: number): Promise<string | null> {
  try { return (await exec("ps", ["-o", "lstart=", "-p", String(pid)])).stdout.trim() || null } catch { return null }
}

/** `sha`'s root held by process `l.pid` while it lives (its file in `store`/leases). Answers its release. */
export async function leaseIn(store: string, sha: string, l: { pid: number; what: string }) {
  const started = await processStart(l.pid)
  if (!started) throw new Error(`process ${l.pid} isn't running`)
  const file = path.join(store, "leases", `${sha}.${l.pid}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ pid: l.pid, started, what: l.what } satisfies Lease, null, 2) + "\n")
  fs.renameSync(`${file}.tmp`, file)
  return () => fs.rmSync(file, { force: true })
}

/** The store and commit of the root `file` is in (<store>/roots/<sha>/…), or null: not a store's. */
export function storeRootOf(file: string): { store: string; sha: string; root: string } | null {
  const parts = path.resolve(file).split(path.sep)
  for (let i = parts.length - 2; i > 0; i--) {
    if (parts[i] === "roots" && /^[0-9a-f]{40}$/.test(parts[i + 1] ?? "")) {
      const store = parts.slice(0, i).join(path.sep) || path.sep
      if (fs.existsSync(path.join(store, "repo.git"))) return { store, sha: parts[i + 1], root: parts.slice(0, i + 2).join(path.sep) }
    }
  }
  return null
}

/** This process holds the root its code (`self`) is in while it lives; nothing when that isn't a store's. Never throws. */
export async function holdRoot(self: string, what: string) {
  const at = storeRootOf(self)
  if (!at) return () => {}
  try {
    const release = await leaseIn(at.store, at.sha, { pid: process.pid, what })
    process.once("exit", release)
    return release
  } catch { return () => {} }
}
