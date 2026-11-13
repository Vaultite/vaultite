// Every file the desktop app's processes load is in its entry's reach (core/update/closure.ts, core/update/sites.ts).
// Needs the desktop app, its loads recorded by tools/test/recorded.ts; WRITES only the throwaway vault.
//   node web/qa/closure.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, wait } from "./lib/qa.mjs"
import { diskTree, graphOf } from "../../core/update/closure.ts"
import { entriesOf, LOADS as RECORDER, recorded, recording, uncovered } from "../../tools/test/recorded.ts"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-closure-"))
const LOADS = path.join(TMP, "loads")
fs.mkdirSync(LOADS)

const app = await _electron.launch({
  // (Playwright drops NODE_OPTIONS: the recorder comes in with -r)
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: ["-r", RECORDER, ROOT, "--vault", VAULT],
  env: { ...process.env, ...recording(LOADS), VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  await wait(3000)
} finally {
  await app.close().catch(() => {})
}

const g = graphOf(diskTree(ROOT))
const runs = recorded(LOADS, ROOT).filter((r) => entriesOf(r, ROOT).length)
check("the main process and its server were recorded", ["desktop", "server"].every((e) => runs.some((r) => entriesOf(r, ROOT).includes(e) && r.files.length > 20)),
  runs.map((r) => [r.what, r.script, r.files.length]))
for (const r of runs) {
  const entries = entriesOf(r, ROOT), missed = uncovered(g, r, entries)
  check(`${entries.join(" and ")}: all ${r.files.length} files it loaded are in its reach`, !missed.length, missed)
}
fs.rmSync(TMP, { recursive: true, force: true })
await done()
