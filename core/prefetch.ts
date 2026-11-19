import path from "node:path"
import { Worker } from "node:worker_threads"

const READER_JS = `
const { workerData: w } = process.getBuiltinModule("node:worker_threads"), fs = process.getBuiltinModule("node:fs"), path = process.getBuiltinModule("node:path")
const files = []
const walk = (dir) => {
  let names
  try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const d of names) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) { if (!/^(\\.|test|docs)/.test(d.name)) walk(p) } else if (/\\.(ts|js|mjs|cjs|json)$/.test(d.name) && !d.name.endsWith(".d.ts")) files.push(p)
  }
}
for (const dir of w.dirs) walk(dir)
let next = 0
const lane = () => { if (next < files.length) fs.readFile(files[next++], lane) }
for (let i = 0; i < 32; i++) lane()
`
const CODE = ["core", "plugins/core", "node_modules/zod", "node_modules/yaml/dist", "node_modules/ws/lib", "node_modules/marked/lib"]

export function prefetchCode(root: string) {
  new Worker(READER_JS, { eval: true, workerData: { dirs: CODE.map((d) => path.join(root, d)) } }).unref()
}
