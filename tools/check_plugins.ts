// node tools/check_plugins.ts [vault] | --plugin <folder> [--tag v1.2.0] [--installable]   (npm run check)
import { isUtf8 } from "node:buffer"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseAst } from "rolldown/parseAst"
import { declsOf, drawnBy, drawsOf, optionNotes, parseOptions, type BlockDecls } from "../core/blocks.ts"
import { blocksIn } from "../core/sections.ts"
import { blockProblems, iconNames, inside, listedPackage, nodeSide, PLUGIN_PACKAGES, pluginProblems, SHARED, SHARED_EDITOR, walk } from "../core/rules.ts"
import { ICON_NAME } from "../core/pluginmeta.ts"
import { opProblems } from "../core/ops.ts"

// core/plugins.ts reads VAULTITE_LOCAL as it loads: set it first, and import what imports it only after.
const SCRATCH = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "vaultite-check-"))
process.env.VAULTITE_LOCAL = path.join(SCRATCH, "local")
const { inArea } = await import("../core/hooks.ts")

const ICONS = iconNames(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const iconProblems = (m: Record<string, unknown> | null | undefined, where: string) => typeof m?.icon === "string" && ICON_NAME.test(m.icon) && !ICONS.has(m.icon)
  ? [`${where}: icon '${m.icon}' isn't one of Lucide's (lucide.dev/icons, by its own name) or one the app's plugins add`] : []

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1] ?? "" }
if (flag("--plugin") !== null) {
  const dir = path.resolve(flag("--plugin")!)
  const { folderProblems } = await import("../core/coreops/plugins.ts")
  const { discover } = await import("../core/plugins.ts")
  const tag = flag("--tag") || null
  const { MOVED } = await import("../core/migrations.ts")
  const official = path.resolve(process.env.VAULTITE_PLUGINS ?? path.join(fileURLToPath(import.meta.url), "../../../vaultite-plugins"))
  const movedDir = (id: string) => [path.join(path.dirname(dir), id), path.join(official, id)].find((d) => fs.existsSync(path.join(d, "manifest.json")))
  const ids = new Map([...Object.keys(MOVED).filter((id) => movedDir(id)).map((id): [string, string] => [id, "vault"]), ...discover().map(([tier, id]): [string, string] => [id, tier])])
  const r = folderProblems(dir, ids, { installable: process.argv.includes("--installable") || !!tag, tag, dirOf: (id) => movedDir(id) ?? path.join(path.dirname(dir), id) })
  try { r.problems.push(...iconProblems(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), "./manifest.json")) } catch { /* said */ }
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  if (r.warnings.length) console.log(`Warnings (it still loads):\n${r.warnings.join("\n")}\n`)
  console.log(r.problems.join("\n") || `ok: ${r.id}${tag ? ` at ${tag}` : ""} follows the rules`)
  process.exit(r.problems.length ? 1 : 0)
}
const { APP_BUNDLES, problems: bundleProblems } = await import("../core/bundles.ts")
const { MOVED } = await import("../core/migrations.ts")
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
const drawers = new Map<string, string[]>() // block -> the app plugins that draw it for its declarer (`draws`)
const vaultManifests = new Map<string, Record<string, unknown>>()
const alwaysOn = new Set<string>() // app plugins with no switch: bundles leave them out
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
  for (const k of ["essential", "alwaysOn"]) if (m[k] !== undefined && m[k] !== true) problems.push(`${label}/manifest.json: ${k} is only true`)
  if (m.alwaysOn === true && (m.essential !== undefined || m.offByDefault !== undefined)) problems.push(`${label}/manifest.json: an alwaysOn plugin is neither essential nor offByDefault`)
  if (m.alwaysOn !== true && m.essential !== true && m.offByDefault !== true) problems.push(`${label}/manifest.json: a built-in that isn't alwaysOn or essential (a Vaultite plugin) is offByDefault`)
  if (m.alwaysOn === true) alwaysOn.add(name)
  Object.assign(decls, declsOf(m))
  for (const b of drawsOf(m)) drawers.set(b, [...drawers.get(b) ?? [], name])
}

