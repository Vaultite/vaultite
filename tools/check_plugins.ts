// Every plugin follows the rules (core/rules.ts, plugins/CLAUDE.md), and so do the ops, bundles, skills and block fences.
// node tools/check_plugins.ts [vault] | --plugin <folder> [--tag v1.2.0] [--installable]   (npm run check)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseAst } from "rolldown/parseAst"
import { declsOf, optionNotes, parseOptions, type BlockDecls } from "../core/blocks.ts"
import { blocksIn } from "../core/sections.ts"
import { blockProblems, defKeys, iconNames, nodeSide, pluginProblems, walk } from "../core/rules.ts"
import { ICON_NAME } from "../core/pluginmeta.ts"
import { opProblems } from "../core/ops.ts"

// (the plugins load below into a throwaway vault, keeping what they keep on this machine in a throwaway folder too: before
// core/plugins.ts reads VAULTITE_LOCAL, so it's imported only after, with everything that imports it)
const SCRATCH = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "vaultite-check-"))
process.env.VAULTITE_LOCAL = path.join(SCRATCH, "local")
const { inArea } = await import("../core/hooks.ts")

// A manifest's icon by name is one the app has (the server can't tell: the app's plugins' sources aren't shipped).
const ICONS = iconNames(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const iconProblems = (m: Record<string, unknown> | null | undefined, where: string) => typeof m?.icon === "string" && ICON_NAME.test(m.icon) && !ICONS.has(m.icon)
  ? [`${where}: icon '${m.icon}' isn't one of Lucide's (lucide.dev/icons, by its own name) or one the app's plugins add`] : []

// One plugin's folder (a plugin's own repository, its CI: tools/plugin-action/action.yml).
const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1] ?? "" }
if (flag("--plugin") !== null) {
  const dir = path.resolve(flag("--plugin")!)
  const { folderProblems } = await import("../core/coreops/plugins.ts")
  const { discover } = await import("../core/plugins.ts")
  const tag = flag("--tag") || null
  const r = folderProblems(dir, new Map(discover().map(([tier, id]) => [id, tier])), { installable: process.argv.includes("--installable") || !!tag, tag })
  try { r.problems.push(...iconProblems(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), "./manifest.json")) } catch { /* said */ }
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  if (r.warnings.length) console.log(`Warnings (it still loads):\n${r.warnings.join("\n")}\n`)
  console.log(r.problems.join("\n") || `ok: ${r.id}${tag ? ` at ${tag}` : ""} follows the rules`)
  process.exit(r.problems.length ? 1 : 0)
}
const { APP_BUNDLES, problems: bundleProblems } = await import("../core/bundles.ts")
const { checkVaultPlugin } = await import("../core/vaultplugins.ts")
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PLUGINS = path.join(ROOT, "plugins")
const VAULT = process.argv[2] ? path.resolve(process.argv[2]) : null

const found = new Map<string, [string, string]>() // id -> [tier, folder]
for (const name of fs.readdirSync(path.join(PLUGINS, "core")).sort()) {
  const d = path.join(PLUGINS, "core", name)
  if (fs.statSync(d).isDirectory()) found.set(name, ["core", d])
}
const vaultDir = VAULT && path.join(VAULT, ".vaultite", "plugins")
for (const name of vaultDir && fs.existsSync(vaultDir) ? fs.readdirSync(vaultDir).sort() : []) {
  const d = path.join(vaultDir!, name)
  if (fs.existsSync(path.join(d, "manifest.json")) && !found.has(name)) found.set(name, ["vault", d])
}

