// Vault plugins (.vaultite/plugins/<id>/): the app's plugin shape and rules, off until turned on and allowed on this machine
// (core/trust.ts). A changed one reloads: plugin.ts as a new module URL, index.tsx bundled against the app's React.
import crypto from "node:crypto"
import fs from "node:fs"
import { isBuiltin, registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { LOCAL, Plugin, ROOT } from "./plugins.ts"
import { disclosuresOf, ICON_NAME, iconOf } from "./pluginmeta.ts"
import { blockProblems, hashed, inside, installProblems, pluginProblems, SHARED, SHARED_EDITOR, userFilesOf, VAULT_CORE, walk } from "./rules.ts"
import { declsOf, settingsOf } from "./blocks.ts"
import type { VaultEvent } from "./events.ts"
import { hookProblems, Hooks } from "./hooks.ts"
import type { Op } from "./ops.ts"
import { type Digest, trustOf, type Trust } from "./trust.ts"
import { type Item, readText, type Vault, writeAtomic } from "./vault.ts"

export const DIR = ".vaultite/plugins"
const CACHE = path.join(LOCAL, "cache", "plugins")
const CSS = path.join(ROOT, "web", "src", "index.css") // the app's Tailwind setup: a plugin's classes compile against it
// Part of every plugin's version: a new way of building (bump it), or a new app stylesheet, builds bundles again.
const BUILD = "4:" + crypto.createHash("sha256").update(readText(CSS)).digest("hex").slice(0, 8)

export type VaultPlugin = {
  id: string; dir: string; manifest: Item
  /** Its manifest's icon as the app draws it (core/pluginmeta.ts iconOf): a name, or its SVG file as a data address. */
  icon: string | null
  /** Its files' sizes and times (cheap to compare), and a hash of their contents and the app's build: its version. */
  stat: string; hash: string
  /** Its contents' hash and each file's (what this machine approves: core/trust.ts). */
  digest: Digest
  /** Why the plugin index blocks this version (core/pluginindex.ts), or null. */
  blocked: string | null
  /** Rules it breaks: it isn't loaded. */
  problems: string[]
  /** Where it breaks the block contract (core/rules.ts blockProblems): it loads anyway. */
  warnings: string[]
  /** Loaded (on, and plugin.ts imported), at which version. */
  plugin: Plugin | null; loaded: string
  /** Its built frontend: bundle.js and the chunks it imports when it needs them (a big package loaded only when used). */
  bundle: { hash: string; code: string; chunks: Record<string, string> } | null
  /** What went wrong loading plugin.ts or building index.tsx, at which version (tried again when its files change). */
  failed: { load?: [string, string]; build?: [string, string] }
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").trim() // eslint-disable-line no-control-regex
const message = (e: unknown) => plain(String((e as Error)?.message ?? e)).split("\n").slice(0, 6).join("\n")

// --- plugin.ts: what it may import
const FOLDERS = new Map<string, string>() // vault plugin id -> its folder
const APP = pathToFileURL(path.join(ROOT, "server.ts")).href
const TAG = /[?&]plugin=([^&]+)&v=(\w+)$/

registerHooks({
  resolve(spec, context, next) {
    const m = context.parentURL ? TAG.exec(context.parentURL) : null
    if (!m) return next(spec, context)
    const id = decodeURIComponent(m[1]), dir = FOLDERS.get(id)
    const refuse = (why: string): never => { throw new Error(`${id}: plugin.ts can't import '${spec}': ${why}`) }
    if (!dir) return refuse("the plugin isn't loaded")
    const own = "a vault plugin imports only its own folder's files (not hidden ones, nor node_modules)"
    const core = VAULT_CORE.exec(spec)
    if (core) return next(pathToFileURL(path.join(ROOT, "core", `${core[1]}.ts`)).href, context)
    if (isBuiltin(spec)) return next(spec, context)
    if (spec.startsWith("./") || spec.startsWith("../")) {
      if (!hashed(dir, fileURLToPath(new URL(spec, context.parentURL)))) return refuse(own)
      const r = next(spec, context)
      if (!r.url.startsWith("file:") || !hashed(dir, fileURLToPath(r.url))) return refuse(own)
      return { ...r, url: `${r.url}?plugin=${m[1]}&v=${m[2]}` }
    }
    if (/^(@[\w.-]+\/)?[\w.-]/.test(spec) && !spec.includes(":") && !spec.startsWith("@vaultite") && !spec.startsWith("@plugins/")) {
      return next(spec, { ...context, parentURL: APP }) // an npm package: the app's
    }
    return refuse("a vault plugin's backend imports its own folder, @vaultite/core/plugins.ts (vault.ts, client.ts, " +
      "timeline.ts), Node's modules and the app's npm packages")
  },
})

// --- index.tsx: one ES module for the web app

/** The app's built stylesheet (web/dist), to tell which classes it has; "" before a build. */
let appCss: { file: string; text: string } | null = null
function builtCss() {
  const dist = path.join(ROOT, "web", "dist")
  let file = ""
  try { file = /href="\.\/assets\/([^"]+\.css)"/.exec(readText(path.join(dist, "index.html")))?.[1] ?? "" } catch { /* not built */ }
  if (appCss?.file !== file) { try { appCss = { file, text: file ? readText(path.join(dist, "assets", file)) : "" } } catch { appCss = { file, text: "" } } }
  return appCss!.text
}

/** A class name as a CSS selector writes it (CSS.escape, for the characters Tailwind's names have). */
const escapeClass = (c: string) => c.replace(/^(\d)/, "\\3$1 ").replace(/[^\w-]/g, (ch) => `\\${ch}`)

/** Its Tailwind classes, compiled against the app's stylesheet, in the `plugins` layer (under the app's utilities in
 *  web/index.html: it never restyles the app). Variants the app doesn't have (`md:-m-1`) go in `plugin-variants`,
 *  above them, so they win over the app's plain classes on its own elements, as they would in the app. */
async function styles(dir: string, used: Set<string>) {
  const { compile } = await import("@tailwindcss/node")
  const { Scanner } = await import("@tailwindcss/oxide")
  const scanner = new Scanner({})
  const candidates = new Set<string>()
  // (only the modules its bundle has: other files in its folder, data or another app's code, aren't its classes)
  for (const f of walk(dir)) {
    if (!/\.[jt]sx?$/.test(f) || !used.has(f)) continue
    for (const c of scanner.getCandidatesWithPositions({ content: readText(f), extension: path.extname(f).slice(1) })) candidates.add(c.candidate)
  }
  const app = builtCss()
  const theirs = (c: string) => [..."{:, >[."].some((ch) => app.includes(`.${escapeClass(c)}${ch}`))
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

/** The bundle: its styles and the plugins it requires first, then the module (its default export: the
 *  definePlugin({...})), and the chunks its import()s load. `tiers`: the app's plugins, id -> tier. */
async function bundle(vp: VaultPlugin, tiers: Map<string, string>) {
  const { rolldown } = await import("rolldown")
  const dir = fs.realpathSync(vp.dir)
  const requires = ((vp.manifest.requires ?? []) as string[]).filter((r) => tiers.has(r)).map((r) => `@plugins/${tiers.get(r)}/${r}`)
  const preload = new Set<string>()
  const sheets: string[] = [] // stylesheets it imports (a package's own: "@excalidraw/excalidraw/index.css"), in order
  const refuse = (spec: string, why: string): never => { throw new Error(`can't import '${spec}': ${why}`) }
  // Its icon by a Lucide name comes in the bundle (`icon`), so the app needn't load all of Lucide's to draw it.
  const index = path.join(dir, "index.tsx"), ENTRY = "\0vau-entry"
  const lucide = vp.icon && ICON_NAME.test(vp.icon) ? path.join(ROOT, "node_modules", "lucide-react", "dist", "esm", "icons", `${vp.icon}.mjs`) : ""
  const entry = lucide && fs.existsSync(lucide) ? `export { default } from ${JSON.stringify(index)}\nexport { default as icon } from ${JSON.stringify(lucide)}` : ""
  const build = await rolldown({
    input: entry ? ENTRY : index,
    cwd: ROOT,
    platform: "browser",
    logLevel: "silent",
    resolve: { conditionNames: ["production", "browser", "import", "default"] }, // (as the app's own build)
    transform: { jsx: { runtime: "automatic" }, define: { "process.env.NODE_ENV": JSON.stringify("production") } },
    plugins: [{
      name: "vaultite",
      async resolveId(spec, importer) {
        if (spec === ENTRY || importer === ENTRY) return spec
        if (SHARED.has(spec)) return `\0vau:${spec}`
        if (SHARED_EDITOR.has(spec) || spec.startsWith("@plugins/")) {
          if (spec.startsWith("@plugins/") && !requires.some((r) => spec.startsWith(r + "/"))) refuse(spec, "a plugin may only import plugins it `requires`")
          preload.add(spec)
          return `\0vau:${spec}`
        }
        if (!importer || importer.includes(`${path.sep}node_modules${path.sep}`)) return null // the entry; a package's own imports
        if (spec.startsWith("./") || spec.startsWith("../")) {
          const r = await this.resolve(spec, importer, { skipSelf: true })
          if (!r) refuse(spec, "no such file")
          if (!hashed(dir, r!.id)) refuse(spec, "a vault plugin imports only its own folder's files (not hidden ones, nor node_modules)")
          return r
        }
        if (spec.startsWith("@/")) refuse(spec, "use \"@vaultite\" (the plugin API) instead")
        if (spec.startsWith("@vaultite")) refuse(spec, "the plugin API is \"@vaultite\"")
        if (isBuiltin(spec) || spec.includes(":") || path.isAbsolute(spec)) refuse(spec, "index.tsx runs in the browser: its folder, \"@vaultite\" and npm packages")
        const r = await this.resolve(spec, path.join(ROOT, "package.json"), { skipSelf: true })
        return r ?? refuse(spec, "the app has no such package")
      },
      load(id) {
        if (id === ENTRY) return entry
        if (id.startsWith("\0vau:")) return `module.exports = globalThis.__vaultite.modules[${JSON.stringify(id.slice(5))}]`
        if (id.endsWith(".css")) { sheets.push(readText(id)); return { code: "", moduleType: "js" } }
        return null
      },
    }],
  })
  try {
    const out = await build.generate({ format: "esm", minify: true, entryFileNames: "bundle.js", chunkFileNames: "[name]-[hash].js" })
    const used = new Set(out.output.flatMap((o) => (o.type === "chunk" ? o.moduleIds : [])))
    const css = sheets.join("\n") + await styles(dir, used)
    const chunks: Record<string, string> = {}
    let entry = ""
    for (const o of out.output) if (o.type === "chunk") { if (o.isEntry) entry = o.code; else chunks[o.fileName] = o.code }
    return { code: `globalThis.__vaultite.style(${JSON.stringify(vp.id)}, ${JSON.stringify(css)});\n` +
      `await globalThis.__vaultite.preload(${JSON.stringify([...preload])});\n${entry}`, chunks }
  } finally {
    await build.close()
  }
}

// --- the folder

/** The files that aren't its code: data.json, its settings, and its manifest's `userFiles` (changing them isn't a new version). */
function notCode(dir: string) {
  const own = userFilesOf(dir)
  return (f: string) => f === path.join(dir, "data.json") || own.has(path.relative(dir, f).split(path.sep).join("/"))
}

/** Its files, as `<path>:<size>:<mtime>` lines (data.json and its userFiles left out). */
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

/** Each of its files' hash (data.json and its userFiles left out), and the whole's: what this machine approves, and the
 *  lock records. */
export function digestOf(dir: string): Digest {
  const files: Record<string, string> = {}
  const whole = crypto.createHash("sha256")
  const skip = notCode(dir)
  for (const f of walk(dir)) {
    if (skip(f)) continue
    const rel = path.relative(dir, f).split(path.sep).join("/")
    files[rel] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16)
    whole.update(`\0${rel}\0${files[rel]}`)
  }
  return { content: whole.digest("hex").slice(0, 16), files }
}

/** What's wrong with a vault plugin's folder, checked as `label` (.vaultite/plugins/<id>): its manifest (read here unless
 *  given), files and commands, and for one to install (`installable`, `tag`: what its version must be) version and repo.
 *  `ids`: every plugin there is, id -> tier. Warnings break the block contract: it loads anyway. */
export function checkVaultPlugin(dir: string, o: { ids: Map<string, string>; label: string; tag?: string | null; installable?: boolean; manifest?: Item }) {
  const { ids, label } = o
  let manifest: Item | null = o.manifest ?? null, unread = ""
  if (!manifest) try { manifest = JSON.parse(readText(path.join(dir, "manifest.json"))) } catch (e) { unread = (e as Error).message }
  const id = typeof manifest?.id === "string" ? manifest.id : path.basename(dir)
  const problems: string[] = []
  if (ids.has(id) && ids.get(id) !== "vault") problems.push(`${label}: the app already has a plugin called '${id}'`)
  if (!manifest) return { manifest, problems: [...problems, `${label}: no readable manifest.json (${unread})`], warnings: [] as string[] }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`${label}/manifest.json: id must be lowercase letters, digits and dashes, starting with a letter`)
  problems.push(...pluginProblems(dir, ROOT, ids, true, label, manifest), ...hookProblems(manifest, dir, `${label}/manifest.json`))
  if (o.installable || o.tag) problems.push(...installProblems(manifest, o.tag ?? null, `${label}/manifest.json`))
  return { manifest, problems, warnings: blockProblems(dir, manifest, label) }
}

