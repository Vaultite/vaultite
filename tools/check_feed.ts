// `node tools/check_feed.ts <feed url> <folder>`: after a publish, each update list in <folder> is the one the feed serves,
// and every file it names is there at its size, so no app is told of an update it can't download (the .deb once wasn't).
import fs from "node:fs"
import path from "node:path"

const [base, dir] = process.argv.slice(2)
if (!base || !dir) throw new Error("usage: node tools/check_feed.ts <feed url> <folder>")
const at = (name: string) => `${base.replace(/\/?$/, "/")}${encodeURIComponent(name)}?t=${Date.now()}` // (past any cache)

const lists = fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))
if (!lists.length) throw new Error(`no update lists in ${dir}`)
const wrong: string[] = []
for (const list of lists) {
  const text = fs.readFileSync(path.join(dir, list), "utf8")
  const served = await fetch(at(list)).then((r) => (r.ok ? r.text() : `(${r.status})`), (e) => `(${e})`)
  if (served !== text) wrong.push(`${list}: the feed serves ${served.startsWith("(") ? served : "another version of it"}`)
  for (const [, url, size] of text.matchAll(/^ {2}- url: (.+)\n(?: {4}.*\n)*? {4}size: (\d+)/gm)) {
    const r = await fetch(at(url), { method: "HEAD" }).catch(() => null)
    const length = r?.headers.get("content-length")
    if (!r?.ok || length !== size) wrong.push(`${list} names ${url}: ${r ? `${r.status}, ${length ?? "no"} bytes (${size} listed)` : "no answer"}`)
  }
  console.log(`${list}: checked`)
}
if (wrong.length) { console.error(wrong.join("\n")); process.exit(1) }
console.log(`${base}: every list served as made, every file it names there`)
