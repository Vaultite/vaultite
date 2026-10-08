// Startup: once the server opened the vault with the plugin on, note when (and which server: VAULTITE_URL).
import fs from "node:fs"
import path from "node:path"

fs.writeFileSync(path.join(process.env.VAULTITE_PLUGIN_STATE, "started.json"), JSON.stringify({ at: new Date().toISOString(), url: process.env.VAULTITE_URL }))
