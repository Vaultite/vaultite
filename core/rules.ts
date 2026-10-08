// The rules every plugin follows (plugins/CLAUDE.md, "The rules"), as checks: `npm run check` runs them on the app's
// plugins, and the server on vault plugins before loading one (an app plugin fails; a vault plugin loads with warnings).
import fs from "node:fs"
import { isBuiltin } from "node:module"
import path from "node:path"
import { declProblems, declsOf, settingDeclProblems } from "./blocks.ts"
import { CATEGORIES } from "./categories.ts"
import { API_VERSION, APP_VERSION, compareVersions, MIN_API_VERSION, parseVersion, tagVersion } from "./version.ts"
import { DISCLOSURES, HOST, REPO as REPO_NAME, VERSION } from "./pluginmeta.ts"

export const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g
export const BACKEND = new Set(["plugin.ts", "import.ts", "cli.ts"])
/** A file that runs in Node: a backend's, or a test (test.ts, *.test.ts: never bundled into the app). */
export const nodeSide = (file: string) => BACKEND.has(path.basename(file)) || /(^|\.)test\.ts$/.test(path.basename(file))
// codingagents.ts, terminalids.ts: what the coding agent plugins share; not part of the vault plugins' API (VAULT_CORE).
export const CORE_FOR_PLUGINS = new Set(["plugins.ts", "vault.ts", "client.ts", "timeline.ts", "codingagents.ts", "terminalids.ts"])
/** What a vault plugin's backend imports the core as: "@vaultite/core/plugins.ts" (".ts" optional). */
export const VAULT_CORE = /^@vaultite\/core\/(plugins|vault|client|timeline)(?:\.ts)?$/
/** What a vault plugin's frontend gets from the app itself, never bundled: one React, one store. */
export const SHARED = new Set(["@vaultite", "react", "react/jsx-runtime", "react-dom"])
/** The app's CodeMirror, loaded with the plugin, never bundled: an `editor` extension works only with the editor's own copy. */
export const SHARED_EDITOR = new Set(["@codemirror/state", "@codemirror/view", "@codemirror/language", "@codemirror/commands",
  "@codemirror/search", "@codemirror/autocomplete", "@lezer/common", "@lezer/highlight"])

/** Every file under a folder (hidden files and node_modules left out), absolute paths, sorted. */
export function walk(d: string): string[] {
  let names: fs.Dirent[]
  try {
    names = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return []
  }
  return names.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])).sort()
}

export const inside = (dir: string, p: string) => p === dir || p.startsWith(dir + path.sep)
/** A file of a plugin's that's part of its version (walk's files: no hidden ones, no node_modules): all a vault plugin
 *  may import or run, so what this machine approved (core/trust.ts) is all that runs. */
export const hashed = (dir: string, p: string) => inside(dir, p) && !path.relative(dir, p).split(path.sep).some((s) => s.startsWith(".") || s === "node_modules")
  && !userFilesOf(dir).has(path.relative(dir, p).split(path.sep).join("/"))

const CODE = /\.(m?[jt]sx?|cjs|css|wasm|sh|py|rb|pl)$/i
/** The files a plugin writes as the user's own (its manifest's `userFiles`: Vim's init.vim): not its version, kept by
 *  updates, never imported. Data and settings, never code. */
export function userFilesOf(dir: string): Set<string> {
  let m: Record<string, unknown> = {}
  try { m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) } catch { /* none */ }
  const list = Array.isArray(m.userFiles) ? m.userFiles : []
  return new Set(list.filter((f): f is string => typeof f === "string" && userFileOk(f)))
}
const userFileOk = (f: string) => /^[\w.-]+(\/[\w.-]+)*$/.test(f) && !f.split("/").some((s) => /^\.+$/.test(s) || s.startsWith(".")) && !CODE.test(f) && f !== "manifest.json"
/** "yaml", "@codemirror/view", "lucide-react/icons" -> the package's name. */
const packageOf = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/")

