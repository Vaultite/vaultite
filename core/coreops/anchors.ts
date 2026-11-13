import type { App } from "../app.ts"
import { blocksOf, findBlockByText, newBlockId, withBlockId, type NoteBlock } from "../blockrefs.ts"
import { isHiddenPath } from "../fileprops.ts"
import { defineOp, type Op, OpError } from "../ops.ts"
import { headingsOf } from "../sections.ts"
import type { Entry } from "../vault.ts"
import { readFile, saveFile } from "./routes.ts"

type Anchors = { ns: bigint; headings: string[]; blocks: NoteBlock[] }
const seen = new Map<string, Anchors>()
function anchorsOf(e: Entry): Anchors {
  const hit = seen.get(e.rel)
  if (hit?.ns === e.stat.ns) return hit
  const next = { ns: e.stat.ns, headings: headingsOf(e.text).map((h) => h.text), blocks: blocksOf(e.text) }
  seen.set(e.rel, next)
  return next
}

const LIMIT = 30

export function anchorOps(app: App): Op[] {
  return [defineOp({
    id: "file.block-link",
    cli: "block-link",
    summary: "A link to a paragraph or list item in a note ([[Note#^id]]), giving the block a ^id when it has none.",
    help: `Finds the block (a paragraph or a list item) by its words, writes " ^id" at its end if it has no id yet (the
rest of the file untouched), and answers the link, written as the vault writes links (from: the note it goes in).
Paste the link into a note, or ![[...]] to embed the block.

  vau block-link "Notes/Idea.md" "the quarterly goal"
  vau block-link Lighthouse "launch checklist" --from "Journal/2026-10-04.md"`,
    kind: "write",
    params: {
      path: { type: "string", format: "path", required: true, description: "the note (Notes/Idea.md, or its name)" },
      text: { type: "string", required: true, description: "words of the block, enough to find it once" },
      line: { type: "integer", minimum: 1, description: "its line (1: the first), when its words are in several blocks" },
      id: { type: "string", pattern: "^[A-Za-z0-9-]+$", description: "the id to give it when it has none (else a new one)" },
      from: { type: "string", format: "path", description: "the note the link goes in, for a relative link format" },
    },
    args: ["path", "text"],
    run: async ({ path, text, line, id, from }, ctx) => {
      const f = await readFile(ctx, path)
      if (!/\.md$/i.test(f.path)) throw new OpError(`${f.path} isn't a note: only notes have blocks`)
      const blocks = blocksOf(f.text)
      const hit = findBlockByText(blocks, text, line === undefined ? undefined : line - 1)
      if (!hit) throw new OpError(`no paragraph or list item in ${f.path} has “${text}”: read it again and copy its words`, 404)
      if (Array.isArray(hit)) throw new OpError(`“${text}” is in ${hit.length} blocks of ${f.path} (lines ${hit.map((b) => b.line + 1).join(", ")}): give more of its words, or line`)
      let to = hit.id, added = false
      if (!to) {
        const taken = new Set(blocks.flatMap((b) => (b.id ? [b.id.toLowerCase()] : [])))
        if (id && taken.has(id.toLowerCase())) throw new OpError(`another block in ${f.path} is ^${id} already`, 409)
        to = id ?? newBlockId((x) => taken.has(x))
        await saveFile(ctx, { path: f.path, text: withBlockId(f.text, hit, to), base: f.text })
        added = true
      }
      return { path: f.path, id: to, line: hit.line + 1, text: hit.text, added, link: app.vault.newLink({ path: f.path, anchor: `^${to}` }, from ?? "") }
    },
    text: (r) => `${r.link}${r.added ? ` (the block on line ${r.line} is ^${r.id} now)` : ""}`,
  }), defineOp({
    id: "file.anchors",
    cli: "anchors",
    summary: "Headings or blocks (paragraphs, list items) across the vault's notes whose words match: what a link can point into.",
    help: `Every note's headings, or its blocks, with all the words of query in them (any case), newest notes first:
what [[## and [[^^ suggest in the editor. Link to a heading as [[Note#Heading]]; to a block with block-link.

  vau anchors heading "launch plan"
  vau anchors block "quarterly goal"`,
    kind: "read",
    params: {
      kind: { type: "string", enum: ["heading", "block"], required: true, description: "headings, or blocks" },
      query: { type: "string", default: "", description: "words they all have (none: the newest notes')" },
      limit: { type: "integer", minimum: 1, maximum: 200, default: LIMIT, description: "at most this many" },
    },
    args: ["kind", "query"],
    run: ({ kind, query, limit }, ctx) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      const has = (t: string) => { const l = t.toLowerCase(); return words.every((w) => l.includes(w)) }
      const notes = [...ctx.vault.entries.values()].filter((e) => /\.md$/i.test(e.rel) && !isHiddenPath(e.rel) && !ctx.vault.excluded(e.rel))
      notes.sort((a, b) => Number(b.stat.ns - a.stat.ns))
      const found: { path: string; text: string; id?: string }[] = []
      for (const e of notes) {
        const a = anchorsOf(e)
        const all: { text: string; id?: string }[] = kind === "heading" ? a.headings.map((h) => ({ text: h })) : a.blocks
        for (const t of all) {
          if (!t.text || !has(t.text)) continue
          found.push({ path: e.rel, text: t.text, id: t.id })
          if (found.length >= limit) return { kind, found }
        }
      }
      return { kind, found }
    },
    text: (r) => (r.found.length ? r.found.map((f) => `- ${f.path}: ${f.text}${f.id ? ` ^${f.id}` : ""}`).join("\n") : `No ${r.kind}s match.`),
  })]
}
