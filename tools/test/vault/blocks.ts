import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  // Blocks (```block-<name>): where the app draws something. A kind never sees them, and API writes leave them in place.
  // A kind's own blocks are written into a new file of it as fences; only what a file places is drawn.
  {
    const { blocksIn, withoutBlocks } = await import("../../../core/sections.ts")
    const { unplaced, withKindBlocks } = await import("../../../core/blocks.ts")
    const doc = "```block-a\nx: 1\n```\n\nText\n\n```` md\n```block-b\n```\n````\n\n~~~block-c extra\n~~~\n\n```block-d\nnot closed"
    check("blocksIn: closed fences, ~~~ too, a word after the name, none inside code or still open",
      JSON.stringify(blocksIn(doc).map((b) => [b.name, b.text, b.open, b.close])) === JSON.stringify([["a", "x: 1", 0, 2], ["c", "", 11, 12]]), blocksIn(doc))
    check("withoutBlocks: the text without them and the blank lines after them", withoutBlocks("```block-a\n```\n\nOne\n\n```block-b\n```\n\nTwo\n") === "One\n\nTwo", withoutBlocks("```block-a\n```\n\nOne\n\n```block-b\n```\n\nTwo\n"))
    check("unplaced: a kind's blocks the body has no fence of (one for another file isn't its own)",
      JSON.stringify(unplaced(["log", "workout"], "Notes\n\n```block-workout\n```\n")) === JSON.stringify(["log"]) && unplaced(undefined, "x").length === 0
      && JSON.stringify(unplaced(["person"], "```block-person\nfile: Bob\n```\n")) === JSON.stringify(["person"]))
    check("withKindBlocks: the missing fences on top, in the kind's order; null when it has them",
      withKindBlocks(["log", "workout"], "\nNotes\n") === "```block-log\n```\n\n```block-workout\n```\n\nNotes\n"
      && withKindBlocks(["log", "workout"], "Notes\n\n```block-workout\nwide: true\n```\n") === "```block-log\n```\n\nNotes\n\n```block-workout\nwide: true\n```\n"
      && withKindBlocks(["person"], "") === "```block-person\n```\n" && withKindBlocks(["person"], "Text\n\n```block-person\n```\n") === null && withKindBlocks([], "x") === null)
  }
  let [code, p] = await api("POST", "people", { name: "Block Person", relation: "friend", notes: "Likes tea." })
  let t = read("People/Block Person.md")
  check("a new file has its kind's blocks as fences, on top", t === "---\ntype: person\nrelation: friend\n---\n\n```block-person\n```\n\nLikes tea.\n", t)
  check("an item's text has no blocks", p.notes === "Likes tea.", p.notes)
  let [, tr] = await api("GET", "files")
  check("the file index has its fences, and no blocks it doesn't place", JSON.stringify(tr.files.find((f: Any) => f.path === "People/Block Person.md")?.blocks) === JSON.stringify([["person", ""]])
    && !tr.files.some((f: Any) => "kindBlocks" in f))
  let kr = (await api("GET", "render?path=People/Block Person.md"))[1]
  check("render draws its fence where it is", kr.indexOf("Last in touch") >= 0 && kr.indexOf("Last in touch") < kr.indexOf("Likes tea."), kr)
  write("People/Bare Person.md", "---\ntype: person\nrelation: friend\n---\n\nNo fence.\n")
  kr = (await api("GET", "render?path=People/Bare Person.md"))[1]
  check("a file without its kind's fence draws none", !kr.includes("Last in touch") && kr.includes("No fence."), kr)
  write("People/Block Person.md", read("People/Block Person.md").replace("```block-person\n```\n\nLikes tea.", "Likes tea.\n\n```block-person\n```") + "\n```base\nviews:\n  - type: table\n    limit: 3\n```\n")
  kr = (await api("GET", "render?path=People/Block Person.md"))[1]
  check("a fence moved down draws it there, once", kr.indexOf("Last in touch") > kr.indexOf("Likes tea.") && kr.split("Last in touch").length === 2, kr)
  write("People/Block Person.md", read("People/Block Person.md").replace("Likes tea.\n\n```block-person\n```", "```block-person\n```\n\nLikes tea."))
  await api("PUT", "people/Block Person", { notes: "Likes coffee now." })
  await api("POST", "interactions", { person: "Block Person", date: "2026-09-29", kind: "call", notes: "Hi" })
  t = read("People/Block Person.md")
  const body = t.split("---\n").slice(2).join("---\n")
  check("API writes keep blocks where they were", body.trimStart().startsWith("```block-person\n```\n\nLikes coffee now.")
    && body.trimEnd().endsWith("```base\nviews:\n  - type: table\n    limit: 3\n```") && body.includes("- 2026-09-29 · call · Hi"), body)
  let [, s] = await api("GET", "state")
  const bp = s.people.find((x: Any) => x.name === "Block Person")
  check("a block after the timeline isn't read as part of it", !JSON.stringify(bp).includes("block")
    && !JSON.stringify(s.interactions.filter((i: Any) => i.person_id === "People/Block Person")).includes("block"), bp)
  await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "block-meal", title: "Toast", notes: "Two slices", data: { kcal: 200 } }])
  const lg = (await api("GET", "state"))[1].logs.find((x: Any) => x.ext_id === "block-meal")
  check("a new log has its kind's fence", read(lg.id + ".md").includes("```block-log\n```\n\nTwo slices"), read(lg.id + ".md"))
  await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "block-meal", title: "Toast", notes: "Three slices", data: { kcal: 300 } }])
  t = read(lg.id + ".md")
  check("re-posting a log changes only its text", t.split("```block-log").length === 2 && t.includes("Three slices") && !t.includes("Two slices"), t)
  // vau type --apply writes a kind's fences with its type; vau migrate, those a typed file lacks and the titles links no
  // longer find as aliases, once.
  write("Typed/People/Kai Moss.md", "Met at work.\n")
  await api("POST", "ops/file.type", { folder: "Typed/People", apply: true })
  check("file.type: apply writes the kind's fences too", read("Typed/People/Kai Moss.md") === "---\ntype: person\n---\n\n```block-person\n```\n\nMet at work.\n", read("Typed/People/Kai Moss.md"))
  write("Migrate/Old person.md", "---\ntype: person\n---\n\nOld.\n")
  write("Migrate/Old note.md", "---\ntitle: \"Old: note\"\n---\n\nSee.\n")
  write("Migrate/Links.md", "[[Old: note]]\n")
  const edge = async () => (await api("GET", "graph"))[1].edges.some((e: Any) => e.from === "Migrate/Links.md" && e.to === "Migrate/Old note.md")
  check("a `title:` isn't a link name", !(await edge()))
    let [, mg] = await api("POST", "ops/file.migrate", { folder: "Migrate" })
  check("file.migrate: lists the fences and aliases to add, writes nothing", JSON.stringify(mg.files) === JSON.stringify([
    { path: "Migrate/Old note.md", blocks: [], aliases: ["Old: note"] }, { path: "Migrate/Old person.md", blocks: ["person"], aliases: [] }]) && read("Migrate/Old person.md") === "---\ntype: person\n---\n\nOld.\n", mg)
  ;[, mg] = await api("POST", "ops/file.migrate", { folder: "Migrate", apply: true })
  check("file.migrate: apply writes them", read("Migrate/Old person.md") === "---\ntype: person\n---\n\n```block-person\n```\n\nOld.\n"
    && read("Migrate/Old note.md") === "---\ntitle: \"Old: note\"\naliases: ['Old: note']\n---\n\nSee.\n" && await edge(), [read("Migrate/Old person.md"), read("Migrate/Old note.md")])
  ;[, mg] = await api("POST", "ops/file.migrate", { folder: "Migrate" })
  check("file.migrate: again, nothing to do", !mg.files.length && !mg.failed.length, mg)
  Object.assign($.vars, { code })
}
