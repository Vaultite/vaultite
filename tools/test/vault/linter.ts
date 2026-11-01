import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  // Linter (plugins/core/linter): rules on prose lines only, and the op on a note and a folder.
  const { formatMarkdown, RULES, rulesOf } = await import("../../../plugins/core/linter/format.ts")
  const src = "---\ntitle: x  \n---\n# Plan ##\nIntro.   \n\n\n\n* one\n  + two\n* * *\n*em* text\n## Next\n```\ncode   \n\n\n* not a list\n```\n$$\na  \n$$\n# C#\n\n\n"
  const out = formatMarkdown(src)
  check("linter: every rule, frontmatter, code and math left as written", out ===
    "---\ntitle: x  \n---\n\n# Plan\n\nIntro.\n\n- one\n  - two\n* * *\n*em* text\n\n## Next\n\n```\ncode   \n\n\n* not a list\n```\n$$\na  \n$$\n\n# C#\n", JSON.stringify(out))
  check("linter: formatted text stays as it is", formatMarkdown(out) === out)
  check("linter: a rule off is left alone", formatMarkdown("* a  \n", { ...RULES, listMarkers: false, trailingSpaces: false }) === "* a  \n" && rulesOf({ blankLines: false, x: 1 }).blankLines === false && rulesOf({}).blankLines === true)
  check("linter: a tag at a line's start isn't a heading", formatMarkdown("Text\n#tag\nmore\n") === "Text\n#tag\nmore\n")

  write("Lint/A.md", "# A\ntext  \n")
  write("Lint/B.md", "# B\n\ntext\n")
  const [cs, cb] = await api("POST", "ops/linter.format", { path: "Lint", check: true })
  check("linter op: check names what would change and writes nothing", cs === 200 && cb.changed.join() === "Lint/A.md" && cb.checked === 2 && read("Lint/A.md") === "# A\ntext  \n", cb)
  const [ws, wb] = await api("POST", "ops/linter.format?as=text", { path: "Lint/A.md" })
  check("linter op: a note formatted", ws === 200 && read("Lint/A.md") === "# A\n\ntext\n" && /^Formatted 1 of 1/.test(wb), [wb, read("Lint/A.md")])
  const [ns] = await api("POST", "ops/linter.format", { path: "Lint/missing.md" })
  check("linter op: no such note is a 404", ns === 404)
  const listed = "1. Step\n\n    ```sh\n    * glob  \n\n\n    ```\n"
  check("linter: code in a list item (an indented fence) is left as written", formatMarkdown(listed) === listed, JSON.stringify(formatMarkdown(listed)))
}