/** How long a manifest's `forAgents` line may be: every agent session reads every one that's on. */
export const FOR_AGENTS_MAX = 240
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** What's wrong with a manifest (`name`: its folder's name; `ids`: every plugin there is). */
export function manifestProblems(m: Record<string, unknown>, name: string, ids: Set<string>, where = "manifest.json") {
  const out: string[] = []
  if (m.id !== name) out.push(`${where}: id must be '${name}' (its folder's name)`)
  for (const k of ["name", "description"]) if (!m[k] || typeof m[k] !== "string") out.push(`${where}: missing ${k}`)
  if (m.pageSort !== undefined && typeof m.pageSort !== "number") out.push(`${where}: pageSort must be a number`)
  if (m.tint !== undefined && (typeof m.tint !== "string" || !/^[a-z][a-z-]*$/.test(m.tint))) {
    out.push(`${where}: tint must name a colour ("orange", "teal": the app's --orange, --teal...)`)
  }
  if (m.category !== undefined && (typeof m.category !== "string" || !/^[a-z][a-z-]*$/.test(m.category))) {
    out.push(`${where}: category must be a slug, like "life" (core/categories.ts)`)
  }
  // One short line every agent reads while the plugin is on (core/plugins.ts agentLines): what it's for goes in its docs.
  if (m.forAgents !== undefined) {
    const t = m.forAgents, keys = isMap(m.settings) ? Object.keys(m.settings) : []
    if (typeof t !== "string" || !t.trim() || t.includes("\n") || t.length > FOR_AGENTS_MAX) out.push(`${where}: forAgents must be one line of at most ${FOR_AGENTS_MAX} characters (the rest goes in its AGENTS.md)`)
    else for (const [, k] of t.matchAll(/\{(\w+)\}/g)) if (!keys.includes(k)) out.push(`${where}: forAgents names {${k}}, which isn't one of its settings`)
  }
  for (const k of ["requires", "enhances"]) {
    const v = m[k] ?? []
    if (!Array.isArray(v)) out.push(`${where}: ${k} must be a list of plugin ids`)
    else for (const other of v) if (!ids.has(other)) out.push(`${where}: ${k} '${other}', which isn't a plugin`)
  }
  return [...out, ...metaProblems(m, where), ...compatProblems(m, where)]
}

/** Who made it, where it's from, what it does beyond the vault, the other apps' plugins it stands in for: `version`, `author`,
 *  `repo`, `fundingUrl`, `disclosures`, `replaces`. All optional here; one installed needs `version` and `repo` (installProblems). */
export function metaProblems(m: Record<string, unknown>, where = "manifest.json") {
  const out: string[] = []
  if (m.version !== undefined && (typeof m.version !== "string" || !VERSION.test(m.version))) out.push(`${where}: version must be a version like "1.0.0"`)
  if (m.author !== undefined && (typeof m.author !== "string" || !m.author.trim())) out.push(`${where}: author is a name`)
  if (m.repo !== undefined && (typeof m.repo !== "string" || !REPO_NAME.test(m.repo))) out.push(`${where}: repo is its GitHub repository, "owner/name"`)
  if (m.fundingUrl !== undefined) {
    let ok = false
    try { ok = typeof m.fundingUrl === "string" && new URL(m.fundingUrl).protocol === "https:" } catch { /* not a URL */ }
    if (!ok) out.push(`${where}: fundingUrl is an https:// address`)
  }
  if (m.replaces !== undefined && (!isMap(m.replaces) || !Object.values(m.replaces).every((ids) => Array.isArray(ids) && ids.every((x) => typeof x === "string" && /^([\w.-]+|\*)$/.test(x))))) {
    out.push(`${where}: replaces lists other apps' plugins it stands in for, by app and id ({"obsidian": ["dataview"]}; "*": it runs any)`)
  }
  if (m.marks !== undefined && (!isMap(m.marks) || !Object.entries(m.marks).every(([k, t]) => /^[\w.-]+$/.test(k) && typeof t === "string" && /^[a-z][\w-]*$/.test(t)))) {
    out.push(`${where}: marks maps a frontmatter key to the type it gives a file without \`type:\` ({"kanban-plugin": "kanban"})`)
  }
  if (m.userFiles !== undefined && (!Array.isArray(m.userFiles) || !m.userFiles.every((f) => typeof f === "string" && userFileOk(f)))) {
    out.push(`${where}: userFiles lists the files it writes as the user's own, by path in its folder (["init.vim"]), never code or manifest.json`)
  }
  if (m.disclosures !== undefined) {
    const d = m.disclosures
    if (!isMap(d)) out.push(`${where}: disclosures is an object: {"network": ["api.example.com"], "shell": true, "outsideVault": true, "clipboard": true}`)
    else for (const [k, v] of Object.entries(d)) {
      if (!Object.hasOwn(DISCLOSURES, k)) out.push(`${where}: disclosures.${k} isn't one (${Object.keys(DISCLOSURES).join(", ")})`)
      else if (k === "network" ? !Array.isArray(v) || !v.every((h) => typeof h === "string" && HOST.test(h)) : typeof v !== "boolean") {
        out.push(k === "network" ? `${where}: disclosures.network is a list of the hosts it talks to ("api.example.com", "*.example.com", or "*" for those its settings name)` : `${where}: disclosures.${k} is true or false`)
      }
    }
  }
  return out
}