export class VaultPlugins {
  vault: Vault
  /** The app's plugins: id -> tier (a vault plugin can't take one's id, and may require them). */
  tiers: Map<string, string>
  found = new Map<string, VaultPlugin>() // by folder name, sorted
  /** Their manifests' commands: ops, event hooks, startup, schedule (core/hooks.ts). */
  hooks: Hooks
  /** What this machine approved (core/trust.ts). */
  trust: Trust
  /** Why the plugin index blocks a plugin's version, or null (the App sets it: core/pluginindex.ts). */
  blocked: (vp: VaultPlugin) => string | null = () => null
  private queue: Promise<unknown> = Promise.resolve()
  private declared = new WeakSet<Op>() // the ops a plugin got from its manifest (dropped when it's loaded again)

  constructor(vault: Vault, app: Plugin[]) {
    this.vault = vault
    this.tiers = new Map(app.map((p) => [p.id, p.tier]))
    this.hooks = new Hooks(vault)
    this.trust = trustOf(vault.path)
  }

  /** An event (core/events.ts): the event hooks of the plugins that are loaded and on. */
  heard(ev: VaultEvent) {
    // (plugins.json as the last sync read it: one just turned off hears nothing, though it's unloaded only at the next
    // request)
    const e = this.vault.config("plugins").enabled
    const on = new Set(Array.isArray(e) ? e : [])
    this.hooks.heard(ev, [...this.found.values()].filter((v) => v.plugin && on.has(v.id)))
  }

