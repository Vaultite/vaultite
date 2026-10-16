import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, tmp, vault, write } = $
  let code: number
  // /api/render: a file with its blocks filled in as text (for AIs); nothing is written.
  const before = read("Dashboards/People.md")
  let txt: Any
  ;[code, txt] = await api("GET", "render?path=Dashboards/People.md")
  check("render fills a dashboard's blocks in", code === 200 && txt.includes("## Reach out") && txt.includes("## Friends") && !txt.includes("```block-"), txt.slice(0, 300))
  check("render doesn't touch the file", read("Dashboards/People.md") === before)
  check("render of a person file", (await api("GET", "render?path=People/Block Person.md"))[1].includes("Last in touch"))
  // Markdown's extras (callouts, footnotes, math, mermaid, code fences, <details>) are plain Markdown: render passes it through.
  {
    const rich = "> [!tip]- Title\n> Body [^1]\n\n$$\nx^2\n$$\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nconst a = 1\n```\n\n<details>\n<summary>More</summary>\n\nInside\n\n</details>\n\n[^1]: A note, $y$.\n"
    write("Notes/Rich markdown.md", rich)
    const [c2, out] = await api("GET", "render?path=Notes/Rich markdown.md")
    check("render keeps Markdown's extras as they are", c2 === 200 && out.includes(rich.trim()), out)
  }
  // Embeds and blocks written inside a code fence are code: shown as they are, not drawn (a ```` fence can hold a ``` one).
  {
    const shown = "```\n![[Rich markdown]]\n```\n\n````md\n```block-books\n```\n````\n"
    write("Notes/Fenced embed.md", shown + "\n![[Rich markdown]]\n")
    const [c3, out] = await api("GET", "render?path=Notes/Fenced embed.md")
    check("render leaves embeds and blocks in code fences alone", c3 === 200 && out.includes(shown) && out.includes("> [[Rich markdown]]"), out)
  }
  check("render of a missing file is a 404", (await api("GET", "render?path=Nope.md"))[0] === 404)
  // The block contract (core/blocks.ts): options checked against the manifests' declarations, noted after the block's text.
  write("Notes/Block options.md", "```block-week-goals\ntitel: Mine\n```\n\n```block-graph\ndepth: 9\nheight: tall\n```\n\n" +
    "```block-area\n```\n\n```block-week-goals\nareas: [workouts]\nwide: true\nstack: true\n```\n\n```block-people-due\n- not: options\n```\n\n```block-nope\n```\n")
  txt = (await api("GET", "render?path=Notes/Block options.md"))[1]
  check("render: an unknown option is noted after the block, with the name it's closest to",
    txt.includes("_(week-goals block: unknown option `titel` (did you mean `title`?))_") && txt.includes("## This week"), txt)
  check("render: wrong types and values are noted, the block still drawn",
    txt.includes("_(graph block: `depth` should be one of 1, 2, 3, 4, 5, not 9; `height` should be a number, not \"tall\")_"), txt)
  check("render: a required option left out is noted", txt.includes("_(area block: `area` is required)_"), txt)
  check("render: the options every block takes are fine anywhere", !/week-goals block: .*(wide|stack)/.test(txt), txt)
  check("render: options that aren't a map are noted", txt.includes("_(people-due block: its options should be `key: value` lines)_"), txt)
  check("render: a block no plugin draws says so", txt.includes("_(no plugin draws block-nope)_") && !txt.includes("```block-nope"), txt)
  {
    // A declared block whose plugin has no text side reads as its declaration's description.
    const { blockText } = await import("../../../core/render.ts")
    const { Plugin } = await import("../../../core/plugins.ts")
    const dir = path.join(tmp, "fake-plugin")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "fake", name: "Fake", description: "Made up",
      blocks: { fake: { description: "a made-up card", options: { size: { type: "number", default: 3, description: "how big" } } } } }))
    const fake = new Plugin(path.join(dir, "manifest.json"))
    fake.vault = vault
    const t = await blockText(vault, [fake], "", {}, "", "fake", "size: big")
    check("render: a block with no text side reads as its description, its options still checked",
      t === "_(Fake: a made-up card; drawn in the app only)_\n\n_(fake block: `size` should be a number, not \"big\")_", t)
    let seen: unknown = null
    fake.block("fake", (ctx) => { seen = ctx.options; return "Drawn" })
    check("render: a block's text gets the declared defaults", await blockText(vault, [fake], "", {}, "", "fake", "") === "Drawn" && (seen as Any)?.size === 3, seen)
  }
  // GET /api/blocks: every block, its plugin, on or off, its options.
  {
    const [bc, bl] = await api("GET", "blocks")
    const qb = bl.blocks.find((b: Any) => b.name === "activity")
    check("/api/blocks: every app plugin's block, declared, with its options and text side", bc === 200 && qb?.plugin === "activity" && qb.declared && qb.text === true
      && qb.options.limit?.type === "number" && typeof qb.description === "string" && bl.common.wide && bl.common.file, qb)
    check("/api/blocks: whether its plugin is on", bl.blocks.find((b: Any) => b.name === "people-due")?.on === true, bl.blocks.length)
  }
  // GET /api/blocks/sources: where a block's data comes from, recorded while its text side runs (core/sources.ts).
  {
    write("Notes/Qa sources.md", "---\ntype: note\n---\n\n```block-person\nfile: Alice Park\n```\n\n```block-people-group\n```\n\n" +
      "```block-graph\ndepth: 2\n```\n\n```block-agenda\n```\n")
    const [sc, all] = await api("GET", "blocks/sources?path=Notes/Qa sources.md")
    const by = (n: string) => all.blocks.find((b: Any) => b.name === n)
    const at = (fence: string) => read("Notes/Qa sources.md").split("\n").indexOf(fence)
    const files = (b: Any) => b.sources.filter((x: Any) => x.kind === "file").map((x: Any) => x.path)
    check("sources: every block in the file, each with its fence's line", sc === 200 && all.blocks.length === 4 && by("person").line === at("```block-person") && by("graph").line === at("```block-graph") && at("```block-graph") > 0, all)
    check("sources: a person's profile reads that person's file (its file:), not every person", JSON.stringify(files(by("person"))) === '["People/Alice Park.md"]' &&
      by("person").file === "People/Alice Park.md" && !by("person").sources.some((x: Any) => x.kind === "files"), by("person"))
    const group = by("people-group")
    check("sources: a list names the files it shows", files(group).includes("People/Alice Park.md") && !files(group).includes("Notes/Qa sources.md"), group)
    check("sources: live data is said in the manifest's words", by("agenda").sources.some((x: Any) => x.kind === "live" && /calendars/.test(x.label)), by("agenda"))
    const [c1, one] = await api("GET", "blocks/sources?path=Notes/Qa sources.md&name=graph&text=depth: 2")
    check("sources: one block by its name and options' text", c1 === 200 && one.name === "graph" && one.line === at("```block-graph") && one.description, one)
    check("sources: a missing file is a 404, a bad name a 400", (await api("GET", "blocks/sources?path=Nope.md"))[0] === 404 &&
      (await api("GET", "blocks/sources?path=Notes/Qa sources.md&name=no%20pe"))[0] === 400)
    check("sources: nothing is traced outside a request for them", (await api("GET", "render?path=Notes/Qa sources.md"))[0] === 200)
  }
  // `tabs:` without Page tabs (a plugin of Vaultite's own, installed): plain frontmatter, no strip, nothing under the title.
  write("Notes/Tabs/Head.md", "---\ntab: List\ntabs: [Other]\n---\n\nThe head.\n")
  write("Notes/Tabs/Other.md", "---\ntab: Map\n---\n\nThe other.\n")
  {
    const [, st] = await api("GET", "state")
    check("tabs: without Page tabs, no groups in the state", !("pageTabs" in st), Object.keys(st))
    const [c, t] = await api("GET", "render?path=Notes/Tabs/Head.md")
    check("tabs: without Page tabs, render shows the page as it is", c === 200 && t.includes("# Head\n\nThe head.") && !t.includes("Tabs:"), t)
  }
  fs.rmSync(path.join(VAULT, "Notes/Tabs"), { recursive: true })
  // `file:` in a block's options: drawn for another file (a name, or a folder's newest file).
  write("Notes/Showcase.md", "```block-person\nfile: Alice Park\n```\n\n```block-person\nfile: Nobody Here\n```\n")
  txt = (await api("GET", "render?path=Notes/Showcase.md"))[1]
  check("a block's file: draws it for that file", txt.includes("Seattle") && txt.includes("no file Nobody Here"), txt)
  // Logs knows no areas of its own: with no areas setting, the plugins that draw them bring theirs (the service
  // `log-areas`: the made-up Regatta here), and an area set without an icon or colour takes the one its plugin gives.
  {
    write(".vaultite/plugins/regatta/manifest.json", JSON.stringify({ id: "regatta", name: "Regatta", description: "Made up: sailing logs.", version: "1.0.0", disclosures: {} }))
    write(".vaultite/plugins/regatta/plugin.ts", 'import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\n' +
      'plugin.provide("log-areas", () => [{ slug: "water", name: "Water", icon: "waves", tint: "blue" }, { slug: "sailing", name: "Sailing", icon: "sailboat", tint: "teal",\n' +
      '  parent: "water", blocks: ["race"], fields: [{ key: "distance_nm", label: "Distance", type: "number", unit: "nm" }] }])\n')
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/logs/data.json"), { force: true }) // (the areas logs above added)
    const was: string[] = vault.config("plugins").enabled, without = was.filter((id) => id !== "regatta")
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: [...was, "regatta"] })
    await $.app.syncPlugins()
    const hash = ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "regatta")?.hash
    await api("POST", "ops/plugin.allow", { id: "regatta", hash })
    let areas = (await api("GET", "state"))[1].areas
    const sail = areas.find((a: Any) => a.slug === "sailing")
    check("areas come from the plugins that draw them", sail?.tint === "teal" && sail.icon === "sailboat" && sail.parent === "water" && areas.some((a: Any) => a.slug === "water"),
      areas.map((a: Any) => a.slug))
    await api("POST", "logs", [{ area: "sailing", date: "2026-09-28", source: "claude", ext_id: "block-sail", title: "Around the bay", data: { distance_nm: 12 } }])
    const sailed = (await api("GET", "state"))[1].logs.find((x: Any) => x.ext_id === "block-sail")
    check("a new log's fences are its area's blocks too", read(sailed.id + ".md").includes("```block-log\n```\n\n```block-race\n```"), read(sailed.id + ".md"))
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: without }) // (a settings change: /api/state is new)
    areas = (await api("GET", "state"))[1].areas
    check("a plugin's service is off until it's turned on: it brings no areas", !areas.some((a: Any) => a.slug === "sailing"), areas.map((a: Any) => a.slug))
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: [...without, "regatta"] })
    areas = (await api("GET", "state"))[1].areas
    check("turned on (enabled), it brings its areas", areas.some((a: Any) => a.slug === "sailing"), areas.map((a: Any) => a.slug))
    vault.setConfig("plugins/logs/data", { areas: [{ slug: "sailing", name: "Racing", fields: [{ key: "distance_nm", label: "Distance", type: "number", unit: "nm" }] },
      { slug: "chess", name: "Chess", icon: "trophy", tint: "pink" }] })
    areas = (await api("GET", "state"))[1].areas
    check("the areas setting wins; an area without an icon or colour takes its plugin's", areas.length === 2 && areas[0].name === "Racing" &&
      areas[0].tint === "teal" && areas[0].icon === "sailboat" && areas[1].tint === "pink" && areas[1].icon === "trophy", areas)
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    await api("POST", "logs", [{ area: "sailing", date: day, source: "claude", ext_id: "area-total", title: "Out to the point", data: { distance_nm: 1234.5, place: "Bay" } }])
    write("Notes/Area options.md", "```block-area\narea: sailing\nmeta: [place, distance_nm]\ntotal: distance_nm\n```\n")
    txt = (await api("GET", "render?path=Notes/Area options.md"))[1]
    check("area: meta names fields shown on each row (numbers with their unit), total sums one over the week",
      txt.includes("Distance: 1,234.5 nm.") && txt.includes(`${day}: Out to the point · Bay · 1,234.5 nm`), txt)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/logs/data.json"))
    // tidy up
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: without })
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/regatta"), { recursive: true })
    $.app.vaultPlugins.trust.forget("regatta")
    await $.app.syncPlugins()
  }
}
