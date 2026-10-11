import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, write } = $
  const { sameJson } = $.vars
  // ---------- Graph view: files and [[links]] as a graph; a local graph; its block as text ----------
  write("Graph test/Hub.md", "---\ntype: note\ntags: [Lab]\naliases: [Centre]\n---\n\nSee [[Spoke one]], [[Graph test/Spoke two|two]] and ![[Board.canvas]].\n\n```\n[[Not a link]]\n```\n")
  write("Graph test/Spoke one.md", "Back to [[Centre]]. Also [[Far]] and [[Nobody here]].\n")
  write("Graph test/Spoke two.md", "---\nsee: \"[[Hub]]\"\n---\n\nNothing else.\n")
  write("Graph test/Far.md", "The end of the line.\n")
  write("Graph test/Alone.md", "No links at all.\n")
  const board = { nodes: [
    { id: "g1", type: "group", label: "Plan", x: -20, y: -20, width: 600, height: 300, color: "4", mine: "kept" },
    { id: "t1", type: "text", text: "Start with [[Far]]", x: 0, y: 0, width: 250, height: 60, color: "1" },
    { id: "f1", type: "file", file: "Graph test/Spoke one.md", x: 300, y: 0, width: 250, height: 200 },
    { id: "l1", type: "link", url: "https://example.com", x: 0, y: 400, width: 250, height: 100 },
  ], edges: [{ id: "e1", fromNode: "t1", fromSide: "right", toNode: "f1", toSide: "left", label: "then", extra: 1 }], custom: { keep: true } }
  write("Graph test/Board.canvas", JSON.stringify(board, null, "\t") + "\n")
  let [gc, graph] = await api("GET", "graph")
  const gnode = (p: string) => graph.nodes.find((n: Any) => n.path === p)
  const gedge = (a: string, b: string) => graph.edges.some((e: Any) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
  check("graph: every Markdown file is a node", gc === 200 && !!gnode("Graph test/Hub.md") && !!gnode("Graph test/Alone.md"), gc)
  check("graph: links by name, path and alias are edges", gedge("Graph test/Hub.md", "Graph test/Spoke one.md") && gedge("Graph test/Hub.md", "Graph test/Spoke two.md") && gedge("Graph test/Spoke one.md", "Graph test/Far.md"), graph.edges.filter((e: Any) => e.from.startsWith("Graph")))
  check("graph: a pair linked both ways is one edge", graph.edges.filter((e: Any) => [e.from, e.to].sort().join() === ["Graph test/Hub.md", "Graph test/Spoke one.md"].sort().join()).length === 1)
  check("graph: links in code and to nothing aren't edges", !graph.nodes.some((n: Any) => /Not a link|Nobody here/.test(n.path)))
  check("graph: degree, folder, tags", gnode("Graph test/Hub.md").degree === 3 && gnode("Graph test/Hub.md").folder === "Graph test" && gnode("Graph test/Hub.md").tags.includes("Lab") && gnode("Graph test/Alone.md").degree === 0, gnode("Graph test/Hub.md"))
  check("graph: an embedded canvas is a node, and its cards link to files", !!gnode("Graph test/Board.canvas") && gedge("Graph test/Board.canvas", "Graph test/Spoke one.md") && gedge("Graph test/Board.canvas", "Graph test/Far.md"), gnode("Graph test/Board.canvas"))
  // Obsidian's rules: a first name alone isn't a link (the app offers "Did you mean" instead); an alias is.
  write("People/Theo Park.md", "---\ntype: person\nrelation: friend\naliases: [Ted]\n---\n\nA friend.\n")
  write("Graph test/Met.md", "Met [[Theo]] and [[Ted]].\n")
  ;[, graph] = await api("GET", "graph")
  check("graph: a first name alone links to nobody, an alias does", gedge("Graph test/Met.md", "People/Theo Park.md") && graph.edges.filter((e: Any) => e.from === "Graph test/Met.md").length === 1, graph.edges.filter((e: Any) => e.from === "Graph test/Met.md"))
  const { linkResolver } = await import("../../../core/links.ts")
  const lr = linkResolver([{ path: "Notes/Idea.md", aliases: ["Big idea"] }, { path: "People/Bob Lee.md" }, { path: "Idea.md" }, { path: "Work/Idea.md" },
    { path: "Work/Deep/Plan.md" }, { path: "files/a.pdf" }, { path: "Books/Dune Part One.md", title: "Dune: Part One" }, { path: "Dune: Part One.md" }])
  check("links: path, name, alias, title and heading resolve; a first name or a part of a path doesn't",
    lr("Notes/Idea") === "Notes/Idea.md" && lr("Big idea#Part") === "Notes/Idea.md" && lr("Dune: Part One") === "Dune: Part One.md" && lr("Bob") === null &&
    lr("Nobody") === null && lr("Deep/Plan") === "Work/Deep/Plan.md" && lr("eep/Plan") === null && lr("Other/Plan") === null && lr("a.pdf") === "files/a.pdf",
    [lr("Notes/Idea"), lr("Big idea"), lr("Bob"), lr("Deep/Plan"), lr("eep/Plan"), lr("a.pdf")])
  check("links: of several files with a name, the closest to the link's file wins", lr("Idea", "Work/Deep/Plan.md") === "Work/Idea.md" && lr("Idea", "Notes/x.md") === "Notes/Idea.md" &&
    lr("Idea", "Top.md") === "Idea.md" && lr("Idea", "Other/x.md") === "Idea.md" && lr("../Idea", "Work/Deep/Plan.md") === "Work/Idea.md" && lr("/Idea", "Work/x.md") === "Idea.md",
    [lr("Idea", "Work/Deep/Plan.md"), lr("Idea", "Notes/x.md"), lr("Idea", "Top.md"), lr("Idea", "Other/x.md"), lr("../Idea", "Work/Deep/Plan.md"), lr("/Idea", "Work/x.md")])
  const { linkIndex } = await import("../../../core/links.ts")
  const lix = linkIndex([{ value: "alice", path: "People/Alice Park.md" }, { value: "plan", path: "Work/Plan.md" }])
  check("links: what a link to nothing may have meant", sameJson(lix.suggest("Alice"), ["alice"]) && sameJson(lix.suggest("Old/Plan"), ["plan"]) && sameJson(lix.suggest("Ali"), []), [lix.suggest("Alice"), lix.suggest("Old/Plan")])
  let [, localG] = await api("GET", "graph?path=Graph test/Far.md&depth=1")
  const lp = (g: Any) => g.nodes.map((n: Any) => n.path).sort()
  check("graph: a local graph is the file and its neighbours", JSON.stringify(lp(localG)) === JSON.stringify(["Graph test/Board.canvas", "Graph test/Far.md", "Graph test/Spoke one.md"]), lp(localG))
  ;[, localG] = await api("GET", "graph?path=Graph test/Far.md&depth=2")
  check("graph: depth 2 reaches two links away, with dist", lp(localG).includes("Graph test/Hub.md") && localG.nodes.find((n: Any) => n.path === "Graph test/Hub.md").dist === 2, lp(localG))
  check("graph: a local graph of nothing is a 404", (await api("GET", "graph?path=Graph test/Missing.md"))[0] === 404)
  write("Graph test/Far.md", "The end of the line, now with [[Alone]].\n")
  ;[, graph] = await api("GET", "graph")
  check("graph: follows a file changed on disk", gedge("Graph test/Far.md", "Graph test/Alone.md"))
  write("Graph test/With graph.md", "Links to [[Hub]].\n\n```block-graph\ndepth: 2\n```\n")
  let [, gtext] = await api("GET", "render?path=Graph test/With graph.md")
  check("graph: the block as text lists neighbours as links", gtext.includes("- [[Hub]] (links to it)") && gtext.includes("**Two links away") && gtext.includes("[[Spoke one]]") && !gtext.includes("```block-graph"), gtext)
  let [, gset] = await api("PATCH", "config/plugin/graph", { colorBy: "type", hidden: ["folder:Logs"] })
  check("graph: settings saved in its data.json", gset.colorBy === "type" && JSON.parse(read(".vaultite/plugins/graph/data.json")).hidden[0] === "folder:Logs", gset)
  check("plugin settings: a declared one's value is checked against its manifest", (await api("PATCH", "config/plugin/graph", { colorBy: "size" }))[0] === 400)

  // ---------- One type per file, and archiving (core/fileprops.ts) ----------
  write("People/No Type.md", "---\nrelation: friend\n---\n\nNo type line.\n")
  write("People/Odd Type.md", "---\ntype: persn\nrelation: friend\n---\n\nA type no kind has.\n")
  write("People/Wrong Type.md", "---\ntype: idea-board\n---\n\nNot a kind's type.\n")
  write("People/A Note.md", "---\ntype: note\n---\n\nSays it's a note, among people.\n")
  write("Elsewhere/Loose person.md", "---\ntype: Person\nrelation: friend\n---\n\nOutside People.\n")
  let [, atree] = await api("GET", "files")
  const frow = (p: string) => atree.files.find((f: Any) => f.path === p)
  check("type: a kind's folder never decides a file's type", frow("People/No Type.md")?.type === null && frow("People/No Type.md")?.kind === null, frow("People/No Type.md"))
  check("type: a file's `type` decides its kind, whatever its folder", frow("People/A Note.md")?.kind === "notes" && frow("Elsewhere/Loose person.md")?.kind === "people" &&
    frow("Elsewhere/Loose person.md")?.type === "person" && frow("Dashboards/Design.md")?.type === "dashboard", [frow("People/A Note.md"), frow("Elsewhere/Loose person.md")])
  let [, s] = await api("GET", "state")
  check("type: one no kind has, in a kind's folder, is a plain file of that type", frow("People/Odd Type.md")?.kind === null && frow("People/Odd Type.md")?.type === "persn", frow("People/Odd Type.md"))
  let [, aqt] = await api("POST", "query", { type: "person", from: "People/", columns: ["file", "type"] })
  const qpaths = (r: Any) => r.groups.flatMap((g: Any) => g.rows.map((x: Any) => x.path))
  check("type: a query's `type` is the file's type", qpaths(aqt).includes("People/Alice Park.md") && !qpaths(aqt).includes("People/No Type.md") && !qpaths(aqt).includes("People/A Note.md") && aqt.groups[0].rows.find((x: Any) => x.path === "People/Alice Park.md").values.type === "person", qpaths(aqt))
  ;[, graph] = await api("GET", "graph")
  check("type: the graph colours by the file's type", gnode("People/No Type.md")?.type === null && gnode("People/A Note.md")?.type === "note", gnode("People/A Note.md"))
  for (const f of ["People/Wrong Type.md", "People/Odd Type.md", "People/A Note.md"]) fs.rmSync(path.join(VAULT, f))
  fs.rmSync(path.join(VAULT, "Elsewhere"), { recursive: true })

  // ---------- Folders are the user's (core/vault.ts kindFor and home): kinds by type, new files where their kind's are ----------
  {
    write("Personal/People/Moved Person.md", "---\ntype: person\nrelation: friend\n---\n\nMoved with the others.\n")
    write("Personal/People/Typeless.md", "---\nrelation: family\n---\n\nNo type, among people.\n")
    write("Personal/Logs/Study/2026-09-01 Verbs.md", "---\ntype: log\narea: study\ndate: 2026-09-01\ntitle: Verbs\n---\n")
    write("Archive/Books/Not a book.md", "---\nstatus: done\n---\n\nIn a folder only named like Books'.\n")
    write("Templates/A person.md", "---\ntype: person\nrelation: friend\n---\n")
    let [, ft] = await api("GET", "files")
    const row = (p: string) => ft.files.find((f: Any) => f.path === p)
    check("folders: a typed file is its kind in any folder", row("Personal/People/Moved Person.md")?.kind === "people" &&
      (await api("GET", "people/Moved Person"))[1]?.id === "Personal/People/Moved Person", row("Personal/People/Moved Person.md"))
    check("folders: no type, even among people, is a plain file", row("Personal/People/Typeless.md")?.kind === null, row("Personal/People/Typeless.md"))
    check("folders: a folder only named like a kind's isn't one", row("Archive/Books/Not a book.md")?.kind === null, row("Archive/Books/Not a book.md"))
    check("folders: templates are never items, whatever their type", row("Templates/A person.md")?.kind === null && row("Templates/A person.md")?.type === "person" &&
      !(await api("GET", "people"))[1].some((p: Any) => p.id === "Templates/A person"), row("Templates/A person.md"))
    await api("POST", "logs", [{ area: "study", date: "2026-09-02", source: "claude", ext_id: "folders-study", title: "Nouns" }])
    check("folders: a new log goes where its area's logs are", exists("Personal/Logs/Study/2026-09-02 Nouns.md"), ft.folders)
    write("Notes/Met.md", "Met [[Moved Person]].\n")
    await api("GET", "state")
    await api("PUT", "people/Moved Person", { name: "Moved Again" })
    check("folders: a renamed item stays in its folder", exists("Personal/People/Moved Again.md") && !exists("People/Moved Again.md"))
    check("a renamed item's links follow it", read("Notes/Met.md") === "Met [[Moved Again]].\n", read("Notes/Met.md"))
    const inPeople = (await api("GET", "people"))[1].filter((p: Any) => p.id.startsWith("People/")).length
    for (let i = 0; i <= inPeople; i++) write(`Personal/People/Extra ${i}.md`, "---\ntype: person\nrelation: contact\n---\n")
    await api("POST", "people", { name: "Newly Met", relation: "contact" })
    check("folders: a new person goes where most people are", exists("Personal/People/Newly Met.md"), inPeople)
    const { homeFolder } = await import("../../../core/fileprops.ts")
    check("folders: homeFolder prefers folders named like the kind's", homeFolder(["Clippings/a.md", "Clippings/b.md", "Personal/Notes/c.md"], "Notes") === "Personal/Notes" &&
      homeFolder(["Personal/Logs/Gym/a.md", "Personal/Logs/Gym/b.md", "Logs/Sleep/c.md"], "Logs", true) === "Personal/Logs/Gym" &&
      homeFolder(["Friends/a.md", "Friends/b.md", "c.md"], "People") === "Friends" && homeFolder([], "People") === null)
    for (const d of ["Personal", "Archive"]) fs.rmSync(path.join(VAULT, d), { recursive: true })
    fs.rmSync(path.join(VAULT, "Templates/A person.md"))
  }

  // Archiving: one key, any file.
  write("People/Kai Old.md", "---\ntype: person\nrelation: friend\narchived: true\n---\n\nAn old friend.\n")
  write("People/Kai New.md", "---\ntype: person\nrelation: friend\n---\n\nA new friend.\n")
  write("People/Remy Gone.md", "---\ntype: person\nrelation: friend\narchived: true\n---\n\nMoved away.\n")
  write("Arch/Links.md", "[[Kai]], [[Remy]], [[Kai Old]] and [[Shared]].\n")
  write("Arch/Old note.md", "---\ntype: note\naliases: [Shared]\narchived: true\n---\n\nAn archived note about quokkas.\n")
  write("Arch/New note.md", "---\ntype: note\naliases: [Shared]\n---\n\nA current note about quokkas.\n")
  ;[, atree] = await api("GET", "files")
  check("archived: the file row says so (and only then)", frow("Arch/Old note.md")?.archived === true && !("archived" in frow("Arch/New note.md")), frow("Arch/Old note.md"))
  ;[, s] = await api("GET", "state")
  const kaiOld = s.people.find((p: Any) => p.id === "People/Kai Old"), kaiNew = s.people.find((p: Any) => p.id === "People/Kai New")
  check("archived: every kind's item says so", kaiOld?.archived === true && !kaiNew?.archived, [kaiOld?.archived, kaiNew?.archived])
  ;[, graph] = await api("GET", "graph?archived=true")
  check("archived: a full name still finds it; a first name finds nobody", gedge("Arch/Links.md", "People/Kai Old.md") && !gedge("Arch/Links.md", "People/Kai New.md") && !gedge("Arch/Links.md", "People/Remy Gone.md"))
  check("archived: an alias goes to the one not archived", gedge("Arch/Links.md", "Arch/New note.md") && !gedge("Arch/Links.md", "Arch/Old note.md"))
  const lra = linkResolver([{ path: "A/Kai.md", archived: true }, { path: "B/Kai.md" }, { path: "A/Old.md", aliases: ["Twin"], archived: true }, { path: "B/New.md", aliases: ["Twin"] },
    { path: "People/Remy.md", archived: true }])
  check("links: archived files lose ties, and keep what's theirs alone", lra("Kai", "A/x.md") === "B/Kai.md" && lra("Twin") === "B/New.md" && lra("Remy") === "People/Remy.md" && lra("A/Kai") === "A/Kai.md", [lra("Kai", "A/x.md"), lra("Twin"), lra("Remy")])
  ;[, graph] = await api("GET", "graph")
  check("archived: left out of the graph", !gnode("People/Kai Old.md") && !gnode("Arch/Old note.md") && !!gnode("People/Kai New.md"))
  ;[, localG] = await api("GET", "graph?path=Arch/Old note.md&depth=1")
  check("archived: its own local graph keeps it", lp(localG).includes("Arch/Old note.md"), lp(localG))
  await api("PATCH", "config/plugin/graph", { archived: true })
  ;[, graph] = await api("GET", "graph")
  check("archived: a graph setting brings them back", !!gnode("People/Kai Old.md"))
  await api("PATCH", "config/plugin/graph", { archived: null })
  let [, aq] = await api("POST", "query", { from: "Arch/" })
  check("archived: left out of database views", JSON.stringify(qpaths(aq)) === JSON.stringify(["Arch/Links.md", "Arch/New note.md"]), qpaths(aq))
  ;[, aq] = await api("POST", "query", { from: "Arch/", archived: true })
  check("archived: `archived: true` brings them in", qpaths(aq).length === 3, qpaths(aq))
  ;[, aq] = await api("POST", "query", { from: "Arch/", archived: "only" })
  check("archived: `archived: only` lists only them", JSON.stringify(qpaths(aq)) === JSON.stringify(["Arch/Old note.md"]), qpaths(aq))
  check("archived: another value is a 400", (await api("POST", "query", { archived: "maybe" }))[0] === 400)
  const [, asr] = await api("GET", "search?q=quokkas")
  check("archived: search finds it last, marked", asr.length === 2 && asr[0].path === "Arch/New note.md" && asr[1].archived === true, asr)
  write("Arch/Due.md", "```block-people-group\ntitle: Friends\nrelations: [friend]\n```\n")
  let [, adue] = await api("GET", "render?path=Arch/Due.md")
  check("archived: left out of People's blocks", adue.includes("Kai New") && !adue.includes("Kai Old") && !adue.includes("Remy Gone"), adue)
  // Through the API: set on any kind's item, written as `archived: true` and moved into .archive/ (the Archive plugin);
  // unset, the key is removed (never `false`) and it moves back. Links follow both ways.
  write("Arch/To Kai.md", "[[People/Kai New]] and [[Kai New]].\n")
  let [, kaiPut] = await api("PUT", "people/Kai New", { archived: true })
  check("archive: an API write adds only that key, and moves it into .archive/", !exists("People/Kai New.md") && kaiPut.id === "People/.archive/Kai New" &&
    read("People/.archive/Kai New.md") === "---\ntype: person\nrelation: friend\narchived: true\n---\n\nA new friend.\n", kaiPut)
  check("archive: a path link follows it, a name link still finds it", read("Arch/To Kai.md") === "[[People/.archive/Kai New]] and [[Kai New]].\n", read("Arch/To Kai.md"))
  ;[, s] = await api("GET", "state")
  check("archive: still a person, archived", s.people.find((p: Any) => p.id === "People/.archive/Kai New")?.archived === true)
  check("archive: its id from before still finds it", (await api("GET", "people/People/Kai New"))[1]?.id === "People/.archive/Kai New")
  ;[, adue] = await api("GET", "render?path=Arch/Due.md")
  check("archive: left out of lists", !adue.includes("Kai New"), adue)
  ;[, graph] = await api("GET", "graph?archived=true")
  check("archive: links to it resolve", gedge("Arch/To Kai.md", "People/.archive/Kai New.md"), graph.edges.filter((e: Any) => e.from === "Arch/To Kai.md"))
  ;[, atree] = await api("GET", "files")
  check("archive: in the tree's files and folders, archived", frow("People/.archive/Kai New.md")?.archived === true && atree.folders.includes("People/.archive"))
  kaiPut = (await api("PUT", "people/People/Kai New", { archived: false }))[1]
  check("archive: unarchiving removes the key and moves it back", kaiPut.id === "People/Kai New" && !exists("People/.archive/Kai New.md") &&
    read("People/Kai New.md") === "---\ntype: person\nrelation: friend\n---\n\nA new friend.\n", kaiPut)
  check("archive: links follow it back", read("Arch/To Kai.md") === "[[People/Kai New]] and [[Kai New]].\n", read("Arch/To Kai.md"))
  // The ops: any file, Markdown or not; a name taken on the way back gets " 1".
  write("Arch/Plain.md", "Plain text.\n")
  write("Arch/Chart.png", "not really a png")
  write("Arch/See.md", "[[Arch/Plain]] ![[Arch/Chart.png]]\n")
  let [, aop] = await api("POST", "ops/archive.add", { path: "Arch/Plain.md" })
  check("archive.add: moved, and the key added", aop.path === "Arch/.archive/Plain.md" && read("Arch/.archive/Plain.md") === "---\narchived: true\n---\n\nPlain text.\n", aop)
  ;[, aop] = await api("POST", "ops/archive.add", { path: "Arch/Chart.png" })
  check("archive.add: a file that isn't Markdown just moves", aop.path === "Arch/.archive/Chart.png" && read("Arch/See.md") === "[[Arch/.archive/Plain]] ![[Arch/.archive/Chart.png]]\n", read("Arch/See.md"))
  ;[, atree] = await api("GET", "files")
  check("archive.add: in an archive folder counts as archived", atree.others.find((f: Any) => f.path === "Arch/.archive/Chart.png")?.archived === true)
  write("Arch/Plain.md", "A new plain.\n")
  ;[, aop] = await api("POST", "ops/archive.restore", { path: "Arch/.archive/Plain.md" })
  check("archive.restore: back, key gone, a free name when taken", aop.path === "Arch/Plain 1.md" && read("Arch/Plain 1.md") === "Plain text.\n" && read("Arch/See.md").startsWith("[[Arch/Plain 1]]"), aop)
  check("archive.add: a hidden file or a folder is refused", (await api("POST", "ops/archive.add", { path: "Arch" }))[0] === 400)
  // By hand, the key alone doesn't move a file; archive.tidy moves those, once.
  write("Arch/By hand.md", "---\narchived: true\n---\n\nTyped.\n")
  ;[, aop] = await api("POST", "ops/archive.tidy", { dry: true })
  check("archive.tidy --dry: lists what's marked but not moved", exists("Arch/By hand.md") && aop.files.includes("Arch/By hand.md") && aop.files.includes("People/Kai Old.md") && !aop.moved.length, aop)
  ;[, aop] = await api("POST", "ops/archive.tidy", {})
  check("archive.tidy: moves each into its folder's .archive", !aop.failed.length && exists("Arch/.archive/By hand.md") && exists("People/.archive/Kai Old.md") &&
    (await api("POST", "ops/archive.tidy", { dry: true }))[1].files.length === 0, aop)
  ;[, graph] = await api("GET", "graph?archived=true")
  check("archive.tidy: names still resolve to the archived file", gedge("Arch/Links.md", "People/.archive/Kai Old.md"),
    graph.edges.filter((e: Any) => e.from === "Arch/Links.md"))
  // New files never go into an archive folder.
  const anote = (await api("POST", "notes", { ext_id: "idea-archive-test", title: "Archive me", body: "Soon gone.", kind: "idea", status: "seed" }))[1]
  const anow = (await api("PUT", `notes/${encodeURIComponent(anote.id)}`, { archived: true }))[1]
  check("archived: notes too", anow.id.includes("/.archive/") && /\narchived: true\n/.test(read(`${anow.id}.md`)) && !(await api("GET", "notes"))[1].some((n: Any) => n.id === anow.id) && (await api("GET", "notes?archived=true"))[1].some((n: Any) => n.id === anow.id), anow)
  await api("POST", "books", { title: "Shelved book", author: "Bob Lee", status: "reading" })
  await api("PUT", "books/Shelved book", { archived: true })
  write("Arch/Books.md", "```block-books\n```\n")
  check("archived: left out of Books' list", !(await api("GET", "render?path=Arch/Books.md"))[1].includes("Shelved book"))
  await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "archived-meal", title: "Old meal", data: { kcal: 100 } }])
  let [, alogs] = await api("GET", "logs?area=nutrition")
  let alog = alogs.find((l: Any) => l.ext_id === "archived-meal")
  fs.writeFileSync(path.join(VAULT, `${alog.id}.md`), read(`${alog.id}.md`).replace(/\n---\n/, "\narchived: true\n---\n"))
  ;[, alogs] = await api("GET", "logs?area=nutrition")
  check("archived: GET /api/logs leaves it out", !alogs.some((l: Any) => l.ext_id === "archived-meal"))
  ;[, alogs] = await api("GET", "logs?area=nutrition&archived=true")
  alog = alogs.find((l: Any) => l.ext_id === "archived-meal")
  check("archived: a log's `archived` is the core's, not its data", alog.archived === true && !("archived" in alog.data), alog)
  await api("POST", "logs", [{ area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "archived-meal", title: "Old meal", data: { kcal: 120 } }])
  check("archived: a log's upsert keeps it archived", /\narchived: true\n/.test(read(`${alog.id}.md`)) && /\nkcal: 120\n/.test(read(`${alog.id}.md`)), read(`${alog.id}.md`))
  const { archivedValue, isArchived, archiveTwin, unarchived, isHiddenPath, inArchive, homeFolder: homeOf } = await import("../../../core/fileprops.ts")
  check("archive: paths", archiveTwin("People/Kai.md") === "People/.archive/Kai.md" && archiveTwin("Top.md") === ".archive/Top.md" && archiveTwin("A/.archive/B.md") === "A/B.md" &&
    unarchived("A/.archive/B/.archive/c.md") === "A/B/c.md" && inArchive(".archive/x.md") && !inArchive("A/.archive") && !isHiddenPath("A/.archive/b.md") && isHiddenPath(".trash/a.md") &&
    homeOf(["People/.archive/a.md", "People/.archive/b.md", "People/c.md"], "People") === "People")
  check("archived: only true or yes counts", [true, "yes", "True", " YES "].every(archivedValue) && ![false, "false", "no", 0, 1, "", "2026-09-01", "maybe", [1], { a: 1 }, null, undefined].some(archivedValue) && isArchived({ archived: true }) && !isArchived(null))
  Object.assign($.vars, { board })
}
