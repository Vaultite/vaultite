// The app's own files, at /app as in the repo, before the server's modules load (they read some as they do).
import fs from "./node/fs.ts"
import plugins from "virtual:demo-plugin-files"
import official from "virtual:demo-official-files"

// What the server reads: manifests, docs, pages, bundles, the sample vault.
const FILES = {
  ...import.meta.glob(["../../{core,plugins/core,bundles}/**/*.{md,json,css}", "../../package.json", "../../web/src/index.css"], { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../examples/vault/**/*", { query: "?raw", import: "default", eager: true, exhaustive: true }), // (its .vaultite/ too)
} as Record<string, string>
const appPath = (key: string) => decodeURIComponent(new URL(key, "file:///app/web/demo/").pathname)
for (const [k, text] of Object.entries(FILES)) { fs.mkdirSync(appPath(k).replace(/\/[^/]+$/, ""), { recursive: true }); fs.writeFileSync(appPath(k), text) }
// (Vaultite's own plugins, built in here as the app's: vite.demo.config.ts)
for (const [file, text] of Object.entries(official)) { fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true }); fs.writeFileSync(file, text) }
for (const file of plugins) fs.writeFileSync(file, "") // (core/plugins.ts loads a plugin.ts that's there)
