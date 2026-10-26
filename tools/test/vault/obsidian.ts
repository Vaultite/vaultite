import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, tmp, write } = $
  const { same } = $.vars
  // ---------- Obsidian vaults: embeds, heading and block links, tags, comments, .obsidian settings ----------
  write("Obs/Obs A.md", "---\ntags: [compat]\n---\n# Top\n\nIntro with #obs/inline and `#notatag` %%a secret%% ^intro\n\n## Plans\n\n- first ^li1\n  - under it\n- second\n\n%%\nhidden lines\n%%\n\n## After\n\nEnd.\n")
  write("Obs/Obs B.md", "See [[Obs A#Plans]] and [[Obs A#^intro]], [md](Obs%20A.md#Top), [[#Mine]].\n\n## Mine\n\n![[Obs A#Plans]]\n\n![[Obs A#^intro]]\n\n![[Obs B]]\n\n![[Obs A#Nowhere]]\n\n![[photo.png]]\n")
  write("Obs/Obs C.md", "![[Obs D]]\n")
  write("Obs/Obs D.md", "D says hi.\n\n![[Obs C]]\n")
  let [, obsFiles] = await api("GET", "files")
  const obsB = obsFiles.files.find((f: Any) => f.path === "Obs/Obs B.md")
  check("obsidian: [[Note#Heading]], [[Note#^id]], Markdown links and embeds all link the note", obsB.links.filter((t: string) => t === "Obs/Obs A" || t === "Obs A").length >= 5, obsB.links)
  const obsA = obsFiles.files.find((f: Any) => f.path === "Obs/Obs A.md")
  check("obsidian: a file's tags are its frontmatter's and its inline #tags (not in code or comments)", same(obsA.tags, ["compat", "obs/inline"]), obsA.tags)
  let [, obsR] = await api("GET", "render?path=Obs/Obs B.md")
  check("obsidian: render inlines an embedded section under its link", obsR.includes("> [[Obs A#Plans]]") && obsR.includes(">\n> ## Plans") && obsR.includes("> - first\n>   - under it") && !obsR.includes("## After"), obsR)
  check("obsidian: render inlines an embedded block, its id and comments taken out", obsR.includes("> Intro with #obs/inline and `#notatag`") && !obsR.includes("a secret") && !obsR.includes(" ^intro") && !obsR.includes("hidden lines") && !obsR.includes("> - second\n>\n"), obsR)
  check("obsidian: a note embedding itself, a missing heading and an image are left as they are or said", obsR.includes("[[Obs B]] embeds itself") && obsR.includes("no heading Nowhere in [[Obs A]]") && obsR.includes("![[photo.png]]"), obsR)
  ;[, obsR] = await api("GET", "render?path=Obs/Obs C.md")
  check("obsidian: embeds that embed each other stop", obsR.includes("D says hi.") && obsR.includes("[[Obs C]] embeds itself"), obsR)
  const tagQ = await api("POST", "query", { options: { tags: ["obs"], columns: ["file", "tags"] } })
  check("obsidian: database views match inline #tags, nested ones for their parents", tagQ[0] === 200 && tagQ[1].total === 1 && tagQ[1].groups[0].rows[0].path === "Obs/Obs A.md", tagQ)
  const tagQ2 = await api("POST", "query", { options: { where: "tags contains obs/inline" } })
  check("obsidian: `tags contains` sees inline tags", tagQ2[1].total === 1, tagQ2[1])
  const [, tagList] = await api("GET", "tags")
  check("obsidian: /api/tags counts tags and their parents", tagList.some((t: Any) => t.tag === "obs" && t.count === 1) && tagList.some((t: Any) => t.tag === "obs/inline"), tagList)
  const [, tagFiles] = await api("GET", "tags?tag=obs")
  check("obsidian: /api/tags?tag= lists its files", same(tagFiles.map((f: Any) => f.path), ["Obs/Obs A.md"]), tagFiles)
  {
    // Renaming a tag: frontmatter (a list or text, as written; merged once) and #tags, nested ones too; not in code or links.
    write("Tagged/Rename A.md", "---\ntags: [project, other]\n---\n#project/lighthouse and `#project` in code, [[#project]] and #projector.\n")
    write("Tagged/Rename B.md", "---\ntags: project, work\n---\nPlain #Project here.\n")
    await app.vault.sync()
    const [rc, ro] = await api("POST", "ops/tag.rename", { from: "#project", to: "work" })
    await app.vault.sync()
    check("tag rename: every file with it, nested tags too, only the tags' own text", rc === 200 && ro.changed.length === 2 &&
      read("Tagged/Rename A.md") === "---\ntags: [work, other]\n---\n#work/lighthouse and `#project` in code, [[#project]] and #projector.\n", read("Tagged/Rename A.md"))
    check("tag rename: into one that's there, merged, text kept text", read("Tagged/Rename B.md") === "---\ntags: work\n---\nPlain #work here.\n", read("Tagged/Rename B.md"))
    // plugin.editLine: one line, refused when it changed since it was read.
    const tp = app.plugins.find((p) => p.id === "tags")!
    write("Tagged/Lines.md", "---\r\na: 1\r\n---\r\n- [ ] one\r\n- [ ] two\r\n")
    tp.editLine("Tagged/Lines.md", 3, "- [ ] one", ["- [x] one", "- [ ] one again"])
    let stale = 0
    try { tp.editLine("Tagged/Lines.md", 3, "- [ ] one", null) } catch (e) { stale = (e as Any).status }
    check("plugin.editLine: a small edit of one line, 409 once it changed", read("Tagged/Lines.md") === "---\r\na: 1\r\n---\r\n- [x] one\r\n- [ ] one again\r\n- [ ] two\r\n" && stale === 409, [read("Tagged/Lines.md"), stale])
    const [bc] = await api("POST", "ops/tag.rename", { from: "work", to: "123" })
    check("tag rename: a name that isn't a tag is refused", bc === 400 || bc === 422, bc)
    await $.removeFolder("Tagged")
  }
  let [, s] = await api("GET", "state")
  const hadObsidian = s.obsidian
  write(".obsidian/app.json", JSON.stringify({ newFileLocation: "folder", newFileFolderPath: "Inbox/", attachmentFolderPath: "./assets", useMarkdownLinks: true, theme: "moonstone" }))
  ;[, s] = await api("GET", "state")
  check("obsidian: .obsidian/app.json's settings that apply are in the state", same(s.obsidian, { newFileLocation: "folder", newFileFolderPath: "Inbox", attachmentFolderPath: "./assets", useMarkdownLinks: true }) && hadObsidian === null, [hadObsidian, s.obsidian])
  write(".obsidian/app.json", JSON.stringify({ spellcheck: false, useTab: false, tabSize: 2, autoPairBrackets: false, readableLineLength: false, propertiesInDocument: "source", autoPairMarkdown: "yes", strictLineBreaks: true }))
  ;[, s] = await api("GET", "state")
  check("obsidian: its editor settings are in the state (only well-formed ones)", same(s.obsidian, { spellcheck: false, useTab: false, autoPairBrackets: false, readableLineLength: false, tabSize: 2, propertiesInDocument: "source" }), s.obsidian)
  {
    const [c] = await api("POST", "ops/settings.set", { name: "editor", values: { useTab: true } })
    ;[, s] = await api("GET", "state")
    check("editor.json: a settings file of the app, in the state as written", c === 200 && same(s.config.editor, { useTab: true }), [c, s.config.editor])
    fs.rmSync(path.join(VAULT, ".vaultite/editor.json"), { force: true })
  }
  write(".obsidian/app.json", "{}")
  ;[, s] = await api("GET", "state")
  check("obsidian: an empty app.json changes nothing", same(s.obsidian, {}), s.obsidian)
  {
    // Its look: themes and snippets listed from .obsidian/ too, appearance.json the defaults of the app's, never written.
    const own = path.join(VAULT, ".vaultite/appearance.json"), had = fs.existsSync(own) ? read(".vaultite/appearance.json") : null
    fs.rmSync(own, { force: true })
    write(".obsidian/themes/Obs Theme/manifest.json", JSON.stringify({ name: "Obs Theme", author: "Someone", version: "1.0.0" }))
    write(".obsidian/themes/Obs Theme/theme.css", ".theme-dark { --background-primary: #101010; --text-normal: #eeeeee; }\n.theme-light { --background-primary: #fafafa; --text-normal: #111111; }\n")
    write(".obsidian/snippets/obs-wide.css", ".markdown-preview-view { max-width: none; }\n")
    write(".obsidian/appearance.json", JSON.stringify({ theme: "obsidian", cssTheme: "Obs Theme", enabledCssSnippets: ["obs-wide", "gone"], textFontFamily: "iA Writer Quattro", accentColor: "#ff0000" }))
    ;[, s] = await api("GET", "state")
    check("obsidian: its themes and snippets are listed", s.appearance.themes.some((t: Any) => t.name === "Obs Theme" && !t.problem) && s.appearance.snippets.some((x: Any) => x.name === "obs-wide" && x.path === ".obsidian/snippets/obs-wide.css"), s.appearance)
    check("obsidian: appearance.json's look is the default of the app's (snippets that are there)", same(s.settingDefaults.appearance, { theme: "dark", scheme: "theme:Obs Theme", snippets: ["obs-wide"], textFont: "iA Writer Quattro" }), s.settingDefaults.appearance)
    const [tc, css] = await api("GET", "themes/Obs Theme.css")
    const [sc] = await api("GET", "snippets/obs-wide.css")
    check("obsidian: its theme converts and its snippet serves", tc === 200 && String(css).includes("#101010") && sc === 200, [tc, sc])
    const [, look] = await api("POST", "ops/appearance.set", { key: "scheme" })
    const [setC] = await api("POST", "ops/appearance.set", { key: "snippets", value: "obs-wide" })
    check("obsidian: vau appearance shows its look and takes its snippets", look.value === "theme:Obs Theme" && setC === 200, [look, setC])
    check("obsidian: nothing is written to .obsidian/", same(JSON.parse(read(".obsidian/appearance.json")).enabledCssSnippets, ["obs-wide", "gone"]))
    fs.rmSync(path.join(VAULT, ".obsidian/themes"), { recursive: true })
    fs.rmSync(path.join(VAULT, ".obsidian/snippets"), { recursive: true })
    fs.rmSync(path.join(VAULT, ".obsidian/appearance.json"))
    if (had === null) fs.rmSync(own, { force: true })
    else fs.writeFileSync(own, had)
  }
  {
    // Its plugins: what stands in for each here (manifests' `replaces`), from the app's and the directory's.
    write(".obsidian/community-plugins.json", JSON.stringify(["recent-files-obsidian", "obsidian-made-up", "made-up-elsewhere"]))
    write(".obsidian/plugins/recent-files-obsidian/manifest.json", JSON.stringify({ id: "recent-files-obsidian", name: "Recent Files" }))
    const INDEX = path.join(tmp, "obsidian-index.json")
    fs.writeFileSync(INDEX, JSON.stringify({ plugins: [{ id: "harbor", name: "Harbor", repo: "alicepark/plugins", dir: "harbor", version: "1.0.0", replaces: { obsidian: ["made-up-elsewhere"] } }] }))
    process.env.VAULTITE_PLUGIN_INDEX = INDEX
    const [oc, rows] = await api("POST", "ops/other-apps.plugins", {})
    const by = (id: string) => (rows as Any[]).find((r) => r.id === id)
    check("obsidian plugins: each with the app's plugin that stands in for it, on or off", oc === 200 && by("recent-files-obsidian").name === "Recent Files" &&
      by("recent-files-obsidian").here[0]?.id === "recent" && by("obsidian-made-up").here.length === 0 && by("obsidian-made-up").directory.length === 0, rows)
    check("obsidian plugins: or the directory's, to install by its source", by("made-up-elsewhere").directory[0]?.source === "alicepark/plugins/harbor", by("made-up-elsewhere"))
    delete process.env.VAULTITE_PLUGIN_INDEX
    fs.rmSync(path.join(VAULT, ".obsidian/community-plugins.json"))
    fs.rmSync(path.join(VAULT, ".obsidian/plugins"), { recursive: true })
    fs.rmSync(path.join(VAULT, ".vaultite/cache/plugin-index.json"), { force: true })
    const meta = await import("../../../core/rules.ts")
    check("replaces: a manifest's is other apps' plugins by app", meta.metaProblems({ replaces: ["dataview"] }).length === 1 && !meta.metaProblems({ replaces: { obsidian: ["dataview"] } }).length)
  }
}
