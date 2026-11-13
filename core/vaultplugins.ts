import crypto from "node:crypto"
import fs from "node:fs"
import { isBuiltin, registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { contentType, LOCAL, Plugin, ROOT } from "./plugins.ts"
import { Manifest } from "./contracts/manifest.ts"
import { readJson } from "./jsonfile.ts"
import { disclosuresOf, exportsOf, ICON_NAME, iconOf, PLUGIN_MODULE } from "./pluginmeta.ts"
import { onItsOwn } from "./writegate.ts"
import { backendOnly, blockProblems, exportFile, hashed, inside, installProblems, listedPackage, pluginProblems, settingsFile, SHARED, SHARED_EDITOR, UNLISTED, userFilesOf, VAULT_CORE, walk } from "./rules.ts"
import { declsOf, drawsOf, settingsOf } from "./blocks.ts"
import { groupOf } from "./categories.ts"
import type { VaultEvent } from "./events.ts"
import { hookProblems, Hooks, scheduleOf } from "./hooks.ts"
import type { Op } from "./ops.ts"
import { type Digest, notesOf, trustOf, type Trust } from "./trust.ts"
import { official } from "./updates.ts"
import { served } from "./webbuild.ts"
import { type Item, readText, type Vault, writeAtomic } from "./vault.ts"
import { isObj, messageOf } from "./values.ts"

export const DIR = ".vaultite/plugins"
const CACHE = path.join(LOCAL, "cache", "plugins")
const CSS = path.join(ROOT, "web", "src", "index.css")
const short = (...parts: string[]) => parts.reduce((h, p) => h.update(p).update("\0"), crypto.createHash("sha256")).digest("hex").slice(0, 8)
let built: { at: string; build: string } | null = null
function buildKey() {
  const st = fs.statSync(CSS), at = `${st.mtimeMs}:${st.size}`
  if (built?.at !== at) built = { at, build: short(readText(CSS), ...[styles, compileStyles, classesOfApp, escapeClass, withStyles].map(String)) }
  return built.build
}
const CODE = short(JSON.stringify(JSON.parse(readText(path.join(ROOT, "package.json"))).dependencies ?? {}), JSON.stringify([...SHARED, ...SHARED_EDITOR]),
  ...[bundle, withAssets].map(String))

export type VaultPlugin = {
  id: string; dir: string; manifest: Manifest
  icon: string | null
  stat: string; hash: string
  digest: Digest
  blocked: string | null
  problems: string[]
  warnings: string[]
  plugin: Plugin | null; loaded: string
  bundle: { hash: string; code: string; chunks: Record<string, string> } | null
  failed: { load?: [string, string]; build?: [string, string] }
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").trim()
const message = (e: unknown) => plain(messageOf(e)).split("\n").slice(0, 6).join("\n")

const FOLDERS = new Map<string, { dir: string; hash: string; files: Record<string, string> }>()
const APP = pathToFileURL(path.join(ROOT, "server.ts")).href
const TAG = /[?&]plugin=([^&]+)&v=(\w+)$/
const BUILT_IN = path.join(ROOT, "plugins", "core") + path.sep

function moduleUrl(id: string, name: string, vault: boolean): string | null {
  const own = path.join(BUILT_IN, id)
  if (fs.existsSync(path.join(own, "manifest.json"))) { const f = exportFile(own, name); return f && pathToFileURL(f).href }
  const at = vault ? FOLDERS.get(id) : undefined, f = at && exportFile(at.dir, name)
  return f ? `${pathToFileURL(f).href}?plugin=${encodeURIComponent(id)}&v=${at!.hash}` : null
}
const manifestIn = (dir: string) => readJson(path.join(dir, "manifest.json"), Manifest, readText)
const requiresOf = (dir: string): string[] => { const r = manifestIn(dir); return r.ok ? r.value.requires ?? [] : [] }

/** A vault plugin's file as an ES module, whatever package.json is above it (a vault that is also a code project may
 *  say `"type": "commonjs"`, which made its plugins fail to load). */
const asModule = <R extends { url: string; format?: string | null }>(r: R): R => {
  if (!TAG.test(r.url) || !r.url.startsWith("file:")) return r
  const p = new URL(r.url).pathname
  return /\.(m?ts|tsx)$/.test(p) ? { ...r, format: "module-typescript" } : /\.m?js$/.test(p) ? { ...r, format: "module" } : r
}

registerHooks({
  load(url, context, next) {
    const r = next(url, context), m = TAG.exec(url)
    if (!m || !url.startsWith("file:")) return r
    const id = decodeURIComponent(m[1]), at = FOLDERS.get(id), rel = at ? path.relative(at.dir, fileURLToPath(url)).split(path.sep).join("/") : ""
    if (!at || at.hash !== m[2] || r.source == null || fileHash(Buffer.from(r.source as Uint8Array | string)) !== at.files[rel]) {
      throw new Error(`${id}: ${rel || url} changed since this machine allowed it: it loads once allowed again`)
    }
    return r
  },
  resolve(spec, context, next) {
    const m = context.parentURL ? TAG.exec(context.parentURL) : null
    if (!m && TAG.test(spec)) return asModule(next(spec, context))
    if (!m) {
      const p = spec.startsWith("@plugins/") && context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : ""
      if (!p.startsWith(BUILT_IN)) return next(spec, context)
      const mod = PLUGIN_MODULE.exec(spec), from = p.slice(BUILT_IN.length).split(path.sep)[0]
      const url = mod && requiresOf(path.join(BUILT_IN, from)).includes(mod[1]) ? moduleUrl(mod[1], mod[2], false) : null
      if (!url) throw new Error(`${from}: can't import '${spec}': a plugin imports the modules that plugins it requires export`)
      return next(url, context)
    }
    const id = decodeURIComponent(m[1]), dir = FOLDERS.get(id)?.dir
    const refuse = (why: string): never => { throw new Error(`${id}: plugin.ts can't import '${spec}': ${why}`) }
    if (!dir) return refuse("the plugin isn't loaded")
    const own = "a vault plugin imports only its own folder's files (not hidden ones, nor node_modules)"
    const mod = PLUGIN_MODULE.exec(spec)
    if (mod) {
      if (!requiresOf(dir).includes(mod[1])) return refuse(`a plugin imports only from plugins it \`requires\``)
      const url = moduleUrl(mod[1], mod[2], true)
      return url ? asModule(next(url, context)) : refuse(`${mod[1]} isn't loaded, or doesn't export '${mod[2]}'`)
    }
    const core = VAULT_CORE.exec(spec)
    if (core) return next(pathToFileURL(path.join(ROOT, "core", `${core[1]}.ts`)).href, context)
    if (isBuiltin(spec)) return next(spec, context)
    if (spec.startsWith("./") || spec.startsWith("../")) {
      if (!hashed(dir, fileURLToPath(new URL(spec, context.parentURL)))) return refuse(own)
      const r = next(spec, context)
      if (!r.url.startsWith("file:") || !hashed(dir, fileURLToPath(r.url))) return refuse(own)
      return asModule({ ...r, url: `${r.url}?plugin=${m[1]}&v=${m[2]}` })
    }
    if (/^(@[\w.-]+\/)?[\w.-]/.test(spec) && !spec.includes(":") && !spec.startsWith("@vaultite") && !spec.startsWith("@plugins/")) {
      return listedPackage(spec) ? next(spec, { ...context, parentURL: APP }) : refuse(UNLISTED)
    }
    return refuse("a vault plugin's backend imports its own folder, @vaultite/core/plugins.ts (vault.ts, client.ts, " +
      "timeline.ts, agents.ts, layout.ts), modules of plugins it requires (@plugins/<id>/<module>), Node's modules and the npm packages the app gives plugins")
  },
})

let appCss: { file: string; text: string } | null = null
function builtCss() {
  const dist = served.dist
  let file = ""
  try { file = /href="\.\/assets\/([^"]+\.css)"/.exec(readText(path.join(dist, "index.html")))?.[1] ?? "" } catch { /* not built */ }
  if (appCss?.file !== file) { try { appCss = { file, text: file ? readText(path.join(dist, "assets", file)) : "" } } catch { appCss = { file, text: "" } } }
  return appCss!.text
}

const escapeClass = (c: string) => c.replace(/^(\d)/, "\\3$1 ").replace(/[^\w-]/g, (ch) => `\\${ch}`)

let appClasses: { file: string; names: Set<string> } | null = null
function classesOfApp() {
  const text = builtCss(), file = appCss?.file ?? ""
  if (appClasses?.file !== file) appClasses = { file, names: new Set([...text.matchAll(/\.((?:\\[0-9a-fA-F]{1,6} |\\.|[\w-])+)(?=[{:, >[.])/g)].map((m) => m[1])) }
  return appClasses.names
}

const stylesFile = new Map<string, string>()
async function styles(id: string, dir: string, used: Set<string>) {
  const { Scanner } = await import("@tailwindcss/oxide")
  const scanner = new Scanner({})
  const candidates = new Set<string>()
  for (const f of walk(dir)) {
    if (!/\.[jt]sx?$/.test(f) || !used.has(f)) continue
    for (const c of scanner.getCandidatesWithPositions({ content: readText(f), extension: path.extname(f).slice(1) })) candidates.add(c.candidate)
  }
  const app = classesOfApp()
  const theirs = (c: string) => app.has(escapeClass(c))
  const sorted = [...candidates].sort()
  const key = crypto.createHash("sha256").update(buildKey()).update(CODE).update(dir).update(sorted.map((c) => `${c}\0${theirs(c) ? 1 : 0}`).join("\n")).digest("hex").slice(0, 12)
  const file = path.join(CACHE, `${id}-styles-${key}.json`)
  stylesFile.set(id, path.basename(file))
  try { return JSON.parse(readText(file)) as string } catch { /* not made yet */ }
  const css = await compileStyles(dir, candidates, theirs)
  fs.mkdirSync(CACHE, { recursive: true })
  writeAtomic(file, JSON.stringify(css))
  return css
}

async function compileStyles(dir: string, candidates: Set<string>, theirs: (c: string) => boolean) {
  const { compile } = await import("@tailwindcss/node")
  const top = [...candidates].filter((c) => c.replace(/\[[^\]]*\]/g, "").includes(":") && !theirs(c))
  const props: string[] = []
  const layer = async (name: string, list: string[]) => {
    if (!list.length) return ""
    const tw = await compile(`@reference ${JSON.stringify(CSS)};\n@tailwind utilities;\n`, { base: dir, onDependency: () => {} })
    // (@property rules stay at the top level: they aren't layered)
    const css = tw.build(list).replace(/^\/\*![^*]*\*\/\s*/, "").replace(/@property [^{]+\{[^}]*\}\s*/g, (rule) => { props.push(rule.trim()); return "" }).trim()
    return css ? `@layer ${name} {\n${css}\n}\n` : ""
  }
  const out = await layer("plugins", [...candidates].filter((c) => !top.includes(c))) + await layer("plugin-variants", top)
  return out ? `${out}${[...new Set(props)].join("\n")}\n` : ""
}

/** A package's stylesheet with the files it names beside it (its fonts: Excalidraw's Assistant) in it as data: URLs:
 *  inlined into the page, a relative url() would be read against the page's address, where nothing is. */
function withAssets(file: string, css: string) {
  const modules = fs.realpathSync(path.join(ROOT, "node_modules")) + path.sep
  return css.replace(/url\((["']?)(\.{1,2}\/[^"')?#]+)([?#][^"')]*)?\1\)/g, (all, _q: string, rel: string) => {
    const at = path.resolve(path.dirname(fs.realpathSync(file)), rel)
    if (!at.startsWith(modules) || !fs.statSync(at, { throwIfNoEntry: false })?.isFile()) return all
    return `url("data:${contentType(at)};base64,${fs.readFileSync(at).toString("base64")}")`
  })
}

async function bundle(vp: VaultPlugin) {
  const { rolldown } = await import("rolldown")
  const dir = fs.realpathSync(vp.dir)
  const requires = new Set(vp.manifest.requires ?? [])
  const preload = new Set<string>()
  const sheets: string[] = []
  const refuse = (spec: string, why: string): never => { throw new Error(`can't import '${spec}': ${why}`) }
  const index = path.join(dir, "index.tsx"), ENTRY = "\0vau-entry"
  const lucide = vp.icon && ICON_NAME.test(vp.icon) ? path.join(ROOT, "node_modules", "lucide-react", "dist", "esm", "icons", `${vp.icon}.mjs`) : ""
  const offered = exportsOf(vp.manifest).flatMap((x) => { const f = exportFile(dir, x, vp.manifest); return f && !backendOnly(dir, f) ? [[x, f]] : [] })
  const entry = [fs.existsSync(index) ? `export { default } from ${JSON.stringify(index)}` : "",
    lucide && fs.existsSync(lucide) ? `export { default as icon } from ${JSON.stringify(lucide)}` : "",
    ...offered.map(([, f], i) => `import * as m${i} from ${JSON.stringify(f)}`),
    offered.length ? `export const __exports = { ${offered.map(([x], i) => `${JSON.stringify(x)}: m${i}`).join(", ")} }` : ""].filter(Boolean).join("\n")
  const build = await rolldown({
    input: ENTRY,
    cwd: ROOT,
    platform: "browser",
    logLevel: "silent",
    // (an import()ed chunk imports what it shares from its own chunks, not its importer's: one that is a package's worker
    // too, Excalidraw's fonts, would run the plugin's code there, reading globalThis.__vaultite, which no worker has)
    experimental: { chunkOptimization: { avoidRedundantChunkLoads: false } },
    resolve: { conditionNames: ["production", "browser", "import", "default"] },
    transform: { jsx: { runtime: "automatic" }, define: { "process.env.NODE_ENV": JSON.stringify("production") } },
    plugins: [{
      name: "vaultite",
      async resolveId(spec, importer) {
        if (spec === ENTRY || importer === ENTRY) return spec
        if (SHARED.has(spec)) return `\0vau:${spec}`
        if (SHARED_EDITOR.has(spec) || spec.startsWith("@plugins/")) {
          const mod = PLUGIN_MODULE.exec(spec)
          if (spec.startsWith("@plugins/") && (!mod || !requires.has(mod[1]))) refuse(spec, "a plugin imports the modules that plugins it `requires` export")
          preload.add(spec)
          return `\0vau:${spec}`
        }
        if (!importer || importer.includes(`${path.sep}node_modules${path.sep}`)) return null
        if (spec.startsWith("./") || spec.startsWith("../")) {
          const r = await this.resolve(spec, importer, { skipSelf: true })
          if (!r) refuse(spec, "no such file")
          if (!hashed(dir, r!.id)) refuse(spec, "a vault plugin imports only its own folder's files (not hidden ones, nor node_modules)")
          return r
        }
        if (spec.startsWith("@/")) refuse(spec, "use \"@vaultite\" (the plugin API) instead")
        if (spec.startsWith("@vaultite")) refuse(spec, "the plugin API is \"@vaultite\"")
        if (isBuiltin(spec) || spec.includes(":") || path.isAbsolute(spec)) refuse(spec, "index.tsx runs in the browser: its folder, \"@vaultite\" and the npm packages the app gives plugins")
        if (!listedPackage(spec)) refuse(spec, UNLISTED)
        const r = await this.resolve(spec, path.join(ROOT, "package.json"), { skipSelf: true })
        return r ?? refuse(spec, "the app has no such package")
      },
      load(id) {
        if (id === ENTRY) return entry
        if (id.startsWith("\0vau:")) return `module.exports = globalThis.__vaultite.modules[${JSON.stringify(id.slice(5))}]`
        if (id.endsWith(".css")) { sheets.push(withAssets(id, readText(id))); return { code: "", moduleType: "js" } }
        return null
      },
    }],
  })
  try {
    const out = await build.generate({ format: "esm", minify: true, entryFileNames: preload.size ? MAIN : "bundle.js", chunkFileNames: "[name]-[hash].js" })
    const chunks: Record<string, string> = {}
    let entry = ""
    for (const o of out.output) if (o.type === "chunk") { if (o.isEntry) entry = o.code; else chunks[o.fileName] = o.code }
    return { entry, chunks, sheets, preload: [...preload], used: out.output.flatMap((o) => (o.type === "chunk" ? o.moduleIds : [])) }
  } finally {
    await build.close()
  }
}
type Code = Awaited<ReturnType<typeof bundle>>

const MAIN = "main.js"

async function withStyles(vp: VaultPlugin, c: Code) {
  const css = c.sheets.join("\n") + await styles(vp.id, fs.realpathSync(vp.dir), new Set(c.used))
  const style = `globalThis.__vaultite.style(${JSON.stringify(vp.id)}, ${JSON.stringify(css)});\n`
  if (!c.preload.length) return { code: style + c.entry, chunks: c.chunks }
  // Imported only once they're there: a static import (a chunk the module shares with its import()s) runs before
  // any line of bundle.js, so a class extending one of them would find it undefined.
  return { code: style + `await globalThis.__vaultite.preload(${JSON.stringify(c.preload)});\n` +
    `const m = await import("./${MAIN}");\nexport default m.default;\nexport const { icon, __exports } = m;\n`, chunks: { ...c.chunks, [MAIN]: c.entry } }
}

function notCode(dir: string) {
  const own = userFilesOf(dir)
  return (f: string) => settingsFile(path.relative(dir, f)) || own.has(path.relative(dir, f).split(path.sep).join("/"))
}
function notCodeBefore(dir: string) {
  const own = userFilesOf(dir)
  return (f: string) => f === path.join(dir, "data.json") || own.has(path.relative(dir, f).split(path.sep).join("/"))
}

function statOf(dir: string) {
  const skip = notCode(dir)
  return walk(dir).filter((f) => !skip(f)).map((f) => {
    try {
      const st = fs.statSync(f)
      return `${path.relative(dir, f)}:${st.size}:${st.mtimeMs}`
    } catch {
      return ""
    }
  }).join("\n")
}

const fileHash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16)

