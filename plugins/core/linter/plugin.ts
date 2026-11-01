// Linter: notes formatted by the rules in its settings (format.ts), as small edits through the API.
import fs from "node:fs"
import { OpError, Plugin, vaultPath } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { formatMarkdown, rulesOf } from "./format.ts"

export const plugin = new Plugin(import.meta.url)

/** The Markdown files `rel` names: itself, or every one under it when it's a folder (hidden ones left out). */
function notesIn(rel: string) {
  const abs = plugin.vault.abs(rel)
  if (!fs.existsSync(abs)) throw new OpError(`no file or folder '${rel}'`, 404)
  if (!fs.statSync(abs).isDirectory()) {
    if (!/\.md$/i.test(rel)) throw new OpError(`${rel} isn't a note: only Markdown files are formatted`)
    return [rel]
  }
  const pre = rel ? `${rel}/` : ""
  return [...plugin.vault.entries.keys()].filter((p) => p.startsWith(pre) && /\.md$/i.test(p)).sort()
}

plugin.op({
  id: "linter.format",
  summary: "Format notes by the Linter's rules (trailing spaces, blank lines, heading spacing, list markers...): a note, or every note in a folder.",
  help: `Only prose lines change: frontmatter, code and math blocks stay as written. The rules are the Linter's settings
(vau settings linter). check: say which notes would change, writing nothing.

  vau linter.format "Notes/Plan.md"
  vau linter.format Notes --check`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "a note, or a folder (every note in it)" },
    check: { type: "boolean", description: "only say which would change" },
  },
  args: ["path"],
  run: async ({ path: given, check }, ctx) => {
    const rel = String(given ?? "").replace(/^\/+|\/+$/g, "")
    const files = notesIn(rel ? vaultPath(rel, true, plugin.vault) : "")
    const rules = rulesOf(plugin.settings({}))
    const changed: string[] = []
    for (const f of files) {
      const text = readText(plugin.vault.abs(f))
      const next = formatMarkdown(text, rules)
      if (next === text) continue
      changed.push(f)
      if (!check) await ctx.api("PUT", "file", { path: f, text: next, base: text })
    }
    return { checked: files.length, changed, written: !check }
  },
  text: (r: { checked: number; changed: string[]; written: boolean }) => !r.changed.length
    ? `${r.checked === 1 ? "It's" : `All ${r.checked} are`} formatted already.`
    : [`${r.written ? "Formatted" : "Would format"} ${r.changed.length} of ${r.checked}:`, ...r.changed.map((p) => `- ${p}`)].join("\n"),
  did: ({ path }) => ({ action: "save", text: `Formatted ${path}` }),
})
