// The YAML library's reads of frontmatter (core/yaml.ts readBefore) kept on this machine between starts: headers that
// aren't plain key: value lines (nested lists, maps) parse once, not at every start. Only those still in the vault stay.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { LOCAL } from "./plugins.ts"
import { readBefore } from "./yaml.ts"

const fileFor = (vault: string) => path.join(LOCAL, "cache", `frontmatter-${crypto.createHash("sha1").update(path.resolve(vault)).digest("hex").slice(0, 12)}.json`)

/** Load what was kept for this vault, then keep it up to date (written a minute after it grows). */
export function keepReads(vault: string) {
  const file = fileFor(vault)
  try { for (const [text, json] of JSON.parse(fs.readFileSync(file, "utf8")) as [string, string][]) readBefore.json.set(text, json) } catch { /* none yet */ }
  let saved = readBefore.added
  setInterval(() => {
    if (readBefore.added === saved) return
    saved = readBefore.added
    const out = [...readBefore.json].filter(([text]) => readBefore.used.has(text))
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(out))
      fs.renameSync(`${file}.tmp`, file)
    } catch (e) { console.error("keeping the frontmatter read:", e) }
  }, 60_000).unref?.()
}