/** What a plugin installed from a repository also needs: its `version` and `repo`, and the version its tag says. */
export function installProblems(m: Record<string, unknown>, tag: string | null, where = "manifest.json") {
  const out: string[] = []
  if (m.version === undefined) out.push(`${where}: an installable plugin says its version ("version": "1.0.0")`)
  if (m.repo === undefined) out.push(`${where}: an installable plugin says its repository ("repo": "owner/name")`)
  if (tag && typeof m.version === "string" && tagVersion(tag) !== m.version) out.push(`${where}: version is ${m.version}, but its tag is ${tag}`)
  return out
}

/** Whether this app can run a plugin (core/version.ts): its manifest's `minAppVersion` (a version, "0.2.0": the oldest
 *  app it works in) and `apiVersion` (a whole number: the plugin API it was written for). Both optional. */
export function compatProblems(m: Record<string, unknown>, where = "manifest.json", app = APP_VERSION, api = API_VERSION, minApi = MIN_API_VERSION) {
  const out: string[] = []
  if (m.minAppVersion !== undefined) {
    if (!parseVersion(m.minAppVersion)) out.push(`${where}: minAppVersion must be a version like "0.1.0"`)
    else if (compareVersions(m.minAppVersion as string, app)! > 0) {
      out.push(`${where}: needs Vaultite ${m.minAppVersion} or later (this is ${app}): update the app to use it`)
    }
  }
  if (m.apiVersion !== undefined) {
    const v = m.apiVersion
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) out.push(`${where}: apiVersion must be a whole number, like ${api}`)
    else if (v > api) out.push(`${where}: written for plugin API ${v}, newer than this app's (${api}): update the app to use it`)
    else if (v < minApi) out.push(`${where}: written for plugin API ${v}, which this app no longer loads (${minApi} to ${api}): update the plugin`)
  }
  return out
}

/** What the folder's `.vaultiteignore` leaves out of an install (its tests, QA, fixtures): a line per path, `*` any
 *  name, a last `/` a folder; one without a slash in it matches at any depth, like .gitignore. */
