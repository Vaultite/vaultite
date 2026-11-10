// Set up's vau shims for Windows in a made-up home (the registry left alone): prints their folder.
import { vauEntry } from "../../core/appentry.ts"
import * as S from "../../electron/setup.ts"
const home = process.argv[2]
S.installVau({ home, exe: process.execPath, vau: vauEntry(), userData: `${home}\\ud`, platform: "win32" }, null)
console.log(S.winBin({ home, exe: "", vau: "", userData: "" }))
