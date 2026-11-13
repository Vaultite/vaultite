// Link format and block references: how a new link is written, and the blocks a [[note#^id]] points at.
import { check } from "../lib.ts"

const { formatLink, linkStyleOf, shortestName } = await import("../../../core/linkformat.ts")
const { blockAt, blocksOf, findBlockByText, newBlockId, withBlockId } = await import("../../../core/blockrefs.ts")
{
  const short = (p: string) => shortestName(p, (c) => c === "Idea" || c === "img.png")
  const from = "Journal/2026/Day.md", to = { path: "Notes/Ideas/Idea.md" }
  const as = (format: "shortest" | "relative" | "absolute", wikilinks: boolean, t: Parameters<typeof formatLink>[0] = to) => formatLink(t, from, { format, wikilinks }, short)
  check("link format: wikilinks by the shortest name, a path from the note's folder, or from the top",
    as("shortest", true) === "[[Idea]]" && as("relative", true) === "[[../../Notes/Ideas/Idea]]" && as("absolute", true) === "[[Notes/Ideas/Idea]]", [as("shortest", true), as("relative", true), as("absolute", true)])
  check("link format: Markdown links keep .md and encode spaces, as Obsidian writes them",
    as("shortest", false) === "[Idea](Idea.md)" && as("absolute", false, { path: "Notes/My idea.md" }) === "[My idea](Notes/My%20idea.md)", [as("shortest", false), as("absolute", false, { path: "Notes/My idea.md" })])
  check("link format: a heading or block, an alias, an embed",
    as("shortest", true, { ...to, anchor: "^ab12cd" }) === "[[Idea#^ab12cd]]" && as("shortest", true, { ...to, text: "the idea" }) === "[[Idea|the idea]]" &&
    as("shortest", true, { path: "Attachments/img.png", embed: true }) === "![[img.png]]" && as("shortest", false, { path: "Attachments/img.png", embed: true }) === "![](img.png)" &&
    as("shortest", false, { ...to, anchor: "Next steps" }) === "[Idea](Idea.md#Next%20steps)")
  check("link format: a heading in the note itself is [[#Heading]]", formatLink({ path: from, anchor: "Plan" }, from, { format: "absolute", wikilinks: true }, short) === "[[#Plan]]")
  check("link format: files.json's keys, else shortest wikilinks", JSON.stringify(linkStyleOf({ linkFormat: "relative", wikilinks: false })) === JSON.stringify({ format: "relative", wikilinks: false }) &&
    JSON.stringify(linkStyleOf({ linkFormat: "nope" })) === JSON.stringify({ format: "shortest", wikilinks: true }))
  check("shortest name: a folder more at a time until it finds the file", shortestName("A/B/Idea.md", (c) => c === "B/Idea") === "B/Idea" && shortestName("A/x.md", () => false) === "A/x")
}
{
  const text = "---\ntitle: x\n---\n# Head\n\nFirst line\nsecond line\n\n- one\n  more of one\n- two ^done\n\n```\ncode\n```\n> a quote\n\nWith its id\n^own\n\nCRLF line\r\n"
  const bs = blocksOf(text)
  check("blocks: paragraphs and list items, not headings, code, quotes or the frontmatter, with their ids",
    JSON.stringify(bs.map((b) => [b.line, b.end, b.text, b.kind, b.id ?? null])) === JSON.stringify([[5, 7, "First line second line", "paragraph", null], [8, 10, "one more of one", "list", null],
      [10, 11, "two", "list", "done"], [17, 18, "With its id", "paragraph", "own"], [20, 21, "CRLF line", "paragraph", null]]), bs)
  check("blocks: an id goes at the block's end, other bytes kept (CRLF too)",
    withBlockId(text, bs[0], "ab12cd").includes("First line\nsecond line ^ab12cd\n") && withBlockId(text, bs[4], "x").endsWith("CRLF line ^x\r\n"))
  check("blocks: the block on a line, by its words", blockAt(text, 9)?.text === "one more of one" && blockAt(text, 3) === null &&
    findBlockByText(bs, "more of") === bs[1] && Array.isArray(findBlockByText(bs, "o")) && findBlockByText(bs, "nothing here") === null)
  const taken = new Set<string>(), id = newBlockId((x) => taken.size < 3 && !!taken.add(x))
  check("blocks: a new id is six letters or digits, not one taken", /^[a-z0-9]{6}$/.test(id) && taken.size === 3 && !taken.has(id), [id, taken])
}
