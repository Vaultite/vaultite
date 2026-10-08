// The menu bar's icons: every lucide icon electron/menu.ts names, as template PNGs (16px, @2x) in electron/menu-icons/.
// node tools/menu_icons.ts after adding one (needs ImageMagick's magick); icons no longer named are removed.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, "electron", "menu-icons")
const LUCIDE = path.join(ROOT, "node_modules", "lucide-react", "dist", "esm", "icons")

const src = fs.readFileSync(path.join(ROOT, "electron", "menu.ts"), "utf8")
const names = new Set<string>()
for (const re of [/icon\("([a-z0-9-]+)"\)/g, /cmd\("[^"]+", "[^"]+", "([a-z0-9-]+)"/g, /sub\("[^"]+", "([a-z0-9-]+)"/g, /files\([^,]+, "([a-z0-9-]+)"\)/g])
  for (const m of src.matchAll(re)) names.add(m[1])

type Node = [string, Record<string, string>]
const attrs = (a: Record<string, string>) => Object.entries(a).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")

fs.mkdirSync(OUT, { recursive: true })
for (const name of names) {
  let file = path.join(LUCIDE, `${name}.mjs`)
  if (!fs.existsSync(file)) throw new Error(`no lucide icon '${name}'`)
  const alias = /export \{ default \} from '\.\/([a-z0-9-]+\.mjs)'/.exec(fs.readFileSync(file, "utf8")) // an old name
  if (alias) file = path.join(LUCIDE, alias[1])
  const { __iconData } = await import(file) as { __iconData: { node: Node[] } }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${__iconData.node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join("")}</svg>`
  const tmp = path.join(OUT, `${name}.svg`)
  fs.writeFileSync(tmp, svg)
  for (const [px, suffix] of [[16, ""], [32, "@2x"]] as const)
    execFileSync("magick", ["-background", "none", "-density", String(96 * px / 24 * 4), tmp, "-resize", `${px}x${px}`, "-strip", path.join(OUT, `${name}${suffix}.png`)])
  fs.rmSync(tmp)
}
for (const f of fs.readdirSync(OUT)) if (!names.has(f.replace(/(@2x)?\.png$/, ""))) fs.rmSync(path.join(OUT, f))
console.log(`${names.size} icons in ${path.relative(ROOT, OUT)}`)
