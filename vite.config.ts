import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { ICON_FILE, ICON_NAME, svgIcon } from './core/pluginmeta.ts'

// A page open in a browser keeps asking for the build it loaded from (a view's chunk, the first time it's opened), so a
// rebuild keeps the files of the last days' builds rather than emptying dist/assets: a page from before the rebuild
// still finds them. (An older build's file that's gone anyway: the app reloads into the new build, web/src/core/
// errors.ts.) VAULTITE_CLEAN_BUILD=1 (the desktop and iPhone apps' builds, which ship dist) keeps only this build's.
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

// The app's plugins' icons (their manifests' `icon`: core/pluginmeta.ts) as virtual:plugin-icons, each Lucide one
// imported alone: all of Lucide's is a chunk of its own (web/src/core/icons.tsx), loaded only when a file names one.
function pluginIcons(): Plugin {
  const ID = 'virtual:plugin-icons', DIR = path.resolve(import.meta.dirname, 'plugins/core')
  const LUCIDE = path.resolve(import.meta.dirname, 'node_modules/lucide-react/dist/esm/icons')
  return {
    name: 'vaultite-plugin-icons',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load(id) {
      if (id !== `\0${ID}`) return null
      const imports = ['import { markIcon } from "@/core/icons"'], entries: string[] = []
      for (const name of fs.readdirSync(DIR).sort()) {
        const file = path.join(DIR, name, 'manifest.json')
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

// The app is in web/ (the core) and plugins/ (every feature, one folder each); both are bundled together.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss(), keepRecentBuilds(), pluginIcons()],
  resolve: {
    alias: {
      // What plugins import: the plugin API (web/src/api.ts). Core code uses @/.
      '@vaultite': path.resolve(import.meta.dirname, './web/src/api.ts'),
      '@plugins': path.resolve(import.meta.dirname, './plugins'),
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
      // iPhone app's first screen (its servers)
      input: {
        main: path.resolve(import.meta.dirname, 'web/index.html'), vaults: path.resolve(import.meta.dirname, 'web/vaults.html'),
        onboarding: path.resolve(import.meta.dirname, 'web/onboarding.html'), phone: path.resolve(import.meta.dirname, 'web/phone.html'),
      },
      // Vault plugins may import the app's plugins' modules (web/src/core/vaultPlugins.ts globs them, lazily); most are
      // in the main chunk anyway, which is fine.
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT' && warning.message.includes('vaultPlugins.ts')) return
        warn(warning)
      },
    },
  },
  // npm run dev: proxy the API to the live server
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8793', ws: true } }, fs: { allow: ['.'] } },
})
