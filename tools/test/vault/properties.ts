import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  const { same } = $.vars
  // ---------- All properties (plugins/core/properties): every key, renamed or retyped everywhere ----------
  {
  write("Props/A.md", "---\nqa_stage: draft   # kept\nqa_n: '3'\nqa_tags: one\n---\n\nBody A.\n")
  write("Props/B.md", "---\nqa_stage: done\nqa_n: 4\nqa_phase: x\n---\n\nBody B.\n")
  write("Props/C.md", "---\nqa_n: lots\n---\n")
  let [, props] = await api("GET", "properties")
  const stage = props.find((p: Any) => p.key === "qa_stage"), qn = props.find((p: Any) => p.key === "qa_n")
  check("properties: every key with its count and type", stage?.count === 2 && stage.type === "text" && qn?.count === 3 && qn.types.number === 1 && qn.types.text === 2, [stage, qn])
  check("properties: most used first", props.findIndex((p: Any) => p.key === "qa_n") < props.findIndex((p: Any) => p.key === "qa_stage"))
  check("properties: in the store too", (await api("GET", "state"))[1].properties?.some((p: Any) => p.key === "qa_stage"))
  const [, withStage] = await api("GET", "properties?key=qa_stage")
  check("properties: ?key= lists its files and values", same(withStage, [{ path: "Props/A.md", value: "draft" }, { path: "Props/B.md", value: "done" }]), withStage)
  let [code, ren] = await api("POST", "properties/rename", { from: "qa_stage", to: "qa_phase" })
  check("properties: rename changes only the key's text", code === 200 && read("Props/A.md") === "---\nqa_phase: draft   # kept\nqa_n: '3'\nqa_tags: one\n---\n\nBody A.\n", read("Props/A.md"))
  check("properties: a file that has the new name already is left alone", same(ren.changed, ["Props/A.md"]) && ren.skipped[0]?.path === "Props/B.md" && read("Props/B.md").includes("qa_stage: done"), ren)
  ;[code] = await api("POST", "properties/rename", { from: "qa_phase", to: "" })
  check("properties: rename needs a name", code === 400)
  ;[, ren] = await api("POST", "properties/retype", { key: "qa_n", type: "number" })
  check("properties: change type converts what converts", read("Props/A.md").includes("qa_n: 3\n") && ren.changed.length === 1 && ren.changed[0].value === "3"
    && ren.skipped.length === 1 && ren.skipped[0].path === "Props/C.md" && read("Props/C.md") === "---\nqa_n: lots\n---\n", ren)
  await api("POST", "properties/restore", { key: "qa_n", values: ren.changed })
  check("properties: restore puts the old values back (Undo)", read("Props/A.md").includes("qa_n: '3'\n"), read("Props/A.md"))
  ;[, ren] = await api("POST", "properties/retype", { key: "qa_tags", type: "list" })
  check("properties: text to a list", read("Props/A.md").includes("qa_tags: [one]\n") && read("Props/A.md").includes("# kept"), read("Props/A.md"))
  ;[code] = await api("POST", "properties/retype", { key: "qa_tags", type: "colour" })
  check("properties: an unknown type is refused", code === 400)
  }
}
