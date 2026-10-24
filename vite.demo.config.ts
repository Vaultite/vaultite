import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Alias, type Plugin } from 'vite'
import base, { pluginIcons, pluginModules } from './vite.config.ts'
import { MACHINE } from './web/demo/machine.ts'
import { ignoreOf, walk } from './core/rules.ts'

// npm run build:demo: the web app with its server in the browser, on the sandbox vault (web/demo/CLAUDE.md), as static
// files in web/dist-demo for any host, under any path.
const ROOT = import.meta.dirname
const node = (file: string) => path.join(ROOT, 'web/demo/node', file)
const STUBBED = ['node:child_process', 'node:http', 'node:https', 'node:http2', 'node:net', 'node:dns', 'node:readline', 'node:module',
  'node:stream', 'node:stream/promises', 'node:perf_hooks', 'node:inspector/promises', 'node:zlib', 'node:sqlite', 'ws', 'node-pty', '@xterm/headless',
  '@xterm/addon-serialize', '@tailwindcss/node', '@tailwindcss/oxide', 'rolldown']
const ALIASES: Alias[] = [
  ...Object.entries({ fs: 'fs.ts', path: 'path.ts', crypto: 'crypto.ts', os: 'os.ts', url: 'url.ts', util: 'util.ts', async_hooks: 'async_hooks.ts',
    'timers/promises': 'timers.ts' }).map(([m, file]) => ({ find: `node:${m}`, replacement: node(file) })),
  ...STUBBED.map((m) => ({ find: new RegExp(`^${m}$`), replacement: node('stub.ts') })),
  // (a vault plugin's backend imports the core as @vaultite/core/<name>.ts)
  { find: /^@vaultite\/core\/(\w+)(?:\.ts)?$/, replacement: path.join(ROOT, 'core/$1.ts') },
]

// Vaultite's own plugins (Vaultite/plugins, checked out at VAULTITE_PLUGINS, else beside the app) are built in here as
// if they were the app's, off until turned on: a visitor can't install anything, and bundles name them to install.
const OFFICIAL = path.resolve(process.env.VAULTITE_PLUGINS ?? path.join(ROOT, '..', 'vaultite-plugins'))
if (!fs.existsSync(OFFICIAL)) throw new Error(`the demo builds in Vaultite's own plugins: check out Vaultite/plugins at ${OFFICIAL}, or set VAULTITE_PLUGINS`)
type Official = { id: string; dir: string; manifest: Record<string, unknown>; machine: boolean }
const official: Official[] = fs.readdirSync(OFFICIAL).sort().flatMap((id) => {
  const dir = path.join(OFFICIAL, id)
  let m: Record<string, unknown>
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) } catch { return [] }
  if (m.id !== id || m.repo !== 'Vaultite/plugins' || fs.existsSync(path.join(ROOT, 'plugins/core', id))) return []
  // (what runs programs, reads the machine's files or needs the desktop app needs one: off here, as the app's are: web/demo/machine.ts)
  const d = (m.disclosures ?? {}) as { shell?: boolean }
  return [{ id, dir, manifest: { ...m, offByDefault: true }, machine: m.runsOnServer === true || m.desktopApp === true || d.shell === true }]
})
/** Each official plugin's files the server reads (manifest, docs, pages, styles), at /app/plugins/core/<id>/ as the app's. */
function officialFiles() {
  const out: Record<string, string> = {}
  for (const o of official) {
    const left = ignoreOf(o.dir)
    for (const f of walk(o.dir)) {
      const rel = path.relative(o.dir, f).split(path.sep).join('/')
      if (left(rel) || !/\.(md|json|css)$/.test(rel)) continue
      out[`/app/plugins/core/${o.id}/${rel}`] = rel === 'manifest.json' ? JSON.stringify(o.manifest, null, 2) : fs.readFileSync(f, 'utf8')
    }
  }
  return out
}
/** An official plugin's file as the app's would be: plugins/core/<id>/<rest> (its module URL in the worker). */
const asApp = (file: string) => {
  const o = official.find((x) => file.startsWith(x.dir + path.sep))
  return o ? path.join('plugins/core', o.id, path.relative(o.dir, file)) : null
}
const MODULES = [path.join(ROOT, 'plugins/core'), OFFICIAL]

