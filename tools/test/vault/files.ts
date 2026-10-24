import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, vault, write } = $
  let code: number
  // Plain files: indexed, not parsed
  write("Ideas/Loose thought.md", "Links to [[Hand Made]].\n")
  let [, s] = await api("GET", "state")
  check("a plain file doesn't become a note or a problem", !s.notes.some((n: Any) => n.title === "Loose thought")
    && !s.vault.problems.some((x: Any) => x.file.startsWith("Ideas/")))

  // Files: the editor's API
  let f: Any, f2: Any
  ;[code, f] = await api("POST", "file", { path: "Notes/Untitled.md", text: "", unique: true })
  check("new file", code === 201 && f.path === "Notes/Untitled.md", f)
  ;[code, f2] = await api("POST", "file", { path: "Notes/Untitled.md", text: "", unique: true })
  check("new file with a taken name gets a number, from 1 as in Obsidian", f2.path === "Notes/Untitled 1.md", f2)
  check("a new note stays as it was made (empty)", read("Notes/Untitled.md") === "", read("Notes/Untitled.md"))
  ;[, f] = await api("GET", "file?path=Notes/Untitled.md")
  const base = f.text
  ;[, f] = await api("PUT", "file", { path: "Notes/Untitled.md", text: base + "Line one\nLine two\n", base })
  check("save", read("Notes/Untitled.md").includes("Line one"), f)
  const mineText = f.text
  write("Notes/Untitled.md", mineText.replace("Line two", "Line two (by Claude)"))
  ;[, f] = await api("PUT", "file", { path: "Notes/Untitled.md", text: mineText.replace("Line one", "Line one edited"), base: mineText })
  let t = read("Notes/Untitled.md")
  check("a change on disk meanwhile is merged, not lost", t.includes("Line one edited") && t.includes("(by Claude)"), t)
  const cur = read("Notes/Untitled.md")
  write("Notes/Untitled.md", cur.replace("Line one edited", "Line one by Claude"))
  ;[code, f] = await api("PUT", "file", { path: "Notes/Untitled.md", text: cur.replace("Line one edited", "Line one by me"), base: cur })
  check("the same line changed on both sides is a 409 with the disk text", code === 409 && f.text.includes("by Claude"), [code, f])
  write("Notes/Linker.md", "See [[Untitled]] and [[Untitled|this]] and [[Untitled#Head]]; not [[Untitled 2]].\n")
  let r: Any
  ;[, r] = await api("POST", "file/move", { from: "Notes/Untitled.md", to: "Notes/Renamed.md" })
  t = read("Notes/Linker.md")
  check("rename updates links", t.includes("See [[Renamed]] and [[Renamed|this]] and [[Renamed#Head]]; not [[Untitled 2]].")
    && JSON.stringify(r.updated) === JSON.stringify(["Notes/Linker.md"]), [t, r])
  let tr: Any
  ;[, tr] = await api("GET", "files")
  const seeLine = t.split("\n").find((l) => l.startsWith("See"))
  check("tree lists files, links and folders", tr.files.some((x: Any) => x.path === "Notes/Linker.md" && x.links.includes("Renamed"))
    && tr.folders.includes("Notes"), tr.files.filter((x: Any) => x.path === "Notes/Linker.md"))
  const [, ll] = await api("GET", "file/linked?path=Notes/Renamed.md")
  check("file/linked: each file linking here with the line its link is on", ll.lines["Notes/Linker.md"] === seeLine, ll)
  write("Img/Shot one.png", "png")
  write("Notes/Pics.md", '---\ncover: "[[Shot one.png]]"\n---\n![[Shot one.png]] ![[Shot one.png|300]] [[Img/Shot one.png]] ![a](../Img/Shot%20one.png)\nnot `[[Shot one.png]]`\n```\n![[Shot one.png]]\n```\n')
  ;[, r] = await api("POST", "file/move", { from: "Img/Shot one.png", to: "Img/Words.jpeg" })
  t = read("Notes/Pics.md")
  check("renaming an image updates embeds, path links, Markdown links and frontmatter, not code", t === '---\ncover: "[[Words.jpeg]]"\n---\n![[Words.jpeg]] ![[Words.jpeg|300]] [[Img/Words.jpeg]] ![a](../Img/Words.jpeg)\nnot `[[Shot one.png]]`\n```\n![[Shot one.png]]\n```\n', [t, r])
  await api("POST", "file/move", { from: "Img", to: "Media/Img" })
  t = read("Notes/Pics.md")
  // ([[Img/Words.jpeg]] still finds Media/Img/Words.jpeg: a folder in front of a name narrows it, as in Obsidian)
  check("moving a folder updates Markdown links to its files; names, and paths that still find them, stay", t.includes("![[Words.jpeg]] ![[Words.jpeg|300]] [[Img/Words.jpeg]] ![a](../Media/Img/Words.jpeg)"), t)
  await api("POST", "file/move", { from: "Notes/Pics.md", to: "Pics.md" })
  t = read("Pics.md")
  check("a moved note's relative links still find their files", t.includes("![a](Media/Img/Words.jpeg)"), t)
  write("A/Same.md", "a\n")
  write("B/Thing.md", "b\n")
  write("Notes/Refs.md", "[[Thing]] [Thing](../B/Thing.md)\n")
  await api("POST", "file/move", { from: "B/Thing.md", to: "B/Same.md" })
  t = read("Notes/Refs.md")
  check("a link whose new name another file has gets the path", t === "[[B/Same]] [Thing](../B/Same.md)\n", t)
  write("C/Short one.md", "c\n")
  write("Notes/Shortest.md", "[a](Short%20one.md) [b](Short%20one.md#Top) [c](Short%20one)\n")
  await api("POST", "file/move", { from: "C/Short one.md", to: "C/Short two.md" })
  t = read("Notes/Shortest.md")
  check("renaming updates Markdown links by name alone (Obsidian's shortest path)", t === "[a](Short%20two.md) [b](Short%20two.md#Top) [c](Short%20two)\n", t)
  await api("POST", "file/move", { from: "C/Short two.md", to: "C/Same.md" })
  t = read("Notes/Shortest.md")
  check("a link by name whose new name another file has gets the path", t === "[a](C/Same.md) [b](C/Same.md#Top) [c](C/Same)\n", t)
  write("Notes/Bare.md", "---\nrelated: [[Ref target]]\n---\nNo links here.\n")
  write("Ref target.md", "x\n")
  write("Notes/Others.md", "[[Something else]] and [a](../Elsewhere.md)\n")
  await vault.synced()
  const readFile = fs.readFileSync, seen: string[] = []
  fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...a: Any[]) => { seen.push(String(p)); return readFile(p, ...a) }) as typeof fs.readFileSync
  try { await api("POST", "file/move", { from: "Ref target.md", to: "Ref moved.md" }) } finally { fs.readFileSync = readFile }
  check("a rename reads only the files whose links change (unquoted frontmatter links too)", read("Notes/Bare.md").includes("related: [[Ref moved]]")
    && !seen.some((p) => p.endsWith("Notes/Others.md")), [read("Notes/Bare.md"), seen.filter((p) => p.includes("/Notes/"))])
  await api("POST", "folder", { path: "Projects/Sub" })
  await api("POST", "file/move", { from: "Notes/Renamed.md", to: "Projects/Sub/Renamed.md" })
  check("move into a folder", exists("Projects/Sub/Renamed.md"))
  await api("DELETE", "file?path=Projects/Sub")
  check("delete a folder goes to .trash", !exists("Projects/Sub") && fs.readdirSync(path.join(VAULT, ".trash/Projects")).some((n) => n.startsWith("Sub")))
  ;[, tr] = await api("GET", "files")
  check("its files leave the index", !tr.files.some((x: Any) => x.path.startsWith("Projects/Sub/")))
  vault.setConfig("files", { ...vault.config("files"), showHidden: false }) // a real vault may show hidden files
  for (const bad of ["../x.md", ".vaultite/x.md"]) {
    ;[code] = await api("PUT", "file", { path: bad, text: "x" })
    check(`can't write ${bad}`, code === 400 || code === 403 || (bad.startsWith(".") && code === 404), code)
  }
  // With hidden files off, the app's settings files open by their exact path (the Plugins page), and nothing else hidden.
  vault.setConfig("plugins", { ...vault.config("plugins") })
  let cfg: Any
  ;[code, cfg] = await api("GET", "file?path=.vaultite/plugins.json")
  check("a settings file opens by its path with hidden files off", code === 200 && cfg.text.includes("{"), [code, cfg])
  ;[code] = await api("PUT", "file", { path: ".vaultite/plugins.json", text: cfg.text, base: cfg.text })
  check("and saves", code === 200, code)
  ;[code] = await api("PUT", "file", { path: ".vaultite/plugins.json", text: "{nope", base: cfg.text })
  check("saves as typed, valid JSON or not; the settings read keep the last good copy", code === 200 && read(".vaultite/plugins.json") === "{nope" &&
    JSON.stringify(vault.config("plugins")) === JSON.stringify(JSON.parse(cfg.text)), code)
  ;[code] = await api("PUT", "file", { path: ".vaultite/plugins.json", text: cfg.text, base: "{nope" })
  for (const bad of [".trash/x.md", ".vaultite/.secret/x.json", ".vaultite/x.txt", ".git/config"]) {
    ;[code] = await api("GET", `file?path=${bad}`)
    check(`no ${bad} with hidden files off`, code === 400, code)
  }
  ;[, cfg] = await api("GET", "files")
  check("hidden files aren't listed", !JSON.stringify(cfg).includes(".vaultite/"), null)
  let res: Any
  ;[, res] = await api("GET", "search?q=Linker")
  check("search finds by name", res.length && res[0].path === "Notes/Linker.md", res.slice(0, 2))
}