  /** The ones turned on, read from plugins.json as it is now: this runs before the request's sync, when vault.config()
   *  may be a request late. Unreadable (mid-sync): what was read last. */
  enabled() {
    let e: unknown
    try { e = (this.vault.readConfig("plugins") ?? {}).enabled } catch { e = this.vault.config("plugins").enabled }
    return new Set<string>(Array.isArray(e) ? e.filter((x) => typeof x === "string") : [])
  }

  /** Let plugin `id` run on this machine as its files are now (core/trust.ts), remembered as `version` or its manifest's;
   *  throws when its files can't be read yet. */
  allow(id: string, o: { version?: string; edits?: boolean; digest?: Digest } = {}): Digest {
    const d = o.digest ?? digestOf(this.vault.abs(`${DIR}/${id}`))
    const v = o.version ?? this.found.get(id)?.manifest.version
    this.trust.approve(id, d, typeof v === "string" ? v : undefined, true, o.edits)
    return d
  }

  /** The loaded ones (on, and nothing wrong), by folder name. */
  loaded() {
    return [...this.found.values()].flatMap((v) => (v.plugin ? [v.plugin] : []))
  }

  /** Look at the folder again and load or unload what changed (one sync at a time). True if the loaded plugins
   *  changed (the app then rebuilds its list, AGENTS.md and dashboards). */
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
    for (const name of names) {
      const dir = path.join(root, name)
      const stat = `${statOf(dir)}\n${names.join(",")}`
      let vp = this.found.get(name)
      if (!vp || vp.stat !== stat) {
        let manifest: Item = { id: name, name }
        try {
          const r = checkVaultPlugin(dir, { ids, label: `${DIR}/${name}` })
          const { problems, warnings } = r
          manifest = r.manifest ?? manifest
          const digest = digestOf(dir)
          // (the app's built stylesheet too: which of its classes the app has decides their layer)
          const hash = crypto.createHash("sha256").update(BUILD).update((builtCss(), appCss?.file ?? "")).update(digest.content).digest("hex").slice(0, 12)
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
      const want = on.has(name) && !vp.problems.length && !vp.blocked && this.trust.approved(name, vp.digest.content)
      if (!want) { vp.failed = {}; this.hooks.stopped(name) } // turned on again: tried again, its startup runs again
      if (vp.plugin && (!want || vp.loaded !== vp.hash)) { this.unload(vp); changed = true }
      if (want && !vp.plugin && vp.failed.load?.[0] !== vp.hash && (await this.load(vp))) changed = true
      if (vp.plugin && fs.existsSync(path.join(dir, "index.tsx")) && vp.bundle?.hash !== vp.hash && vp.failed.build?.[0] !== vp.hash) await this.build(vp)
    }
    if (!this.trust.made) this.trust.save()
    return changed
  }

  private async load(vp: VaultPlugin) {
    try {
      FOLDERS.set(vp.id, fs.realpathSync(vp.dir)) // what Node resolves imports to (the vault may be a symlink)
      const file = path.join(vp.dir, "plugin.ts")
      let p: Plugin
      if (fs.existsSync(file)) {
        const mod = await import(`${pathToFileURL(file).href}?plugin=${encodeURIComponent(vp.id)}&v=${vp.hash}`)
        if (!(mod.plugin instanceof Plugin)) throw new Error("plugin.ts must export `plugin`: export const plugin = new Plugin(import.meta.url)")
        p = mod.plugin
      } else p = new Plugin(path.join(vp.dir, "manifest.json"))
      for (const k of p.kinds) if (this.vault.has(k.collection)) throw new Error(`its kind '${k.collection}' is another plugin's`)
      p.vault = this.vault
      for (const k of p.kinds) this.vault.register(k)
      // Its manifest's ops (core/hooks.ts), besides plugin.ts's (the same module again keeps only one set).
      p.ops = p.ops.filter((o) => !this.declared.has(o))
      for (const op of this.hooks.opsOf(vp)) { this.declared.add(op); p.op(op) }
      for (const j of this.hooks.jobsOf(vp, p)) p.every(j.name, j, j.run) // (by name: loaded again, it replaces itself)
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

  /** Unload them all (the server serves another vault now: Manage vaults on the web). */
  async close() {
    await this.queue
    for (const vp of this.found.values()) if (vp.plugin) this.unload(vp)
    this.hooks.close()
  }

  private unload(vp: VaultPlugin) {
    const p = vp.plugin!
    for (const fn of p.cleanups) {
      try {
        fn()
      } catch (e) {
        console.error(`vault plugin ${vp.id}: onUnload:`, e)
      }
    }
    for (const k of p.kinds) this.vault.unregister(k)
    p.forget()
    vp.plugin = null
    vp.loaded = ""
  }

  private async build(vp: VaultPlugin) {
    const file = path.join(CACHE, `${vp.id}-${vp.hash}.json`)
    try {
      let built: { code: string; chunks: Record<string, string> }
      try {
        built = JSON.parse(readText(file))
      } catch {
        built = await bundle(vp, this.tiers)
        fs.mkdirSync(CACHE, { recursive: true })
        for (const old of fs.readdirSync(CACHE)) if (old.startsWith(`${vp.id}-`) && /\.js(on)?$/.test(old)) fs.rmSync(path.join(CACHE, old), { force: true })
        writeAtomic(file, JSON.stringify(built))
      }
      vp.bundle = { hash: vp.hash, ...built }
      delete vp.failed.build
    } catch (e) {
      vp.bundle = null
      vp.failed.build = [vp.hash, `index.tsx couldn't be built: ${message(e)}`]
    }
  }

  /** A file of its built frontend for the web app (bundle.js, or a chunk it imports), at this version, if it's on and built. */
  code(id: string, version: string, file = "bundle.js") {
    const vp = this.found.get(id)
    if (!vp?.plugin || vp.bundle?.hash !== vp.hash || version !== vp.hash) return null
    return file === "bundle.js" ? vp.bundle.code : Object.hasOwn(vp.bundle.chunks, file) ? vp.bundle.chunks[file] : null
  }

  /** What the web app shows (/api/state's `vaultPlugins`, GET /api/plugins): every vault plugin, on or off; `problems`
   *  keep it from loading, `warnings` don't (a block without its declaration or its text side). */
  list(): Item[] {
    const on = this.enabled()
    const lock = this.vault.config("plugins-lock")
    return [...this.found.values()].map((vp) => {
      const m = vp.manifest
      const failed = Object.values(vp.failed).filter((f) => f && f[0] === vp.hash).map((f) => f![1])
      const pages = path.join(vp.dir, "pages")
      const str = (k: string) => (typeof m[k] === "string" && m[k] ? m[k] as string : null)
      // On in the vault, but not allowed on this machine at this version: what changed since it was (all of it when never).
      const waiting = on.has(vp.id) && !vp.problems.length && !vp.blocked && !this.trust.approved(vp.id, vp.digest.content)
      const changes = waiting ? this.trust.changes(vp.id, vp.digest) : null
      return {
        id: vp.id, name: typeof m.name === "string" && m.name ? m.name : vp.id, description: typeof m.description === "string" ? m.description : "",
        requires: Array.isArray(m.requires) ? m.requires : [], enhances: Array.isArray(m.enhances) ? m.enhances : [], runsOnServer: !!m.runsOnServer,
        minAppVersion: typeof m.minAppVersion === "string" ? m.minAppVersion : null, apiVersion: typeof m.apiVersion === "number" ? m.apiVersion : null,
        ...(typeof m.tint === "string" ? { tint: m.tint } : {}),
        ...(vp.icon ? { icon: vp.icon } : {}),
        ...(typeof m.category === "string" ? { category: m.category } : {}),
        ...(m.replaces && typeof m.replaces === "object" && !Array.isArray(m.replaces) ? { replaces: m.replaces } : {}),
        folder: `${DIR}/${vp.id}`, on: on.has(vp.id), loaded: !!vp.plugin, problems: [...vp.problems, ...failed, ...(vp.blocked ? [vp.blocked] : [])], warnings: vp.warnings,
        version: str("version"), author: str("author"), repo: str("repo"), fundingUrl: str("fundingUrl"), disclosures: disclosuresOf(m),
        // where it was installed from (.vaultite/plugins-lock.json: core/installs.ts), null for one made here
        source: lock[vp.id] && typeof lock[vp.id] === "object" ? lock[vp.id] : null,
        approval: changes ? { state: changes.since ? "changed" : "new", since: changes.since, changed: changes.files.slice(0, 50) } : null,
        blocked: vp.blocked, hash: vp.digest.content, edits: !!this.trust.approval(vp.id)?.edits,
        // its blocks as its manifest declares them (core/blocks.ts): the app checks their options against them
        blocks: declsOf(m),
        // its settings as its manifest declares them: the app draws them as a form in its settings sheet
        settings: settingsOf(m),
        // the bundle's version (the web app imports it again when it changes), null when there's none to load
        bundle: this.code(vp.id, vp.hash) !== null ? vp.hash : null,
        pages: (fs.existsSync(pages) ? fs.readdirSync(pages).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort() : [])
          .map((n) => ({ name: n.slice(0, -3), text: readText(path.join(pages, n)) })),
      }
    })
  }
}
