import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { defineConfig, normalizePath, type Plugin, type Rollup } from 'vite'
import { exportsOf, ICON_FILE, ICON_NAME, PLUGIN_MODULE, svgIcon } from './core/pluginmeta.ts'
import { exportFile } from './core/rules.ts'
import { STAMP_META, stampText } from './core/buildstamp.ts'
import { gitEnv } from './core/gitenv.ts'

// An open page keeps asking for the build it loaded from (a view's chunk), so a rebuild keeps the last days' builds.
// VAULTITE_CLEAN_BUILD=1 (the desktop and iPhone apps' builds, which ship dist) keeps only this one.
const KEEP_DAYS = 3
function keepRecentBuilds(): Plugin {
  return {
    name: 'vaultite-keep-recent-builds',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = path.join(options.dir ?? path.resolve(import.meta.dirname, 'web/dist'), 'assets')
      const now = new Set(Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => f.slice(7)))
      const clean = !!process.env.VAULTITE_CLEAN_BUILD, oldest = Date.now() - KEEP_DAYS * 86_400_000
      let names: string[] = []
      try { names = fs.readdirSync(dir) } catch { return }
      for (const f of names) {
        if (now.has(f)) continue
        try { if (clean || fs.statSync(path.join(dir, f)).mtimeMs < oldest) fs.rmSync(path.join(dir, f)) } catch { /* gone */ }
      }
    },
  }
}

// Which commit a build is, in its pages (core/buildstamp.ts): open pages, vau version and Settings > About read it.
function buildStamp(): Plugin {
  let content = ''
  return {
    name: 'vaultite-build-stamp',
    apply: 'build',
    buildStart() {
      try {
        const [commit, at, ...subject] = execFileSync('git', ['log', '-1', '--format=%H%n%ct%n%s'], { cwd: import.meta.dirname, encoding: 'utf8', env: gitEnv() }).trim().split('\n')
        content = stampText({ commit, at: Number(at) * 1000, subject: subject.join(' ') })
      } catch { content = '' } // (not a checkout: no stamp)
    },
    transformIndexHtml: () => (content ? [{ tag: 'meta', attrs: { name: STAMP_META, content }, injectTo: 'head' }] : []),
  }
}

// The app's plugins' icons as virtual:plugin-icons, each Lucide one imported alone (all of Lucide is its own chunk).
// `more`: other plugins' folders by id (the demo's official ones).
export function pluginIcons(more: Record<string, string> = {}): Plugin {
  const ID = 'virtual:plugin-icons', CORE = path.resolve(import.meta.dirname, 'plugins/core')
  const LUCIDE = path.resolve(import.meta.dirname, 'node_modules/lucide-react/dist/esm/icons')
  return {
    name: 'vaultite-plugin-icons',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load(id) {
      if (id !== `\0${ID}`) return null
      const imports = ['import { markIcon } from "@/core/icons"'], entries: string[] = []
      const dirs: Record<string, string> = { ...Object.fromEntries(fs.readdirSync(CORE).map((n) => [n, path.join(CORE, n)])), ...more }
      for (const name of Object.keys(dirs).sort()) {
        const DIR = path.dirname(dirs[name]), file = path.join(dirs[name], 'manifest.json')
        if (!fs.existsSync(file)) continue
        this.addWatchFile(file)
        const icon: unknown = JSON.parse(fs.readFileSync(file, 'utf8')).icon
        if (typeof icon !== 'string') continue
        if (ICON_FILE.test(icon)) {
          const mark = fs.existsSync(path.join(DIR, name, icon)) && svgIcon(fs.readFileSync(path.join(DIR, name, icon), 'utf8'))
          if (mark) entries.push(`${JSON.stringify(name)}: markIcon(${JSON.stringify(mark)})`)
        } else if (ICON_NAME.test(icon) && fs.existsSync(path.join(LUCIDE, `${icon}.mjs`))) {
          imports.push(`import i${imports.length} from "lucide-react/dist/esm/icons/${icon}.mjs"`)
          entries.push(`${JSON.stringify(name)}: i${imports.length - 1}`)
        } else entries.push(`${JSON.stringify(name)}: ${JSON.stringify(icon)}`)
      }
      return `${imports.join('\n')}\nexport default {\n  ${entries.join(',\n  ')}\n}\n`
    },
  }
}

const EXPORTED = 'virtual:plugin-exports', EXPORTED_ID = '\0virtual:plugin-exports'
/** @plugins/<id>/<module>: a module a plugin's manifest `exports` (core/rules.ts checks who may import it), from the
 *  folders that hold plugins (the app's own; the demo's official ones too). */