export function digestOf(dir: string, before = false): Digest {
  const files: Record<string, string> = {}
  const whole = crypto.createHash("sha256")
  const skip = (before ? notCodeBefore : notCode)(dir)
  for (const f of walk(dir)) {
    if (skip(f)) continue
    const rel = path.relative(dir, f).split(path.sep).join("/")
    files[rel] = fileHash(fs.readFileSync(f))
    whole.update(`\0${rel}\0${files[rel]}`)
  }
  return { content: whole.digest("hex").slice(0, 16), files, note: notesOf(dir) }
}

function dependencyOrder(names: string[], deps: Map<string, string[]>) {
  const out: string[] = [], seen = new Set<string>()
  const visit = (n: string, path: string[]) => {
    if (seen.has(n) || path.includes(n)) return
    for (const d of deps.get(n) ?? []) visit(d, [...path, n])
    seen.add(n)
    out.push(n)
  }
  for (const n of names) visit(n, [])
  return out
}

export function checkVaultPlugin(dir: string, o: { ids: Map<string, string>; label: string; tag?: string | null; installable?: boolean; manifest?: Item
  dirOf?: (id: string) => string }) {
  const { ids, label } = o
  let raw: unknown = o.manifest ?? null, unread = ""
  if (!raw) try { raw = JSON.parse(readText(path.join(dir, "manifest.json"))) } catch (e) { unread = messageOf(e) }
  const written = isObj(raw) ? raw : null
  const id = typeof written?.id === "string" ? written.id : path.basename(dir)
  const problems: string[] = []
  if (ids.has(id) && ids.get(id) !== "vault") problems.push(`${label}: the app already has a plugin called '${id}'`)
  if (!written) return { manifest: null, problems: [...problems, `${label}: no readable manifest.json (${unread || "not an object"})`], warnings: [] as string[] }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`${label}/manifest.json: id must be lowercase letters, digits and dashes, starting with a letter`)
  problems.push(...pluginProblems(dir, ROOT, ids, true, label, written, o.dirOf), ...hookProblems(written, dir, `${label}/manifest.json`))
  if (o.installable || o.tag) problems.push(...installProblems(written, o.tag ?? null, `${label}/manifest.json`))
  return { manifest: Manifest.parse({ ...written, id }), problems, warnings: blockProblems(dir, written, label) }
}

