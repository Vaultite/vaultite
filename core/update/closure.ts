import fs from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"
import { parseSync } from "rolldown/utils"
import { ENTRIES, type Entry, GENERATED, PLUGIN_READS, ROOT_EXPORTS, SITES, type Site } from "./sites.ts"
import { messageOf } from "../values.ts"

/** Paths are the repo's, with "/". */
export type Tree = { files: string[]; read: (file: string) => string | null }

/** What the graph can't follow in a file: a computed import (`import`), a path made from the code's own place
 *  (`anchor`: import.meta, the core's ROOT), or a process started from a file (`spawn`). */
export type Loose = { file: string; line: number; kind: "import" | "anchor" | "spawn"; text: string }
type Ref = { spec: string; kind: "import" | "require" | "worker" | "asset" | "css"; line: number; names?: string[] }
type Parsed = { refs: Ref[]; globs: { patterns: string[]; line: number }[]; loose: Loose[]; plugin: boolean }

/** One entry's reach: every file it reaches and the one that brought each in (null: the entry's own), and the loose
 *  ends nobody declared in what it reaches (any makes its answer unknown). */
export type Reach = { files: Map<string, string | null>; unknown: Loose[] }
/** A change's answer for one entry: not reached (null), reached (the changed file nearest the entry, and its chain of
 *  imports from the entry), or unknown (counted as reached). */
export type Hit = { file: string; chain: string[]; unknown?: Loose }

const isCode = (f: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f) && !/\.d\.[mc]?ts$/.test(f) || /^bin\/[^./]+$/.test(f)
const DEPS = ["package.json", "package-lock.json"]
const VITE_EXT = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]
const REQUIRE_EXT = [".js", ".json", ".node", ".cjs"]
const PLUGIN_MODULE = /^@plugins\/([a-z][a-z0-9-]*)\/([\w-]+(?:\/[\w-]+)*)$/
const VAULT_CORE = /^@vaultite\/core\/([\w-]+)(?:\.ts)?$/
const BUILTIN = new Set(builtinModules)

/** A glob as a RegExp: `*` within a folder, `**` across them, `{a,b}`. */
export function globRe(glob: string) {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*" && glob[i + 1] === "*") { i++; if (glob[i + 1] === "/") { i++; re += "(?:.*/)?" } else re += ".*" }
    else if (c === "*") re += "[^/]*"
    else if (c === "?") re += "[^/]"
    else if (c === "{") re += "(?:"
    else if (c === "}") re += ")"
    else if (c === ",") re += "|"
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

function lines(text: string) {
  const starts = [0]
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1)
  return (at: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1 } return lo + 1 }
}
const unparen = (n: any): any => (n?.type === "ParenthesizedExpression" ? unparen(n.expression) : n)
const literal = (n: any): string | null => {
  n = unparen(n)
  if (n?.type === "Literal" && typeof n.value === "string") return n.value
  if (n?.type === "TemplateLiteral" && !n.expressions.length) return n.quasis[0].value.cooked
  return null
}
const isMeta = (n: any, prop?: string) => {
  n = unparen(n)
  return n?.type === "MemberExpression" && n.object?.type === "MetaProperty" && n.object.meta?.name === "import" && !n.computed && (!prop || n.property?.name === prop)
}
/** `new URL("./x", import.meta.url)`: a file beside this one. */
const besideUrl = (n: any) => {
  n = unparen(n)
  return n?.type === "NewExpression" && n.callee?.name === "URL" && n.arguments.length === 2 && literal(n.arguments[0]) !== null && isMeta(n.arguments[1], "url") ? literal(n.arguments[0]) : null
}
const isRequire = (callee: any) => { callee = unparen(callee); return callee?.type === "Identifier" && callee.name === "require" || callee?.type === "CallExpression" && unparen(callee.callee)?.name === "createRequire" }

