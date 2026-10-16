import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, write } = $
  // ---------- journal entries as a tag, people's sort ----------
  write("Notes/Tagged journal.md", "---\ntype: note\ntags: [journal]\n---\n\nAnother day.\n")
  write("Notes/Inline journal.md", "---\ntype: note\n---\n\nA third day. #Journal\n")
  let [, s] = await api("GET", "state")
  const nj = (t: string) => s.notes.find((n: Any) => n.title === t)
  check("notes: a journal tag or #journal is a journal entry", nj("Tagged journal")?.journal === true &&
    nj("Inline journal")?.journal === true && nj("Hand written")?.journal === false, [nj("Tagged journal"), nj("Inline journal")])
  const jn = (await api("POST", "notes", { ext_id: "journal-api-test", title: "Api journal", body: "Today.", kind: "journal", tags: "Travel" }))[1]
  check("notes: the API's kind journal writes a Journal tag instead", /\nkind: note\n/.test(read(`${jn.id}.md`)) && /\ntags: \[Travel, Journal\]\n/.test(read(`${jn.id}.md`)) && jn.journal === true, read(`${jn.id}.md`))
  const jn2 = (await api("POST", "notes", { ext_id: "journal-api-test-2", title: "Api journal two", body: "Today.", kind: "journal", tags: "journal" }))[1]
  check("notes: and doesn't duplicate one it has", /\ntags: \[journal\]\n/.test(read(`${jn2.id}.md`)), read(`${jn2.id}.md`))
  check("notes: kind journal in GET /api/notes means journal entries", (await api("GET", "notes?kind=journal"))[1].every((n: Any) => n.journal) &&
    (await api("GET", "notes?kind=journal"))[1].some((n: Any) => n.title === "Inline journal"))
  check("notes: another kind is a problem", (write("Notes/Odd kind.md", "---\ntype: note\nkind: memo\n---\n\nx\n"), (await api("GET", "state"))[1].vault.problems.some((x: Any) => x.file === "Notes/Odd kind.md" && x.problem.includes("['idea', 'note']"))))
  fs.rmSync(path.join(VAULT, "Notes/Odd kind.md"))
  await api("POST", "people", { name: "Zed Nosort", relation: "friend" })
  write("People/Aaron Nosort.md", "---\ntype: person\nrelation: friend\n---\n\nHand made.\n")
  ;[, s] = await api("GET", "state")
  check("people: no `sort` is written, on a new person or on read", !/sort/.test(read("People/Zed Nosort.md")) && !/sort/.test(read("People/Aaron Nosort.md")), read("People/Zed Nosort.md"))
  const pOrder = s.people.map((p: Any) => p.name)
  check("people: those with a sort first, by it; the rest after, by name", pOrder.indexOf("Hand Made") < pOrder.indexOf("Aaron Nosort") && pOrder.indexOf("Aaron Nosort") < pOrder.indexOf("Zed Nosort"), pOrder)
}