export class VaultPlugins {
  vault: Vault
  tiers: Map<string, string>
  found = new Map<string, VaultPlugin>()
  hooks: Hooks
  trust: Trust
  blocked: (vp: VaultPlugin) => string | null = () => null
  adopting = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private declared = new WeakSet<Op>()

  constructor(vault: Vault, app: Plugin[]) {
    this.vault = vault
    this.tiers = new Map(app.map((p) => [p.id, p.tier]))
    this.hooks = new Hooks(vault)
    this.trust = trustOf(vault.path)
    this.hooks.allowed = (vp) => { try { return this.trust.approved(vp.id, digestOf(vp.dir)) } catch { return false } }
  }

  heard(ev: VaultEvent) {
    const on = this.onIn(this.vault.config("plugins"))
    this.hooks.heard(ev, [...this.found.values()].filter((v) => v.plugin && on.has(v.id)))
  }

  enabled() {
    let conf: Item
    try { conf = this.vault.readConfig("plugins") ?? {} } catch { conf = this.vault.config("plugins") }
    return this.onIn(conf)
  }

  private onIn(conf: Item) {
    const e: unknown = conf.enabled
    const on = new Set<string>(Array.isArray(e) ? e.filter((x) => typeof x === "string") : [])
    if (conf.ai === false) for (const id of on) if (this.aiOf(id)) on.delete(id)
    return on
  }

