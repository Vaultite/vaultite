// Each desktopwire/ driver's output held to its .json beside it (VAULTITE_SNAPSHOT=1 writes it).
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { VaultTest } from "./harness.ts"

const DIR = path.join(import.meta.dirname, "desktopwire")
function driven(driver: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((done) => {
    const p = spawn(process.execPath, ["--import", "./electron.ts", driver], { cwd: DIR, env: { ...process.env, VAULTITE_QUIET: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    p.stdout.on("data", (d: Buffer) => { out += String(d) })
    p.stderr.on("data", (d: Buffer) => { err += String(d) })
    p.on("close", (code) => done(code === 0 ? out : JSON.stringify({ failed: `${driver} exited ${code}: ${err.slice(-600)}` })))
  })
}

async function snapshot(check: VaultTest["check"], driver: string, what: string, env: NodeJS.ProcessEnv = {}) {
  const file = path.join(DIR, driver.replace(/\.ts$/, ".json")), got = JSON.parse(await driven(driver, env))
  if (process.env.VAULTITE_SNAPSHOT) fs.writeFileSync(file, JSON.stringify(got, null, 1) + "\n")
  const want = JSON.parse(fs.readFileSync(file, "utf8"))
  for (const name of new Set([...Object.keys(want), ...Object.keys(got)]))
    check(`desktop wire: ${what}, ${name}`, isDeepStrictEqual(got[name], want[name]), { got: got[name], want: want[name] })
}

export default async ($: VaultTest) => {
  await snapshot($.check, "live.ts", "what the home vault's server sends the helper")
  if (process.platform === "win32") return
  const fakes = (name: string) => { const dir = path.join($.tmp, `fakes-${name}`); fs.mkdirSync(dir, { recursive: true }); return dir }
  await snapshot($.check, "swift.ts", "what the Swift helpers' lines do", { VAULTITE_FAKE_HELPERS: fakes("swift"), VAULTITE_CAPTURE: "1", VAULTITE_DICTATION_FILE: path.join($.tmp, "none.wav") })
  await snapshot($.check, "screen.ts", "what the screen helper tells the helper", { VAULTITE_FAKE_HELPERS: fakes("screen"), VAULTITE_QA_SCREEN: "1" })
  await snapshot($.check, "ipc.ts", "what pages, the server and files hand the helper", { VAULTITE_FAKE_HELPERS: fakes("ipc") })
}
