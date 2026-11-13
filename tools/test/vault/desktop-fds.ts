import { execFileSync } from "node:child_process"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const LIB = path.join(ROOT, "electron/inherited.ts"), CLOSE = path.join(ROOT, "electron/inheritedclose.ts")

const CHILD = `
const fs = require("node:fs")
const link = (n) => { try { return fs.readlinkSync("/proc/self/fd/" + n) } catch { return "" } }
const held = [link(40) === "/etc/hostname", link(41).startsWith("pipe:"), link(42).startsWith("socket:")].filter(Boolean).length
process.send([held, process.env.VAULTITE_INHERITED_FDS ? 1 : 0])
`
const PARENT = `
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"
const [lib, mode, close] = process.argv.slice(1)
const { heldPastExec, INHERITED } = await import(pathToFileURL(lib).href)
const leaks = heldPastExec()
const child = spawn(process.execPath, [...(mode === "close" ? ["--import", pathToFileURL(close).href] : []), "-e", ${JSON.stringify(CHILD)}], {
  stdio: ["ignore", "inherit", "inherit", "ipc"], env: { ...process.env, [INHERITED]: leaks || undefined } })
child.on("message", (m) => { child.disconnect(); process.stdout.write([leaks.split("\\n").filter(Boolean).length, ...m].join(" ")) })
`

function inherited(check: VaultTest["check"]) {
  if (process.platform !== "linux") return
  const run = (mode: string) => {
    const opens = "exec 40</etc/hostname 41< <(:) 42<>/dev/udp/127.0.0.1/9"
    const out = execFileSync("bash", ["-c", `${opens}; exec "$0" --input-type=module -e "$1" "$2" "$3" "$4"`, process.execPath, PARENT, LIB, mode, CLOSE],
      { encoding: "utf8", timeout: 20_000 })
    const [leaks, held, env] = out.split(" ").map(Number)
    return { leaks, held, env }
  }
  const open = run("plain"), closed = run("close")
  check("desktop: a child forked as the main process forks its servers inherits its descriptors that lack close-on-exec, on Linux",
    open.leaks >= 3 && open.held >= 3, open)
  check("desktop: a server closes the descriptors it inherited at its start, and keeps its IPC channel", closed.held === 0 && closed.env === 0, closed)
}

export default ($: VaultTest) => { inherited($.check) }