  private aiOf(id: string) {
    const m = this.found.get(id)?.manifest
    if (m) return m.ai === true
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return false
    const r = manifestIn(this.vault.abs(`${DIR}/${id}`))
    return r.ok && r.value.ai === true
  }

  allow(id: string, o: { version?: string; edits?: boolean; digest?: Digest } = {}): Digest {
    const dir = this.vault.abs(`${DIR}/${id}`)
    const d = o.digest ?? digestOf(dir)
    const r = readJson(path.join(dir, "manifest.json"), Manifest), m = r.ok ? r.value : null
    const src = (this.vault.config("plugins-lock")[id] as Item | undefined)?.source
    this.trust.approve(id, d, { version: o.version ?? m?.version, edits: o.edits, source: typeof src === "string" ? src : undefined, says: disclosuresOf(m ?? {}) })
    return d
  }

  loaded() {
    return [...this.found.values()].flatMap((v) => (v.plugin ? [v.plugin] : []))
  }

  sync(): Promise<boolean> {
    const run = this.queue.then(() => this.run())
    this.queue = run.catch(() => {})
    return run
  }

  private async run() {
    let changed = false
    const root = this.vault.abs(DIR)
    let names: string[] = []
    try {
      names = fs.readdirSync(root).filter((n) => !n.startsWith(".") && fs.existsSync(path.join(root, n, "manifest.json"))).sort()
    } catch { /* no plugins folder */ }
    for (const [name, vp] of [...this.found]) {
      if (names.includes(name)) continue
      if (vp.plugin) { this.unload(vp); changed = true }
      this.found.delete(name)
    }
    const ids = new Map([...names.map((n): [string, string] => [n, "vault"]), ...this.tiers])
    const on = this.enabled()
    const deps = new Map(names.map((n) => [n, requiresOf(path.join(root, n)).filter((r) => r !== n && names.includes(r))]))
    for (const name of dependencyOrder(names, deps)) {
      const dir = path.join(root, name)
      const theirs = deps.get(name)!.map((r) => this.found.get(r)?.hash ?? "").join(",")
      const stat = `${statOf(dir)}\n${names.join(",")}\n${theirs}`
      let vp = this.found.get(name)
      if (!vp || vp.stat !== stat) {
        let manifest: Manifest = { id: name, name }
        try {
          const r = checkVaultPlugin(dir, { ids, label: `${DIR}/${name}`, dirOf: (id) => path.join(root, id) })
          const { problems, warnings } = r
          manifest = r.manifest ?? manifest
          const digest = digestOf(dir)
          const hash = crypto.createHash("sha256").update(buildKey()).update(CODE).update((builtCss(), appCss?.file ?? "")).update(digest.content).update(theirs).digest("hex").slice(0, 12)
          const icon = iconOf(manifest.icon, (f) => { const file = path.join(dir, f); return inside(dir, file) && fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? readText(file) : null })
          vp = { plugin: null, loaded: "", bundle: null, failed: {}, blocked: null, ...vp, id: name, dir, manifest, icon, stat, problems, warnings, hash, digest }
        } catch (e) {
          // A file iCloud hasn't brought down yet can't be read (EDEADLK under launchd): looked at again next time.
          vp = { plugin: null, loaded: "", bundle: null, failed: {}, blocked: null, ...vp, id: name, dir, manifest, icon: null, stat: "", warnings: [], hash: "", digest: { content: "", files: {} },
            problems: [`${DIR}/${name}: can't be read yet (${e instanceof Error ? e.message : String(e)})`] }
        }
        this.found.set(name, vp)
      }
      vp.blocked = this.blocked(vp)
      const want = on.has(name) && !vp.problems.length && !vp.blocked && this.trust.approved(name, vp.digest)
      if (!want) { vp.failed = {}; this.hooks.stopped(name) }
      if (vp.plugin && (!want || vp.loaded !== vp.hash)) { this.unload(vp); changed = true }
      if (want && !vp.plugin && vp.failed.load?.[0] !== vp.hash && (await this.load(vp))) changed = true
      const front = fs.existsSync(path.join(dir, "index.tsx")) || exportsOf(vp.manifest).length > 0
      if (vp.plugin && front && vp.bundle?.hash !== vp.hash && vp.failed.build?.[0] !== vp.hash) await this.build(vp)
    }
    if (!this.trust.made) this.trust.save()
    return changed
  }