export function ignoreOf(dir: string): (rel: string) => boolean {
  let lines: string[] = []
  try { lines = fs.readFileSync(path.join(dir, ".vaultiteignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) } catch { /* none */ }
  const res = lines.map((l) => {
    const folder = l.endsWith("/"), p = l.replace(/^\/|\/$/g, "")
    const body = p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")
    return new RegExp(`${p.includes("/") || l.startsWith("/") ? "^" : "(^|/)"}${body}${folder ? "/" : "(/|$)"}`)
  })
  return (rel) => res.some((r) => r.test(rel.split(path.sep).join("/")))
}

export type ImportRules = {
  /** The plugin's folder. */
  dir: string
  /** The app's folder (for the core and node_modules). */
  root: string
  /** A vault plugin (stricter: see the top of this file). */
  vault: boolean
  /** "@plugins/<tier>/<id>" of the plugins it requires. */
  requires: string[]
  /** A vault plugin's files its index.tsx reaches (frontFiles): any other is its backend's, like plugin.ts. */
  front?: Set<string>
}

/** The files of a plugin's own that its index.tsx imports, directly or not: what runs in the browser. */
export function frontFiles(dir: string): Set<string> {
  const seen = new Set<string>(), todo = [path.join(dir, "index.tsx")]
  for (let f = todo.pop(); f; f = todo.pop()) {
    if (seen.has(f) || !fs.existsSync(f)) continue
    seen.add(f)
    for (const hit of fs.readFileSync(f, "utf8").matchAll(IMPORT)) {
      const spec = hit[1] ?? hit[2] ?? hit[3]
      if (!spec.startsWith(".")) continue
      const t = path.resolve(path.dirname(f), spec)
      const hitFile = [t, `${t}.ts`, `${t}.tsx`, path.join(t, "index.ts"), path.join(t, "index.tsx")].find((c) => fs.statSync(c, { throwIfNoEntry: false })?.isFile())
      if (hitFile && inside(dir, hitFile)) todo.push(hitFile)
    }
  }
  return seen
}

/** What's wrong with one file's imports. `where`: how to name the file in a message. */
export function importProblems(file: string, src: string, where: string, rules: ImportRules): string[] {
  const out: string[] = []
  const backend = nodeSide(file) || (!!rules.front && !rules.front.has(file))
  const say = (spec: string, why: string) => out.push(`${where}: imports ${spec}: ${why}`)
  for (const hit of src.matchAll(IMPORT)) {
    const spec = hit[1] ?? hit[2] ?? hit[3]
    if (spec.startsWith(".") || path.isAbsolute(spec) || spec.startsWith("file:")) {
      const target = spec.startsWith("file:") ? spec : path.resolve(path.dirname(file), spec)
      if (inside(rules.dir, target)) continue // its own folder
      if (rules.vault) { say(spec, "a vault plugin imports only from its own folder, \"@vaultite\" and packages"); continue }
      if (!backend) continue // (the check before this one didn't look at these)
      const inCore = path.dirname(target) === path.join(rules.root, "core")
      const core = path.basename(target)
      if (!inCore || !(CORE_FOR_PLUGINS.has(core) || (core === "cli.ts" && path.basename(file) === "cli.ts"))) {
        say(spec, "a plugin's backend talks to the core only through core/plugins.ts, core/vault.ts, core/client.ts, core/timeline.ts, core/codingagents.ts and core/terminalids.ts")
      }
      continue
    }
    if (spec.startsWith("@/")) { say(spec, "use \"@vaultite\" (the plugin API) instead"); continue }
    if (backend) {
      if (!rules.vault || isBuiltin(spec) || VAULT_CORE.test(spec)) continue
      if (spec.startsWith("@vaultite")) say(spec, "a vault plugin's backend imports the core as @vaultite/core/plugins.ts, vault.ts, client.ts or timeline.ts")
      else if (spec.startsWith("@plugins/")) say(spec, "a backend uses a plugin it requires through plugin.peer(\"<id>\").exports")
      else if (!fs.existsSync(path.join(rules.root, "node_modules", packageOf(spec)))) say(spec, "the app has no such package")
      continue
    }
    if (spec.startsWith("@plugins/")) {
      if (!rules.requires.some((x) => spec.startsWith(x + "/"))) say(spec, "a plugin may only import plugins it `requires`")
      continue
    }
    if (!rules.vault || SHARED.has(spec) || SHARED_EDITOR.has(spec)) continue
    if (spec.startsWith("@vaultite")) say(spec, "the plugin API is \"@vaultite\" (the core's files are for plugin.ts)")
    else if (isBuiltin(spec)) say(spec, "Node's modules are for plugin.ts; index.tsx runs in the browser")
    else if (!fs.existsSync(path.join(rules.root, "node_modules", packageOf(spec)))) say(spec, "the app has no such package")
  }
  return out
}

// Reading a settings file from disk: its path as text (".vaultite/plugins/x/data.json") or in parts (path.join(...,
// ".vaultite", "plugins", "x")), on a line that reads something (help texts and comments only name them).
const READS = /readFileSync|readFile\(|readText|\.abs\(|path\.join|\.config\(|fetch\(/
const SETTINGS = [
  /\.vaultite\/plugins\.json|["']\.vaultite["']\s*,\s*["']plugins\.json["']/,
  /\.vaultite\/plugins\/([\w-]+)\/|["']\.vaultite["']\s*,\s*["']plugins["']\s*,\s*["']([\w-]+)["']|\.config\(\s*[`"']plugins\/([\w-]+)\//,
]

/** Where one file reads another plugin's settings, or plugins.json, from disk rather than through the API. */
export function settingsProblems(src: string, where: string, id: string): string[] {
  const out: string[] = []
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || !READS.test(line)) return
    if (SETTINGS[0].test(line)) out.push(`${where}:${i + 1}: reads .vaultite/plugins.json itself: use vault.config("plugins")`)
    if (/\.config\(\s*["']plugins["']\s*\)\.disabled/.test(line)) out.push(`${where}:${i + 1}: reads which plugins are off from \`disabled\` alone: use plugin.isOff() or vault.switchedOff() (offByDefault ones too)`)
    const m = SETTINGS[1].exec(line)
    const other = m && (m[1] ?? m[2] ?? m[3])
    if (other && other !== id) out.push(`${where}:${i + 1}: reads the ${other} plugin's settings itself: use plugin.peer("${other}")?.settings()`)
  })
  return out
}

/** Every rule a plugin folder breaks: its manifest's and every file's imports. `ids`: every plugin there is, with their
 *  tier ("core", "vault"). `label`: how to name the folder in messages. */
export function pluginProblems(dir: string, root: string, ids: Map<string, string>, vault: boolean, label: string, manifest?: Record<string, unknown>) {
  const name = path.basename(dir)
  let m: Record<string, unknown>
  try {
    m = manifest ?? JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))
  } catch (e) {
    return [`${label}: no readable manifest.json (${(e as Error).message})`]
  }
  const out = manifestProblems(m, name, new Set(ids.keys()), `${label}/manifest.json`)
  // The app's plugins each name a category (the Plugins page groups by it); a vault plugin's is optional (else Other).
  if (!vault && !CATEGORIES.some((c) => c.id === m.category)) {
    out.push(`${label}/manifest.json: category must be one of ${CATEGORIES.map((c) => c.id).join(", ")} (core/categories.ts)`)
  }
  // (a vault plugin is off until turned on anyway)
  if (m.offByDefault !== undefined && (vault || m.offByDefault !== true)) {
    out.push(`${label}/manifest.json: offByDefault is for the app's plugins, and only true`)
  }
  // A vault plugin imports the app's plugins it requires; the others' files aren't the app's to bundle.
  const requires = (Array.isArray(m.requires) ? m.requires as string[] : [])
    .filter((r) => ids.has(r) && (!vault || ids.get(r) !== "vault")).map((r) => `@plugins/${ids.get(r)}/${r}`)
  // (what its .vaultiteignore leaves out of an install, its tests and QA, never runs in the app)
  const ignored = ignoreOf(dir)
  const front = vault ? frontFiles(dir) : undefined
  for (const file of walk(dir)) {
    if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts") || ignored(path.relative(dir, file))) continue
    const rel = `${label}/${path.relative(dir, file).split(path.sep).join("/")}`
    const src = fs.readFileSync(file, "utf8")
    out.push(...importProblems(file, src, rel, { dir, root, vault, requires, front }), ...settingsProblems(src, rel, name))
  }
  return out
}

/** The keys of `blocks: { ... }` in a plugin's definePlugin (index.tsx's source; depth 1 only, strings and comments
 *  skipped): the blocks it draws in the app. */
export function blockNames(src: string): string[] {
  const at = src.search(/\bblocks:\s*\{/)
  if (at < 0) return []
  const out: string[] = []
  let i = src.indexOf("{", at) + 1, depth = 1, expectKey = true
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 2; continue }
    if (depth === 1 && expectKey) {
      const m = /^\s*(?:"([\w-]+)"|'([\w-]+)'|([A-Za-z_$][\w$]*))\s*:/.exec(src.slice(i))
      if (m) { out.push(m[1] ?? m[2] ?? m[3]); i += m[0].length; expectKey = false; continue }
    }
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1; i++; continue }
    if ("{([".includes(c)) depth++
    else if ("})]".includes(c)) depth--
    else if (c === "," && depth === 1) expectKey = true
    else if (!/\s/.test(c)) expectKey = false
    i++
  }
  return out
}

/** The blocks a coding agent plugin's `codingAgent(plugin, {prefix})` gives it (core/codingagents.ts). */
export const USAGE_BLOCKS = (prefix: string) => ["-sessions", "-usage", "-projects", "-models", ""].map((s) => prefix + s)

/** The blocks a plugin's backend gives a text side (`plugin.block("<name>", ...)` in its .ts files, or codingAgent). */
export function textBlockNames(dir: string): string[] {
  const out = new Set<string>()
  for (const f of walk(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue
    const src = fs.readFileSync(f, "utf8")
    for (const m of src.matchAll(/\.block\(\s*["'`]([\w-]+)["'`]/g)) out.add(m[1])
    for (const m of src.matchAll(/codingAgent\([^)]*?prefix:\s*["'`]([\w-]+)["'`]/g)) for (const b of USAGE_BLOCKS(m[1])) out.add(b)
  }
  return [...out]
}

/** What breaks a plugin's declarations: its blocks' and settings' own problems, a drawn block that isn't declared or
 *  has no text side, a declared block it doesn't draw. */
export function blockProblems(dir: string, m: Record<string, unknown>, label: string): string[] {
  const where = `${label}/manifest.json`
  const out = [...declProblems(m.blocks, where), ...settingDeclProblems(m.settings, where)]
  let src = ""
  try { src = fs.readFileSync(path.join(dir, "index.tsx"), "utf8") } catch { /* no frontend */ }
  const drawn = blockNames(src), texts = new Set(textBlockNames(dir)), decls = declsOf(m)
  for (const b of drawn) {
    if (!Object.hasOwn(decls, b)) out.push(`${where}: block '${b}' (drawn by index.tsx) isn't declared in "blocks": what it shows and its options`)
    if (!texts.has(b)) out.push(`${label}: block '${b}' has no text side: plugin.block("${b}", ...) in plugin.ts, what /api/render shows`)
  }
  for (const b of Object.keys(decls)) if (!drawn.includes(b)) out.push(`${where}: declares block '${b}', which index.tsx doesn't draw`)
  return out
}
