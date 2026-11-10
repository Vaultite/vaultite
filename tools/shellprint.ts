// The shell fingerprint of a checkout (electron/shell/print.mjs over inputs.json): equal to an installed app's
// (its electron/shell.json), its code runs in that app; else it needs a new build. node tools/shellprint.ts [root]
import path from "node:path"
import { fingerprint } from "../electron/shell/print.mjs"

console.log(fingerprint(path.resolve(process.argv[2] ?? path.dirname(import.meta.dirname))))
