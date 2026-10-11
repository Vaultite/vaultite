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
    check("mentions: aliases, longest name first, unicode words", JSON.stringify(findMentions("Met Zoë and Zoë Souza; zoëlle no", ["Zoë Souza", "Zoë"]).map((m) => m.text)) ===
      JSON.stringify(["Zoë", "Zoë Souza"]), findMentions("Met Zoë and Zoë Souza; zoëlle no", ["Zoë Souza", "Zoë"]))
  }
}
