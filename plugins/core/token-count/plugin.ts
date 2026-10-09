// Token count's server side: each Markdown file's tokens against its limit (limits.ts), and what Claude Code loads with
// a CLAUDE.md's @imports, for the app (its part of /api/state) and for agents (the op token-count.size: `vau size`).
import fs from "node:fs"
import path from "node:path"
import { OpError, pathAsSaid, Plugin } from "../../../core/plugins.ts"
import { parseText, type Vault } from "../../../core/vault.ts"
import { estimateTokens, tokenText } from "./estimate.ts"
import { importsOf, isChainRoot, levelOf, limitFor, type Limits, limitsOf, type Link, MAX_DEPTH, pathLike, type Sized, worse } from "./limits.ts"

export const plugin = new Plugin(import.meta.url)

const decls = plugin.manifest.settings ?? {}
const DEFAULTS: Limits = { limit: decls.limit?.default ?? 0, limits: decls.limits?.default ?? {} }
export const limits = () => limitsOf(plugin.settings(), DEFAULTS)

// Read again only when a file's stat changed: the text's tokens, its imports and its frontmatter.
type Read = { ns: bigint; size: number; tokens: number; imports: string[]; fm: Record<string, unknown> }
const reads = new Map<string, Read>()

function readAt(vault: Vault, rel: string, stat?: { ns: bigint; size: number }): Read | null {
  const abs = vault.abs(rel)
  let st = stat
  if (!st) {
    try { const s = fs.statSync(abs, { bigint: true }); if (!s.isFile()) return null; st = { ns: s.mtimeNs, size: Number(s.size) } } catch { return null }
  }
  const had = reads.get(abs)
  if (had && had.ns === st.ns && had.size === st.size) return had
  let text: string
  try { text = fs.readFileSync(abs, "utf8") } catch { return null } // (any size the index reads too; past what a string holds, none)
  let fm: Record<string, unknown> = {}
  if (rel.endsWith(".md")) try { fm = parseText(text)[0] } catch { /* a header that doesn't parse: no max_tokens */ }
  const r = { ns: st.ns, size: st.size, tokens: estimateTokens(text), imports: rel.endsWith(".md") ? importsOf(text) : [], fm }
  reads.set(abs, r)
  return r
}

/** Agent files in hidden folders (the vault's rules, skills): the index leaves hidden folders out. */
function hiddenAgentFiles(vault: Vault): string[] {
  const out = [".vaultite/AGENTS.md"].filter((p) => fs.existsSync(vault.abs(p)))
  const walk = (dir: string, depth: number) => {
    let names: fs.Dirent[]
    try { names = fs.readdirSync(vault.abs(dir), { withFileTypes: true }) } catch { return }
    for (const d of names) {
      const rel = `${dir}/${d.name}`
      if (d.isDirectory() && depth < 6 && d.name !== "node_modules") walk(rel, depth + 1)
      else if (d.isFile() && d.name.endsWith(".md")) out.push(rel)
    }
  }
  for (const dir of [".claude", ".agents"]) walk(dir, 0)
  return out
}

/** An import as a vault path, Claude Code's way (relative to the file importing it; `~/` is the home folder): null for
 *  one outside the vault. */
function resolveImport(vault: Vault, from: string, p: string): string | null {
  if (p.startsWith("~/")) return null
  const root = path.resolve(vault.path)
  const abs = path.isAbsolute(p) ? p : path.resolve(root, path.dirname(from), p)
  const rel = path.relative(root, abs)
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : null
}

/** What an agent loads with `root`: it and its imports, depth first, each file once (a cycle ends there). */
function chainOf(vault: Vault, root: string, first: Read) {
  const chain: Link[] = [], outside = new Set<string>(), missing = new Set<string>()
  const seen = new Set([root])
  const visit = (from: string, r: Read, depth: number) => {
    if (depth > MAX_DEPTH) return
    for (const p of r.imports) {
      const rel = resolveImport(vault, from, p)
      if (rel === null) { if (pathLike(p)) outside.add(p); continue }
      if (seen.has(rel)) continue
      const sub = readAt(vault, rel)
      if (!sub) { if (pathLike(p)) missing.add(p); continue }
      seen.add(rel)
      chain.push({ path: rel, tokens: sub.tokens, depth, from })
      visit(rel, sub, depth + 1)
    }
  }
  visit(root, first, 1)
  return { chain, total: first.tokens + chain.reduce((n, l) => n + l.tokens, 0), outside: [...outside], missing: [...missing] }
}

function size(vault: Vault, rel: string, r: Read, l: Limits): Sized {
  const limit = limitFor(rel, r.fm, l)
  const out: Sized = { path: rel, tokens: r.tokens, limit, level: levelOf(r.tokens, limit) }
  if (isChainRoot(rel) && r.imports.length) {
    const c = chainOf(vault, rel, r)
    if (c.chain.length || c.outside.length || c.missing.length) {
      Object.assign(out, { chain: c.chain }, c.chain.length ? { total: c.total, level: worse(out.level, levelOf(c.total, limit)) } : {},
        c.outside.length ? { outside: c.outside } : {}, c.missing.length ? { missing: c.missing } : {})
    }
  }
  return out
}

