// Compiles into NODE_COMPILE_CACHE what the main process may load, running none of it: each import's module fails to link.
import fs from "node:fs"
import module from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const HERE = path.join(path.dirname(import.meta.dirname), "electron")
const NEVER = "compileFillNeverExported"
const ts = fs.readdirSync(HERE, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).map((f) => path.join(HERE, f))
const lazy = new Set()
for (const f of ts) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    lazy.add(m[1].startsWith(".") ? pathToFileURL(path.resolve(path.dirname(f), m[1])).href : import.meta.resolve(m[1]))
  }
}
const entries = [...ts.map((f) => pathToFileURL(f).href), ...lazy]
const compiled = async (spec) => {
  const src = `import ${JSON.stringify(spec)}\nimport { ${NEVER} } from "node:path"\n`
  try { await import(`data:text/javascript,${encodeURIComponent(src)}`) } catch (e) {
    if (e instanceof SyntaxError && e.message.includes("does not provide an export named")) return true
    console.log(`compilefill: ${spec}: ${e instanceof Error ? e.message : String(e)}`)
  }
  return false
}
const ok = (await Promise.all(entries.map(compiled))).filter(Boolean).length
module.flushCompileCache()
console.log(`compilefill: ${ok} of ${entries.length} entries compiled into ${module.getCompileCacheDir?.() ?? "no cache"}`)
