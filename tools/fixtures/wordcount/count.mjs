// wordcount.count: the words of the Markdown files in a folder of the vault ({folder} on stdin), as JSON.
import fs from "node:fs"
import path from "node:path"

const { folder = "" } = JSON.parse(fs.readFileSync(0, "utf8") || "{}")
const root = path.resolve(process.env.VAULTITE_VAULT, folder)
if (!root.startsWith(path.resolve(process.env.VAULTITE_VAULT))) {
  console.error(`${folder} isn't in the vault`)
  process.exit(2)
}
let files = 0, words = 0
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".md")) {
      files++
      words += fs.readFileSync(p, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").split(/\s+/).filter(Boolean).length
    }
  }
}
if (!fs.existsSync(root)) {
  console.error(`there's no folder ${folder}`)
  process.exit(1)
}
walk(root)
console.log(JSON.stringify({ folder, files, words }))