const ids = new Map([...found].map(([id, [tier]]) => [id, tier]))
const problems: string[] = []
const warnings: string[] = []
const decls: BlockDecls = {} // every app plugin's blocks
const vaultManifests = new Map<string, Record<string, unknown>>()
for (const [name, [tier, d]] of found) {
  if (tier === "vault") {
    const r = checkVaultPlugin(d, { ids, label: `.vaultite/plugins/${name}` })
    problems.push(...r.problems)
    warnings.push(...r.warnings)
    problems.push(...iconProblems(r.manifest, `.vaultite/plugins/${name}/manifest.json`))
    if (r.manifest) vaultManifests.set(name, r.manifest)
    continue
  }
  const label = `plugins/${tier}/${name}`
  problems.push(...pluginProblems(d, ROOT, ids, false, label))
  let m: Record<string, unknown> = {}
  try { m = JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")) } catch { continue } // (said above)
  problems.push(...blockProblems(d, m, label), ...iconProblems(m, `${label}/manifest.json`))
  // The app's own are `essential` (Built-in on the Plugins page); the rest are Vaultite plugins, off until turned on.
  if (m.essential !== undefined && m.essential !== true) problems.push(`${label}/manifest.json: essential is only true`)
  if (m.essential !== true && m.offByDefault !== true) problems.push(`${label}/manifest.json: a built-in that isn't essential (a Vaultite plugin) is offByDefault`)
  Object.assign(decls, declsOf(m))
}

// Nothing of the plugin API runs while an app plugin's module loads: the core module behind it may not have run yet
// (the Dock icon plugin once threw at its top level and the app never started). Vault plugins load later: not theirs.
const AT_LOAD = new Set(["definePlugin", "devicePref"])
type Node = { type: string; start: number; [k: string]: unknown }
const INSIDE = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassBody"])
function loadTimeProblems(file: string, rel: string): string[] {
  const src = fs.readFileSync(file, "utf8")
  let ast: { body: Node[] }
  try { ast = parseAst(src, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }, file) as unknown as { body: Node[] } } catch (e) { return [`${rel}: doesn't parse: ${(e as Error).message}`] }
  const api = new Set<string>() // what it imports from the plugin API, by its local name
  for (const s of ast.body) {
    if (s.type !== "ImportDeclaration" || (s.source as { value: string }).value !== "@vaultite" || s.importKind === "type") continue
    for (const sp of s.specifiers as Node[]) if (sp.type === "ImportSpecifier" && sp.importKind !== "type") api.add((sp.local as { name: string }).name)
  }
  if (!api.size) return []
  const out: string[] = []
  const say = (n: Node, name: string, what: string) =>
    out.push(`${rel}:${src.slice(0, n.start).split("\n").length}: ${what} ${name} while the module loads (the plugin API may not be ready then: use it inside a function, e.g. on first use)`)
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return
    if (Array.isArray(n)) return n.forEach(visit)
    const node = n as Node
    if (typeof node.type !== "string" || INSIDE.has(node.type) || node.type.startsWith("TS")) return
    if (node.type === "CallExpression" || node.type === "NewExpression" || node.type === "TaggedTemplateExpression") {
      let c = (node.callee ?? node.tag) as Node | undefined
      while (c && ["MemberExpression", "ChainExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(c.type)) c = (c.object ?? c.expression) as Node
      if (c?.type === "Identifier" && api.has(c.name as string) && !AT_LOAD.has(c.name as string)) say(node, `${c.name as string}()`, "calls")
    } else if (node.type === "MemberExpression") {
      const o = node.object as Node
      if (o.type === "Identifier" && api.has(o.name as string)) say(node, `${o.name as string}.${src.slice((node.property as Node).start, (node.property as { end: number }).end)}`, "reads")
    }
    for (const [k, v] of Object.entries(node)) if (k !== "type" && k !== "start" && k !== "end") visit(v)
  }
  for (const s of ast.body) if (s.type !== "ImportDeclaration") visit(s)
  return out
}
for (const [tier, d] of found.values()) {
  if (tier === "vault") continue
  for (const f of walk(d)) if (/\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !nodeSide(f)) problems.push(...loadTimeProblems(f, path.relative(ROOT, f)))
}

// Tooltips are the app's (`data-tip`, components/Tooltip.tsx), never the browser's `title=` (web/CLAUDE.md): slow,
// unstyled, the one hover that looked different. A component's own `title` prop is fine.
const OWN_TITLE = new Set(["svg", "title", "iframe", "abbr", "webview"])
function titleProblems(file: string, rel: string): string[] {
  const src = fs.readFileSync(file, "utf8")
  if (!/\btitle=/.test(src)) return []
  let ast: unknown
  try { ast = parseAst(src, { lang: "tsx" }, file) } catch { return [] } // (a plugin's said above; the core's, by the build)
  const out: string[] = []
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return
    if (Array.isArray(n)) return n.forEach(visit)
    const node = n as Node
    const name = node.type === "JSXOpeningElement" ? node.name as Node & { name?: string } : null
    if (name?.type === "JSXIdentifier" && /^[a-z]/.test(name.name!) && !OWN_TITLE.has(name.name!))
      for (const a of node.attributes as Node[]) if (a.type === "JSXAttribute" && (a.name as { name?: string }).name === "title")
        out.push(`${rel}:${src.slice(0, a.start).split("\n").length}: <${name.name} title=…> is the browser's tooltip: use data-tip (data-tip-trunc for cut-off text)`)
    for (const [k, v] of Object.entries(node)) if (k !== "type" && k !== "start" && k !== "end") visit(v)
  }
  visit(ast)
  return out
}
for (const d of [path.join(ROOT, "web", "src"), PLUGINS]) for (const f of walk(d)) if (f.endsWith(".tsx")) problems.push(...titleProblems(f, path.relative(ROOT, f)))

