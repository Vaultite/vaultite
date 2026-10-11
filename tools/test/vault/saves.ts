import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, merge3, read, vault, write } = $
  let p: Any
  // Review fixes
  check("strict merge doesn't drop lines the other side added inside a changed stretch", merge3("a\nb\nc\nd", "a\nX\nd", "a\nb\nNEW\nc\nd") === null)
  write("People/Round Trip.md", "---\ntype: person\nrelation: friend\n---\n\n## Timeline\n\n- 2026-09-20 · call · Hi\n" +
    "Met at the gym, see photos\n- 2026-09-10 - text - hand written\n")
  let rt: Any
  ;[, rt] = await api("GET", "people/Round Trip")
  const tl = rt.timeline.filter((i: Any) => !("_raw" in i)).map((i: Any) => Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith("_"))))
  tl[0].notes = "Hi again"
  await api("PUT", "people/Round Trip", { timeline: tl })
  let t = read("People/Round Trip.md")
  check("GET then PUT of a timeline keeps lines it can't read and hand-written lines",
    t.includes("Met at the gym, see photos") && t.includes("- 2026-09-10 - text - hand written") && t.includes("- 2026-09-20 · call · Hi again"), t)
  let [, s] = await api("GET", "state")
  const ids = s.interactions.filter((i: Any) => i.person_id === "People/Round Trip").map((i: Any) => i.id).sort()
  check("interaction ids count only entries", JSON.stringify(ids) === JSON.stringify(["People/Round Trip#0", "People/Round Trip#1"]), ids)
  write("People/Round Trip.md", read("People/Round Trip.md").replace("relation: friend", "relation: [friend"))
  let [code] = await api("POST", "interactions", { person: "Round Trip", date: "2026-09-29", kind: "call" })
  check("no writes to a file whose header can't be read", code === 409 && read("People/Round Trip.md").includes("relation: [friend"), code)
  // A save changes only what it changed: an empty key stays, a cleared one stays empty, the file keeps its own name.
  write("People/Sam Lee (school).md", "---\ntype: person\nname: Sam Lee\nrelation: friend\ncontext:\n---\n\nMet at school.\n")
  await api("GET", "state")
  ;[code] = await api("PUT", "people/People/Sam Lee (school)", { relation: "family" })
  check("save: one key's line changes, an empty one stays, the name stays the file's own",
    code === 200 && read("People/Sam Lee (school).md") === "---\ntype: person\nname: Sam Lee\nrelation: family\ncontext:\n---\n\nMet at school.\n", [code, exists("People/Sam Lee (school).md") && read("People/Sam Lee (school).md")])
  ;[code] = await api("PUT", "people/People/Sam Lee (school)", { relation: "" })
  check("save: a value cleared keeps its key, empty (as Obsidian does)", read("People/Sam Lee (school).md") === "---\ntype: person\nname: Sam Lee\nrelation: null\ncontext:\n---\n\nMet at school.\n", read("People/Sam Lee (school).md"))
  ;[code] = await api("PUT", "people/People/Sam Lee (school)", { name: "Sam Leigh" })
  check("save: renamed only when its name changed", code === 200 && exists("People/Sam Leigh.md") && !exists("People/Sam Lee (school).md"), code)
  write("Notes/Gone.md", "x\n")
  await api("GET", "state")
  await api("DELETE", "file?path=Notes/Gone.md")
  ;[code] = await api("PUT", "file", { path: "Notes/Gone.md", text: "x\ny\n", base: "x\n" })
  check("saving a deleted file doesn't bring it back", code === 404 && !exists("Notes/Gone.md"), code)
  // Undo after trashing (the app's toast): DELETE says where it went, restore brings it back with hidden files off, and a
  // second undo (it's gone from the trash) fails with a clear error.
  write("Scratch/Undo me.txt", "keep\n")
  await api("GET", "state")
  let del: Any
  ;[code, del] = await api("DELETE", "file?path=Scratch/Undo me.txt")
  check("DELETE answers where in .trash it went", code === 200 && /^\.trash\/Scratch\/Undo me \d{4}-\d{2}-\d{2} \d{6}\.txt$/.test(del.trashed) && exists(del.trashed), del)
  ;[code, p] = await api("POST", "file/restore", { path: del.trashed })
  check("restore takes a .trash path with hidden files off (Undo)", code === 200 && p.path === "Scratch/Undo me.txt" && read("Scratch/Undo me.txt") === "keep\n", [code, p])
  ;[code, p] = await api("POST", "file/restore", { path: del.trashed })
  check("restoring twice says it's not in the trash any more", code === 404 && /isn't in the trash/.test(p.error), [code, p])
  ;[code, p] = await api("POST", "file/restore", { path: ".trash/../Scratch/Undo me.txt" })
  check("restore refuses paths out of the trash", code === 400, [code, p])
  {
    // .trash is emptied of what's been there 30 days (by the time in its name), its emptied path folders too.
    const { emptyTrash } = await import("../../../core/files.ts")
    const old = "2026-08-01 101500", fresh = "2026-10-01 101500", now = new Date(2026, 9, 9).getTime()
    for (const f of [`Old ${old}.md`, `Fresh ${fresh}.md`, `Deep/Er/Old ${old} 2.md`, `Folder ${old}/a.md`, `.Cloud ${old}.md.icloud`]) write(`.trash/${f}`, "x\n")
    const gone = await emptyTrash(vault, now)
    check("trash: what's been there over 30 days goes for good, the rest stays", gone.length === 4 && !exists(`.trash/Old ${old}.md`) && exists(`.trash/Fresh ${fresh}.md`) &&
      !exists(`.trash/Folder ${old}`) && !exists(".trash/Deep") && !exists(`.trash/.Cloud ${old}.md.icloud`), gone)
    fs.rmSync(path.join(VAULT, `.trash/Fresh ${fresh}.md`))
  }
  ;[code, p] = await api("POST", "file/move", { from: "Scratch/Undo me.txt", to: "Scratch/Moved/Undo me.txt" })
  await api("DELETE", "file?path=Scratch/Moved/Undo me.txt")
  ;[code, p] = await api("POST", "file/move", { from: "Scratch/Moved/Undo me.txt", to: "Scratch/Undo me.txt" })
  check("undoing a move of a file that's gone since fails (404)", code === 404, [code, p])
  write("Notes/Idea.md", "one\n"); write("Projects/Idea.md", "---\ntype: project\n---\n"); write("Notes/Uses.md", "[[Idea]] and [[Notes/Idea]]\n")
  await api("GET", "state")
  await api("POST", "file/move", { from: "Notes/Idea.md", to: "Notes/Idea two.md" })
  t = read("Notes/Uses.md")
  check("a rename follows the file [[Name]] found, also when another file had that name", t.includes("[[Idea two]] and [[Notes/Idea two]]"), t)
}
