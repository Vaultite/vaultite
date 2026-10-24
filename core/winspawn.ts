// Windows: the server runs without a console (the desktop app run as Node, `vau service`), so each console program it
// starts (git, netstat, wsl.exe, a plugin's) would open a window of its own. Imported first, it makes them start hidden.
import cp from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import { promisify } from "node:util"

if (process.platform === "win32") {
  type Fn = (...a: unknown[]) => unknown
  const hidden = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? { windowsHide: true, ...o } : o)
  /** `fn` with `windowsHide` added to its options (wherever they are: after the command, or after its args). */
  const hide = (fn: Fn): Fn => function (this: unknown, ...a: unknown[]) {
    const at = a.findIndex((x, i) => i > 0 && (typeof x === "function" || (x !== null && typeof x === "object" && !Array.isArray(x))))
    if (at > 0 && typeof a[at] !== "function") a[at] = hidden(a[at])
    else if (at > 1 && a[at - 1] == null) a[at - 1] = { windowsHide: true } // (execFile(f, args, undefined, done))
    else a.splice(at < 0 ? a.length : at, 0, { windowsHide: true })
    return fn.apply(this, a)
  }
  const m = cp as unknown as Record<string, Fn & { [promisify.custom]?: Fn }>
  for (const k of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const custom = m[k][promisify.custom] // (promisify(execFile)'s { stdout, stderr })
    m[k] = Object.assign(hide(m[k]), custom ? { [promisify.custom]: hide(custom) } : {})
  }
  syncBuiltinESMExports()
}
