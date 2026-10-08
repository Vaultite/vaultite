// Tags for AIs (/api/tags): every tag with its count, or the files with one; frontmatter and inline #tags read like
// the app's (core/sections.ts). A rename edits only the tags' own text in each file.
import { HTTPError, Plugin } from "../../../core/plugins.ts"
import { hasTag, readText, renameTagText, sortBy, tagName, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

plugin.route("GET", "tags", (req) => {
  const files = [...plugin.vault.entries].filter(([, e]) => e.tags.length)
  const want = String(req.query.tag ?? "").trim().replace(/^#/, "")
  if (want) {
    return sortBy(files.filter(([, e]) => hasTag(e.tags, want)), ([, e]) => -Number(e.stat.ns / 1000000n)).map(([path, e]) => ({ path, tags: e.tags }))
  }
  const counts = new Map<string, { tag: string; files: Set<string> }>()
  for (const [path, e] of files) {
    for (const t of e.tags) {
      const parts = t.split("/")
      for (let i = 1; i <= parts.length; i++) {
        const tag = parts.slice(0, i).join("/"), k = tag.toLowerCase()
        const c = counts.get(k) ?? { tag, files: new Set<string>() }
        c.files.add(path)
        counts.set(k, c)
      }
    }
  }
  return sortBy([...counts.values()].map((c) => ({ tag: c.tag, count: c.files.size })), (c) => [-c.count, c.tag.toLowerCase()])
})

plugin.op({
  id: "tag.list",
  cli: "tags",
  mcp: "tags",
  summary: "Every tag in the vault (frontmatter tags and #tags in the text) with how many files have it; or one tag's files.",
  help: `Nested tags count for their parents too (project/lighthouse counts for project). With a tag: the files that have it
(or one nested under it), newest first.

  vau tags
  vau tags journal`,
  kind: "read",
  params: { tag: { type: "string", description: "one tag (with or without #): the files that have it" } },
  args: ["tag"],
  run: async ({ tag }, ctx) => (tag ? { tag, files: await ctx.api("GET", `tags?tag=${encodeURIComponent(tag)}`) } : { tags: await ctx.api("GET", "tags") }),
  text: (r) => (r.tag
    ? (r.files.length ? r.files.map((f: { path: string; tags: string[] }) => `- ${f.path} (${f.tags.map((t) => `#${t}`).join(" ")})`).join("\n") : `No file has #${String(r.tag).replace(/^#/, "")}.`)
    : (r.tags.length ? r.tags.map((t: { tag: string; count: number }) => `- #${t.tag}: ${t.count}`).join("\n") : "No tags yet.")),
})

const TAG_NAME = /^[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*$/u

plugin.route("POST", "tags/rename", (req) => {
  const from = tagName(String(req.body?.from ?? "")), to = tagName(String(req.body?.to ?? ""))
  if (!from) throw new HTTPError(400, "from: the tag to rename")
  if (!TAG_NAME.test(to) || to.includes("//")) throw new HTTPError(400, "to: a tag (letters, digits, _ - and / for nesting, not only digits)")
  const changed: string[] = [], skipped: { path: string; reason: string }[] = []
  if (from === to) return { changed, skipped }
  for (const [path, e] of plugin.vault.entries) {
    if (!hasTag(e.tags, from) || path.split("/").some((p) => p.startsWith(".") && p !== ".archive")) continue
    let text: string
    try { text = readText(plugin.vault.abs(path)) } catch { skipped.push({ path, reason: "couldn't be read" }); continue }
    const out = renameTagText(text, from, to)
    if (out === null) { skipped.push({ path, reason: "its properties can't be changed line by line" }); continue }
    if (out !== text) { writeAtomic(plugin.vault.abs(path), out); changed.push(path) }
  }
  return { changed, skipped }
})

plugin.op({
  id: "tag.rename",
  cli: "tags rename",
  summary: "Rename a tag in every file, the tags nested under it too (#project/x follows #project): merges into one that exists.",
  help: `Changes only the tags' own text: frontmatter tags (kept a list or text, as written) and #tags in the text, not in code,
comments or links. A file whose properties can't be changed line by line is left alone and listed.

  vau tags rename project work
  vau tags rename book/to-read reading`,
  kind: "write",
  params: {
    from: { type: "string", required: true, description: "the tag as it is now (with or without #)" },
    to: { type: "string", required: true, description: "its new name" },
  },
  args: ["from", "to"],
  run: async ({ from, to }, ctx) => await ctx.api("POST", "tags/rename", { from, to }),
  text: (r: { changed: string[]; skipped: { path: string; reason: string }[] }, p) => [
    `Renamed #${tagName(p.from)} to #${tagName(p.to)} in ${r.changed.length} file${r.changed.length === 1 ? "" : "s"}.`,
    ...r.skipped.map((s) => `  left alone: ${s.path} (${s.reason})`)].join("\n"),
})
