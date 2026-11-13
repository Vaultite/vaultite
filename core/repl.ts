import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { z } from "zod"
import { commands, Ctx, CliError, execute, parseArgs, print, userData } from "./cli.ts"
import type { OpEntry, Schema } from "./contracts/ops.ts"
import { camel, flagOf } from "./ops.ts"

const Listed = z.looseObject({ files: z.array(z.looseObject({ path: z.unknown().optional() })).optional() })
const Commands = z.looseObject({ commands: z.array(z.looseObject({ id: z.unknown().optional() })).optional() })

const GLOBAL_FLAGS = ["--json", "--copy", "--count", "--paths", "--help"]

/** `partial`: the last word as typed so far, from `start`; "" after a space. */
export function split(line: string) {
  const words: string[] = []
  let cur = "", inWord = false, quote = "", start = line.length, opened = ""
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = ""
      else if (ch === "\\" && quote === "\"" && i + 1 < line.length) cur += line[++i]
      else cur += ch
      continue
    }
    if (/\s/.test(ch)) {
      if (inWord) { words.push(cur); cur = ""; inWord = false }
      continue
    }
    if (!inWord) { inWord = true; start = i; opened = ch === "'" || ch === "\"" ? ch : "" }
    if (ch === "'" || ch === "\"") quote = ch
    else if (ch === "\\" && i + 1 < line.length) cur += line[++i]
    else cur += ch
  }
  if (inWord) words.push(cur)
  return { words, partial: inWord ? cur : "", start: inWord ? start : line.length, quote: inWord ? opened : "" }
}

export type Source = {
  ops: OpEntry[]
  local: string[]
  files: () => Promise<string[]>
  commandIds: () => Promise<string[]>
}

function named(ops: OpEntry[], words: string[]): { op: OpEntry; used: number } | null {
  let best: { op: OpEntry; used: number } | null = null
  for (const op of ops) {
    if (op.id === words[0]) return { op, used: 1 }
    const cli = (op.cli ?? "").split(" ").filter(Boolean)
    if (cli.length && cli.length <= words.length && cli.every((w, i) => words[i] === w) && (!best || cli.length > best.used)) best = { op, used: cli.length }
  }
  return best
}

async function valuesOf(key: string, s: Schema | undefined, src: Source, partial: string): Promise<string[]> {
  if (!s) return []
  if (s.enum) return s.enum.map(String)
  if (s.type === "boolean") return ["true", "false"]
  if (s.format === "path" || key === "path" || key === "folder") {
    const files = await src.files()
    const dirs = key === "folder"
    const next = new Set<string>()
    for (const f of files) {
      if (!f.toLowerCase().startsWith(partial.toLowerCase())) continue
      const cut = f.indexOf("/", partial.length)
      if (cut >= 0) next.add(f.slice(0, cut + 1))
      else if (!dirs) next.add(f)
    }
    if (next.size) return [...next]
    const low = partial.toLowerCase()
    return dirs ? [] : files.filter((f) => f.toLowerCase().includes(low)).slice(0, 50)
  }
  if ((key === "id" || key === "command") && /command|hotkey/.test(s.description ?? "")) return await src.commandIds()
  return []
}