/** Every Markdown file sized (the index's, and agent files in hidden folders), biggest first. */
export function sizes(vault: Vault): Sized[] {
  const l = limits(), out: Sized[] = []
  const live = new Set<string>()
  for (const e of vault.entries.values()) {
    const r = readAt(vault, e.rel, e.stat)
    live.add(vault.abs(e.rel))
    if (r) out.push(size(vault, e.rel, r, l))
  }
  for (const rel of hiddenAgentFiles(vault)) {
    const r = readAt(vault, rel)
    live.add(vault.abs(rel))
    if (r) out.push(size(vault, rel, r, l))
  }
  for (const k of reads.keys()) if (!live.has(k) && !fs.existsSync(k)) reads.delete(k)
  return out.sort((a, b) => (b.total ?? b.tokens) - (a.total ?? a.tokens) || a.path.localeCompare(b.path))
}

/** What the app needs: the files near or over their limit, and every load chain. */
const flagged = (s: Sized) => s.level !== "ok" || s.chain !== undefined
plugin.state(() => ({ tokenCount: { limits: limits(), files: sizes(plugin.vault).filter(flagged) } }))

/** An absolute path (a Claude Code hook's) as a vault path; null when it's outside the vault. */
function vaultRel(vault: Vault, p: string): string | null {
  if (!path.isAbsolute(p)) return p.replace(/^\.\//, "")
  for (const root of new Set([path.resolve(vault.path), (() => { try { return fs.realpathSync(vault.path) } catch { return vault.path } })()])) {
    const rel = path.relative(root, p)
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/")
  }
  return null
}

const short = (n: number) => tokenText(n).replace(/^~| tokens?$/g, "")
const line = (s: Sized) => `- ${s.path}: ${tokenText(s.tokens)}` +
  (s.total !== undefined ? `, ~${short(s.total)} with its imports` : "") + (s.limit ? ` (limit ${short(s.limit)})` : " (no limit)")
const chainText = (s: Sized) => [
  ...(s.chain ?? []).map((c) => `  ${"  ".repeat(c.depth - 1)}- @${c.path}: ${tokenText(c.tokens)}`),
  ...(s.outside?.length ? [`  - not counted, outside the vault: ${s.outside.join(", ")}`] : []),
  ...(s.missing?.length ? [`  - not found: ${s.missing.join(", ")}`] : []),
]

plugin.op({
  id: "token-count.size",
  cli: "size",
  summary: "Markdown files over or near their token limit (agent files like CLAUDE.md and AGENTS.md are stricter), and what a CLAUDE.md or AGENTS.md loads with its @imports.",
  help: `Sizes are estimates of Claude's tokens, as the status bar shows them. Limits: the plugin's settings (\`limit\` for any
file, \`limits\` by name or path), or a file's own \`max_tokens\`. A file near its limit is at 80% of it. With a path:
that file (its size, limit and imports), or nothing with --over when it's under; a path outside the vault answers
nothing. Only warns: nothing stops a file from growing.

  vau size
  vau size CLAUDE.md
  vau size "$CLAUDE_PROJECT_DIR/AGENTS.md" --over   (in a Claude Code hook: \`vau docs token-count\`)`,
  kind: "read",
  params: {
    path: { type: "string", description: "one file (a vault path, or an absolute one inside the vault)" },
    over: { type: "boolean", description: "only what's over its limit" },
    all: { type: "boolean", description: "every Markdown file, not only those near or over their limit and the load chains" },
  },
  args: ["path"],
  run: ({ path: p, over, all }) => {
    const vault = plugin.vault
    let files = sizes(vault)
    if (p) {
      const rel = vaultRel(vault, p)
      if (rel === null) return { files: [], outside: p }
      const said = pathAsSaid({ files: files.map((s) => ({ path: s.path })) as never }, rel)
      const hit = files.find((s) => s.path === said)
      if (!hit) {
        if (over || !rel.endsWith(".md")) return { files: [] }
        throw new OpError(`no Markdown file '${rel}'`, 404)
      }
      files = [hit]
    } else if (!all) files = files.filter(flagged)
    if (over) files = files.filter((s) => s.level === "over")
    return { limits: limits(), files }
  },
  text: (r: { files: Sized[]; outside?: string }, params: { path?: string; over?: boolean }) => {
    if (r.outside) return params.over ? "" : `${r.outside} is outside the vault.`
    if (params.path) {
      const s = r.files[0]
      if (!s) return ""
      const head = s.level === "over" ? "Over its limit:" : s.level === "near" ? "Near its limit:" : "Under its limit:"
      return [head, line(s), ...chainText(s), ...(params.over ? ["Shorten it: move detail into files read when needed."] : [])].join("\n")
    }
    const over = r.files.filter((s) => s.level === "over"), near = r.files.filter((s) => s.level === "near")
    const chains = r.files.filter((s) => s.chain && !params.over), rest = r.files.filter((s) => s.level === "ok" && !s.chain)
    const part = (title: string, xs: Sized[], chain = false) =>
      xs.length ? [`${title} (${xs.length}):`, ...xs.flatMap((s) => [line(s), ...(chain ? chainText(s) : [])]), ""] : []
    const out = [...part("Over their limit", over), ...part("Near their limit", near),
      ...part("Loaded at startup (a CLAUDE.md or AGENTS.md and its imports)", chains, true), ...part("Under their limit", rest)]
    return out.length ? out.join("\n").trimEnd() : params.over ? "" : "No file is near its limit."
  },
})