const AT_LOAD = new Set(["agentPlugin", "cell", "definePlugin", "devicePref", "pluginSettings", "removals"])
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

{
  const srcs = [path.join(ROOT, "web", "src"), PLUGINS].flatMap((d) => walk(d)).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
  const ids = new Set<string>(), made: RegExp[] = []
  for (const f of srcs) {
    const src = fs.readFileSync(f, "utf8")
    for (const m of src.matchAll(/\bid:\s*"([\w-]+:[\w:-]+)"/g)) ids.add(m[1])
    for (const m of src.matchAll(/\bid:\s*`([\w-]+:[^`$]*\$\{[^`]+)`/g)) made.push(new RegExp(`^${m[1].replace(/\$\{[^}]+\}/g, "[\\w:-]+")}$`))
  }
  const spaces = new Set([...ids].map((id) => id.split(":")[0]))
  for (const f of [...srcs, path.join(ROOT, "electron", "menu.ts")]) {
    const src = fs.readFileSync(f, "utf8"), rel = path.relative(ROOT, f)
    const named = [/\b(?:runCommandById|runCommandId|offeredCommand|commandKeys|useCommandKeys|firstKeys|cmd|radio)\("([\w-]+:[\w:-]+)"/g, /^\s*"([\w-]+:[\w:-]+)":\s*\[/gm]
    for (const re of named) for (const m of src.matchAll(re)) {
      if (!spaces.has(m[1].split(":")[0]) || ids.has(m[1]) || made.some((r) => r.test(m[1]))) continue
      problems.push(`${rel}:${src.slice(0, m.index).split("\n").length}: '${m[1]}' isn't a command's id (no command has it)`)
    }
  }
}

for (const [b, ps] of drawers) if (!decls[b]?.by) problems.push(`plugins/core/${ps[0]}/manifest.json: draws '${b}', which no app plugin declares with \`by\``)

const OFFICIAL = path.resolve(process.env.VAULTITE_PLUGINS ?? path.join(ROOT, "..", "vaultite-plugins"))
const officialDecls: BlockDecls | null = fs.existsSync(OFFICIAL) ? {} : null
const officialDrawers = new Map<string, string[]>()
for (const id of officialDecls ? fs.readdirSync(OFFICIAL) : []) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(OFFICIAL, id, "manifest.json"), "utf8"))
    if (m.repo !== "Vaultite/plugins") continue
    Object.assign(officialDecls!, declsOf(m))
    for (const b of drawsOf(m)) officialDrawers.set(b, [...(officialDrawers.get(b) ?? []), id])
  } catch { /* not a plugin */ }
}
for (const [b, d] of Object.entries(decls)) if (d.by) decls[b] = drawnBy(d, [...drawers.get(b) ?? [], ...officialDecls ? officialDrawers.get(b) ?? [] : Object.keys(MOVED)])

const docs = [path.join(ROOT, "core", "AGENTS.md"), ...walk(path.join(ROOT, "core", "docs")),
  ...walk(PLUGINS).filter((f) => /\/(pages\/[^/]+|AGENTS)\.md$/.test(f.split(path.sep).join("/"))), ...walk(path.join(ROOT, "examples", "vault")).filter((f) => f.endsWith(".md")),
  ...walk(APP_BUNDLES).filter((f) => f.endsWith(".md")), ...walk(path.join(ROOT, "skills")).filter((f) => f.endsWith(".md"))]
for (const f of docs) {
  const text = fs.readFileSync(f, "utf8"), rel = path.relative(ROOT, f)
  for (const b of blocksIn(text)) {
    const line = b.open + 1
    const decl = Object.hasOwn(decls, b.name) ? decls[b.name] : officialDecls && Object.hasOwn(officialDecls, b.name) ? officialDecls[b.name] : null
    if (!decl) {
      if (officialDecls) problems.push(`${rel}:${line}: block-${b.name} isn't a block any app plugin declares, nor one of Vaultite's own (${OFFICIAL}: pull it?)`)
      continue
    }
    const { options, error } = parseOptions(b.text)
    for (const n of optionNotes(decl, options, error)) problems.push(`${rel}:${line}: block-${b.name}: ${n}`)
  }
}

