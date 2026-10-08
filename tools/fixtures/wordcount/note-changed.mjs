// The event hook: a note changed (the event as JSON on stdin): its paths go on a list in this plugin's state folder.
import fs from "node:fs"
import path from "node:path"

const ev = JSON.parse(fs.readFileSync(0, "utf8"))
fs.appendFileSync(path.join(process.env.VAULTITE_PLUGIN_STATE, "changed.txt"), (ev.paths ?? []).map((p) => `${p}\n`).join(""))
