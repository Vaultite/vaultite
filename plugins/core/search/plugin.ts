import { z } from "zod"
import { FENCE_FILES, FENCE_LINES, fenceQuery, Plugin, source } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const Found = z.object({
  files: z.number(), lines: z.number(),
  results: z.array(z.looseObject({ path: z.string(), count: z.number().optional(),
    matches: z.array(z.looseObject({ line: z.number(), text: z.string(), ctx: z.boolean().optional() })).optional() })),
})

const stemOf = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "")

async function queryMarkdown(text: string): Promise<string> {
  const q = fenceQuery(text)
  if (!q) return "_(an empty query: no search in it)_"
  const p = new URLSearchParams({ q, lines: String(FENCE_LINES), total: "1", limit: String(FENCE_FILES) })
  let found: z.infer<typeof Found>
  try { found = Found.parse(await plugin.host.api("GET", `search?${p}`)) } catch (e) {
    return `_(query \`${q}\` can't be searched: ${e instanceof Error ? e.message : String(e)})_`
  }
  source(found.results.map((r) => r.path))
  const head = `Search \`${q}\`: ${found.files ? `${found.files} ${found.files === 1 ? "file" : "files"}` : "nothing matches"}`
  const rows = found.results.map((r) => {
    const name = /\.md$/i.test(r.path) ? `[[${r.path.replace(/\.md$/i, "")}|${stemOf(r.path)}]]` : `[[${r.path}]]`
    const lines = (r.matches ?? []).filter((m) => !m.ctx).map((m) => `  - line ${m.line}: ${m.text.trim()}`)
    return [`- ${name}`, ...lines].join("\n")
  })
  const more = found.files - found.results.length
  return [head, ...rows, ...(more > 0 ? [`- (${more} more: vau search '${q.replace(/'/g, "'\\''")}' --offset ${found.results.length})`] : [])].join("\n")
}

plugin.provide("fence:query", (ctx: { text: string }) => queryMarkdown(ctx.text))
