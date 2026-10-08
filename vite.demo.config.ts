import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Alias, type Plugin } from 'vite'
import base from './vite.config.ts'
import { MACHINE } from './web/demo/machine.ts'

// npm run build:demo: the web app with its server in the browser, on the sandbox vault (web/demo/CLAUDE.md), as static
// files in web/dist-demo for any host, under any path.
const ROOT = import.meta.dirname
const node = (file: string) => path.join(ROOT, 'web/demo/node', file)
const STUBBED = ['node:child_process', 'node:http', 'node:https', 'node:http2', 'node:net', 'node:dns', 'node:readline', 'node:module',
  'node:stream', 'node:stream/promises', 'node:perf_hooks', 'node:zlib', 'node:sqlite', 'ws', 'node-pty', '@xterm/headless',
  '@xterm/addon-serialize', '@tailwindcss/node', '@tailwindcss/oxide', 'rolldown']
const ALIASES: Alias[] = [
  ...Object.entries({ fs: 'fs.ts', path: 'path.ts', crypto: 'crypto.ts', os: 'os.ts', url: 'url.ts', util: 'util.ts', async_hooks: 'async_hooks.ts',
    'timers/promises': 'timers.ts' }).map(([m, file]) => ({ find: `node:${m}`, replacement: node(file) })),
  ...STUBBED.map((m) => ({ find: new RegExp(`^${m}$`), replacement: node('stub.ts') })),
]

/** The server's modules in the worker: each sees itself at /app as in the repo (its import.meta.url), and core/plugins.ts
 *  takes the built-in plugins' backends from the bundle, but those that need a machine: virtual:demo-plugin-files names
 *  them (for web/demo/mount.ts) and keeps them once worker.ts imports virtual:demo-plugins, after the core (one chunk:
 *  WebKit runs a worker's script again when a chunk imports it). */
function demoServer(): Plugin {
  const dirs = fs.readdirSync(path.join(ROOT, 'plugins/core'))
    .filter((d) => !MACHINE.includes(d) && fs.existsSync(path.join(ROOT, 'plugins/core', d, 'plugin.ts')))
  return {
    name: 'vaultite-demo-server',
    resolveId: (id) => (id.startsWith('virtual:demo-plugin') ? '\0' + id : null),
    load(id) {
      const files = dirs.map((d) => `/app/plugins/core/${d}/plugin.ts`)
      if (id === '\0virtual:demo-plugin-files') return `export default ${JSON.stringify(files)}\nexport const loaded = {}`
      if (id !== '\0virtual:demo-plugins') return
      return dirs.map((d, i) => `import * as p${i} from ${JSON.stringify(path.join(ROOT, 'plugins/core', d, 'plugin.ts'))}`).join('\n') +
        `\nimport { loaded } from "virtual:demo-plugin-files"\nObject.assign(loaded, {${files.map((f, i) => `${JSON.stringify(f)}: p${i}`).join(', ')}})`
    },
    transform(code, id) {
      const rel = path.relative(ROOT, id.replace(/\?.*$/, ''))
      if (!/^(core|plugins)\/.*\.ts$/.test(rel)) return
      let out = `const __vauModuleUrl = ${JSON.stringify(`file:///app/${rel}`)};\n` + code.replaceAll('import.meta.url', '__vauModuleUrl')
      if (rel === 'core/plugins.ts') out = 'import { loaded as __demoPlugins } from "virtual:demo-plugin-files";\n' + out.replace('import(pathToFileURL(file).href)', 'Promise.resolve(__demoPlugins[file])')
      return out
    },
  }
}

/** The app starts once the demo has (web/demo/boot.ts: main.tsx's first import, which waits for its server). */
const demoEntry = (): Plugin => ({
  name: 'vaultite-demo-entry',
  transform: (code, id) => (id === path.join(ROOT, 'web/src/main.tsx') ? `import ${JSON.stringify(path.join(ROOT, 'web/demo/boot.ts'))}\n${code}` : undefined),
})

export default defineConfig({
  ...base,
  plugins: [...(base.plugins ?? []), demoEntry()],
  resolve: { alias: [...Object.entries(base.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement })), ...ALIASES] },
  worker: { format: 'es', plugins: () => [demoServer()] },
  build: {
    ...base.build, outDir: 'dist-demo', emptyOutDir: true, chunkSizeWarningLimit: 4000, minify: process.env.DEMO_MINIFY !== '0',
    rollupOptions: {
      input: { main: path.join(ROOT, 'web/index.html'), sw: path.join(ROOT, 'web/demo/sw.ts') },
      output: { entryFileNames: (c) => (c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
      onwarn: base.build?.rollupOptions?.onwarn,
    },
  },
})
