// `node tools/feed.ts <folder>`: each pair of update lists release.yml's one-architecture builds wrote (<name>.<arch>.yml:
// the Mac's zips, Windows' installers) merged into the <name>.yml a build of both would write; an app picks its file by name.
import fs from "node:fs"
import path from "node:path"

const dir = process.argv[2]
if (!dir) throw new Error("usage: node tools/feed.ts <folder>")
const parts = fs.readdirSync(dir).filter((f) => /\.(arm64|x64)\.yml$/.test(f))
const byName = new Map<string, string[]>()
for (const f of parts) { const name = f.replace(/\.(arm64|x64)\.yml$/, ".yml"); byName.set(name, [...byName.get(name) ?? [], f]) }
if (!byName.size) throw new Error(`no *.<arch>.yml in ${dir}`)

/** A list's files: each `  - url:` entry with its indented lines. */
const entries = (text: string) => text.match(/^ {2}- url: .*\n(?: {4}.*\n)*/gm) ?? []
const url = (entry: string) => entry.split("\n")[0]

// (the Mac's updater takes the file with "arm64" in its name or the one without; Windows' the one with process.arch in it)
for (const [name, files] of byName) {
  if (files.length !== 2) throw new Error(`${name}: expected an arm64 and an x64 list, got ${files.join(", ")}`)
  const read = (arch: string) => fs.readFileSync(path.join(dir, files.find((f) => f.endsWith(`.${arch}.yml`))!), "utf8")
  const x64 = read("x64"), arm64 = read("arm64")
  if (!entries(arm64).every((e) => url(e).includes("arm64")) || entries(x64).some((e) => url(e).includes("arm64"))) {
    throw new Error(`${name}: an update's file name doesn't say its architecture (arm64's must, Intel's mustn't)`)
  }
  // (Intel's leads: its file is the list's path, as electron-builder writes it for both)
  const all = [...entries(x64), ...entries(arm64)]
  if (all.length < 2) throw new Error(`${name}: a list without its files`)
  const merged = x64.replace(/^files:\n(?: {2}- url: .*\n(?: {4}.*\n)*)+/m, `files:\n${all.join("")}`)
  fs.writeFileSync(path.join(dir, name), merged)
  for (const f of files) fs.rmSync(path.join(dir, f))
  console.log(`${name}: ${all.length} files`)
}