for (const [id, source] of Object.entries(MOVED)) {
  if (ids.get(id) === "core") problems.push(`plugins/core/${id}: it moved to ${source} (core/migrations.ts MOVED): take it out of the app`)
  if (!/^Vaultite\/plugins\/[a-z][a-z0-9-]*$/.test(source) || !source.endsWith(`/${id}`)) problems.push(`core/migrations.ts: MOVED.${id} is Vaultite/plugins/${id}, not ${source}`)
}

const panels = new Set<string>()
const pages = new Set<string>()
for (const [id, [tier, d]] of found) {
  if (tier === "vault") continue
  const index = path.join(d, "index.tsx")
  const src = fs.existsSync(index) ? fs.readFileSync(index, "utf8") : ""
  if (/\bsidebar\s*:\s*\{/.test(src)) for (const x of src.matchAll(/(?:\bsidebar\s*:\s*\{|\n)\s*([\w-]+)\s*:\s*\{\s*title:/g)) panels.add(`${id}:${x[1]}`)
  const pd = path.join(d, "pages")
  if (fs.existsSync(pd)) for (const n of fs.readdirSync(pd)) if (n.endsWith(".md")) pages.add(`Dashboards/${n}`)
}
const builtIns = new Map<string, Record<string, string | Buffer>>()
for (const id of fs.existsSync(APP_BUNDLES) ? fs.readdirSync(APP_BUNDLES).sort() : []) {
  const dir = path.join(APP_BUNDLES, id)
  if (!fs.statSync(dir).isDirectory()) continue
  const files: Record<string, string | Buffer> = {}
  for (const f of walk(dir)) { const b = fs.readFileSync(f); files[path.relative(dir, f).split(path.sep).join("/")] = isUtf8(b) ? b.toString("utf8") : b }
  builtIns.set(id, files)
  const at = `bundles/${id}`
  problems.push(...bundleProblems(files).map((x) => `${at}: ${x}`))
  const json = (f: string) => { try { return JSON.parse(String(files[f] ?? "null")) } catch { return null } }
  const pj = json("plugins.json")
  const installs = new Set(Object.keys(pj?.install ?? {}))
  for (const [p, x] of Object.entries<{ source?: string; commit?: string; hash?: string }>(pj?.install ?? {})) {
    if (!/^Vaultite\/plugins\/[a-z][a-z0-9-]*$/.test(x?.source ?? "")) problems.push(`${at}/plugins.json: '${p}' is installed from ${x?.source}: the app's bundles install only Vaultite's plugins (Vaultite/plugins/<id>)`)
    if (ids.has(p)) problems.push(`${at}/plugins.json: '${p}' is one of the app's plugins: it isn't installed`)
    if (!x?.commit || !x.hash) problems.push(`${at}/plugins.json: '${p}' needs its commit and hash: node tools/pin_bundles.ts`)
  }
  for (const p of pj?.enabled ?? []) if (MOVED[p] && !installs.has(p)) problems.push(`${at}/plugins.json: '${p}' moved out of the app: name it in install, pinned (node tools/pin_bundles.ts)`)
  for (const k of ["disabled", "enabled"]) for (const p of pj?.[k] ?? []) {
    if (!ids.has(p) && !installs.has(p)) problems.push(`${at}/plugins.json: '${p}' isn't a plugin of the app${MOVED[p] ? ` (it moved: install it from ${MOVED[p]})` : ""}`)
    else if (alwaysOn.has(p)) problems.push(`${at}/plugins.json: '${p}' is always on: leave it out`)
  }
  const sb = json("sidebars.json")
  for (const k of [...sb?.left ?? [], ...sb?.right ?? []]) if (!panels.has(k) && !installs.has(k.split(":")[0])) problems.push(`${at}/sidebars.json: '${k}' isn't a sidebar panel of the app`)
  const theirs = new Set([...installs].flatMap((i) => { const pd = path.join(OFFICIAL, i, "pages"); return fs.existsSync(pd) ? fs.readdirSync(pd).map((n) => `Dashboards/${n}`) : [] }))
  for (const p of json("pages.json")?.pinned ?? []) {
    if (!pages.has(p) && !theirs.has(p) && files[p] === undefined && (officialDecls || !installs.size)) problems.push(`${at}/pages.json: '${p}' is neither a plugin's page nor a file of the bundle`)
  }
  for (const f of Object.keys(files)) {
    const m = /^plugins\/([^/]+)\/data\.json$/.exec(f)
    if (m && !ids.has(m[1]) && !installs.has(m[1])) problems.push(`${at}/${f}: '${m[1]}' isn't a plugin of the app`)
  }
}

{
  const { LOOK_KEYS, PERSONAL_LOOK } = await import("../core/look.ts")
  const { EDITOR_KEYS } = await import("../core/editor.ts")
  const { CONFIGS } = await import("../core/bundles.ts")
  const keysOf = (files: Record<string, string | Buffer>, f: string) => { try { return Object.keys(JSON.parse(String(files[f] ?? "{}"))) } catch { return [] } }
  const said = new Map<string, string>() // "<file>\0<key>" -> the bundle that says it
  for (const [id, files] of builtIns) {
    for (const c of CONFIGS) if (files[`${c}.json`] !== undefined) said.set(`${c}.json\0`, said.get(`${c}.json\0`) ?? id)
    for (const f of Object.keys(files)) if (f === "editor.json" || /^plugins\/[^/]+\/data\.json$/.test(f)) for (const k of keysOf(files, f)) said.set(`${f}\0${k}`, said.get(`${f}\0${k}`) ?? id)
  }
  for (const [id, files] of builtIns) {
    for (const [key, by] of said) {
      const [f, k] = key.split("\0")
      if (files[f] === undefined) problems.push(`bundles/${id}: it has no ${f}, which bundles/${by} has: each of the app's bundles says every part (Standard the defaults)`)
      else if (k && !keysOf(files, f).includes(k)) problems.push(`bundles/${id}/${f}: it doesn't say ${k}, which bundles/${by} sets: say it (its default in Standard)`)
    }
    const look = keysOf(files, "appearance.json")
    for (const k of LOOK_KEYS) {
      if (PERSONAL_LOOK.includes(k)) { if (look.includes(k)) problems.push(`bundles/${id}/appearance.json: it says ${k}, the user's own (core/look.ts PERSONAL_LOOK): a layout leaves it as it is`) }
      else if (!look.includes(k)) problems.push(`bundles/${id}/appearance.json: it doesn't say ${k}: the look says every key but the user's own (core/look.ts), the default too`)
    }
    for (const k of look) if (!(LOOK_KEYS as string[]).includes(k)) problems.push(`bundles/${id}/appearance.json: '${k}' isn't a key of the look (core/look.ts)`)
    for (const k of keysOf(files, "editor.json")) if (!(EDITOR_KEYS as string[]).includes(k)) problems.push(`bundles/${id}/editor.json: '${k}' isn't an editor setting (core/editor.ts)`)
  }
}

const AGENTS_MAX = 2_000, RULES_MAX = 4_000
const agentsSize = fs.statSync(path.join(ROOT, "core", "AGENTS.md")).size
if (agentsSize > AGENTS_MAX) problems.push(`core/AGENTS.md (the vault's rules) is ${agentsSize} bytes (at most ${AGENTS_MAX}): only rules go there; formats go in a plugin's AGENTS.md or core/docs/`)
{
  const lines = [...found].filter(([, [tier]]) => tier !== "vault").map(([, [, d]]) => JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")).forAgents)
    .filter((l): l is string => typeof l === "string")
  const all = agentsSize + lines.reduce((n, l) => n + Buffer.byteLength(l) + 3, 0)
  if (all > RULES_MAX) problems.push(`the vault's rules with every plugin's forAgents line are ${all} bytes (at most ${RULES_MAX}): every agent reads them; move detail into the plugins' AGENTS.md`)
}

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
  const names = new Map<string, string | null>(COMMANDS.map((c) => [c.name, null]))
  for (const [id, [tier, d]] of found) {
    if (tier === "vault" || !fs.existsSync(path.join(d, "cli.ts"))) continue
    const { cli } = await import(pathToFileURL(path.join(d, "cli.ts")).href)
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
  const { skillProblems } = await import("./skills.ts")
  problems.push(...await skillProblems({ commands: [...names.keys()], ops: all.filter((o) => !o.vault).map((o) => o.op),
    topic: (t) => app.runOp("docs.read", { topic: t }).then(() => true, () => false) }))
}
const { generate } = await import("./plugin_api_doc.ts")
for (const [f, text] of Object.entries(generate())) {
  if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text) problems.push(`${path.relative(ROOT, f)} is out of date: node tools/plugin_api_doc.ts`)
}
fs.rmSync(SCRATCH, { recursive: true, force: true })

const VENDORED = new Set(["plugins/core/spreadsheets/xlsx/xlsx.mjs"].map((f) => path.join(ROOT, f)))
const sources = ["core", "web/src", "plugins", "electron", "bin", "tools/test", "tools/evals", "tools/perf"].flatMap((d) => walk(path.join(ROOT, d)))
  .concat(path.join(ROOT, "server.ts"), fs.readdirSync(path.join(ROOT, "tools")).map((n) => path.join(ROOT, "tools", n))).filter((f) => !VENDORED.has(f))

for (const f of sources.filter((f) => /\.(tsx|css)$/.test(f))) {
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (/\*\s*\+\s*\*/.test(l) && !/^\s*(\/\/|\/?\*)/.test(l)) problems.push(`${path.relative(ROOT, f)}:${i + 1}: \`* + *\` restyles the whole list as it changes: :where(:not(:first-child))`)
  })
}

{
  const { diskTree, graphOf } = await import("../core/update/closure.ts")
  const g = graphOf(diskTree(ROOT))
  for (const id of ["web", "demo"]) {
    const r = g.reach(id), label = g.entries.find((e) => e.id === id)!.label
    for (const f of ["core/update/closure.ts"]) if (r.files.has(f) && g.chainOf(r, f)[0] !== "vite.config.ts") problems.push(`${label} reaches ${f} (${g.chainOf(r, f).join(" > ")}): load it through core/update/graph.ts, which the server gives`)
  }
}

const UNTYPED: Record<string, string> = {
  "tools/test/kdbx/upstream/": "upstream kdbxweb's tests, kept as written (typed for an older TypeScript)",
  "plugins/core/terminal/claude-pictures/hooks/": "a Claude Code mod: its 'claude-code' types are Claude Code's own (its decoders, decode/, are typed through tools/test_pictures.ts)",
}
{
  const { spawnSync } = await import("node:child_process")
  const { gitEnv } = await import("../core/gitenv.ts")
  const projects = (JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")) as { references: { path: string }[] }).references.map((r) => r.path)
  const typed = new Set(projects.flatMap((p) => spawnSync(process.execPath, [path.join(ROOT, "node_modules/typescript/bin/tsc"), "-p", p, "--listFilesOnly"], { cwd: ROOT, encoding: "utf8" })
    .stdout.split("\n").filter(Boolean).map((f) => path.relative(ROOT, f.trim()).split(path.sep).join("/"))))
  const ts = spawnSync("git", ["ls-files", "*.ts", "*.tsx", "*.mts", "*.cts"], { cwd: ROOT, encoding: "utf8", env: gitEnv() }).stdout.split("\n").filter(Boolean)
  for (const f of ts) if (!typed.has(f) && !Object.keys(UNTYPED).some((k) => f.startsWith(k))) problems.push(`${f}: no tsconfig project type-checks it (add it to one's include, or to UNTYPED in tools/check_plugins.ts, saying why)`)
}

for (const f of walk(path.join(ROOT, "electron", "browser")).filter((f) => /\.(ts|cjs|js)$/.test(f)))
  for (const m of fs.readFileSync(f, "utf8").matchAll(/(?:from|import\(|require\()\s*["'](\.\.\/[^"']*)["']/g))
    problems.push(`${path.relative(ROOT, f)}: imports ${m[1]}: the engine imports nothing of the app's (setEngineHost)`)

const LOADERS: Record<string, string> = {
  "web/src/core/plugins.ts": "the registry: every app plugin's manifest, module and pages (import.meta.glob)",
  "web/src/core/vaultPlugins.ts": "which plugins are the app's (their manifests); the modules they export come from virtual:plugin-exports (vite.config.ts)",
}
{
  const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+|\brequire\s*\(\s*)["']([^"']+)["']|import\.meta\.glob\b[^(]*\(([^)]*)\)/gm
  const loading = new Set<string>()
  const code = ["core", "electron", path.join("web", "src")].flatMap((d) => walk(path.join(ROOT, d))).concat(path.join(ROOT, "server.ts"))
  for (const f of code.filter((f) => /\.(ts|tsx|mts|mjs|cjs|js)$/.test(f))) {
    const rel = path.relative(ROOT, f).split(path.sep).join("/"), text = fs.readFileSync(f, "utf8")
    for (const m of text.matchAll(SPEC)) {
      for (const spec of m[1] !== undefined ? [m[1]] : [...m[2].matchAll(/["'`]!?([^"'`]+)["'`]/g)].map((x) => x[1])) {
        if (!spec.startsWith("@plugins/") && !(spec.startsWith(".") && inside(PLUGINS, path.resolve(path.dirname(f), spec)))) continue
        if (LOADERS[rel]) { loading.add(rel); continue }
        problems.push(`${rel}:${text.slice(0, m.index).split("\n").length}: imports ${spec}: the core imports no plugin (what both use goes in core/, the desktop app's contracts in core/desktop/)`)
      }
    }
  }
  for (const f of Object.keys(LOADERS)) if (!loading.has(f)) problems.push(`tools/check_plugins.ts: LOADERS names ${f}, which loads no plugin's files now: take it out`)
}

{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const shipped = new Set<string>(), todo = Object.keys(pkg.dependencies ?? {})
  while (todo.length) {
    const n = todo.pop()!
    if (shipped.has(n)) continue
    shipped.add(n)
    try {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", n, "package.json"), "utf8"))
      todo.push(...Object.keys(p.dependencies ?? {}), ...Object.keys(p.optionalDependencies ?? {}))
    } catch { /* not installed here */ }
  }
  const BUILT = new Set(["electron", "builder-util", "@electron/fuses"])
  const { builtinModules } = await import("node:module")
  const runs = ["core", "plugins", "electron", "bin"].flatMap((d) => walk(path.join(ROOT, d))).concat(path.join(ROOT, "server.ts"))
    .filter((f) => /\.(ts|mts|js|mjs|cjs)$/.test(f) && !/\.test\.ts$|\.d\.m?ts$|\/(test|qa)\//.test(f))
  for (const f of runs) {
    const text = fs.readFileSync(f, "utf8")
    for (const m of text.matchAll(/(?:^|[^.\w$])(?:import\s+(?!type\b)(?:[^"'`;]*?\sfrom\s*)?|import\s*\(\s*|require\s*\(\s*|export\s+(?!type\b)[^"'`;]*?\sfrom\s*)["']([^"'./][^"']*)["']/gm)) {
      const spec = m[1], name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
      if (spec.includes("${") || spec.startsWith("node:") || builtinModules.includes(name) || /^@(vaultite|plugins)(\/|$)/.test(name) || shipped.has(name) || BUILT.has(name)) continue
      if (/typeof\s+$/.test(text.slice(Math.max(0, m.index - 12), m.index + m[0].indexOf("import")))) continue
      problems.push(`${path.relative(ROOT, f)}:${text.slice(0, m.index).split("\n").length}: imports ${name}, which the built app doesn't ship: add it to package.json's dependencies`)
    }
  }
}

{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string; resolved?: string; integrity?: string; hasInstallScript?: boolean; link?: boolean; inBundle?: boolean }> }
  for (const n of PLUGIN_PACKAGES) if (!pkg.dependencies?.[n]) problems.push(`package.json: ${n} is one of the packages vault plugins import (core/rules.ts PLUGIN_PACKAGES): it goes in dependencies`)
  for (const n of [...SHARED, ...SHARED_EDITOR]) if (n !== "@vaultite" && !listedPackage(n)) problems.push(`core/rules.ts: ${n}, which the app hands vault plugins, isn't in PLUGIN_PACKAGES`)
  const reviewed = pkg.allowScripts ?? {}
  for (const [where, p] of Object.entries(lock.packages)) {
    if (!where || p.link || p.inBundle) continue
    const name = where.slice(where.lastIndexOf("node_modules/") + 13)
    if (p.hasInstallScript && !(name in reviewed)) problems.push(`package-lock.json: ${name}@${p.version} has an install script: review it, then list it in package.json's allowScripts (false unless the app needs it run)`)
    if (!p.resolved?.startsWith("https://registry.npmjs.org/")) problems.push(`package-lock.json: ${name}@${p.version} isn't from the npm registry (${p.resolved ?? "no address"})`)
    if (!p.integrity) problems.push(`package-lock.json: ${name}@${p.version} has no integrity hash`)
  }
  for (const [name, v] of Object.entries(reviewed)) if (v !== false) problems.push(`package.json: allowScripts ${name} is ${JSON.stringify(v)}: the app runs no install scripts (.npmrc), so it's false`)
}

{
  const core = (f: string) => fs.readFileSync(path.join(ROOT, "web", "src", "core", f), "utf8")
  const imports = (src: string) => [...src.matchAll(/^\s*import\s+(type\s+)?[^"]*?\bfrom\s+"([^"]+)"|\bimport\(\s*"([^"]+)"/gm)]
  for (const [f, why] of [["unsaved.ts", "errors.ts asks it before the app loads"], ["askers.ts", "modules register with it while they load, inside import cycles"]])
    if (imports(core(f)).length) problems.push(`web/src/core/${f}: imports nothing (${why})`)
  if (imports(core("paletterank.ts")).some((m) => /^react(-dom)?(\/|$)/.test(m[2] ?? m[3]))) problems.push("web/src/core/paletterank.ts: no React, so tools/test_web.ts ranks real lists in Node")
  if (imports(core("editors.ts")).some((m) => !m[1] && (m[2] ?? m[3]).startsWith("@codemirror/"))) problems.push("web/src/core/editors.ts: only `import type` from CodeMirror, so the editor stays its own chunk")
  const errorsKey = /const KEY = "([^"]+)"/.exec(core("errors.ts"))?.[1]
  if (!errorsKey || !fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8").includes(`"${errorsKey}"`)) problems.push("web/src/core/errors.ts: KEY is the queue index.html writes before the app starts: the same key in both")
}

{
  const runtimeImports = (f: string) => [...fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']/gm)]
    .flatMap((m) => (m[1] ? [] : [m[2] ?? m[3]]))
  for (const [f, why] of [["core/sandbox.ts", "the desktop app's main process makes sandboxes with it, without the server's code"],
    ["core/winbin.ts", "plugins/core/terminal/starter.ts loads it alone, before each terminal's program starts"]])
    for (const spec of runtimeImports(f)) if (!spec.startsWith("node:")) problems.push(`${f}: imports ${spec}: it imports only Node's own modules (${why})`)
  const { COLORS } = await import("../core/colors.ts")
  const css = fs.readFileSync(path.join(ROOT, "web", "src", "index.css"), "utf8")
  for (const c of COLORS) if (!css.includes(`--${c}:`)) problems.push(`core/colors.ts: '${c}' isn't a colour token of web/src/index.css (--${c}): name one it has, or add it there for every scheme`)
}

const ratchet = spawnSync(process.execPath, [path.join(ROOT, "tools", "ratchet.ts")], { cwd: ROOT, encoding: "utf8" })
if (ratchet.status !== 0) problems.push((ratchet.stderr || ratchet.stdout).trim())

if (warnings.length) console.log(`Warnings (vault plugins: they still load):\n${warnings.join("\n")}\n`)
console.log(problems.join("\n") || `ok: ${found.size} plugins, every block declared and drawn as text; every operation checked`)
process.exit(problems.length ? 1 : 0)