  private async load(vp: VaultPlugin) {
    try {
      FOLDERS.set(vp.id, { dir: fs.realpathSync(vp.dir), hash: vp.hash, files: vp.digest.files }) // what Node resolves imports to (the vault may be a symlink)
      const file = path.join(vp.dir, "plugin.ts")
      let p: Plugin
      if (fs.existsSync(file)) {
        const mod = await onItsOwn(vp.id, () => import(`${pathToFileURL(file).href}?plugin=${encodeURIComponent(vp.id)}&v=${vp.hash}`))
        if (!(mod.plugin instanceof Plugin)) throw new Error("plugin.ts must export `plugin`: export const plugin = new Plugin(import.meta.url)")
        p = mod.plugin
      } else p = new Plugin(path.join(vp.dir, "manifest.json"))
      for (const k of p.kinds) if (this.vault.has(k.collection)) throw new Error(`its kind '${k.collection}' is another plugin's`)
      p.vault = this.vault
      for (const k of p.kinds) this.vault.register(k)
      p.ops = p.ops.filter((o) => !this.declared.has(o))
      for (const op of this.hooks.opsOf(vp)) { this.declared.add(op); p.op(op) }
      for (const j of this.hooks.jobsOf(vp, p)) p.every(j.name, j, j.run)
      vp.plugin = p
      vp.loaded = vp.hash
      delete vp.failed.load
      this.hooks.startup(vp)
      return true
    } catch (e) {
      console.error(`vault plugin ${vp.id}:`, e)
      vp.failed.load = [vp.hash, `plugin.ts couldn't be loaded: ${message(e)}`]
      return false
    }
  }

