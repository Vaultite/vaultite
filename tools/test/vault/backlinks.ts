import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, write } = $
  // Links (plugins/core/backlinks): unlinked mentions, and linking one as a small edit.
  {
    write("Links test/Theo Marsh.md", "A made-up person.\n")
    write("Links test/Weekend.md", "---\ntype: note\n---\n\nClimbing with theo marsh on Saturday.\n`Theo Marsh` in code, [[Theo Marsh]] already linked, [Theo Marsh](https://example.com)\n" +
      "```\nTheo Marsh in a fence\n```\nTheo Marshs isn't a name. Lunch with Theo Marsh.\n")
    write("Links test/Crlf.md", "First line\r\nSaw Theo Marsh today\r\nLast line\r\n")
    let [c, un] = await api("GET", "backlinks/unlinked?path=Links test/Theo Marsh.md")
    const mine = (f: string) => (un.mentions as Any[]).filter((m) => m.path === f)
    check("unlinked mentions: plain text only (not links, code, fences or longer words), any case",
      c === 200 && mine("Links test/Weekend.md").map((m: Any) => m.text).join("|") === "theo marsh|Theo Marsh" && mine("Links test/Crlf.md").length === 1, un)
    check("unlinked mentions: counted in all, a page at a time", un.total === 3 && un.files === 2, un)
    const [, page] = await api("GET", "backlinks/unlinked?path=Links test/Theo Marsh.md&offset=1&limit=1")
    check("unlinked mentions: offset and limit", page.total === 3 && page.mentions.length === 1 && JSON.stringify(page.mentions[0]) === JSON.stringify(un.mentions[1]), page)
    const [first, second] = mine("Links test/Weekend.md")
    ;[c] = await api("POST", "backlinks/link", { ...first, target: "Links test/Theo Marsh.md" })
    let t = read("Links test/Weekend.md")
    check("Link: written differently, it keeps the text ([[Name|as written]]), and only that line changes",
      c === 200 && t.replace(/^---\n[\s\S]*?\n---\n/, "") === "\nClimbing with [[Theo Marsh|theo marsh]] on Saturday.\n`Theo Marsh` in code, [[Theo Marsh]] already linked, [Theo Marsh](https://example.com)\n" +
      "```\nTheo Marsh in a fence\n```\nTheo Marshs isn't a name. Lunch with Theo Marsh.\n", t)
    ;[c] = await api("POST", "backlinks/link", { ...second, target: "Links test/Theo Marsh.md" })
    check("Link: written like the name, a plain [[Name]]", c === 200 && read("Links test/Weekend.md").includes("Lunch with [[Theo Marsh]].\n"), read("Links test/Weekend.md"))
    ;[c] = await api("POST", "backlinks/link", { ...second, target: "Links test/Theo Marsh.md" })
    check("Link: again, when the file changed there since, is a 409", c === 409, c)
    ;[, un] = await api("GET", "backlinks/unlinked?path=Links test/Theo Marsh.md")
    check("unlinked mentions: linked ones are gone", !mine("Links test/Weekend.md").length, un)
    ;[c] = await api("POST", "backlinks/link", { ...mine("Links test/Crlf.md")[0], target: "Links test/Theo Marsh.md" })
    check("Link: a file with CRLF keeps them", c === 200 && fs.readFileSync(path.join(VAULT, "Links test/Crlf.md"), "utf8") === "First line\r\nSaw [[Theo Marsh]] today\r\nLast line\r\n",
      fs.readFileSync(path.join(VAULT, "Links test/Crlf.md"), "utf8"))
    ;[c] = await api("POST", "backlinks/link", { path: "Links test/Crlf.md", target: "Links test/Theo Marsh.md", line: "Last line", nth: 0, col: 0, len: 4, text: "Last" })
    check("Link: only a name of the file it links to", c === 400, c)
    const { findMentions } = await import("../../../plugins/core/backlinks/mentions.ts")
    check("mentions: never inside a #tag, nested or not; the plain word beside it is one",
      JSON.stringify(findMentions("#lighthouse/launch and #work/lighthouse, then Lighthouse.", ["Lighthouse"]).map((m) => m.col)) === JSON.stringify([46]),
      findMentions("#lighthouse/launch and #work/lighthouse, then Lighthouse.", ["Lighthouse"]))
    check("mentions: aliases, longest name first, unicode words", JSON.stringify(findMentions("Met Zoë and Zoë Souza; zoëlle no", ["Zoë Souza", "Zoë"]).map((m) => m.text)) ===
      JSON.stringify(["Zoë", "Zoë Souza"]), findMentions("Met Zoë and Zoë Souza; zoëlle no", ["Zoë Souza", "Zoë"]))
  }
  // Markdown links are links too: linked mentions, outgoing links, and never an unlinked mention.
  {
    write("Links test/Md/Ada Stone.md", "A made-up person.\n")
    write("Links test/Md/Notes/Rel.md", "Lunch with [Ada Stone](../Ada%20Stone.md).\n")
    write("Links test/Md/Notes/No ext.md", "Call [Ada](../Ada%20Stone#Phone), then Ada Stone again.\n")
    write("Links test/Md/Notes/Top.md", "See [her](/Links%20test/Md/Ada%20Stone.md) and [nobody](Nobody.md).\n")
    write("Links test/Md/Notes/Web.md", "[Ada Stone](https://example.com/Ada%20Stone.md)\n")
    const [c, lk] = await api("GET", "file/linked?path=Links test/Md/Ada Stone.md")
    check("linked mentions: Markdown links relative, without .md and from the top, each with its line",
      c === 200 && JSON.stringify(lk.linked.map((l: Any) => l.path).sort()) === JSON.stringify(["Links test/Md/Notes/No ext.md", "Links test/Md/Notes/Rel.md", "Links test/Md/Notes/Top.md"]) &&
      lk.linked.find((l: Any) => l.path === "Links test/Md/Notes/Rel.md").line === "Lunch with [Ada Stone](../Ada%20Stone.md).", lk)
    const [, top] = await api("GET", "file/linked?path=Links test/Md/Notes/Top.md")
    check("outgoing links: a Markdown link's target as written, decoded", JSON.stringify(top.links) === JSON.stringify(["/Links test/Md/Ada Stone.md", "Nobody.md"]), top)
    const [, un] = await api("GET", "backlinks/unlinked?path=Links test/Md/Ada Stone.md")
    check("unlinked mentions: a name in a Markdown link (to a note or a URL) isn't one; plain text beside it is",
      JSON.stringify(un.mentions.map((m: Any) => `${m.path}:${m.col}`).sort()) === JSON.stringify(["Links test/Md/Notes/No ext.md:39"]), un)
  }
  // A web page's links: the notes about it (`source`), linking it however it's written, and elsewhere on its site.
  {
    write("Links test/Web about.md", "---\ntype: note\nsource: https://www.example.com/posts/one/\n---\n\nMy notes.\n")
    write("Links test/Web linked.md", "Read [the post](https://example.com/posts/one?utm_source=x#top), then <https://example.com/posts/two>.\n```\nhttps://example.com/posts/three\n```\n")
    write("Links test/Web other.md", "See https://example.com/about. And https://elsewhere.org/posts/one too.\n")
    const [c, w] = await api("GET", "backlinks/web?url=https://example.com/posts/one")
    const paths = (xs: Any[]) => xs.map((x) => x.path).sort().join("|")
    check("web: the note about it, by its source (www, a trailing slash)", c === 200 && paths(w.about) === "Links test/Web about.md", w)
    check("web: notes linking it (tracking keys and #part ignored), not those about it", paths(w.linked) === "Links test/Web linked.md" && /the post/.test(w.linked[0].line), w)
    check("web: elsewhere on its site, not in code, nor other sites", w.site === "example.com" && JSON.stringify(w.elsewhere.filter((x: Any) => x.path.includes("/Web ")).map((x: Any) => x.url).sort()) ===
      JSON.stringify(["https://example.com/about", "https://example.com/posts/two"]), w.elsewhere)
    const [bad] = await api("GET", "backlinks/web?url=notes")
    check("web: an address that isn't one is a 400", bad === 400, bad)
    const { urlsIn } = await import("../../../plugins/core/backlinks/weblinks.ts")
    check("web: an address keeps its own parentheses, not the link's", JSON.stringify(urlsIn("[w](https://en.wikipedia.org/wiki/Foo_(bar)) (https://a.org/x).").map((u) => u.url)) ===
      JSON.stringify(["https://en.wikipedia.org/wiki/Foo_(bar)", "https://a.org/x"]), urlsIn("[w](https://en.wikipedia.org/wiki/Foo_(bar)) (https://a.org/x)."))
  }
  await blockRefs($)
  // (its notes would be where the next ones go: new notes go beside the others)
  await api("DELETE", "file?path=Links test")
}