/** The official plugins for the page (web/src/core/plugins.ts merges them in), keyed as plugins/core's globs are. */
function officialPlugins(): Plugin {
  const ID = 'virtual:official-plugins'
  return {
    name: 'vaultite-demo-official-plugins',
    enforce: 'pre',
    resolveId: (id) => (id === ID ? '\0' + ID : null),
    load(id) {
      if (id !== '\0' + ID) return
      const key = (o: Official, rel: string) => JSON.stringify(`../../../plugins/core/${o.id}/${rel}`)
      const withIndex = official.filter((o) => fs.existsSync(path.join(o.dir, 'index.tsx')))
      const pages = official.flatMap((o) => (fs.existsSync(path.join(o.dir, 'pages')) ? fs.readdirSync(path.join(o.dir, 'pages')) : [])
        .filter((n) => n.endsWith('.md')).map((n) => `${key(o, `pages/${n}`)}: ${JSON.stringify(fs.readFileSync(path.join(o.dir, 'pages', n), 'utf8'))}`))
      return withIndex.map((o, i) => `import d${i} from ${JSON.stringify(path.join(o.dir, 'index.tsx'))}`).join('\n') +
        `\nexport const manifests = {${official.map((o) => `${key(o, 'manifest.json')}: ${JSON.stringify(o.manifest)}`).join(', ')}}` +
        `\nexport const modules = {${withIndex.map((o, i) => `${key(o, 'index.tsx')}: d${i}`).join(', ')}}` +
        `\nexport const pages = {${pages.join(', ')}}\n`
    },
    // (their Tailwind classes are the app's here)
    transform: (code, id) => (id.endsWith('web/src/index.css') ? `${code}\n@source ${JSON.stringify(OFFICIAL)};\n` : undefined),
  }
}

/** The server's modules in the worker: each sees itself at /app as in the repo (its import.meta.url, dirname and filename), and core/plugins.ts
 *  takes the built-in plugins' backends from the bundle, but those that need a machine: virtual:demo-plugin-files names
 *  them (for web/demo/mount.ts) and keeps them once worker.ts imports virtual:demo-plugins, after the core (one chunk:
 *  WebKit runs a worker's script again when a chunk imports it). The official plugins' too, and their files. */
function demoServer(): Plugin {
  const dirs = [
    ...fs.readdirSync(path.join(ROOT, 'plugins/core')).filter((d) => !MACHINE.includes(d)).map((d) => ({ id: d, dir: path.join(ROOT, 'plugins/core', d) })),
    ...official.filter((o) => !o.machine),
  ].filter((d) => fs.existsSync(path.join(d.dir, 'plugin.ts')))
  return {
    name: 'vaultite-demo-server',
    resolveId: (id) => (id.startsWith('virtual:demo-') ? '\0' + id : null),
    load(id) {
      const files = dirs.map((d) => `/app/plugins/core/${d.id}/plugin.ts`)
      if (id === '\0virtual:demo-plugin-files') return `export default ${JSON.stringify(files)}\nexport const loaded = {}`
      if (id === '\0virtual:demo-official-files') return `export default ${JSON.stringify(officialFiles())}`
      if (id !== '\0virtual:demo-plugins') return
      return dirs.map((d, i) => `import * as p${i} from ${JSON.stringify(path.join(d.dir, 'plugin.ts'))}`).join('\n') +
        `\nimport { loaded } from "virtual:demo-plugin-files"\nObject.assign(loaded, {${files.map((f, i) => `${JSON.stringify(f)}: p${i}`).join(', ')}})`
    },
    transform(code, id) {
      const file = id.replace(/\?.*$/, '')
      const rel = asApp(file) ?? path.relative(ROOT, file)
      if (!/^(core|plugins)\/.*\.ts$/.test(rel)) return
      const app = `/app/${rel}`
      let out = `const __vauModuleUrl = ${JSON.stringify(`file://${app}`)};\n` + code.replaceAll('import.meta.url', '__vauModuleUrl')
        .replaceAll('import.meta.dirname', JSON.stringify(path.posix.dirname(app))).replaceAll('import.meta.filename', JSON.stringify(app))
      if (rel === 'core/plugins.ts') out = 'import { loaded as __demoPlugins } from "virtual:demo-plugin-files";\n' + out.replace('import(pathToFileURL(file).href)', 'Promise.resolve(__demoPlugins[file])')
      return out
    },
  }
}