  async close() {
    await this.queue
    for (const vp of this.found.values()) if (vp.plugin) this.unload(vp)
    this.hooks.close()
  }

  private unload(vp: VaultPlugin) {
    const p = vp.plugin!
    const at = FOLDERS.get(vp.id)
    if (at) at.hash = ""
    p.unload()
    for (const k of p.kinds) this.vault.unregister(k)
    p.forget()
    vp.plugin = null
    vp.loaded = ""
  }

  private async build(vp: VaultPlugin) {
    const file = path.join(CACHE, `${vp.id}-${vp.hash}.json`)
    const codeHash = crypto.createHash("sha256").update(CODE).update(vp.digest.content).digest("hex").slice(0, 12)
    const codeFile = path.join(CACHE, `${vp.id}-code-${codeHash}.json`)
    try {
      let built: { code: string; chunks: Record<string, string> }
      try {
        built = JSON.parse(readText(file))
      } catch {
        let code: Code, bundled = false
        try { code = JSON.parse(readText(codeFile)) } catch {
          code = await bundle(vp)
          bundled = true
          if (digestOf(vp.dir).content !== vp.digest.content) throw new Error("its files changed as it was built: it's built again once allowed")
        }
        built = await withStyles(vp, code)
        fs.mkdirSync(CACHE, { recursive: true })
        const mine = new RegExp(`^${vp.id.replace(/[^\w-]/g, "\\$&")}-(code-|styles-)?[0-9a-f]{12}\\.json$`)
        const keep = new Set([path.basename(codeFile), stylesFile.get(vp.id)])
        for (const old of fs.readdirSync(CACHE)) if (mine.test(old) && !keep.has(old)) fs.rmSync(path.join(CACHE, old), { force: true })
        if (bundled) writeAtomic(codeFile, JSON.stringify(code))
        writeAtomic(file, JSON.stringify(built))
      }
      vp.bundle = { hash: vp.hash, ...built }
      delete vp.failed.build
    } catch (e) {
      vp.bundle = null
      vp.failed.build = [vp.hash, `index.tsx couldn't be built: ${message(e)}`]
    }
  }

