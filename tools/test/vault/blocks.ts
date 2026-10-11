import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  // Blocks (```block-<name>): where the app draws something. A kind never sees them, and API writes leave them in place.
  // A kind's own blocks are drawn on top of its files, never written into them.
  {
    const { blocksIn, withoutBlocks } = await import("../../../core/sections.ts")
    const { onTop } = await import("../../../core/blocks.ts")
    const doc = "```block-a\nx: 1\n```\n\nText\n\n```` md\n```block-b\n```\n````\n\n~~~block-c extra\n~~~\n\n```block-d\nnot closed"
    check("blocksIn: closed fences, ~~~ too, a word after the name, none inside code or still open",
      JSON.stringify(blocksIn(doc).map((b) => [b.name, b.text, b.open, b.close])) === JSON.stringify([["a", "x: 1", 0, 2], ["c", "", 11, 12]]), blocksIn(doc))
    check("withoutBlocks: the text without them and the blank lines after them", withoutBlocks("```block-a\n```\n\nOne\n\n```block-b\n```\n\nTwo\n") === "One\n\nTwo", withoutBlocks("```block-a\n```\n\nOne\n\n```block-b\n```\n\nTwo\n"))
    const { tidyKindBlocks } = await import("../../../core/blocks.ts")
    check("tidyKindBlocks: the fences on top that repeat the kind's blocks, in order, without options",
      tidyKindBlocks(["log", "workout"], "\n```block-log\n```\n\n```block-workout\n```\n\nNotes\n") === "Notes\n"
      && tidyKindBlocks(["log", "workout"], "```block-log\n```\n\n```block-workout\nwide: true\n```\n") === "```block-workout\nwide: true\n```\n"
      && tidyKindBlocks(["person"], "Text\n\n```block-person\n```\n") === null
      && tidyKindBlocks(["person"], "```block-person\n```\n\n```block-person\nfile: Bob\n```\n") === null
      && tidyKindBlocks(["log"], "```block-log\n```\n") === "")
    check("onTop: a kind's blocks the body doesn't place", JSON.stringify(onTop(["log", "workout"], "Notes\n\n```block-workout\n```\n")) === JSON.stringify(["log"]) && onTop(undefined, "x").length === 0)
  }
  let [code, p] = await api("POST", "people", { name: "Block Person", relation: "friend", notes: "Likes tea." })
  let t = read("People/Block Person.md")
  check("a new file has no fence for its kind's blocks", !t.includes("```") && t.split("---\n").slice(2).join("---\n").trimStart().startsWith("Likes tea."), t)
  check("an item's text has no blocks", p.notes === "Likes tea.", p.notes)
  let [, tr] = await api("GET", "files")
  check("the file index says a file's kind's blocks", JSON.stringify(tr.files.find((f: Any) => f.path === "People/Block Person.md")?.kindBlocks) === JSON.stringify(["person"]))
  let kr = ""
  kr = (await api("GET", "render?path=People/Block Person.md"))[1]
  check("render draws a kind's blocks on top of its file", kr.indexOf("Last in touch") >= 0 && kr.indexOf("Last in touch") < kr.indexOf("Likes tea."), kr)
  write("People/Block Person.md", read("People/Block Person.md").replace("Likes tea.", "Likes tea.\n\n```block-person\n```") + "\n```block-query\nlimit: 3\n```\n")
  kr = (await api("GET", "render?path=People/Block Person.md"))[1]
  check("a fence of a kind's block draws it there, once", kr.indexOf("Last in touch") > kr.indexOf("Likes tea.") && kr.split("Last in touch").length === 2, kr)
  write("People/Block Person.md", read("People/Block Person.md").replace("Likes tea.\n\n```block-person\n```", "```block-person\n```\n\nLikes tea."))
  await api("PUT", "people/Block Person", { notes: "Likes coffee now." })
  await api("POST", "interactions", { person: "Block Person", date: "2026-09-29", kind: "call", notes: "Hi" })
  t = read("People/Block Person.md")
  const body = t.split("---\n").slice(2).join("---\n")
  check("API writes keep blocks where they were", body.trimStart().startsWith("```block-person\n```\n\nLikes coffee now.")
    && body.trimEnd().endsWith("```block-query\nlimit: 3\n```") && body.includes("- 2026-09-29 · call · Hi"), body)
  let [, s] = await api("GET", "state")
  const bp = s.people.find((x: Any) => x.name === "Block Person")
  write("Notes/Tidy.md", "```block-person\n```\n")
  write("People/Tidy Person.md", "---\ntype: person\n---\n\n```block-person\n```\n\nKept.\n")
  ;[, p] = await api("POST", "ops/block.tidy", { dry: true })
  check("blocks tidy --dry: the files with their kind's blocks on top, and only those", JSON.stringify(p.files) === JSON.stringify(["People/Block Person.md", "People/Tidy Person.md"]) && read("People/Tidy Person.md").includes("```"), p)
  await api("POST", "ops/block.tidy", {})
  check("blocks tidy: takes them out, the rest as it was", read("People/Tidy Person.md") === "---\ntype: person\n---\n\nKept.\n" && read("Notes/Tidy.md") === "```block-person\n```\n"
    && read("People/Block Person.md").includes("```block-query") && !read("People/Block Person.md").includes("```block-person"), read("People/Tidy Person.md"))
  check("a block after the timeline isn't read as part of it", !JSON.stringify(bp).includes("block")
    && !JSON.stringify(s.interactions.filter((i: Any) => i.person_id === "People/Block Person")).includes("block"), bp)
  await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "block-meal", title: "Toast", notes: "Two slices", data: { kcal: 200 } }])
  const lg = (await api("GET", "state"))[1].logs.find((x: Any) => x.ext_id === "block-meal")
  check("a new log has no fence: its blocks are its kind's", !read(lg.id + ".md").includes("```"), read(lg.id + ".md"))
  await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "block-meal", title: "Toast", notes: "Three slices", data: { kcal: 300 } }])
  t = read(lg.id + ".md")
  check("re-posting a log changes only its text", !t.includes("```") && t.includes("Three slices") && !t.includes("Two slices"), t)
  Object.assign($.vars, { code })
}
