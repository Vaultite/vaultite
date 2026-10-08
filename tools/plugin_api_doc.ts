// core/docs/plugin-api.md, the plugin API's reference, written from the code's own doc comments: the backend's Plugin
// class, definePlugin's keys and "@vaultite"'s names. node tools/plugin_api_doc.ts (npm run check says when it's stale).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseAst } from "rolldown/parseAst"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const OUT = path.join(ROOT, "core", "docs", "plugin-api.md")
const NAMES = path.join(ROOT, "core", "docs", "plugin-api-names.md")
type Node = { type: string; start: number; end: number; [k: string]: any }

const parse = (rel: string) => {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
  return { src, ast: parseAst(src, { lang: rel.endsWith(".tsx") ? "tsx" : "ts" }, rel) as unknown as { body: Node[] } }
}

/** The /** comment right before `at`, as one line. */
function docBefore(src: string, at: number) {
  const before = src.slice(0, at).trimEnd()
  if (!before.endsWith("*/")) return ""
  const open = before.lastIndexOf("/**")
  if (open < 0) return ""
  return before.slice(open + 3, -2).split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).join(" ").replace(/\s+/g, " ").trim()
}

function backend() {
  const { src, ast } = parse("core/plugins.ts")
  const cls = ast.body.map((n) => n.declaration ?? n).find((n) => n.type === "ClassDeclaration" && n.id?.name === "Plugin")!
  const out: string[] = []
  for (const m of cls.body.body as Node[]) {
    if (m.type !== "MethodDefinition" || m.kind === "constructor" || m.accessibility === "private" || m.key.type !== "Identifier") continue
    const doc = docBefore(src, m.start)
    if (!doc) continue
    const params = (m.value.params as Node[]).map((p) => src.slice(p.start, p.end).replace(/:[\s\S]*$/, "").replace(/\s*=.*$/, "").trim()).join(", ")
    out.push(`- \`plugin.${m.key.name}${m.kind === "get" ? "" : `(${params})`}\`: ${doc}`)
  }
  return out
}

/** A type of define.ts (PluginDef: index.tsx's definePlugin; Manifest: manifest.json), a line per key. */
function keysOf(type: string) {
  const { src, ast } = parse("web/src/core/define.ts")
  const def = ast.body.find((n) => n.type === "ExportNamedDeclaration" && n.declaration?.id?.name === type)!
  return (def.declaration.typeAnnotation.members as Node[]).filter((m) => m.type === "TSPropertySignature")
    .map((m) => `- \`${m.key.name}\`${m.optional ? "" : " (required)"}${docBefore(src, m.start) ? `: ${docBefore(src, m.start)}` : ""}`)
}

/** A doc comment's first sentence, at most a long line. */
const first = (doc: string) => { const d = /^.*?\.(?=\s|$)/.exec(doc)?.[0] ?? doc; return d.length > 200 ? `${d.slice(0, 197).replace(/\s+\S*$/, "")}…` : d }

/** A module the API re-exports, by its specifier ("@/core/files", "../../core/csv.ts"): its file. */
function moduleFile(spec: string) {
  const base = spec.startsWith("@/") ? path.join(ROOT, "web", "src", spec.slice(2)) : path.join(ROOT, "web", "src", spec)
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null
}

/** A declaration's first sentence and, for a function, its parameters: "(path, opts)". */
function describe(file: string, name: string): { params: string | null; doc: string } {
  const src = fs.readFileSync(file, "utf8")
  const ast = parseAst(src, { lang: file.endsWith("x") ? "tsx" : "ts" }, file) as unknown as { body: Node[] }
  const named = (p: Node): string => p.type === "Identifier" ? `${p.name}${p.optional ? "?" : ""}` : p.type === "AssignmentPattern" ? `${named(p.left)}?`
    : p.type === "RestElement" ? `...${named(p.argument)}` : p.type === "ObjectPattern" ? `{ ${(p.properties as Node[]).map((k) => k.key?.name ?? "…").join(", ")} }` : "…"
  const args = (ps: Node[]) => `(${ps.map(named).join(", ")})`
  for (const n of ast.body) {
    const d = n.type === "ExportNamedDeclaration" ? n.declaration : null
    if (!d) continue
    const v = d.type === "VariableDeclaration" ? (d.declarations as Node[]).find((x) => x.id?.name === name) : null
    if (d.id?.name !== name && !v) continue
    const fn = d.type === "FunctionDeclaration" ? d : v?.init && /Function/.test(v.init.type) ? v.init : null
    const doc = docBefore(src, n.start)
    return { params: fn ? args(fn.params) : null, doc: first(doc) }
  }
  return { params: null, doc: "" }
}

/** "@vaultite"'s names, each with its parameters and first sentence, from where it's defined. */
function exportsOf() {
  const { ast } = parse("web/src/api.ts")
  const out = new Map<string, string>()
  for (const n of ast.body) {
    if (n.type !== "ExportNamedDeclaration") continue
    const file = n.source ? moduleFile(n.source.value) : null
    for (const s of (n.specifiers ?? []) as Node[]) {
      const name = s.exported.name ?? s.exported.value, local = s.local?.name ?? name
      const d = file ? describe(file, local) : { params: null, doc: "" }
      out.set(name, `- \`${name}${d.params ?? ""}\`${d.doc ? `: ${d.doc}` : ""}`)
    }
    const d = n.declaration
    if (d?.id?.name) out.set(d.id.name, `- \`${d.id.name}\``)
  }
  return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([, l]) => l)
}