export function pluginModules(dirs: string[]): Plugin {
  return {
    name: 'vaultite-plugin-modules',
    enforce: 'pre',
    resolveId(spec) {
      if (spec === EXPORTED) return EXPORTED_ID
      const m = PLUGIN_MODULE.exec(spec)
      if (!m) return null
      for (const d of dirs) {
        if (!fs.existsSync(path.join(d, m[1], 'manifest.json'))) continue
        const f = exportFile(path.join(d, m[1]), m[2])
        // (Vite's ids use forward slashes: a native Windows path would be a second copy of a module others import)
        if (f) return normalizePath(f)
        this.error(`${spec}: ${m[1]} doesn't export '${m[2]}' (its manifest's exports)`)
      }
      return this.error(`${spec}: there's no plugin ${m[1]}`)
    },
    load(id) {
      if (id !== EXPORTED_ID) return null
      const entries = dirs.flatMap((d) => fs.readdirSync(d).flatMap((plugin) => {
        const file = path.join(d, plugin, 'manifest.json')
        if (!fs.existsSync(file)) return []
        this.addWatchFile(file)
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
        return exportsOf(manifest).flatMap((x) => {
          const f = exportFile(path.join(d, plugin), x, manifest)
          return f ? [`${JSON.stringify(`${plugin}/${x}`)}: () => import(${JSON.stringify(normalizePath(f))})`] : []
        })
      }))
      return `export default {\n  ${entries.join(',\n  ')}\n}\n`
    },
  }
}

/** `import { X } from "lucide-react"` as X's own file: the whole set (imported lazily, core/icons.tsx) stays out of
 *  what a page's code reaches (bootChunks), as tree-shaking keeps it out of the bundle. */
export function lucideByFile(): Plugin {
  const at = path.resolve(import.meta.dirname, 'node_modules/lucide-react/dist/esm')
  const file = new Map<string, string>()
  for (const [, names, f] of fs.readFileSync(path.join(at, 'lucide-react.mjs'), 'utf8').matchAll(/export \{([^}]*)\} from '\.\/icons\/([\w-]+\.mjs)'/g))
    for (const n of names.split(',')) file.set(n.trim().replace(/^default as /, ''), f)
  return {
    name: 'vaultite-lucide-by-file',
    apply: 'build',
    enforce: 'post',
    transform(code, id) {
      if (id.includes('node_modules') || !code.includes('lucide-react')) return null
      return code.replace(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["'];?/g, (_all, list: string) => {
        const rest: string[] = [], own: string[] = []
        for (const spec of list.split(',').map((x) => x.trim()).filter(Boolean)) {
          const [name, as = name] = spec.split(/\s+as\s+/)
          if (file.has(name)) own.push(`import ${as} from ${JSON.stringify(`lucide-react/dist/esm/icons/${file.get(name)}`)};`)
          else rest.push(spec)
        }
        return [...own, ...(rest.length ? [`import { ${rest.join(', ')} } from "lucide-react";`] : [])].join('\n')
      })
    },
  }
}

/** What a window runs as it starts is grouped by the pages (index.html and its siblings) that import it, big libraries
 *  apart from the app; appGroups then splits the app's own by folder. */
