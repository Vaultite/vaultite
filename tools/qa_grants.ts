// A QA vault's built-in plugins' writes on their own answered "not now" (core/grants.ts) where not answered yet: a
// script turning Activity on and writing gets its "wants to write" ask over the page at the scheduler's next turn.
import fs from "node:fs"
import path from "node:path"

const CORE = path.resolve(import.meta.dirname, "../plugins/core")

/** Answers them in `vault` (tools/qa.ts' vaults; web/qa/lib/qa.mjs': a sandbox given as an argument). */
export function quietGrants(vault: string) {
  const file = path.join(vault, ".vaultite/grants.json")
  let cur: Record<string, Record<string, string>> = {}, changed = false
  try { cur = JSON.parse(fs.readFileSync(file, "utf8")) } catch { /* none yet */ }
  for (const id of fs.readdirSync(CORE)) {
    let writes: { folder?: string; file?: string }[] = []
    try { writes = JSON.parse(fs.readFileSync(path.join(CORE, id, "manifest.json"), "utf8")).writes ?? [] } catch { /* not a plugin */ }
    for (const w of writes) {
      const place = (w.folder ?? w.file ?? "").replace(/^\/+|\/+$/g, "")
      if (place && (!cur[id]?.[place] || cur[id][place] === "ask")) { cur[id] = { ...cur[id], [place]: "not now" }; changed = true }
    }
  }
  if (!changed) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n")
}