/** The app starts once the demo has (web/demo/boot.ts: main.tsx's first import, which waits for its server). */
const demoEntry = (): Plugin => ({
  name: 'vaultite-demo-entry',
  transform: (code, id) => (id === path.join(ROOT, 'web/src/main.tsx') ? `import ${JSON.stringify(path.join(ROOT, 'web/demo/boot.ts'))}\n${code}` : undefined),
  // ?theme=light (or dark) pins the look for the site's embed, and the page can switch it (vaultite-demo:theme). Before
  // any of the app's code: its chunks read the system's look as they load.
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <script>${PIN_THEME}</script>`),
})

const PIN_THEME = `(() => {
  let pin = new URLSearchParams(location.search).get("theme")
  if (pin !== "light" && pin !== "dark") return
  const real = matchMedia.bind(window), heard = new Set()
  class Pinned extends EventTarget {
    constructor(media) { super(); this.media = media; this.onchange = null }
    get matches() { return this.media.includes("dark") === (pin === "dark") }
    addEventListener(type, fn, o) { heard.add(this); super.addEventListener(type, fn, o) }
    addListener(fn) { this.addEventListener("change", fn) }
    removeListener(fn) { this.removeEventListener("change", fn) }
  }
  window.matchMedia = (q) => (q.includes("prefers-color-scheme") ? new Pinned(q) : real(q))
  addEventListener("message", (e) => {
    const to = e.data?.theme
    if (e.origin !== location.origin || e.data?.type !== "vaultite-demo:theme" || (to !== "light" && to !== "dark") || to === pin) return
    pin = to
    for (const m of heard) { const ev = new MediaQueryListEvent("change", { media: m.media, matches: m.matches }); m.dispatchEvent(ev); m.onchange?.(ev) }
  })
})()`

// (the base's resolvers know only the app's own plugins)
const own = new Set(['vaultite-plugin-modules', 'vaultite-plugin-icons'])
export default defineConfig({
  ...base,
  plugins: [officialPlugins(), pluginModules(MODULES), pluginIcons(Object.fromEntries(official.map((o) => [o.id, o.dir]))),
    ...(base.plugins ?? []).filter((p) => !(p && 'name' in p && own.has(p.name))), demoEntry()],
  define: { ...base.define, __DEMO_OFFICIAL__: JSON.stringify(official.map((o) => ({ id: o.id, machine: o.machine }))) },
  resolve: { alias: [...ALIASES, ...Object.entries(base.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement }))] },
  worker: { format: 'es', plugins: () => [pluginModules(MODULES), demoServer()] },
  build: {
    ...base.build, outDir: 'dist-demo', emptyOutDir: true, chunkSizeWarningLimit: 4000, minify: process.env.DEMO_MINIFY !== '0',
    rollupOptions: {
      input: { main: path.join(ROOT, 'web/index.html'), sw: path.join(ROOT, 'web/demo/sw.ts') },
      output: { entryFileNames: (c) => (c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
      onwarn: base.build?.rollupOptions?.onwarn,
    },
  },
})