const boot = { pages: new Map<string, string>(), libs: new Set<string>(), editor: new Set<string>(), terminal: new Set<string>(), chat: new Set<string>() }
const isLib = (id: string) => /[\\/]node_modules[\\/]/.test(id)
export function bootChunks(): Plugin {
  return {
    name: 'vaultite-boot-chunks',
    apply: 'build',
    buildEnd() {
      const ids = new Map<string, string>()
      for (const id of this.getModuleIds()) {
        const key = normalizePath(id).toLowerCase(), was = ids.get(key)
        if (was) this.error(`${id} is bundled twice (also as ${was}): a plugin resolved it to a path of its own`)
        ids.set(key, id)
      }
      boot.pages.clear(); boot.libs.clear(); boot.editor.clear(); boot.terminal.clear(); boot.chat.clear()
      const pages = [...this.getModuleIds()].filter((id) => id.endsWith('.html') && this.getModuleInfo(id)?.isEntry).sort()
      const starts = new Set(pages.flatMap((p) => this.getModuleInfo(p)?.importedIds ?? []))
      for (const page of pages) {
        const name = path.basename(page, '.html'), todo = [page], seen = new Set(todo)
        for (let id; (id = todo.pop());) {
          // (a page's own script stays its entry: run from a shared file, it would start in every window)
          if (!starts.has(id) && !id.endsWith('.html')) boot.pages.set(id, `${boot.pages.get(id) ?? ''}~${name}`)
          for (const i of this.getModuleInfo(id)?.importedIds ?? []) if (!seen.has(i)) { seen.add(i); todo.push(i) }
        }
      }
      const libBytes = new Map<string, number>()
      for (const [id, by] of boot.pages) if (isLib(id)) libBytes.set(by, (libBytes.get(by) ?? 0) + (this.getModuleInfo(id)?.code?.length ?? 0))
      for (const [by, n] of libBytes) if (n > 50_000) boot.libs.add(by) // (a deploy changes the app, rarely these)
      // The editor (CodeMirror), which a note shows and which loads once the first page is drawn: one file too.
      const todo = [...this.getModuleIds()].filter((id) => /[\\/]web[\\/]src[\\/]editor[\\/]Editor\.tsx$/.test(id))
      for (let id; (id = todo.pop());) {
        if (boot.editor.has(id) || boot.pages.has(id)) continue
        boot.editor.add(id)
        todo.push(...(this.getModuleInfo(id)?.importedIds ?? []))
      }
      // A lazy view's own modules in one file, not one per module (every plugin module is a vault plugin's lazy import,
      // so each would be its own file): those under `folder` that `root` reaches and no page starts with (the root too).
      const own = (root: RegExp, folder: RegExp, into: Set<string>) => {
        const todo = [...this.getModuleIds()].filter((id) => root.test(id))
        for (const id of todo) if (folder.test(id) && !boot.pages.has(id)) into.add(id)
        for (let id; (id = todo.pop());) {
          for (const i of this.getModuleInfo(id)?.importedIds ?? []) if (folder.test(i) && !boot.pages.has(i) && !into.has(i)) { into.add(i); todo.push(i) }
        }
      }
      // The terminal's libghostty-vt side (its screen, input and renderers), which a terminal tab loads
      own(/[\\/]plugins[\\/]core[\\/]terminal[\\/]Terminal\.tsx$/, /[\\/]plugins[\\/]core[\\/]terminal[\\/]vt[\\/]/, boot.terminal)
      // Claude Code's chat (claude-code/index.tsx loads it once a computer is idle)
      own(/[\\/]plugins[\\/]core[\\/]claude-code[\\/]ChatTab\.tsx$/, /[\\/]plugins[\\/]core[\\/]claude-code[\\/]/, boot.chat)
    },
  }
}
// (a group takes its modules' imports along: the most shared go first, so each of those lands in its own file)
const PAGES = 5
export const bootGroups = [...Array.from({ length: PAGES * 2 }, (_, i) => {
  const pages = PAGES - (i >> 1), lib = i % 2 === 0
  const libOf = (id: string) => isLib(id) && boot.libs.has(boot.pages.get(id)!)
  return {
    priority: PAGES * 2 - i,
    test: (id: string) => !!boot.pages.get(id)?.includes('~index') && boot.pages.get(id)!.split('~').length - 1 === pages && libOf(id) === lib,
    name: (id: string) => `${lib ? 'vendor' : 'app'}${boot.pages.get(id)!.replace('~index', '')}`,
  }
}), { name: 'editor', test: (id: string) => boot.editor.has(id) }, { name: 'terminal', test: (id: string) => boot.terminal.has(id) }, { name: 'chat', test: (id: string) => boot.chat.has(id) }]

/** The app's own code in a file per folder (a plugin's, a core folder's; a view's libraries apart from its code), so a
 *  deploy changes a few small files, not one of 2 MB (stableChunks keeps the others' names). Over HTTP/2: many files are cheap. */
const folderOf = (id: string) => {
  const p = normalizePath(id)
  const m = /\/plugins\/core\/([^/]+)\//.exec(p) ?? /\/web\/src\/([^/]+)\//.exec(p)
  return m ? `${p.includes('/plugins/core/') ? 'p' : 'w'}-${m[1]}` : isLib(id) ? 'lib' : 'w'
}
export const appGroups = bootGroups.map((g) => typeof g.name !== 'function'
  ? { ...g, name: (id: string) => `${g.name}-${isLib(id) ? 'lib' : folderOf(id)}` }
  : { ...g, name: (id: string) => { const n = (g.name as (id: string) => string)(id); return n === 'app' ? `app-${folderOf(id)}` : n } })
const indexBoot = (file: string) => /^(app|vendor)-/.test(path.basename(file))
const grouped = (name: string) => /^(app|vendor|editor|terminal|chat)([~-]|$)/.test(name)

