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
}
