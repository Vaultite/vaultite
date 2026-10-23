// Runs one line at cmd's prompt, as typed (verbatim: no quoting of Node's or MSYS's), with argv[2] first on PATH.
import { spawnSync } from "node:child_process"
const [dir, line] = process.argv.slice(2)
const r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true, stdio: "inherit", env: { ...process.env, PATH: `${dir};${process.env.PATH}` } })
process.exit(r.status ?? 1)
