import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, write } = $
  // Every file opens (core/filetypes.ts): code and any text in the editor, the rest in viewers. Only text is written.
  const { kindOf } = await import("../../../core/filetypes.ts")
  check("kinds by name", kindOf("a/b.py") === "code" && kindOf("x.IPYNB") === "notebook" && kindOf("s.pdf") === "pdf" && kindOf("w.xlsx") === "binary" &&
    kindOf("Makefile") === "code" && kindOf(".gitignore") === "code" && kindOf(".env.local") === "code" && kindOf("n.md") === "markdown" &&
    kindOf("odd.qqq") === "other", [kindOf("a/b.py"), kindOf(".env.local"), kindOf("odd.qqq")])
  {
    // Opening a file in its app (the desktop app, Open in default app): what would run is shown in its folder, by its name
    // and by what it links to.
    const { runsCode } = await import("../../../core/opening.ts")
    fs.mkdirSync(path.join(VAULT, "Open"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "Open/x.terminal"), "<plist/>")
    fs.writeFileSync(path.join(VAULT, "Open/Real.pdf"), "%PDF-1.4\n")
    fs.symlinkSync("x.terminal", path.join(VAULT, "Open/Report.pdf"))
    check("opening: a link named like a document to what would run is shown, not opened", runsCode(path.join(VAULT, "Open/Report.pdf")) && runsCode(path.join(VAULT, "Open/x.terminal")) &&
      !runsCode(path.join(VAULT, "Open/Real.pdf")) && ["a.chm", "b.jnlp", "c.iso", "d.xll", "e.mobileconfig", "f.pyz"].every((n) => runsCode(path.join(VAULT, "Open", n))))
    fs.rmSync(path.join(VAULT, "Open"), { recursive: true })
  }
  write("Code/clean.py", "import csv\n\n\ndef total(rows):\n    return sum(r['amount'] for r in rows)\n")
  write("Code/win.txt", "one\r\ntwo\r\n")
  write("Code/notes.qqq", "plain text with an odd name\n")
  fs.writeFileSync(path.join(VAULT, "Code/data.bin"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0x14, 0, 0xff, 0xfe]))
  fs.writeFileSync(path.join(VAULT, "Code/huge.log"), Buffer.alloc(16 << 20, 0x61))
  write("Code/analysis.ipynb", JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# Totals"] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }))
  write("Code/statement.pdf", "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n%%EOF\n")
  write("Code/node_modules/dep/index.js", "module.exports = 1\n")
  write("Code/__pycache__/clean.cpython-312.pyc", "x")
  let [, s] = await api("GET", "files")
  const listed = (p: string) => s.others.some((f: Any) => f.path === p)
  check("every file is listed", ["Code/clean.py", "Code/win.txt", "Code/data.bin", "Code/statement.pdf", "Code/analysis.ipynb"].every(listed), s.others.map((f: Any) => f.path))
  check("package and compiled caches aren't", !listed("Code/node_modules/dep/index.js") && !s.folders.includes("Code/node_modules") && !s.folders.includes("Code/__pycache__"), s.folders)
  let [code, out] = await api("GET", "file?path=Code/clean.py")
  check("a code file reads as text", code === 200 && out.text.startsWith("import csv") && out.size > 0, out)
  const py = out.text
  write("Code/clean.py", py.replace("import csv", "import csv\nimport json")) // someone else changes it meanwhile
  ;[code, out] = await api("PUT", "file", { path: "Code/clean.py", text: py + "\nprint(total([]))\n", base: py })
  check("a code file saves, merged with a change on disk", code === 200 && read("Code/clean.py").includes("import json") && read("Code/clean.py").endsWith("print(total([]))\n"), out)
  ;[code, out] = await api("GET", "file?path=Code/win.txt")
  ;[code] = await api("PUT", "file", { path: "Code/win.txt", text: out.text + "three\n", base: out.text })
  check("Windows line endings stay", code === 200 && read("Code/win.txt") === "one\r\ntwo\r\nthree\r\n", read("Code/win.txt"))
  ;[code, out] = await api("GET", "file?path=Code/notes.qqq")
  check("an unknown file that is text opens as text", code === 200 && out.text.startsWith("plain"), code)
  ;[code] = await api("PUT", "file", { path: "Code/notes.qqq", text: "changed\n", base: out.text })
  check("and can be written", code === 200 && read("Code/notes.qqq") === "changed\n", code)
  ;[code] = await api("GET", "file?path=Code/data.bin")
  check("a binary file isn't text (415)", code === 415, code)
  ;[code] = await api("PUT", "file", { path: "Code/data.bin", text: "oops", base: null })
  check("and can't be written as text", code === 400 && fs.readFileSync(path.join(VAULT, "Code/data.bin"))[0] === 0x50, code)
  ;[code, out] = await api("GET", "file?path=Code/huge.log")
  check("a huge file reads as text, at any size", code === 200 && out.text.length === 16 << 20, [code, out?.text?.length])
  {
    // A big file's save: its base's fingerprint, not the base; the base only when the file changed on disk.
    const { textHash } = await import("../../../core/texthash.ts")
    const huge = out.text, mine = huge + "\nmine\n"
    ;[code, out] = await api("PUT", "file", { path: "Code/huge.log", text: mine, baseHash: textHash(huge), lean: true })
    check("a big file saves with its base's fingerprint, its text not sent back", code === 200 && out.same === true && out.text === undefined && read("Code/huge.log") === mine, [code, out?.same])
    write("Code/huge.log", "theirs\n" + mine) // someone else changes it meanwhile
    ;[code] = await api("PUT", "file", { path: "Code/huge.log", text: mine + "more\n", baseHash: textHash(mine), lean: true })
    check("changed on disk meanwhile: asked for the base (412), nothing written", code === 412 && read("Code/huge.log") === "theirs\n" + mine, code)
    ;[code, out] = await api("PUT", "file", { path: "Code/huge.log", text: mine + "more\n", base: mine, lean: true })
    check("and with it, merged", code === 200 && read("Code/huge.log") === "theirs\n" + mine + "more\n" && out.text === read("Code/huge.log"), code)
  }
  ;{
    const was = read("Code/analysis.ipynb")
    ;[code] = await api("PUT", "file", { path: "Code/analysis.ipynb", text: "{ not json", base: was })
    check("a notebook saves as typed, even half-edited", code === 200 && read("Code/analysis.ipynb") === "{ not json", code)
    await api("PUT", "file", { path: "Code/analysis.ipynb", text: was, base: "{ not json" })
  }
  ;[code] = await api("POST", "file", { path: "Code/new.py", text: "x = 1\n" })
  check("a new code file", code === 201 && read("Code/new.py") === "x = 1\n", code)
  ;[code, out] = await api("GET", "file/info?path=Code/statement.pdf")
  check("info: a PDF's pages and size", code === 200 && out.pages === 3 && out.kind === "pdf" && out.size > 0, out)
  ;[code, out] = await api("GET", "file/info?path=Code/data.bin")
  check("info: any file", code === 200 && out.kind === "other" && out.size === 10 && out.pages === undefined, out)
  ;[, out] = await api("GET", "search?q=total rows")
  check("search finds words in code files", out.some((r: Any) => r.path === "Code/clean.py" && r.title === "clean.py" && r.context.includes("def total")), out)
  ;[, out] = await api("GET", "search?q=module.exports")
  check("but not in caches", !out.length, out)
  // Every file is searched whole, at any size and of any kind that's text.
  write("Code/big.log", "x".repeat(300 << 10) + "\nneedle at the end\n")
  write("Code/notes.weird", "a text file of no known kind: haystack\n")
  fs.writeFileSync(path.join(VAULT, "Code/blob.weird"), Buffer.from([1, 0, 2, 3]))
  ;[, out] = await api("GET", "search?q=needle&lines=5")
  check("search: a big text file, to its end", out.some((r: Any) => r.path === "Code/big.log" && r.matches?.[0]?.line === 2), out)
  ;[, out] = await api("GET", "search?q=haystack")
  check("search: a text file of a kind it doesn't know", out.some((r: Any) => r.path === "Code/notes.weird"), out)
  write("Code/drawing.excalidraw", JSON.stringify({ title: "Pier sketch", image: `data:image/png;base64,${"QUJD".repeat(500)}xyzzy` }))
  ;[, out] = await api("GET", "search?q=xyzzy")
  check("search: not inside an embedded file's base64 (a drawing's pasted image)", !out.some((r: Any) => r.path === "Code/drawing.excalidraw"), out)
  ;[, out] = await api("GET", "search?q=Pier sketch")
  check("search: but the rest of that file", out.some((r: Any) => r.path === "Code/drawing.excalidraw"), out)
  // Data isn't read (a folder of 25k exported records made a first search take seconds); documents in JSON are.
  write("Code/export.json", JSON.stringify({ name: "Quillwort record" }))
  write("Code/records.jsonl", `${JSON.stringify({ name: "Quillwort line" })}\n`)
  write("Code/board.canvas", JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Quillwort card" }], edges: [] }))
  write("Code/table.csv", "plant,where\nQuillwort,pond\n")
  ;[, out] = await api("GET", "search?q=Quillwort")
  check("search: not in plain JSON data", !out.some((r: Any) => r.path === "Code/export.json" || r.path === "Code/records.jsonl"), out)
  check("search: but canvases and tables", out.some((r: Any) => r.path === "Code/board.canvas") && out.some((r: Any) => r.path === "Code/table.csv"), out)
  ;[code] = await api("POST", "file/move", { from: "Code/clean.py", to: "Code/tidy.py" })
  check("a code file renames", code === 200 && exists("Code/tidy.py") && !exists("Code/clean.py"), code)
  ;[code] = await api("DELETE", "file?path=Code/tidy.py")
  check("and goes to the trash", code === 200 && !exists("Code/tidy.py") && fs.readdirSync(path.join(VAULT, ".trash/Code")).some((n) => n.startsWith("tidy ")), code)
}
