import { execFileSync } from 'node:child_process'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import { ICON_FILE, ICON_NAME, PLUGIN_MODULE, svgIcon } from './core/pluginmeta.ts'
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

/** @plugins/<id>/<module>: a module a plugin's manifest `exports` (core/rules.ts checks who may import it), from the
 *  folders that hold plugins (the app's own; the demo's official ones too). */
export function pluginModules(dirs: string[]): Plugin {
  return {
    name: 'vaultite-plugin-modules',
    enforce: 'pre',
    resolveId(spec) {
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

/** What a window runs as it starts comes in a few files rather than a hundred (a phone fetched them 6 at a time): a
 *  module goes with the others the same pages (index.html and its siblings) import, big libraries apart from the app. */
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
  plugins: [pluginModules([path.resolve(import.meta.dirname, 'plugins/core')]), react(), tailwindcss(), keepRecentBuilds(), buildStamp(), pluginIcons(), noOfficialPlugins(), lucideByFile(), bootChunks()],
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
    rollupOptions: {
      // vaults.html: the desktop app's Manage vaults window; onboarding.html: its Set up Vaultite window; phone.html: the
      // iPhone app's first screen (its servers); screen.html: the companion over the whole screen (electron/overlay.ts)
      input: {
        main: path.resolve(import.meta.dirname, 'web/index.html'), vaults: path.resolve(import.meta.dirname, 'web/vaults.html'),
        onboarding: path.resolve(import.meta.dirname, 'web/onboarding.html'), phone: path.resolve(import.meta.dirname, 'web/phone.html'),
        screen: path.resolve(import.meta.dirname, 'web/screen.html'),
      },
      // Vault plugins may import the app's plugins' modules (web/src/core/vaultPlugins.ts globs them, lazily); most are
      // in the main chunk anyway, which is fine.
      output: { codeSplitting: { groups: bootGroups } },
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT' && warning.message.includes('vaultPlugins.ts')) return
        warn(warning)
      },
    },
  },
  // npm run dev: proxy the API to the live server
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8793', ws: true } }, fs: { allow: ['.'] } },
})
