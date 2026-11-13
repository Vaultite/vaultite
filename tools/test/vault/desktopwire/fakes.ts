// The Swift helpers' stand-ins: each logs what it's sent to `<name>.in` and answers by `<name>.json` (`$id`: the ask's).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SCRIPT = `const fs = require("node:fs"), file = process.argv[1]
require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
  fs.appendFileSync(file + ".in", l + "\\n")
  let m = {}
  try { m = JSON.parse(l) } catch {}
  let answers = {}
  try { answers = JSON.parse(fs.readFileSync(file + ".json", "utf8")) } catch {}
  const lines = answers[m.op + ":" + m.do] ?? answers[m.op ?? m.cmd] ?? (m.id === undefined ? [] : ['{"id": "$id", "ok": true}'])
  if (lines === "exit") process.exit(1)
  for (const x of lines) process.stdout.write(x.replaceAll('"$id"', String(m.id)) + "\\n")
})
`
export function fakeHelpers() {
  const dir = process.env.VAULTITE_FAKE_HELPERS ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-fakes-"))
  for (const h of ["screen", "capture", "takeover", "voice", "appWindows", "dictation"]) {
    fs.writeFileSync(path.join(dir, h), `#!${process.execPath}\n${SCRIPT}`)
    fs.chmodSync(path.join(dir, h), 0o755)
  }
  return {
    dir,
    answer: (h: string, answers: { [op: string]: string[] | "exit" }) => fs.writeFileSync(path.join(dir, `${h}.json`), JSON.stringify(answers)),
    sent: (h: string) => { try { return fs.readFileSync(path.join(dir, `${h}.in`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    clear: (h: string) => fs.rmSync(path.join(dir, `${h}.in`), { force: true }),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}
