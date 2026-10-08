// wordcount.changed: the list the event hook keeps, as text (one path a line, each once).
import fs from "node:fs"
import path from "node:path"

let list = ""
try { list = fs.readFileSync(path.join(process.env.VAULTITE_PLUGIN_STATE, "changed.txt"), "utf8") } catch { /* none yet */ }
const paths = [...new Set(list.split("\n").filter(Boolean))]
process.stdout.write(paths.length ? paths.map((p) => `- ${p}`).join("\n") : "No notes changed yet.")
