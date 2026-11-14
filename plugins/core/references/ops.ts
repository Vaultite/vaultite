import { z } from "zod"
import { OpError, type Plugin } from "../../../core/plugins.ts"
import { citationsIn } from "./cite.ts"
import { formatSources, searchRows, shownEntries, textOf } from "./answers.ts"
import { markdownOf } from "./format.ts"
import type { References } from "./refs.ts"
import { writeOps } from "./writeops.ts"

const Keys = z.array(z.string()).catch([])
const keysOf = (keys: string[] | undefined) => Keys.parse(keys).flatMap((k) => k.split(/[\s,;]+/)).map((k) => k.replace(/^\[?-?@|\]$/g, "")).filter(Boolean)

function searchOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.search",
    cli: "references search",
    mcp: "references_search",
    summary: "Search the user's reference library (Zotero, .bib and other bibliography files, reference notes) by author, year, title or citekey; cite one in a note as Pandoc does, [@key, p. 33] (vau docs references).",
    help: `Each answer has the citekey to cite it with (Pandoc's [@key]), who wrote it, the year and title, where it's from,
and its literature note when there is one. Nothing given: the newest. path: the library a note cites from (its own
bibliography: too).

  vau references search "luhmann zettelkasten"
  vau references search 1945 --limit 5`,
    kind: "read",
    params: {
      query: { type: "string", description: "words to find: authors, a year, title words or a citekey" },
      path: { type: "string", description: "a note whose library to search (its frontmatter's bibliography: counts)" },
      limit: { type: "number", description: "at most this many (default 20)" },
    },
    args: ["query"],
    run: async (p) => ({ results: searchRows(refs, p.query ?? "", p.path ?? "", Math.max(1, Math.min(200, p.limit ?? 20))) }),
    text: (r) => (r.results.length ? r.results.map((x) => `- @${x.key}: ${[x.authors, x.year].filter(Boolean).join(" ")}${x.title ? `, ${x.title}` : ""}${x.from ? ` (${x.from})` : ""}${x.note ? ` → ${x.note}` : ""}`).join("\n") : "Nothing in the library matches."),
  })
}

function getOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.get",
    cli: "references get",
    summary: "Get references by citekey: the formatted reference in the note's or the user's style, its CSL JSON, links (DOI, URL, Zotero) and literature note.",
    kind: "read",
    params: {
      keys: { type: "array", items: { type: "string" }, required: true, description: "citekeys (with or without @)" },
      path: { type: "string", description: "the note it's cited from (its csl: and bibliography: count)" },
      style: { type: "string", description: "a style instead of the note's or the user's (apa, chicago-author-date, mla, harvard, ieee, vancouver, or a .csl file)" },
    },
    args: ["keys"],
    run: async (p) => {
      const keys = keysOf(p.keys)
      const { lib, shown, missing } = await shownEntries(refs, keys, p.path ?? "", p.style ?? "")
      return { references: shown.map((s) => ({ ...s, text: textOf(s.html), csl: lib.entries.get(s.key)?.item ?? null })), missing }
    },
    text: (r) => [...r.references.map((x) => `- @${x.key}: ${x.text}${x.note ? ` (literature note: ${x.note})` : ""}`),
      ...r.missing.map((k) => `- @${k}: not in the library`)].join("\n"),
  })
}

function formatOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.format",
    cli: "references format",
    summary: "Format citations and references in a citation style: a note's (its citations as they read, and its bibliography), or citations given in Pandoc's syntax.",
    help: `A note: each citation in it as the style writes it, and its references. Citations: Pandoc's ("[@a, p. 33; @b]",
"@a", "[-@a]"), formatted together as one text would have them.

  vau references format --path "Papers/Draft.md"
  vau references format "[@bush1945, p. 101]" "@kuhn1962" --style chicago`,
    kind: "read",
    params: {
      citations: { type: "array", items: { type: "string" }, description: "citations in Pandoc's syntax" },
      path: { type: "string", description: "a note: its citations, or the note the given citations are for" },
      style: { type: "string", description: "a style instead of the note's or the user's" },
    },
    args: ["citations"],
    run: async (p) => {
      const path = p.path ?? ""
      if (!p.citations?.length && !path) throw new OpError("give citations, or a note's path")
      if (p.citations?.length) {
        const r = await formatSources(refs, path, p.citations)
        return { style: r.style.title, citations: r.sources.map((h, i) => ({ source: p.citations![i], text: markdownOf(h) })), references: r.entries.map((e) => textOf(e.html)), missing: r.missing }
      }
      const f = await refs.formatNote(path, undefined, p.style ?? "")
      return { style: f.style.title, citations: f.cites.map((c, i) => ({ source: c.source, text: markdownOf(f.citations[i] ?? "") })), references: f.entries.map((e) => markdownOf(e.html)), missing: f.missing }
    },
    text: (r) => [`Style: ${r.style}`, "", ...r.citations.map((c) => `- ${c.source} → ${c.text}`), "", "References:", ...r.references.map((x) => `- ${x}`),
      ...(r.missing.length ? ["", `Not in the library: ${r.missing.map((k) => `@${k}`).join(", ")}`] : [])].join("\n"),
  })
}

function citedOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.cited",
    cli: "references cited",
    summary: "The citekeys a note cites, in order, each with whether the library has it.",
    kind: "read",
    params: { path: { type: "string", required: true, description: "the note" } },
    args: ["path"],
    run: async (p) => {
      const text = refs.host.textOf(p.path)
      if (text === null) throw new OpError(`no note ${p.path}`, 404)
      const lib = refs.library(p.path)
      const keys = [...new Set(citationsIn(text).flatMap((c) => c.items.map((i) => i.key)))]
      return { keys: keys.map((k) => ({ key: k, found: lib.entries.has(k) || lib.aliases.has(k) })) }
    },
    text: (r) => (r.keys.length ? r.keys.map((k) => `- @${k.key}${k.found ? "" : " (not in the library)"}`).join("\n") : "It cites nothing."),
  })
}

export function referencesOps(plugin: Plugin, refs: References) {
  searchOp(plugin, refs)
  getOp(plugin, refs)
  formatOp(plugin, refs)
  citedOp(plugin, refs)
  writeOps(plugin, refs)
}