export function parse(file: string, text: string): Parsed {
  const out: Parsed = { refs: [], globs: [], loose: [], plugin: false }, lineAt = lines(text)
  if (file.endsWith(".html")) {
    for (const m of text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) out.refs.push({ spec: m[1], kind: "asset", line: lineAt(m.index) })
    return out
  }
  if (file.endsWith(".css")) {
    for (const m of text.matchAll(/@(import|plugin|source|reference)\s+(?:url\()?["']([^"']+)["']/g)) out.refs.push({ spec: m[2], kind: m[1] === "source" ? "css" : "import", line: lineAt(m.index) })
    for (const m of text.matchAll(/url\(\s*["']?(\.{1,2}\/[^"')]+)["']?\s*\)/g)) out.refs.push({ spec: m[1], kind: "asset", line: lineAt(m.index) })
    return out
  }
  const lang = /\.(tsx)$/.test(file) ? "tsx" : /\.(ts|mts|cts)$/.test(file) ? "ts" : /\.jsx$/.test(file) ? "jsx" : "js"
  const r = parseSync(file, text, { lang, sourceType: file.endsWith(".cjs") ? "commonjs" : "module" })
  // (what doesn't parse may hide an import: unknown)
  const error = r.errors.find((e) => e.severity === "Error")
  if (error) out.loose.push({ file, line: lineAt(error.labels[0]?.start ?? 0), kind: "import", text: `doesn't parse: ${error.message}` })
  const loose = (kind: Loose["kind"], n: any) => out.loose.push({ file, line: lineAt(n.start), kind, text: text.slice(n.start, Math.min(n.end, n.start + 160)).replace(/\s+/g, " ") })
  /** child_process' fork, by its names here (a function of one's own named fork is no process). */
  const forks = new Set<string>()
  const ref = (spec: string, kind: Ref["kind"], n: any, names?: string[]) => out.refs.push({ spec, kind, line: lineAt(n.start), ...(names ? { names } : {}) })
  const visit = (n: any, parent: any) => {
    if (Array.isArray(n)) { for (const x of n) visit(x, parent); return }
    if (!n || typeof n !== "object" || typeof n.type !== "string") return
    switch (n.type) {
      case "ImportDeclaration":
        if (n.importKind !== "type") ref(n.source.value, "import", n, n.specifiers.map((s: any) => s.imported?.name ?? s.local?.name))
        if (/^(node:)?child_process$/.test(n.source.value)) for (const s of n.specifiers) if (s.imported?.name === "fork") forks.add(s.local.name)
        return
      case "ExportNamedDeclaration": case "ExportAllDeclaration":
        if (n.source && n.exportKind !== "type") ref(n.source.value, "import", n)
        break
      case "ImportExpression": {
        const s = literal(n.source)
        if (s !== null) ref(s, "import", n); else loose("import", n)
        break
      }
      case "CallExpression": {
        const callee = unparen(n.callee)
        if (isRequire(callee) || callee?.type === "MemberExpression" && callee.property?.name === "resolve" && isRequire(callee.object)) {
          const s = literal(n.arguments[0])
          if (s !== null) ref(s, "require", n); else loose("import", n)
        } else if (isMeta(callee, "glob")) {
          const a = unparen(n.arguments[0]), list = a?.type === "ArrayExpression" ? a.elements.map(literal) : [literal(a)]
          if (list.every((x: string | null) => x !== null)) out.globs.push({ patterns: list, line: lineAt(n.start) }); else loose("import", n)
        } else if (callee?.type === "Identifier" && forks.has(callee.name) || callee?.type === "MemberExpression" && callee.property?.name === "fork" && unparen(callee.object)?.name === "utilityProcess") loose("spawn", n)
        break
      }
      case "NewExpression": {
        const name = unparen(n.callee)?.name
        if (name === "Worker" || name === "SharedWorker") {
          const s = besideUrl(n.arguments[0])
          if (s !== null) { ref(s, "worker", n); visit(n.arguments.slice(1), n); return }
          loose("import", n)
        } else if (name === "URL" && besideUrl(n) !== null) { ref(besideUrl(n)!, "asset", n); return }
        else if (name === "Plugin" && n.arguments.length === 1 && isMeta(n.arguments[0], "url")) { out.plugin = true; return }
        break
      }
      case "MemberExpression":
        if (isMeta(n)) {
          const prop = n.property?.name
          // (vite's own: env, hot, glob; createRequire(import.meta.url) resolves what it's given, read above)
          if (!["env", "hot", "glob", "main"].includes(prop) && !(prop === "url" && parent?.type === "CallExpression" && unparen(parent.callee)?.name === "createRequire")) loose("anchor", n)
          return
        }
        if (unparen(n.object)?.name === "process" && n.property?.name === "execPath" && !n.computed) { loose("spawn", n); return }
        break
    }
    for (const k in n) if (k !== "type" && k !== "start" && k !== "end") { const v = n[k]; if (v && typeof v === "object") visit(v, n) }
  }
  visit(r.program, null)
  return out
}

/** A tree's parses, kept by file and text: a graph made again after a change parses only what changed. */
export type ParseCache = Map<string, { text: string; parsed: Parsed }>

/** The working tree at `root`, less what no process runs (node_modules, builds, a checkout's data, iOS, hidden). */
export function diskTree(root: string): Tree {
  const files: string[] = []
  const skip = new Set(["data", "dist-app", "ios", "screenshots", "web/dist"])
  const walk = (dir: string, rel: string) => {
    let list: fs.Dirent[]
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      if (e.name.startsWith(".") || e.name === "node_modules" || (e.isDirectory() && skip.has(rel ? `${rel}/${e.name}` : e.name))) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r); else if (e.isFile()) files.push(r)
    }
  }
  walk(root, "")
  return { files: files.sort(), read: (f) => { try { return fs.readFileSync(path.join(root, f), "utf8") } catch { return null } } }
}