  code(id: string, version: string, file = "bundle.js") {
    const vp = this.found.get(id)
    if (!vp?.plugin || vp.bundle?.hash !== vp.hash || version !== vp.hash) return null
    return file === "bundle.js" ? vp.bundle.code : Object.hasOwn(vp.bundle.chunks, file) ? vp.bundle.chunks[file] : null
  }

  private waits(vp: VaultPlugin, on = this.enabled()) {
    return on.has(vp.id) && !vp.problems.length && !vp.blocked && !this.trust.approved(vp.id, vp.digest)
  }

  paused() {
    const on = this.enabled()
    return [...this.found.values()].filter((vp) => this.trust.approval(vp.id) && !this.adopting.has(vp.id) && this.waits(vp, on)).map((vp) => ({
      id: vp.id, name: vp.manifest.name || vp.id,
      changed: this.trust.changes(vp.id, vp.digest).files, jobs: scheduleOf(vp.manifest, (k) => String(this.vault.config(`plugins/${vp.id}/data`)[k] ?? settingsOf(vp.manifest)[k]?.default ?? "")).map(({ entry: _, ...j }) => j),
    }))
  }

  list(): Item[] {
    const on = this.enabled()
    const lock = this.vault.config("plugins-lock")
    return [...this.found.values()].map((vp) => {
      const m = vp.manifest
      const failed = Object.values(vp.failed).filter((f) => f && f[0] === vp.hash).map((f) => f![1])
      const pages = path.join(vp.dir, "pages")
      const str = (k: string) => (typeof m[k] === "string" && m[k] ? m[k] as string : null)
      const changes = this.waits(vp, on) ? this.trust.changes(vp.id, vp.digest) : null
      return {
        id: vp.id, name: typeof m.name === "string" && m.name ? m.name : vp.id, description: typeof m.description === "string" ? m.description : "",
        requires: Array.isArray(m.requires) ? m.requires : [], enhances: Array.isArray(m.enhances) ? m.enhances : [], runsOnServer: !!m.runsOnServer,
        ...(m.desktopApp === true ? { desktopApp: true } : {}), ...(m.ai === true ? { ai: true } : {}),
        minAppVersion: typeof m.minAppVersion === "string" ? m.minAppVersion : null, apiVersion: typeof m.apiVersion === "number" ? m.apiVersion : null,
        ...(typeof m.tint === "string" ? { tint: m.tint } : {}),
        ...(vp.icon ? { icon: vp.icon } : {}),
        ...(typeof m.category === "string" ? { category: m.category } : {}),
        ...(groupOf(m.group) ? { group: m.group } : {}),
        ...(m.replaces && typeof m.replaces === "object" && !Array.isArray(m.replaces) ? { replaces: m.replaces } : {}),
        ...(m.marks && typeof m.marks === "object" && !Array.isArray(m.marks) ? { marks: m.marks } : {}),
        folder: `${DIR}/${vp.id}`, on: on.has(vp.id), loaded: !!vp.plugin, problems: [...vp.problems, ...failed, ...(vp.blocked ? [vp.blocked] : [])], warnings: vp.warnings,
        version: str("version"), author: str("author"), repo: str("repo"), fundingUrl: str("fundingUrl"), disclosures: disclosuresOf(m),
        source: lock[vp.id] && typeof lock[vp.id] === "object" ? { ...lock[vp.id], official: official(String(lock[vp.id].source ?? "")) } : null,
        approval: changes ? { state: this.adopting.has(vp.id) ? "updating" : changes.since ? "changed" : (lock[vp.id] as Item | undefined)?.moved ? "moved" : "new",
          since: changes.since, changed: changes.files } : null,
        blocked: vp.blocked, hash: vp.digest.content, edits: !!this.trust.approval(vp.id)?.edits,
        blocks: declsOf(m), draws: drawsOf(m),
        settings: settingsOf(m),
        bundle: this.code(vp.id, vp.hash) !== null ? vp.hash : null,
        pages: (fs.existsSync(pages) ? fs.readdirSync(pages).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort() : [])
          .map((n) => ({ name: n.slice(0, -3), text: readText(path.join(pages, n)) })),
      }
    })
  }
}
