// Set up's vau shims for Windows in a made-up home (the registry left alone): prints their folder.
import * as S from "../../electron/setup.ts"
const home = process.argv[2]
S.installVau({ home, exe: process.execPath, root: process.cwd(), userData: `${home}\\ud`, platform: "win32" }, null)
console.log(S.winBin({ home, exe: "", root: "", userData: "" }))
