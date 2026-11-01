import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, write } = $
  // Mind map (plugins/core/mind-map): a note's headings as a tree, and its block as that tree in text.
  const { headingsIn, treeOf, treeText } = await import("../../../plugins/core/mind-map/tree.ts")
  const text = "---\ntitle: x\n---\n# Goals\n## Ship the [[Beta|beta]] ^b1\n```\n# not a heading\n```\n### Week **one**\n## Hire\n# Risks\n#nottag\n"
  const hs = headingsIn(text)
  check("mind map: headings, code and frontmatter skipped, block ids off", hs.map((h) => `${h.level}${h.text}`).join("|") === "1Goals|2Ship the [[Beta|beta]]|3Week **one**|2Hire|1Risks", hs)
  const tree = treeOf(hs, "Plan")
  check("mind map: one title heading is the root", treeOf([{ level: 1, text: "T", line: 0 }, { level: 2, text: "A", line: 1 }], "R").text === "T")
  check("mind map: each heading under the nearest lower one, as it reads", tree.children.length === 2 && tree.children[0].children.map((c) => c.text).join() === "Ship the beta,Hire" &&
    tree.children[0].children[0].children[0].text === "Week one", tree)
  check("mind map: a jump of levels still nests", treeOf([{ level: 1, text: "A", line: 0 }, { level: 3, text: "B", line: 1 }, { level: 2, text: "C", line: 2 }, { level: 1, text: "D", line: 3 }], "R").children[0].children.map((c) => c.text).join() === "B,C")
  check("mind map: as text, to a depth", treeText(tree, 1) === "**Plan**\n- Goals\n- Risks", treeText(tree, 1))

  write("Notes/Map plan.md", "Intro.\n\n```block-mind-map\ndepth: 2\n```\n\n# Goals\n## Ship\n### Detail\n# Risks\n")
  const [st, out] = await api("GET", "render?path=Notes/Map plan.md")
  check("mind map block: rendered as the headings' tree", st === 200 && String(out).includes("**Map plan**\n- Goals\n  - Ship\n- Risks"), out)

  const li = headingsIn("- Before\n# A\n- one\n  - [ ] one a\n  - one b\n- two\n1. three\n```\n- code\n```\n## B\n  - under B\n", true)
  check("mind map lists: items by their indent, under the heading before them; tasks' boxes off; code skipped", li.map((h) => `${h.level}${h.text}`).join("|") ===
    "7Before|1A|7one|8one a|8one b|7two|7three|2B|7under B", li)
  const lt = treeText(treeOf(li, "R"))
  check("mind map lists: as a tree", lt === "**R**\n- Before\n- A\n  - one\n    - one a\n    - one b\n  - two\n  - three\n  - B\n    - under B", lt)
  check("mind map lists: off, headings only", headingsIn("# A\n- one\n").length === 1)
  write("Notes/Map lists.md", "```block-mind-map\n```\n\n# Trip\n## Pack\n- Hat\n- Sunscreen\n## Book\n")
  const [ls, lo] = await api("GET", "render?path=Notes/Map lists.md")
  check("mind map block: lists in its text, lists: false leaves them out", ls === 200 && String(lo).includes("**Trip**\n- Pack\n  - Hat\n  - Sunscreen\n- Book"), lo)
  check("mind map: a # that's part of a heading stays, closing ones go", headingsIn("# Learning C#\n## F#\n## Plan ##\n").map((h) => h.text).join("|") === "Learning C#|F#|Plan")
  check("mind map: a ```js line inside a ```` block is code", headingsIn("````\n```js\n# not\n````\n# Yes\n").map((h) => h.text).join() === "Yes")
}
