// `node tools/mac_feed.ts <folder>`: release.yml's two Mac builds each list only their zip (<name>-mac.<arch>.yml);
// this merges them into the <name>-mac.yml a build of both would write, and removes them.
import fs from "node:fs"
import path from "node:path"

const dir = process.argv[2]
if (!dir) throw new Error("usage: node tools/mac_feed.ts <folder>")
const parts = fs.readdirSync(dir).filter((f) => /-mac\.(arm64|x64)\.yml$/.test(f))
const byName = new Map<string, string[]>()
for (const f of parts) { const name = f.replace(/\.(arm64|x64)\.yml$/, ".yml"); byName.set(name, [...byName.get(name) ?? [], f]) }
if (!byName.size) throw new Error(`no *-mac.<arch>.yml in ${dir}`)

/** A list's files: each `  - url:` entry with its indented lines. */
const entries = (text: string) => text.match(/^ {2}- url: .*\n(?: {4}.*\n)*/gm) ?? []

for (const [name, files] of byName) {
  if (files.length !== 2) throw new Error(`${name}: expected an arm64 and an x64 list, got ${files.join(", ")}`)
  const read = (arch: string) => fs.readFileSync(path.join(dir, files.find((f) => f.endsWith(`.${arch}.yml`))!), "utf8")
  // (Intel's leads: its zip is the list's path, as electron-builder writes it for both)
  const x64 = read("x64"), arm64 = read("arm64")
  const all = [...entries(x64), ...entries(arm64)]
  if (all.length < 2) throw new Error(`${name}: a list without its files`)
  const merged = x64.replace(/^files:\n(?: {2}- url: .*\n(?: {4}.*\n)*)+/m, `files:\n${all.join("")}`)
  fs.writeFileSync(path.join(dir, name), merged)
  for (const f of files) fs.rmSync(path.join(dir, f))
  console.log(`${name}: ${all.length} files`)
}
