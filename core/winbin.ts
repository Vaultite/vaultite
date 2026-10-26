// Starting programs on Windows by name, as its shells find them: Path with PATHEXT's extensions, and npm's .cmd shims
// run as the Node script they start (cmd would mangle arguments: JSON, line breaks). Light: starter.ts runs it alone.
import { spawn, type ChildProcessByStdio, type SpawnOptionsWithStdioTuple } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import fs from "node:fs"
import path from "node:path"

const exists = (p: string) => { try { return fs.statSync(p).isFile() } catch { return false } }

/** `name` as Windows finds it: a path, or on Path with one of PATHEXT's extensions (claude.exe, codex.cmd). */
function which(name: string, env: NodeJS.ProcessEnv): string | null {
  const exts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
  const tries = (base: string) => [...(path.extname(base) ? [base] : []), ...exts.map((e) => base + e.toLowerCase())]
  if (/[\\/]/.test(name)) return tries(name).find(exists) ?? null
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"
  for (const dir of (env[key] ?? "").split(";").filter(Boolean)) {
    const hit = tries(path.join(dir, name)).find(exists)
    if (hit) return hit
  }
  return null
}

/** cmd's escaping of one argument for a .cmd or .bat (cross-spawn's): quoted as a program reads it, then each of cmd's
 *  own characters escaped, twice (the batch file's %* parses it again). A line break can't pass: it becomes a space. */
function cmdArg(arg: string) {
  let a = arg.replace(/\r?\n/g, " ").replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")
  a = `"${a}"`
  for (let i = 0; i < 2; i++) a = a.replace(/[()%!^"<>&|;, ]/g, "^$&")
  return a
}

/** An npm shim (`codex.cmd`) runs Node on a script: that, without cmd, so arguments pass whole (JSON, line breaks). */
function npmShim(file: string, env: NodeJS.ProcessEnv): string[] | null {
  let text = ""
  try { text = fs.readFileSync(file, "utf8") } catch { return null }
  const script = /"%(?:~?dp0%?|dp0%)\\?([^"%]+\.[cm]?js)"\s+%\*/i.exec(text)?.[1]
  if (!script) return null
  const dir = path.dirname(file), node = [path.join(dir, "node.exe")].find(exists) ?? which("node", env)
  return node ? [node, path.join(dir, script)] : null
}

/** How to run `argv` on Windows (spawn can't run a .cmd itself): [program, its arguments, verbatim (cmd's own quoting)], or
 *  null when there's no such program. */
export function winCommand(argv: string[], env: NodeJS.ProcessEnv): [string, string[], boolean] | null {
  const bin = which(argv[0], env)
  if (!bin) return null
  if (!/\.(cmd|bat)$/i.test(bin)) return [bin, argv.slice(1), false]
  const shim = npmShim(bin, env)
  if (shim) return [shim[0], [...shim.slice(1), ...argv.slice(1)], false]
  return [env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${[bin, ...argv.slice(1)].map(cmdArg).join(" ")}"`], true]
}

/** spawn() talking over stdin and stdout, but on Windows a program found as its shells would (a .cmd included). */
export function spawnBin(bin: string, args: string[], o: SpawnOptionsWithStdioTuple<"pipe", "pipe", "ignore">): ChildProcessByStdio<Writable, Readable, null> {
  if (process.platform !== "win32") return spawn(bin, args, o)
  const how = winCommand([bin, ...args], { ...process.env, ...o.env })
  return how ? spawn(how[0], how[1], { windowsHide: true, ...o, windowsVerbatimArguments: how[2] }) : spawn(bin, args, o)
}

/** `env` with `dirs` first on its PATH (Windows' Path, whatever its case: one key, not two). */
export function withPath(env: NodeJS.ProcessEnv, ...dirs: string[]): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"
  return { ...env, [key]: [...dirs, env[key]].filter(Boolean).join(path.delimiter) }
}