/** Vite's preload lists (`__vite__mapDeps`) in an order of their own: Vite's follows files' content hashes, so one file
 *  changing would move it in the lists of every chunk that preloads it. Scripts by name; style sheets in their order. */
const MAP_DEPS = /(const __vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=)(\[[^\]]*\])/
export function steadyDeps(code: string) {
  const m = MAP_DEPS.exec(code)
  if (!m) return code
  const was = JSON.parse(m[2]) as string[], uses = new Map<string, number>()
  for (const [, list] of code.matchAll(/__vite__mapDeps\(\[([\d,]*)\]\)/g)) for (const x of list.split(',').filter(Boolean)) uses.set(was[Number(x)], (uses.get(was[Number(x)]) ?? 0) + 1)
  // (the most used first: their numbers are short, in every list)
  const table = [...new Set(was)].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || (a < b ? -1 : 1)), at = new Map(table.map((f, i) => [f, i]))
  code = code.slice(0, m.index) + m[1] + JSON.stringify(table) + code.slice(m.index + m[0].length)
  return code.replace(/__vite__mapDeps\(\[([\d,]*)\]\)/g, (_, list: string) => {
    const files = [...new Set(list.split(',').filter(Boolean).map((x) => was[Number(x)]))]
    const ordered = [...files.filter((f) => !f.endsWith('.css')).sort(), ...files.filter((f) => f.endsWith('.css'))]
    return `__vite__mapDeps([${ordered.map((f) => at.get(f)).join(',')}])`
  })
}

/** A deploy re-downloads only the files that changed: each chunk imports the others by a name that stays (its group, or
 *  its entry module), which each page's import map points at the file of the moment, named by its content alone. */