async function blockRefs({ VAULT, api, check, read, write }: VaultTest) {
  write("Links test/Blocks.md", "---\ntype: note\n---\n\n# Plan\n\nShip the first cut.\nThen ask Alice.\n\n- launch checklist\n- done already ^kept\n\nShip it twice.\n")
  let [c, r] = await api("POST", "ops/file.block-link", { path: "Links test/Blocks.md", text: "ask alice" })
  const id = r.id
  check("block link: the block gets a ^id at its end, the rest of the file as it was, and its link",
    c === 200 && r.added && /^[a-z0-9]{6}$/.test(id) && r.link === `[[Blocks#^${id}]]` &&
    read("Links test/Blocks.md").replace(/^---\n[\s\S]*?\n---\n/, "") === `\n# Plan\n\nShip the first cut.\nThen ask Alice. ^${id}\n\n- launch checklist\n- done already ^kept\n\nShip it twice.\n`, [r, read("Links test/Blocks.md")])
  ;[c, r] = await api("POST", "ops/file.block-link", { path: "Blocks", text: "done already" })
  check("block link: a block that has an id keeps it, the file untouched", c === 200 && !r.added && r.id === "kept" && r.link === "[[Blocks#^kept]]", r)
  ;[c, r] = await api("POST", "ops/file.block-link", { path: "Links test/Blocks.md", text: "ship" })
  check("block link: words in several blocks ask for more", c === 400 && /2 blocks/.test(r.error), r)
  ;[c, r] = await api("POST", "ops/file.block-link", { path: "Links test/Blocks.md", text: "launch checklist", id: "kept" })
  check("block link: an id another block has is refused", c === 409, r)
  ;[c, r] = await api("POST", "ops/file.anchors", { kind: "block", query: "launch check" })
  check("anchors: blocks across the vault by their words", c === 200 && r.found.some((f: Any) => f.path === "Links test/Blocks.md" && f.text === "launch checklist"), r)
  ;[c, r] = await api("POST", "ops/file.anchors", { kind: "heading", query: "plan" })
  check("anchors: headings across the vault", c === 200 && r.found.some((f: Any) => f.path === "Links test/Blocks.md" && f.text === "Plan"), r)
  await api("PATCH", "config/files", { wikilinks: false, linkFormat: "relative" })
  let [, st] = await api("GET", "state")
  check("link style: files.json's, in the state", JSON.stringify(st.filing.links) === JSON.stringify({ format: "relative", wikilinks: false }), st.filing)
  ;[c, r] = await api("POST", "ops/file.block-link", { path: "Links test/Blocks.md", text: "done already", from: "Links test/Md/Notes/Top.md" })
  check("block link: as a Markdown link, relative to the note it goes in", c === 200 && r.link === "[Blocks](../../Blocks.md#^kept)", r)
  write("Links test/Mention.md", "Saw Ada Stone today.\n")
  const [, un] = await api("GET", "backlinks/unlinked?path=Links test/Md/Ada Stone.md")
  ;[c] = await api("POST", "backlinks/link", { ...un.mentions.find((m: Any) => m.path === "Links test/Mention.md"), target: "Links test/Md/Ada Stone.md" })
  check("Link: an unlinked mention is linked the vault's way", c === 200 && read("Links test/Mention.md") === "Saw [Ada Stone](Md/Ada%20Stone.md) today.\n", read("Links test/Mention.md"))
  await api("PATCH", "config/files", { wikilinks: null, linkFormat: null })
  write(".obsidian/app.json", JSON.stringify({ useMarkdownLinks: true, newLinkFormat: "absolute" }))
  ;[, st] = await api("GET", "state")
  check("link style: Obsidian's useMarkdownLinks and newLinkFormat when files.json says nothing", JSON.stringify(st.filing.links) === JSON.stringify({ format: "absolute", wikilinks: false }), st.filing)
  fs.rmSync(path.join(VAULT, ".obsidian"), { recursive: true, force: true })
  ;[, st] = await api("GET", "state")
  check("link style: else shortest wikilinks", JSON.stringify(st.filing.links) === JSON.stringify({ format: "shortest", wikilinks: true }), st.filing)
}