export async function complete(line: string, src: Source): Promise<string[]> {
  const { words, partial, quote } = split(line)
  const before = partial || quote ? words.slice(0, -1) : words
  const help = before[0] === "help" ? 1 : 0
  const said = before.slice(help)
  const quoted = (c: string) => {
    const q = quote || (/[\s'"\\]/.test(c) ? "\"" : "")
    return q ? `${q}${c}${c.endsWith("/") ? "" : q}` : c
  }
  const starts = (xs: string[]) => [...new Set(xs)].filter((x) => x.startsWith(partial)).sort()
  const n = said.length
  const next = src.ops.flatMap((e) => {
    const cli = (e.cli ?? "").split(" ").filter(Boolean)
    return cli.length > n && said.every((w, i) => cli[i] === w) ? [cli[n]] : []
  })
  const hit = named(src.ops, said)
  if (!hit) {
    if (!n) next.push(...src.local, ...(help ? [] : ["help", "exit"]))
    if (!n && (partial.includes(".") || !starts(next).length)) next.push(...src.ops.map((e) => e.id))
    return starts(next)
  }
  const { op, used } = hit
  const props = op.params.properties ?? {}
  const rest = said.slice(used)
  if (help) return rest.length ? [] : starts(next)
  if (partial.startsWith("-")) return starts([...Object.keys(props).map(flagOf), ...GLOBAL_FLAGS])
  const prev = rest.at(-1)
  const flagged = prev?.startsWith("--") ? camel(prev.slice(2)) : null
  let key: string | undefined
  if (flagged && props[flagged] && props[flagged].type !== "boolean") key = flagged
  else {
    let n = 0
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].startsWith("--")) { const k = camel(rest[i].slice(2)); if (props[k] && props[k].type !== "boolean" && !rest[i].includes("=")) i++; continue }
      n++
    }
    key = op.args[Math.min(n, op.args.length - 1)]
    if (n >= op.args.length && !(key && (props[key]?.type === "array" || props[key]?.type === "string"))) key = undefined
  }
  const sub = rest.length ? [] : starts(next)
  if (!key) return sub
  const values = await valuesOf(key, props[key], src, partial)
  const pre = values.filter((v) => v.startsWith(partial))
  return [...sub, ...(pre.length ? pre : values).sort().map(quoted)]
}

const HISTORY_MAX = 1000

export async function repl(): Promise<number> {
  const ctx = new Ctx()
  let ops: OpEntry[] = []
  try {
    const r = await ctx.api("GET", "ops")
    if (r.status === 200 && Array.isArray(r.body)) ops = r.body as OpEntry[]
  } catch (e) {
    if (!(e instanceof CliError)) throw e
  }
  const local = (await commands()).map((c) => c.name)
  const once = <T,>(fn: () => Promise<T>, fallback: T) => {
    let p: Promise<T> | null = null, at = 0
    return () => {
      if (!p || Date.now() - at > 30_000) { at = Date.now(); p = fn().catch(() => fallback) }
      return p
    }
  }
  const src: Source = {
    ops, local,
    files: once(async () => {
      const t = Listed.parse(await ctx.call("POST", "ops/file.list", { limit: 100000 }))
      return (t.files ?? []).map((f) => String(f.path))
    }, [] as string[]),
    commandIds: once(async () => (Commands.parse(await ctx.call("POST", "ops/ui.commands", {})).commands ?? []).map((c) => String(c.id)), [] as string[]),
  }

  const file = path.join(userData(), "vau_history")
  let history: string[] = []
  try { history = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).reverse().slice(0, HISTORY_MAX) } catch { /* none yet */ }
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, prompt: "vau> ", history, historySize: HISTORY_MAX, removeHistoryDuplicates: true,
    completer: (line: string, cb: (e: Error | null, r: [string[], string]) => void) => {
      complete(line, src).then((c) => cb(null, [c, line.slice(split(line).start)]), () => cb(null, [[], line]))
    },
  })
  rl.on("history", (h: string[]) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, [...h].reverse().join("\n") + "\n")
    } catch { /* not kept: still works */ }
  })
  process.stdout.write(`vau ${ops.length ? `(${ctx.url})` : `(${ctx.down()})`}: a command as you'd type it after vau; Tab completes, help lists them, exit leaves.\n`)

  let busy = false, interrupted = false
  rl.on("SIGINT", () => {
    if (busy) process.exit(130)
    if (rl.line || !interrupted) {
      interrupted = !rl.line
      process.stdout.write(rl.line ? "\n" : "\n(Ctrl-C again or exit to leave)\n")
      rl.write(null, { ctrl: true, name: "u" })
      rl.prompt()
      return
    }
    rl.close()
  })
  const noStdin = () => Promise.reject(new CliError("stdin is the prompt here: give the text as an argument (quoted), or run vau ... with it piped in"))
  rl.prompt()
  for await (const line of rl) {
    interrupted = false
    const words = split(line).words
    if (words[0] === "vau") words.shift()
    if (!words.length) { rl.prompt(); continue }
    if (words[0] === "exit" || words[0] === "quit") break
    busy = true
    try {
      const r = await execute(words, { stdin: noStdin })
      await print(r, !!parseArgs(words).flags.copy)
    } catch (e) {
      process.stderr.write(`vau: ${(e as Error).message}\n`)
    }
    busy = false
    rl.prompt()
  }
  rl.close()
  return 0
}