export function stableChunks(): Plugin {
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 8)
  // (a package's module by its path in node_modules: a code root's packages are a folder shared with others, elsewhere)
  const rel = (id: string) => { const p = normalizePath(id), lib = p.lastIndexOf('/node_modules/'); return lib >= 0 ? p.slice(lib + 1) : normalizePath(path.relative(import.meta.dirname, id)) }
  return {
    name: 'vaultite-stable-chunks',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const chunks = Object.values(bundle).filter((c): c is Rollup.OutputChunk => c.type === 'chunk')
        // A chunk's lasting name: a group's is unique; another's, its entry module or else its modules
        const keys = new Map<string, string>(), taken = new Set<string>()
        for (const c of chunks) {
          const dir = path.posix.dirname(c.fileName)
          const basis = (by: 'name' | 'modules') => (by === 'name' && !c.facadeModuleId && grouped(c.name) ? `group:${c.name}`
            : c.facadeModuleId && by === 'name' ? `facade:${rel(c.facadeModuleId)}` : `modules:${c.moduleIds.map(rel).sort().join('\n')}`)
          let key = `${dir}/${c.name}-${hash(basis('name'))}.js`
          if (taken.has(key)) key = `${dir}/${c.name}-${hash(basis('modules'))}.js`
          if (taken.has(key)) this.error(`two chunks would share the name ${key}`)
          taken.add(key)
          keys.set(c.fileName, key)
        }
        // A chunk's styles too (the preload helper loads them through the map, import.meta.resolve): a new class in the
        // app's sheet would otherwise change every chunk that loads it
        const sheets = new Map<string, string>()
        for (const a of Object.values(bundle)) {
          if (a.type !== 'asset' || !a.fileName.endsWith('.css')) continue
          const key = `${path.posix.dirname(a.fileName)}/${path.posix.basename(a.names[0] ?? a.fileName, '.css')}-${hash(`sheet:${a.names[0] ?? a.fileName}`)}.css`
          if (taken.has(key)) this.error(`two files would share the name ${key}`)
          taken.add(key)
          sheets.set(a.fileName, key)
        }
        const byBase = new Map([...keys, ...sheets].map(([f, k]) => [path.posix.basename(f), path.posix.basename(k)]))
        const toKeys = (code: string) => code.replace(/(?<=["'`/])([^"'`/\s]+\.(?:js|css))(?=["'`])/g, (m) => byBase.get(m) ?? m)
        // Each chunk imports by lasting names, so its content (and the name it's served by) moves only with its own code
        const real = new Map<string, string>()
        for (const c of chunks) {
          c.code = steadyDeps(toKeys(c.code))
          const to = `${path.posix.dirname(c.fileName)}/${c.name}-${hash(c.code)}.js`
          real.set(c.fileName, to)
        }
        // (rolldown keeps no chunk renamed here: each is written anew under its name, as a file)
        const links = new Map(chunks.map((c) => [real.get(c.fileName)!, [...c.imports, ...c.dynamicImports].map((f) => real.get(f) ?? f)]))
        for (const c of chunks) {
          delete bundle[c.fileName]
          this.emitFile({ type: 'asset', fileName: real.get(c.fileName)!, source: c.code })
        }
        const was = new Map([...real].map(([w, t]) => [t, w]))
        for (const a of Object.values(bundle)) {
          if (a.type !== 'asset' || !a.fileName.endsWith('.html')) continue
          let html = String(a.source)
          for (const [was, to] of real) html = html.split(path.posix.basename(was)).join(path.posix.basename(to))
          // The page's map: every chunk its entry reaches, now or later
          const entry = /<script type="module"[^>]*\ssrc="\.?\/?([^"]+\.js)"/.exec(html)?.[1]
          const map: Record<string, string> = {}
          for (const todo = entry && links.has(entry) ? [entry] : [], seen = new Set(todo); todo.length;) {
            const f = todo.pop()!
            map[`./${keys.get(was.get(f)!)}`] = `./${f}`
            for (const to of links.get(f)!) if (links.has(to) && !seen.has(to)) { seen.add(to); todo.push(to) }
          }
          for (const [f, k] of sheets) map[`./${k}`] = `./${f}`
          const sorted = Object.fromEntries(Object.entries(map).sort(([x], [y]) => (x < y ? -1 : 1)))
          a.source = html.replace(/<head>/, `<head>\n    <script type="importmap">${JSON.stringify({ imports: sorted })}</script>`)
        }
      },
    },
  }
}

/** virtual:official-plugins: Vaultite's own plugins the demo builds in as the app's (vite.demo.config.ts); none here. */
export function noOfficialPlugins(): Plugin {
  const ID = 'virtual:official-plugins'
  return {
    name: 'vaultite-official-plugins',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load: (id) => (id === `\0${ID}` ? 'export const manifests = {}, modules = {}, pages = {}\n' : null),
  }
}

// The app is in web/ (the core) and plugins/ (every feature, one folder each); both are bundled together.
export default defineConfig({
  root: 'web',
  plugins: [pluginModules([path.resolve(import.meta.dirname, 'plugins/core')]), react(), tailwindcss(), keepRecentBuilds(), buildStamp(), pluginIcons(), noOfficialPlugins(), lucideByFile(), bootChunks(), stableChunks()],
  resolve: {
    alias: {
      // What plugins import: the plugin API (web/src/api.ts). Core code uses @/.
      '@vaultite': path.resolve(import.meta.dirname, './web/src/api.ts'),
      '@': path.resolve(import.meta.dirname, './web/src'),
    },
  },
  base: './',
  // MapLibre's worker is an ES module (imported with ?worker&url in the People map plugin)
  worker: { format: 'es' },
  // the People map chunk (MapLibre) is ~280 kB gzipped and only loads when the Map view opens
  build: {
    chunkSizeWarningLimit: 1100, outDir: 'dist', emptyOutDir: false, // (keepRecentBuilds, above)
    modulePreload: { resolveDependencies: (_file, deps, { hostId }) => (indexBoot(hostId) ? deps.filter((d) => !indexBoot(d)) : deps) },
    rollupOptions: {
      // vaults.html: the desktop app's Manage vaults window; onboarding.html: its Set up Vaultite window; phone.html: the
      // iPhone app's first screen (its servers); screen.html: the companion over the whole screen (electron/overlay.ts)
      input: {
        main: path.resolve(import.meta.dirname, 'web/index.html'), vaults: path.resolve(import.meta.dirname, 'web/vaults.html'),
        onboarding: path.resolve(import.meta.dirname, 'web/onboarding.html'), phone: path.resolve(import.meta.dirname, 'web/phone.html'),
        screen: path.resolve(import.meta.dirname, 'web/screen.html'),
      },
      // Vault plugins may import the app's plugins' modules (virtual:plugin-exports, lazily); most are
      // in the main chunk anyway, which is fine.
      // (split across files, modules run in their source order: a cycle between two files is safe; export names stay put,
      // so a file importing another changes only when its own code does)
      output: { codeSplitting: { includeDependenciesRecursively: false, groups: appGroups }, strictExecutionOrder: true, minifyInternalExports: false },
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT' && warning.message.includes('virtual:plugin-exports')) return
        warn(warning)
      },
    },
  },
  // npm run dev: proxy the API to the live server
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8793', ws: true } }, fs: { allow: ['.'] } },
})