/** A server module's exports (core/<file>), each with its parameters and first sentence, re-exports followed. */
function serverExports(rel: string) {
  const file = path.join(ROOT, rel), { ast } = parse(rel)
  const out = new Map<string, string>()
  const line = (name: string, d: { params: string | null; doc: string }) => `- \`${name}${d.params ?? ""}\`${d.doc ? `: ${d.doc}` : ""}`
  for (const n of ast.body) {
    if (n.type !== "ExportNamedDeclaration" || n.exportKind === "type" && !n.declaration) continue
    if (n.source) {
      const from = path.resolve(path.dirname(file), n.source.value)
      for (const sp of (n.specifiers ?? []) as Node[]) if (sp.exportKind !== "type") out.set(sp.exported.name, line(sp.exported.name, describe(from, sp.local.name)))
      continue
    }
    const d = n.declaration, names = d?.id?.name ? [d.id.name] : ((d?.declarations ?? []) as Node[]).map((v) => v.id?.name).filter(Boolean)
    for (const name of names) if (name !== "Plugin") out.set(name, line(name, describe(file, name)))
  }
  return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([, l]) => l)
}

/** A type's or class's members, each with its doc: what a value of it has (a vault entry, a route's request). */
function shape(rel: string, name: string) {
  const { src, ast } = parse(rel)
  const d = ast.body.map((n) => n.declaration ?? n).find((n) => n.id?.name === name)!
  const members: Node[] = d.type === "ClassDeclaration" ? d.body.body : d.typeAnnotation?.members ?? d.typeAnnotation?.types?.flatMap((t: Node) => t.members ?? []) ?? []
  return members.filter((m) => m.key?.type === "Identifier" && m.accessibility !== "private" && m.kind !== "constructor" && !/^_/.test(m.key.name))
    .map((m) => `\`${m.key.name}${m.optional ? "?" : ""}\`${docBefore(src, m.start) ? ` (${first(docBefore(src, m.start)).replace(/\.$/, "")})` : ""}`).join("; ")
}

/** The services the app's plugins offer (plugin.provide), with the comment above each: what a plugin asks for by name. */
function services() {
  const dir = path.join(ROOT, "plugins", "core")
  const found = new Map<string, { plugins: Set<string>; doc: string }>()
  for (const id of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, id, "plugin.ts")
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, "utf8")
    for (const m of src.matchAll(/plugin\.provide\("([^"]+)"/g)) {
      const s = found.get(m[1]) ?? { plugins: new Set<string>(), doc: "" }
      s.plugins.add(id)
      s.doc ||= docBefore(src, m.index!)
      found.set(m[1], s)
    }
  }
  // (families, one line each: text:csv, text:docx... are text:<ext>)
  const byFamily = new Map<string, string[]>()
  for (const name of found.keys()) { const f = name.includes(":") ? name.slice(0, name.indexOf(":")) : name; byFamily.set(f, [...byFamily.get(f) ?? [], name]) }
  return [...byFamily].sort(([a], [b]) => a.localeCompare(b)).map(([f, names]) => {
    if (names.length >= 3 && names.every((n) => n.startsWith(`${f}:`))) return `- \`${f}:<…>\` (${names.map((n) => n.slice(f.length + 1)).join(", ")}): ${[...new Set(names.map((n) => [...found.get(n)!.plugins].join(", ")))].join("; ")}`
    return names.map((n) => `- \`${n}\` (${[...found.get(n)!.plugins].join(", ")})${found.get(n)!.doc ? `: ${found.get(n)!.doc}` : ""}`).join("\n")
  })
}

/** The reference, as its two topics: plugin-api (what a plugin is made of) and plugin-api-names (every name to import). */
export function generate(): Record<string, string> {
  return {
    [OUT]: `## Plugin API reference
Written from the code's own doc comments (tools/plugin_api_doc.ts), so it's what this version has. How to write a plugin:
\`vau docs vault-plugins\`; every name each module has, with its parameters: \`vau docs plugin-api-names\`.

### The server: \`plugin.ts\`
\`import { Plugin } from "@vaultite/core/plugins.ts"\`, then \`export const plugin = new Plugin(import.meta.url)\`.

${backend().join("\n")}

What it gets: a route's \`req\`: ${shape("core/plugins.ts", "Request")}. A block's \`ctx\` (plugin.block): ${shape("core/plugins.ts", "BlockCtx")}.
\`plugin.vault.entries\` maps each Markdown file's path to its entry: ${shape("core/vault.ts", "Entry")}. A kind of file,
\`plugin.kind(new Kind({...}))\`: ${shape("core/vault.ts", "KindSpec")}. One frontmatter key in a file's text:
\`setPropertyText\` (\`@vaultite/core/vault.ts\`).

### What it is: \`manifest.json\`
The app's own manifest keys (a vault plugin's are in \`vau docs vault-plugins\`).

${keysOf("Manifest").join("\n")}

### The app: \`definePlugin({...})\` in \`index.tsx\`
\`import { definePlugin } from "@vaultite"\`; every key is optional (its icon is its manifest's).

${keysOf("PluginDef").join("\n")}

### Services the app's plugins offer
\`plugin.ask("<name>", ...args)\` (\`plugin.provide\` to offer one): by name, never by plugin.

${services().join("\n")}
`,
    [NAMES]: `## Plugin API names
Every name a plugin imports, with its parameters and what it is (tools/plugin_api_doc.ts). What a plugin is made of:
\`vau docs plugin-api\`.

### \`"@vaultite"\` (index.tsx)
${exportsOf().join("\n")}

### \`@vaultite/core/plugins.ts\` (plugin.ts)
${serverExports("core/plugins.ts").join("\n")}

### \`@vaultite/core/vault.ts\` (plugin.ts: the vault's files)
${serverExports("core/vault.ts").join("\n")}
`,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [f, text] of Object.entries(generate())) { fs.writeFileSync(f, text); console.log(`wrote ${path.relative(ROOT, f)}`) }
}
