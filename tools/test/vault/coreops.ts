import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, tmp, vault, write } = $
  const { vau, conf } = $.vars
  let cr: Any
  // The core's ops (core/coreops/) through vau: what's around them on this computer (LOCAL), settings key by key, items of
  // any kind, bundles, and the ops that are MCP tools answering an MCP client as the tools do.
  {
    const a = path.join(tmp, "vau-a.txt"), b = path.join(tmp, "vau-b.txt")
    write("Notes/Vau merge.md", "One\nTwo\nThree\n")
    fs.writeFileSync(a, read("Notes/Vau merge.md"))
    fs.writeFileSync(b, "One\nTwo, changed\nThree\n")
    write("Notes/Vau merge.md", "One\nTwo\nThree\nFour, on disk meanwhile\n")
    cr = await vau("write", "Notes/Vau merge.md", "--from", b, "--base", a)
    check("vau write --from --base: files on this computer; a change on disk meanwhile is merged", cr.code === 0 &&
      read("Notes/Vau merge.md") === "One\nTwo, changed\nThree\nFour, on disk meanwhile\n", [cr, read("Notes/Vau merge.md")])
    cr = await vau("write", "Notes/Vau merge.md", "--from", path.join(tmp, "nowhere.txt"))
    check("vau write --from: a file that isn't there says so", cr.code === 1 && cr.err.includes("can't read"), cr)
    cr = await vau("read", "Vau merge", "--json")
    check("vau read --json: the file as GET /api/file answers it", cr.code === 0 && JSON.parse(cr.out).path === "Notes/Vau merge.md", cr)
    fs.rmSync(path.join(VAULT, "Notes/Vau merge.md"))

    write(".vaultite/appearance.json", JSON.stringify({ theme: "dark", mine: 1 }, null, 4) + "\n")
    cr = await vau("settings", "set", "appearance", JSON.stringify({ density: "comfortable", mine: null }))
    check("vau settings set: only the keys given (null removes one)", cr.code === 0 && JSON.stringify(conf("appearance")) === '{"theme":"dark","density":"comfortable"}', [cr, conf("appearance")])
    cr = await vau("settings", "plugin/nope")
    check("vau settings: a plugin's data.json (none yet: {})", cr.code === 0 && cr.out.includes("{}"), cr)
    cr = await vau("settings", "secrets")
    check("vau settings: only the app's settings files", cr.code === 1 && cr.err.includes("plugin/<id>"), cr)
    write(".vaultite/appearance.json", "{\"theme\": \"da")
    cr = await vau("appearance", "theme", "light")
    check("a settings file that doesn't read (mid-sync) is never overwritten", cr.code === 1 && read(".vaultite/appearance.json") === "{\"theme\": \"da", [cr, read(".vaultite/appearance.json")])
    write(".vaultite/appearance.json", JSON.stringify({ theme: "dark" }) + "\n")
    cr = await vau("appearance", "theme")
    check("vau appearance <key>: its value", cr.code === 0 && cr.out === 'theme: "dark"', cr)

    cr = await vau("item.create", "note", JSON.stringify({ title: "Item op", ext_id: "item-op", body: "From item.create." }))
    check("item.create: a note of any kind's fields", cr.code === 0 && exists("Notes/Item op.md") && read("Notes/Item op.md").includes("From item.create."), cr)
    cr = await vau("item.update", "notes", "item-op", JSON.stringify({ status: "seed" }))
    check("item.update: by its key, by collection", cr.code === 0 && read("Notes/Item op.md").includes("status: seed"), [cr, read("Notes/Item op.md")])
    cr = await vau("item.get", "note", "Item op", "--json")
    check("item.get: by its file name", cr.code === 0 && JSON.parse(cr.out).status === "seed", cr)
    cr = await vau("item.list", "note", "--json")
    check("item.list", cr.code === 0 && JSON.parse(cr.out).some((x: Any) => x.title === "Item op"), cr.out.slice(0, 200))
    cr = await vau("item.list", "pottery")
    check("item.list: an unknown kind lists the kinds", cr.code === 1 && cr.err.includes("person (people)"), cr)
    cr = await vau("item.delete", "note", "Item op")
    check("item.delete: to the trash", cr.code === 0 && !exists("Notes/Item op.md"), cr)

    cr = await vau("bundle", "save", "Vau desk", "--description", "Made by a test")
    const desk = path.join(tmp, "vau-desk.bundle.json")
    const exported = await vau("bundle", "export", "vau-desk", desk)
    const printed = await vau("bundle", "export", "vau-desk", "-")
    check("vau bundle export: to a file on this computer, or printed", cr.code === 0 && exported.code === 0 && fs.existsSync(desk) &&
      JSON.parse(fs.readFileSync(desk, "utf8")).id === "vau-desk" && JSON.parse(printed.out).vaultite === "bundle", [cr, exported, printed.out.slice(0, 100)])
    await vau("bundle", "delete", "vau-desk")
    cr = await vau("bundle", "import", desk)
    check("vau bundle import: from a file on this computer", cr.code === 0 && exists(".vaultite/bundles/vau-desk/bundle.json"), cr)
    cr = await vau("bundle", "list")
    check("vau bundle list: the user's too", cr.code === 0 && /vau-desk +yours +Vau desk/.test(cr.out), cr)
    cr = await vau("bundle", "delete", "vau-desk")
    check("vau bundle delete: each delete kept in the trash", cr.code === 0 && !exists(".vaultite/bundles/vau-desk") &&
      fs.readdirSync(path.join(VAULT, ".trash/.vaultite/bundles")).filter((f) => f.startsWith("vau-desk ")).length === 2, cr)
    write("Scratch/Trashed twice.txt", "one\n")
    await api("GET", "state")
    const [, t1] = await api("DELETE", "file?path=Scratch/Trashed twice.txt")
    write("Scratch/Trashed twice.txt", "two\n")
    await api("GET", "state")
    const [, t2] = await api("DELETE", "file?path=Scratch/Trashed twice.txt")
    check("trash: a file deleted twice keeps both copies", t1.trashed !== t2.trashed && read(t1.trashed) === "one\n" && read(t2.trashed) === "two\n", [t1, t2])
    cr = await vau("bundle")
    check("vau bundle: its subcommands", cr.code === 0 && cr.out.includes("vau bundle apply"), cr)

    cr = await vau("icon.list", "--json")
    check("icon.list: the icons a page can name", cr.code === 0 && JSON.parse(cr.out).includes("target"), cr.out.slice(0, 200))
    cr = await vau("plugins", "check")
    check("vau plugins check", cr.code === 0 && cr.out.includes("garden (off)"), cr)
    cr = await vau("plugin")
    check("vau plugin: its subcommands", cr.code === 0 && cr.out.includes("vau plugin on") && cr.out.includes("vau plugin new"), cr)

    // A folder said as a path stays the folder: its last part never picks a file of that name (a dashboard won ties).
    const { pathAsSaid } = await import("../../../core/ops.ts")
    const saidTree = { files: [{ path: "Work.md", type: "dashboard" }, { path: "Home/Logs/Work/Run.md" }], others: [], folders: ["Home", "Home/Logs", "Home/Logs/Work"] }
    check("pathAsSaid: a folder is kept, in its own case", pathAsSaid(saidTree, "Home/Logs/Work") === "Home/Logs/Work" && pathAsSaid(saidTree, "home/logs/work/") === "Home/Logs/Work")
    check("pathAsSaid: a web address is its web tab", pathAsSaid(saidTree, " http://localhost:4317/ ") === "view:web/http://localhost:4317/" && pathAsSaid(saidTree, "HTTPS://example.com") === "view:web/HTTPS://example.com")
    check("pathAsSaid: a view is kept as is, its arg's last slash too", pathAsSaid(saidTree, " view:web/https://example.com/ ") === "view:web/https://example.com/" && pathAsSaid(saidTree, "view:inbox") === "view:inbox")
    check("pathAsSaid: a file's name still finds it", pathAsSaid(saidTree, "work") === "Work.md" && pathAsSaid(saidTree, "Old/Work") === "Work.md")
    check("pathAsSaid: a hidden folder's file is kept, not another of its name", pathAsSaid(saidTree, ".vaultite/pages/Work.md") === ".vaultite/pages/Work.md")

    // MCP's tools that are ops now: an answer as text for an MCP client (they were checked against the old tools, which
    // are gone, before those went).
    const { whoOf } = await import("../../../core/ops.ts")
    await vault.synced()
    const asMcp = async (id: string, params: Any) => {
      const { op, params: p, result, who } = await app.runOp(id, params, { who: whoOf("mcp", "claude-code") })
      return op.text!(result, p, who)
    }
    for (const [tool, id, args] of [["search", "file.search", { query: "Written" }], ["read", "file.read", { path: "From vau" }], ["render", "file.render", { path: "Errors" }],
      ["list", "file.list", { folder: "Notes" }], ["list", "file.list", {}], ["query", "query.run", { type: "person", columns: ["file", "relation"], sort: "file" }]] as [string, string, Any][]) {
      const got = await asMcp(id, args)
      check(`op ${id}: an MCP client gets its answer as text, as the ${tool} tool (${JSON.stringify(args)})`, typeof got === "string" && got.trim().length > 0 && !got.startsWith("```json"), got.slice(0, 300))
    }
    const entry = (id: string) => app.catalog().find((e) => e.id === id)
    check("ops: MCP's search, read, render, list and query are ops with those tool names, read-only", ["search", "read", "render", "list", "query"]
      .every((n) => app.catalog().some((e) => e.mcp === n && e.kind === "read")) && entry("file.read")?.cli === "read", app.catalog().filter((e) => e.mcp).map((e) => e.mcp))
    // A file's actions: the ops that act on its type, the file filled in.
    const acts = (await app.runOp("file.actions", { path: "People/Alice Park.md" })).result as Any
    const tl = acts.actions.find((a: Any) => a.op === "person.timeline-add")
    check("file.actions: a person's are its kind's ops (and any file's), its name filled in, what's still needed listed", acts.type === "person" && !!tl &&
      tl.params.person === "Alice Park" && tl.needs.join() === "kind,text" && acts.actions.some((a: Any) => a.op === "archive.add") && !acts.actions.some((a: Any) => a.op === "archive.restore" || a.op === "book.progress"), acts)
    const { actionProblems } = await import("../../../core/actions.ts")
    check("actions: one naming a param the op doesn't have is a problem", actionProblems("x.y", { on: ["person"], param: "who", label: "Do" }, ["person"]).length === 1)
    check("actions: as text, one line each with its op", /- Add to timeline: person\.timeline-add person="Alice Park", needs kind, text/.test(await asMcp("file.actions", { path: "People/Alice Park.md" })))
    cr = await vau("read", "From vau")
    check("vau read: the file's text exactly (no path before it, as an MCP client gets)", cr.code === 0 && cr.out === read("Notes/From vau.md").replace(/\n$/, ""), cr)

    // Agents page through what's long, every cut says where to go on, and a page can't be written back over the file.
    const longText = Array.from({ length: 3000 }, (_, i) => `Line ${i + 1} ${"x".repeat(60)}`).join("\n") + "\n"
    write("Notes/Long read.md", longText)
    await vault.synced()
    const p1 = await asMcp("file.read", { path: "Notes/Long read.md" })
    const m1 = /\(lines 1-(\d+) of 3000; more: offset (\d+); to change it: edit_file/.exec(p1)
    check("read over MCP: a long file in pages, cut at a line, saying where to go on", !!m1 && Number(m1[2]) === Number(m1[1]) + 1 && p1.length < 101_000 && p1.includes(`Line ${m1[1]} `) && !p1.includes(`Line ${m1[2]} `), p1.slice(-200))
    const pages = [p1]
    let at = Number(m1?.[2])
    while (at && pages.length < 10) {
      const p = await asMcp("file.read", { path: "Notes/Long read.md", offset: at })
      pages.push(p)
      at = Number(/; more: offset (\d+)/.exec(p)?.[1] ?? 0)
    }
    const joined = pages.map((p) => p.slice(p.indexOf("\n\n") + 2).replace(/\n\(lines [^\n]*\)$/, "")).join("")
    check("read: offset goes on from there, every line once, to the end", joined === longText && /\(lines \d+-3000 of 3000; to change it/.test(pages.at(-1)!), [pages.length, pages.at(-1)!.slice(-200)])
    const few = (await app.runOp("file.read", { path: "Notes/Long read.md", offset: 10, limit: 2 })).result as Any
    check("read: offset and limit give exactly those lines (the API too)", few.text === `Line 10 ${"x".repeat(60)}\nLine 11 ${"x".repeat(60)}\n` && few.lines === 3000 && few.to === 11, few)
    const opErr = async (id: string, params: Any, who = whoOf("mcp", "claude-code")) => { try { await app.runOp(id, params, { who }); return "" } catch (e) { return (e as Error).message } }
    const pageBody = p1.slice(p1.indexOf("\n\n") + 2)
    check("write_file: a page as read is refused (it would drop the rest)", /drop the rest/.test(await opErr("file.write", { path: "Notes/Long read.md", text: pageBody })) && read("Notes/Long read.md") === longText)
    check("write_file: a file longer than one read needs base over MCP", /longer than one read/.test(await opErr("file.write", { path: "Notes/Long read.md", text: "short\n" })) && read("Notes/Long read.md") === longText)
    const page = few.text
    await app.runOp("file.write", { path: "Notes/Long read.md", text: page.replace("Line 10 ", "Line ten "), base: page }, { who: whoOf("mcp", "claude-code") })
    check("write_file: a page written with base changes it and keeps the rest", read("Notes/Long read.md") === longText.replace("Line 10 ", "Line ten "), read("Notes/Long read.md").slice(0, 300))
    await app.runOp("file.edit", { path: "Notes/Long read.md", old: "Line 2999 ", new: "Line two nine nine nine " }, { who: whoOf("mcp", "claude-code") })
    check("edit_file: replaces just that text, the rest kept", read("Notes/Long read.md") === longText.replace("Line 10 ", "Line ten ").replace("Line 2999 ", "Line two nine nine nine "))
    check("edit_file: text found more than once, or not at all, is refused with what to do", /3000 times.*all: true/.test(await opErr("file.edit", { path: "Notes/Long read.md", old: ` ${"x".repeat(60)}`, new: "y" })) &&
      /isn't in/.test(await opErr("file.edit", { path: "Notes/Long read.md", old: "nowhere to be found", new: "y" })))
    await app.runOp("file.edit", { path: "Notes/Long read.md", old: "x".repeat(60), new: "y", all: true })
    check("edit_file: all replaces every one", !read("Notes/Long read.md").includes("xxxx") && read("Notes/Long read.md").split("\n").length === 3001)
    for (let i = 0; i < 25; i++) write(`Paged search/Hit ${String(i).padStart(2, "0")}.md`, `pagedneedle ${"word ".repeat(80)}\n`)
    await vault.synced()
    const s1 = await asMcp("file.search", { query: "pagedneedle", folder: "Paged search", sort: "name" })
    const s2 = await asMcp("file.search", { query: "pagedneedle", folder: "Paged search", sort: "name", offset: 20 })
    check("search: a page says where the next starts; a long line ends in …", /\(more files match: offset 20\)$/.test(s1) && (s1.match(/^- /gm) ?? []).length === 20 && s1.includes("…") &&
      (s2.match(/^- /gm) ?? []).length === 5 && s2.includes("Hit 24") && !s2.includes("more files match"), [s1.slice(-200), s2])
    const l1 = await asMcp("file.list", { folder: "Paged search", limit: 10, offset: 10 })
    check("list: a page with offset, saying what's left", l1.includes("Hit 10") && !l1.includes("Hit 09") && /\(files 11-20 of 25; more: offset 20/.test(l1), l1)
    write("Paged search/Long cell.md", `---\ntype: longcell\nsummary: ${"y".repeat(300)}\n---\n`)
    await vault.synced()
    const q1 = await asMcp("query.run", { type: "longcell", columns: ["file", "summary"] })
    const q2 = await asMcp("query.run", { from: ["Paged search"], columns: ["file"], sort: "file", limit: 10 })
    check("query: a cut cell ends in … and says how to get it whole; a page says the next offset", q1.includes(`${"y".repeat(200)}…`) && q1.includes("read its file") &&
      q2.startsWith("Rows 1-10 of 26 files; more: offset 10."), [q1.slice(-300), q2.slice(0, 80)])
  }
}
