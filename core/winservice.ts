// What Windows' `vau service` runs (hidden, by core/service.ts' launcher): the server, its output appended to the file
// VAULTITE_LOG names, since a process with no window has no console to write to.
import fs from "node:fs"
import path from "node:path"

const file = process.env.VAULTITE_LOG || "vaultite.log"
fs.mkdirSync(path.dirname(file), { recursive: true })
const log = fs.openSync(file, "a")
for (const stream of [process.stdout, process.stderr]) {
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    try { if (typeof chunk === "string") fs.writeSync(log, chunk); else fs.writeSync(log, chunk) } catch { /* a full disk: nowhere to say so */ }
    const done = rest.find((x) => typeof x === "function") as (() => void) | undefined
    done?.()
    return true
  }) as typeof stream.write
}
await import("../server.ts")