// The blocks in the app's own Markdown are declared, with options their declarations allow.
const docs = [path.join(ROOT, "core", "pages", "Design.md"), path.join(ROOT, "core", "AGENTS.md"), ...walk(path.join(ROOT, "core", "docs")),
  ...walk(PLUGINS).filter((f) => /\/(pages\/[^/]+|AGENTS)\.md$/.test(f)), ...walk(path.join(ROOT, "examples", "vault")).filter((f) => f.endsWith(".md")),
  ...walk(APP_BUNDLES).filter((f) => f.endsWith(".md")), ...walk(path.join(ROOT, "skills")).filter((f) => f.endsWith(".md"))]
for (const f of docs) {
  const text = fs.readFileSync(f, "utf8"), rel = path.relative(ROOT, f)
  for (const b of blocksIn(text)) {
    const line = b.open + 1
    if (!Object.hasOwn(decls, b.name)) { problems.push(`${rel}:${line}: block-${b.name} isn't a block any app plugin declares`); continue }
    const { options, error } = parseOptions(b.text)
    for (const n of optionNotes(decls[b.name], options, error)) problems.push(`${rel}:${line}: block-${b.name}: ${n}`)
  }
}

// The design system shows every block.
const DESIGN = path.join(ROOT, "core", "pages", "Design.md")
const design = fs.existsSync(DESIGN) ? fs.readFileSync(DESIGN, "utf8") : ""
const shown = new Set(blocksIn(design).map((b) => b.name))
for (const [name, [tier, d]] of found) {
  if (tier === "vault") continue // (the app's design system shows the app's blocks)
  const index = path.join(d, "index.tsx")
  if (!fs.existsSync(index)) continue
  for (const b of defKeys(fs.readFileSync(index, "utf8"), "blocks")) {
    if (!shown.has(b)) problems.push(`plugins/${tier}/${name}: block '${b}' isn't in core/pages/Design.md (the design system shows every block)`)
  }
}