export function graphOf(tree: Tree, o: { cache?: ParseCache; entries?: Entry[]; sites?: Site[] } = {}) {
  const entries = o.entries ?? ENTRIES, sites = o.sites ?? SITES, cache = o.cache ?? new Map()
  const all = new Set(tree.files)
  const parsed = (file: string): Parsed => {
    const text = tree.read(file) ?? ""
    const c = cache.get(file)
    if (c && c.text === text) return c.parsed
    let p: Parsed
    try { p = parse(file, text) } catch (e) { p = { refs: [], globs: [], plugin: false, loose: [{ file, line: 1, kind: "import", text: `doesn't parse: ${messageOf(e)}` }] } }
    cache.set(file, { text, parsed: p })
    return p
  }
  const matched = new Map<string, string[]>(), under = new Map<string, string[]>()
  const matching = (globs: string[]) => {
    const key = globs.join("\0")
    let out = matched.get(key)
    if (!out) {
      const res = globs.map((g) => ({ not: g.startsWith("!"), re: globRe(g.replace(/^!/, "")) }))
      matched.set(key, out = globs.length ? tree.files.filter((f) => res.some((r) => !r.not && r.re.test(f)) && !res.some((r) => r.not && r.re.test(f))) : [])
    }
    return out
  }
  const filesUnder = (dir: string) => {
    let out = under.get(dir)
    if (!out) under.set(dir, out = tree.files.filter((f) => f.startsWith(`${dir}/`)))
    return out
  }
  const generated = GENERATED.map(globRe)
  const sitesOf = new Map<string, Site[]>()
  for (const s of sites) sitesOf.set(s.file, [...(sitesOf.get(s.file) ?? []), s])
  const declared = (l: Loose) => (sitesOf.get(l.file) ?? []).some((s) =>
    l.kind === "import" ? !!s.at?.some((a) => l.text.includes(a)) : l.kind === "spawn" ? !!s.spawns : !!s.anchors)

  const exportFile = (id: string, name: string, via: string[]) => {
    const dir = `plugins/core/${id}`, m = tree.read(`${dir}/manifest.json`)
    if (m === null) return null
    via.push(`${dir}/manifest.json`)
    let ex: unknown
    try { ex = JSON.parse(m).exports } catch { return null }
    if (!Array.isArray(ex) || !ex.includes(name)) return null
    return [".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => `${dir}/${name}${x}`).find((f) => all.has(f)) ?? null
  }
  /** Where `spec` from `from` goes: a file, a package (its deps), nothing (a builtin, a virtual module) or missing. */
  const resolve = (spec: string, from: string, mode: Entry["mode"], kind: Ref["kind"]): { file?: string; deps?: true; missing?: true; via: string[] } => {
    const via: string[] = []
    spec = spec.replace(/[?#].*$/, "")
    if (!spec || /^(https?:|data:|virtual:|\0)/.test(spec) || spec.startsWith("node:") || BUILTIN.has(spec) || spec === "electron" || spec.startsWith("electron/")) return { via }
    const mod = PLUGIN_MODULE.exec(spec)
    if (mod) { const f = exportFile(mod[1], mod[2], via); return f ? { file: f, via } : { missing: true, via } }
    const core = VAULT_CORE.exec(spec)
    if (core) return all.has(`core/${core[1]}.ts`) ? { file: `core/${core[1]}.ts`, via } : { missing: true, via }
    let base: string
    if (mode === "vite" && spec === "@vaultite") base = "web/src/api.ts"
    else if (mode === "vite" && spec.startsWith("@/")) base = `web/src/${spec.slice(2)}`
    else if (mode === "vite" && spec.startsWith("/")) base = path.posix.join("web", spec)
    else if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") base = path.posix.join(path.posix.dirname(from), spec)
    else if (kind === "asset" && !spec.startsWith("@") && from.endsWith(".html")) base = path.posix.join(path.posix.dirname(from), spec)
    else return { deps: true, via }
    const tries = mode === "vite" ? [base, ...VITE_EXT.map((x) => base + x), ...VITE_EXT.map((x) => `${base}/index${x}`)]
      : kind === "require" ? [base, ...REQUIRE_EXT.map((x) => base + x), `${base}/index.js`] : [base]
    const file = tries.find((f) => all.has(f))
    if (file) return { file, via }
    // (html's icons and the manifest come from web/public; generated files are no source)
    if (mode === "vite" && from.endsWith(".html") && all.has(`web/public/${spec.replace(/^\.?\//, "")}`)) return { file: `web/public/${spec.replace(/^\.?\//, "")}`, via }
    if (generated.some((g) => g.test(base))) return { via }
    return { missing: true, via }
  }

  /** A file's loose ends: its own, and its imports of the app's folder (ROOT_EXPORTS). */
  const looseOf = (file: string, p: Parsed, mode: Entry["mode"]) => [...p.loose, ...p.refs.flatMap((r) => {
    if (!r.names) return []
    const to = resolve(r.spec, file, mode, r.kind).file
    return ROOT_EXPORTS.filter((x) => x.file === to && r.names!.includes(x.name)).map((x): Loose => ({ file, line: r.line, kind: "anchor", text: `imports ${x.name} from ${x.file}` }))
  })]

  const reaches = new Map<string, Reach>()
  const walk = (from: string[], mode: Entry["mode"], cut: Set<string>): Reach => {
    const files = new Map<string, string | null>(), unknown: Loose[] = [], todo: [string, Entry["mode"]][] = []
    /** Sites whose code runs only beside their caller, until the entry reaches it too. */
    const waiting: [Site, string, Entry["mode"]][] = []
    const add = (f: string, by: string | null, m: Entry["mode"], follow: boolean) => {
      if (files.has(f) || cut.has(f)) return
      files.set(f, by)
      if (follow) todo.push([f, m])
    }
    const apply = (s: Site, file: string, m: Entry["mode"]) => {
      for (const f of matching(s.loads ?? [])) add(f, file, s.mode ?? m, true)
      for (const f of matching(s.reads ?? [])) add(f, file, m, false)
    }
    const visit = (file: string, m: Entry["mode"]) => {
      if (!isCode(file) && !/\.(html|css)$/.test(file)) return
      const p = parsed(file)
      for (const l of looseOf(file, p, m)) if (!declared(l)) unknown.push(l)
      for (const r of p.refs) {
        if (r.kind === "css") { // (Tailwind's @source: every file in that folder, for the classes it names)
          for (const f of filesUnder(path.posix.join(path.posix.dirname(file), r.spec))) add(f, file, m, false)
          continue
        }
        const to = resolve(r.spec, file, m, r.kind)
        for (const v of to.via) add(v, file, m, false)
        if (to.deps) for (const d of DEPS) add(d, file, m, false)
        if (to.missing) unknown.push({ file, line: r.line, kind: "import", text: `${r.spec}: no such file here` })
        if (to.file) add(to.file, file, m, true)
      }
      const dir = path.posix.dirname(file)
      for (const g of p.globs) {
        const abs = g.patterns.map((x) => { const not = x.startsWith("!"), pat = x.replace(/^!/, ""); return (not ? "!" : "") + path.posix.join(pat.startsWith("/") ? "web" : dir, pat) })
        for (const f of matching(abs)) add(f, file, m, true)
      }
      if (p.plugin) for (const f of filesUnder(dir)) if (PLUGIN_READS.test(f) && !f.slice(dir.length + 1).split("/").some((x) => x.startsWith("."))) add(f, file, m, false)
      for (const s of sitesOf.get(file) ?? []) if (s.caller && !files.has(s.caller)) waiting.push([s, file, m]); else apply(s, file, m)
    }
    for (const f of from) if (all.has(f)) add(f, null, mode, true); else unknown.push({ file: f, line: 0, kind: "import", text: "the entry isn't in this tree" })
    for (;;) {
      for (let next; (next = todo.shift());) visit(...next)
      const ready = waiting.filter(([s]) => files.has(s.caller!))
      if (!ready.length) return { files, unknown }
      for (const w of ready) { waiting.splice(waiting.indexOf(w), 1); apply(...w) }
    }
  }
  /** An entry's reach: its own, or (a slice) what its process reaches only through it. */
  const reach = (id: string): Reach => {
    let r = reaches.get(id)
    if (r) return r
    const e = entries.find((x) => x.id === id)
    if (!e) throw new Error(`no entry ${id}`)
    if (e.within) {
      const whole = walk(entries.find((x) => x.id === e.within)!.from, e.mode, new Set())
      const rest = reach(e.within)
      const files = new Map<string, string | null>()
      for (const [f, by] of whole.files) if (!rest.files.has(f)) files.set(f, by && !rest.files.has(by) ? by : null)
      const key = (l: Loose) => `${l.file}:${l.line}:${l.text}`, known = new Set(rest.unknown.map(key))
      r = { files, unknown: whole.unknown.filter((l) => !known.has(key(l)) && files.has(l.file)) }
    } else r = walk(e.from, e.mode, new Set(e.cut ?? []))
    reaches.set(id, r)
    return r
  }
  const chainOf = (r: Reach, file: string) => {
    const chain = [file]
    for (let by = r.files.get(file); by; by = r.files.get(by)) chain.unshift(by)
    return chain
  }
  /** The changed file nearest the entry, or null. */
  const hit = (id: string, changed: string[]): Hit | null => {
    const r = reach(id)
    let best: Hit | null = null
    for (const f of changed) if (r.files.has(f)) { const chain = chainOf(r, f); if (!best || chain.length < best.chain.length) best = { file: f, chain } }
    if (!best && r.unknown.length && changed.length) return { file: changed[0], chain: [], unknown: r.unknown[0] }
    return best
  }
  const looseEnds = (globs: string[]) => matching(globs).filter(isCode)
    .flatMap((f) => looseOf(f, parsed(f), "node").map((l) => ({ ...l, declared: declared(l) })))
  return { entries, reach, hit, chainOf, looseEnds, affects: (changed: string[]) => entries.map((e) => ({ entry: e.id, hit: hit(e.id, changed) })) }
}
export type Graph = ReturnType<typeof graphOf>
