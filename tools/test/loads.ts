// What a process loads (tools/test/recorded.ts): with NODE_OPTIONS=--import=<this> (Electron: -r <this>) and VAULTITE_LOADS
// set, each process writes <dir>/<pid>.txt: a line saying what it is (Electron's process type or node, its script), then URLs.
import fs from "node:fs"
import module from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const dir = process.env.VAULTITE_LOADS
if (dir && module.registerHooks) {
  // (and the processes it starts: Electron given this with -r, as Playwright drops NODE_OPTIONS)
  const self = `--import=${pathToFileURL(import.meta.filename).href}`
  if (!process.env.NODE_OPTIONS?.includes(self)) process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, self].filter(Boolean).join(" ")
  const file = path.join(dir, `${process.pid}.txt`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${(process as { type?: string }).type ?? "node"} ${process.argv[1] ?? ""}\n`)
  const seen = new Set<string>()
  module.registerHooks({
    load(url, context, next) {
      if (!seen.has(url)) { seen.add(url); fs.appendFileSync(file, `${url}\n`) }
      return next(url, context)
    },
  })
}