// The app's bundles: their shapes, and every plugin, panel and pinned page they name is one the app has.
const panels = new Set<string>()
const pages = new Set<string>()
for (const [id, [tier, d]] of found) {
  if (tier === "vault") continue
  const index = path.join(d, "index.tsx")
  const src = fs.existsSync(index) ? fs.readFileSync(index, "utf8") : ""
  // (a panel: `<name>: { title: "...", ...` in its `sidebar: {...}`; the first one may share the line with `sidebar:`)
  if (/\bsidebar\s*:\s*\{/.test(src)) for (const x of src.matchAll(/(?:\bsidebar\s*:\s*\{|\n)\s*([\w-]+)\s*:\s*\{\s*title:/g)) panels.add(`${id}:${x[1]}`)
  const pd = path.join(d, "pages")
  if (fs.existsSync(pd)) for (const n of fs.readdirSync(pd)) if (n.endsWith(".md")) pages.add(`Dashboards/${n}`)
}
for (const id of fs.existsSync(APP_BUNDLES) ? fs.readdirSync(APP_BUNDLES).sort() : []) {
  const dir = path.join(APP_BUNDLES, id)
  if (!fs.statSync(dir).isDirectory()) continue
  const files: Record<string, string> = {}
  for (const f of walk(dir)) files[path.relative(dir, f).split(path.sep).join("/")] = fs.readFileSync(f, "utf8")
  const at = `bundles/${id}`
  problems.push(...bundleProblems(files).map((x) => `${at}: ${x}`))
  const json = (f: string) => { try { return JSON.parse(files[f] ?? "null") } catch { return null } }
  const pj = json("plugins.json")
  for (const k of ["disabled", "enabled"]) for (const p of pj?.[k] ?? []) if (!ids.has(p)) problems.push(`${at}/plugins.json: '${p}' isn't a plugin of the app`)
  const sb = json("sidebars.json")
  for (const k of [...sb?.left ?? [], ...sb?.right ?? []]) if (!panels.has(k)) problems.push(`${at}/sidebars.json: '${k}' isn't a sidebar panel of the app`)
  for (const p of json("pages.json")?.pinned ?? []) if (!pages.has(p) && files[p] === undefined) problems.push(`${at}/pages.json: '${p}' is neither a plugin's page nor a file of the bundle`)
  for (const f of Object.keys(files)) {
    const m = /^plugins\/([^/]+)\/data\.json$/.exec(f)
    if (m && !ids.has(m[1])) problems.push(`${at}/${f}: '${m[1]}' isn't a plugin of the app`)
  }
}

// The vault's rules stay short (every agent session loads them): core/AGENTS.md, written to .vaultite/AGENTS.md.
// Formats belong on demand, in a plugin's AGENTS.md or core/docs/.
const AGENTS_MAX = 2_000, RULES_MAX = 4_000
const agentsSize = fs.statSync(path.join(ROOT, "core", "AGENTS.md")).size
if (agentsSize > AGENTS_MAX) problems.push(`core/AGENTS.md (the vault's rules) is ${agentsSize} bytes (at most ${AGENTS_MAX}): only rules go there; formats go in a plugin's AGENTS.md or core/docs/`)
{
  const lines = [...found].filter(([, [tier]]) => tier !== "vault").map(([, [, d]]) => JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")).forAgents)
    .filter((l): l is string => typeof l === "string")
  const all = agentsSize + lines.reduce((n, l) => n + Buffer.byteLength(l) + 3, 0)
  if (all > RULES_MAX) problems.push(`the vault's rules with every plugin's forAgents line are ${all} bytes (at most ${RULES_MAX}): every agent reads them; move detail into the plugins' AGENTS.md`)
}

// Operations: the core's and every app plugin's (loaded into a throwaway vault, all of them, on or off), a vault plugin's
// declared in its manifest.
{
  const { App } = await import("../core/app.ts")
  const { RESERVED } = await import("../plugins/core/mcp/catalog.ts")
  const { COMMANDS } = await import("../core/cli.ts")
  const app = await new App(path.join(SCRATCH, "vault")).init()
  type Owned = { op: import("../core/ops.ts").Op; plugin: string | null; kinds: string[]; vault?: boolean }
  const all: Owned[] = [
    ...app.ops().filter((o) => o.plugin === null).map((o) => ({ ...o, kinds: [] })),
    ...app.app.flatMap((p) => p.ops.map((op) => ({ op, plugin: p.id, kinds: p.kinds.flatMap((k) => [k.type, k.collection]) }))),
  ]
  for (const [name, [tier, d]] of found) {
    const m = vaultManifests.get(name)
    if (tier !== "vault" || !m) continue
    for (const op of app.vaultPlugins.hooks.opsOf({ id: name, dir: d, manifest: m })) all.push({ op, plugin: name, kinds: [], vault: true })
  }
  const toolOf = (op: Owned["op"]) => (op.mcp ? (typeof op.mcp === "string" ? op.mcp : op.id.replace(/[.-]/g, "_")) : null)
  // The commands that run in vau, by whose they are (a plugin's own command may take its ops' name and route to them:
  // the Inbox's `vau inbox`).
  const names = new Map<string, string | null>(COMMANDS.map((c) => [c.name, null]))
  for (const [id, [tier, d]] of found) {
    if (tier === "vault" || !fs.existsSync(path.join(d, "cli.ts"))) continue
    const { cli } = await import(path.join(d, "cli.ts"))
    for (const c of cli?.commands ?? []) names.set(c.name, id)
  }
  const ids = new Map<string, string>(), clis = new Map<string, string>(), tools = new Map<string, string>()
  const at = (o: Owned) => (o.plugin ? `plugin ${o.plugin}` : "the core")
  for (const o of all) {
    if (!o.vault) problems.push(...opProblems(o.op).map((p) => `${at(o)}: ${p}`)) // (a vault plugin's: checkVaultPlugin above)
    if (o.plugin && !o.vault && !inArea(o.op.id, o.plugin, o.kinds)) problems.push(`${at(o)}: op '${o.op.id}' isn't in its area (${o.plugin}., or a kind it owns)`)
    const dup = (map: Map<string, string>, key: string | null, what: string) => {
      if (!key) return
      if (map.has(key)) problems.push(`${at(o)}: ${what} '${key}' is also ${map.get(key)}'s`)
      else map.set(key, `${o.op.id} (${at(o)})`)
    }
    dup(ids, o.op.id, "op id")
    dup(clis, o.op.cli ?? null, "CLI name")
    dup(tools, toolOf(o.op), "MCP tool name")
    if (o.op.cli && names.has(o.op.cli) && names.get(o.op.cli) !== o.plugin) problems.push(`${at(o)}: CLI name '${o.op.cli}' is a vau command's (core/cli.ts or a plugin's cli.ts)`)
    const tool = toolOf(o.op)
    if (tool && RESERVED.has(tool)) problems.push(`${at(o)}: MCP tool name '${tool}' is one MCP keeps for itself (${[...RESERVED].join(", ")})`)
  }
  // The skills (skills/, tools/skills.ts): short, their generated part up to date, naming only commands vau has.
  const { skillProblems } = await import("./skills.ts")
  problems.push(...await skillProblems({ commands: [...names.keys()], ops: all.filter((o) => !o.vault).map((o) => o.op),
    topic: (t) => app.runOp("docs.read", { topic: t }).then(() => true, () => false) }))
}
// The plugin API's reference (core/docs/plugin-api.md) is written from the code: it must be this code's.
const { generate } = await import("./plugin_api_doc.ts")
for (const [f, text] of Object.entries(generate())) {
  if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text) problems.push(`${path.relative(ROOT, f)} is out of date: node tools/plugin_api_doc.ts`)
}
fs.rmSync(SCRATCH, { recursive: true, force: true })

if (warnings.length) console.log(`Warnings (vault plugins: they still load):\n${warnings.join("\n")}\n`)
console.log(problems.join("\n") || `ok: ${found.size} plugins, every block declared, drawn as text and in the design system; every operation checked`)
process.exit(problems.length ? 1 : 0)
