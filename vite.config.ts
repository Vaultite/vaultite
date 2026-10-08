import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

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

// The app is in web/ (the core) and plugins/ (every feature, one folder each); both are bundled together.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss(), keepRecentBuilds()],
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
