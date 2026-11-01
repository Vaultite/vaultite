import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
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
  // The map as a canvas.
  const { canvasOf } = await import("../../../plugins/core/mind-map/tree.ts")
  const cv = JSON.parse(canvasOf(treeOf(headingsIn("# A\n## A1\n## A2\n# B\n", true), "Plan"), "Notes/Plan.md"))
  check("mind map canvas: a card per branch, an arrow to each, a colour per top branch, the root linking the note",
    cv.nodes.length === 5 && cv.edges.length === 4 && cv.nodes[0].text === "## [[Notes/Plan|Plan]]" && cv.nodes[1].color === "1" && cv.nodes[2].color === "1" && cv.nodes[4].color === "2" &&
    cv.nodes[1].y === (cv.nodes[2].y + cv.nodes[3].y) / 2 && cv.edges.every((e: { fromSide: string; toSide: string }) => e.fromSide === "right" && e.toSide === "left"), cv)
  write("Notes/Map canvas.md", "# Goals\n- Ship\n# Risks\n")
  const [cs, cb] = await api("POST", "ops/mind-map.canvas", { path: "Notes/Map canvas.md" })
  check("mind map canvas op: a canvas beside the note", cs === 200 && cb.path === "Notes/Map canvas mind map.canvas" && JSON.parse(read(cb.path)).nodes.length === 4, [cs, cb])
  const [cs2, cb2] = await api("POST", "ops/mind-map.canvas", { path: "Notes/Map canvas.md" })
  check("mind map canvas op: again, a second canvas, the first kept", cs2 === 200 && cb2.path === "Notes/Map canvas mind map 1.canvas", cb2)
}

