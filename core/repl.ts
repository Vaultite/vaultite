// vau's prompt: `vau` with no arguments in a terminal. Each line runs as `vau <line>` would (core/cli.ts execute); Tab
// completes commands, their flags and values (choices, the vault's files, palette commands) from the server's catalog.
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { commands, Ctx, CliError, execute, parseArgs, print, userData, type Obj } from "./cli.ts"
import type { OpEntry, Schema } from "./ops.ts"

const GLOBAL_FLAGS = ["--json", "--copy", "--count", "--paths", "--help"]
const kebab = (k: string) => k.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)
const camel = (k: string) => k.replace(/-([a-z])/g, (_, x: string) => x.toUpperCase())

/** A line split like a shell does (quotes, backslashes): its words, and the last one as typed so far (`partial`, from
 *  `start`; "" after a space) with the quote it's open in. */
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
  if (inWord) words.push(cur) // (a quote left open ends with the line)
  return { words, partial: inWord ? cur : "", start: inWord ? start : line.length, quote: inWord ? opened : "" }
}

/** What Tab can offer: the catalog, and values fetched once when first needed. */
export type Source = {
  ops: OpEntry[]
  local: string[]
  /** The vault's file paths. */
  files: () => Promise<string[]>
  /** The palette's command ids. */
  commandIds: () => Promise<string[]>
}

/** The op a line's words name (by id or cli name, the longest), and how many words named it. */
function named(ops: OpEntry[], words: string[]): { op: OpEntry; used: number } | null {
  let best: { op: OpEntry; used: number } | null = null
  for (const op of ops) {
    if (op.id === words[0]) return { op, used: 1 }
    const cli = (op.cli ?? "").split(" ").filter(Boolean)
    if (cli.length && cli.length <= words.length && cli.every((w, i) => words[i] === w) && (!best || cli.length > best.used)) best = { op, used: cli.length }
  }
  return best
}

/** The values a parameter can take that are cheap to list. */
async function valuesOf(key: string, s: Schema | undefined, src: Source, partial: string): Promise<string[]> {
  if (!s) return []
  if (s.enum) return s.enum.map(String)
  if (s.type === "boolean") return ["true", "false"]
  if (s.format === "path" || key === "path" || key === "folder") {
    // One folder at a time: what's under the part typed (People/, then People/Alice Park.md).
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
    return dirs ? [] : files.filter((f) => f.toLowerCase().includes(low)).slice(0, 50) // a name anywhere: Alice
  }
  if ((key === "id" || key === "command") && /command|hotkey/.test(s.description ?? "")) return await src.commandIds()
  return []
}

/** What Tab completes the last word of a line with: the candidates, as they'd be typed (quoted when they need it). */
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
  // A command's words: the next word of the cli names that start with the words said so far (`inbox` then `add`).
  const n = said.length
  const next = src.ops.flatMap((e) => {
    const cli = (e.cli ?? "").split(" ").filter(Boolean)
    return cli.length > n && said.every((w, i) => cli[i] === w) ? [cli[n]] : []
  })
  const hit = named(src.ops, said)
  if (!hit) {
    if (!n) next.push(...src.local, ...(help ? [] : ["help", "exit"]))
    // (ids too once one's being typed, or when no name fits: 120 of them would bury the names)
    if (!n && (partial.includes(".") || !starts(next).length)) next.push(...src.ops.map((e) => e.id))
    return starts(next)
  }
  const { op, used } = hit
  const props = op.params.properties ?? {}
  const rest = said.slice(used)
  if (help) return rest.length ? [] : starts(next)
  if (partial.startsWith("-")) return starts([...Object.keys(props).map((k) => `--${kebab(k)}`), ...GLOBAL_FLAGS])
  // The flag before this word takes a value: its values; else the next positional parameter's.
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
  const sub = rest.length ? [] : starts(next) // (a group's own op, `inbox`, and its others, `inbox add`)
  if (!key) return sub
  const values = await valuesOf(key, props[key], src, partial)
  const pre = values.filter((v) => v.startsWith(partial))
  return [...sub, ...(pre.length ? pre : values).sort().map(quoted)]
}

const HISTORY_MAX = 1000

/** The prompt: runs until exit (or Ctrl-D, or Ctrl-C twice). */
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
      const t = await ctx.call("POST", "ops/file.list", { limit: 100000 }) as Obj
      return (t.files ?? []).map((f: Obj) => String(f.path))
    }, [] as string[]),
    commandIds: once(async () => ((await ctx.call("POST", "ops/ui.commands", {}) as Obj).commands ?? []).map((c: Obj) => String(c.id)), [] as string[]),
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
    if (busy) process.exit(130) // (a command can't be stopped halfway: vau stops)
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
