import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, tmp, vault, write } = $
  const { tree } = $.vars
  let code: number
  // /api/render: a file with its blocks filled in as text (for AIs); nothing is written.
  const beforeToday = read("Dashboards/Today.md")
  let txt: Any
  ;[code, txt] = await api("GET", "render?path=Dashboards/Today.md")
  check("render fills a dashboard's blocks in", code === 200 && txt.includes("## Routines") && txt.includes("## This week") && !txt.includes("```block-"), txt.slice(0, 300))
  check("render doesn't touch the file", read("Dashboards/Today.md") === beforeToday)
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
    "```block-area\n```\n\n```block-week-goals\nareas: [workouts]\nwide: true\nstack: true\n```\n\n```block-routines\n- not: options\n```\n\n```block-nope\n```\n")
  txt = (await api("GET", "render?path=Notes/Block options.md"))[1]
  check("render: an unknown option is noted after the block, with the name it's closest to",
    txt.includes("_(week-goals block: unknown option `titel` (did you mean `title`?))_") && txt.includes("## This week"), txt)
  check("render: wrong types and values are noted, the block still drawn",
    txt.includes("_(graph block: `depth` should be one of 1, 2, 3, 4, 5, not 9; `height` should be a number, not \"tall\")_"), txt)
  check("render: a required option left out is noted", txt.includes("_(area block: `area` is required)_"), txt)
  check("render: the options every block takes are fine anywhere", !/week-goals block: .*(wide|stack)/.test(txt), txt)
  check("render: options that aren't a map are noted", txt.includes("_(routines block: its options should be `key: value` lines)_"), txt)
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
    const qb = bl.blocks.find((b: Any) => b.name === "query")
    check("/api/blocks: every app plugin's block, declared, with its options and text side", bc === 200 && qb?.plugin === "query" && qb.declared && qb.text === true
      && qb.options.limit?.type === "number" && typeof qb.description === "string" && bl.common.wide && bl.common.file, qb)
    check("/api/blocks: whether its plugin is on", bl.blocks.find((b: Any) => b.name === "routines")?.on === true, bl.blocks.length)
  }
  // GET /api/blocks/sources: where a block's data comes from, recorded while its text side runs (core/sources.ts).
  {
    write("Notes/Qa sources.md", "---\ntype: note\n---\n\n```block-person\nfile: Alice Park\n```\n\n```block-people-group\n```\n\n" +
      "```block-query\ntype: person\n```\n\n```block-agenda\n```\n")
    const [sc, all] = await api("GET", "blocks/sources?path=Notes/Qa sources.md")
    const by = (n: string) => all.blocks.find((b: Any) => b.name === n)
    const at = (fence: string) => read("Notes/Qa sources.md").split("\n").indexOf(fence)
    const files = (b: Any) => b.sources.filter((x: Any) => x.kind === "file").map((x: Any) => x.path)
    check("sources: every block in the file, each with its fence's line", sc === 200 && all.blocks.length === 4 && by("person").line === at("```block-person") && by("query").line === at("```block-query") && at("```block-query") > 0, all)
    check("sources: a person's profile reads that person's file (its file:), not every person", JSON.stringify(files(by("person"))) === '["People/Alice Park.md"]' &&
      by("person").file === "People/Alice Park.md" && !by("person").sources.some((x: Any) => x.kind === "files"), by("person"))
    const group = by("people-group")
    check("sources: a list names the files it shows", files(group).includes("People/Alice Park.md") && !files(group).includes("Notes/Qa sources.md"), group)
    check("sources: a query's are its matches, not the file it's in", files(by("query")).includes("People/Alice Park.md") && !files(by("query")).includes("Notes/Qa sources.md"), by("query"))
    check("sources: live data is said in the manifest's words", by("agenda").sources.some((x: Any) => x.kind === "live" && /calendars/.test(x.label)), by("agenda"))
    const [c1, one] = await api("GET", "blocks/sources?path=Notes/Qa sources.md&name=query&text=type: person")
    check("sources: one block by its name and options' text", c1 === 200 && one.name === "query" && one.line === at("```block-query") && one.description, one)
    check("sources: a missing file is a 404, a bad name a 400", (await api("GET", "blocks/sources?path=Nope.md"))[0] === 404 &&
      (await api("GET", "blocks/sources?path=Notes/Qa sources.md&name=no%20pe"))[0] === 400)
    check("sources: nothing is traced outside a request for them", (await api("GET", "render?path=Notes/Qa sources.md"))[0] === 200)
  }
  // Tabs: a page's views are files (core/tabs.ts); the index carries tab/tabs and render says which tab this is.
  const people = tree.files.find((x: Any) => x.path === "Dashboards/People.md")
  check("the file index has a page's tabs", people.tab === "List" && JSON.stringify(people.tabs) === '["People map"]', people)
  txt = (await api("GET", "render?path=Dashboards/People map.md"))[1]
  check("render names the tabs, this one in bold", txt.includes("Tabs: [[People|List]] · **Map**"), txt.slice(0, 400))
  {
    const { pageTabs } = await import("../../../core/tabs.ts")
    const files = [{ path: "CLAUDE.md" }, { path: "Personal/Dashboards/Agents.md", tab: "Overview", tabs: ["Claude", "Codex"] }, { path: "Personal/Dashboards/Claude.md" }, { path: "Personal/Dashboards/Codex.md" }]
    check("tabs: a name is found beside its head first (not the vault's CLAUDE.md)", pageTabs(files, "Personal/Dashboards/Agents.md").map((t) => t.path).join() === "Personal/Dashboards/Agents.md,Personal/Dashboards/Claude.md,Personal/Dashboards/Codex.md",
      pageTabs(files, "Personal/Dashboards/Agents.md"))
  }
  // `file:` in a block's options: drawn for another file (a name, or a folder's newest file).
  write("Notes/Showcase.md", "```block-person\nfile: Alice Park\n```\n\n```block-person\nfile: Nobody Here\n```\n")
  txt = (await api("GET", "render?path=Notes/Showcase.md"))[1]
  check("a block's file: draws it for that file", txt.includes("Seattle") && txt.includes("no file Nobody Here"), txt)
  await api("POST", "logs", [{ area: "workouts", date: "2026-09-28", source: "claude", ext_id: "block-gym", title: "Push",
    data: { exercises: [{ name: "Bench Press", sets: [{ type: "normal", weight_kg: 50, reps: 8 }] }] } }])
  const gym = (await api("GET", "state"))[1].logs.find((x: Any) => x.ext_id === "block-gym")
  let t = read(gym.id + ".md")
  check("a new log's kind's blocks are its area's too", !t.includes("```") && JSON.stringify((await api("GET", "files"))[1].files.find((f: Any) => f.path === gym.id + ".md")?.kindBlocks) === JSON.stringify(["log", "workout"]), t)
  check("a workout renders as text", (await api("GET", `render?path=${gym.id}.md`))[1].includes("Bench Press: 50 kg x 8"))
  // Logs knows no areas of its own: with no areas setting, the plugins that draw them bring theirs (the service
  // `log-areas`), and an area set without an icon or colour takes the one its plugin gives.
  {
    let areas = (await api("GET", "state"))[1].areas
    const gymArea = areas.find((a: Any) => a.slug === "workouts")
    check("areas come from the plugins that draw them", gymArea?.tint === "pink" && gymArea.icon === "dumbbell" && gymArea.parent === "health" &&
      ["sleep", "nutrition", "study", "reading"].every((s) => areas.some((a: Any) => a.slug === s)), areas.map((a: Any) => a.slug))
    // An offByDefault plugin's backend (Learning): its service brings nothing until it's in `enabled`.
    const was: string[] = vault.config("plugins").enabled, without = was.filter((id) => id !== "learning")
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: without }) // (a settings change: /api/state is new)
    areas = (await api("GET", "state"))[1].areas
    check("an offByDefault plugin's service is off until it's turned on", !areas.some((a: Any) => a.slug === "study"), areas.map((a: Any) => a.slug))
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: was })
    areas = (await api("GET", "state"))[1].areas
    check("turned on (enabled), it brings its areas", areas.some((a: Any) => a.slug === "study"), areas.map((a: Any) => a.slug))
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: without })
    areas = (await api("GET", "state"))[1].areas
    check("a plugin that's off brings none", !areas.some((a: Any) => a.slug === "study") && areas.some((a: Any) => a.slug === "workouts"), areas.map((a: Any) => a.slug))
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: was, disabled: [] })
    vault.setConfig("plugins/logs/data", { areas: [{ slug: "workouts", name: "Lifting", fields: [{ key: "volume_kg", label: "Volume", type: "number", unit: "kg" }] },
      { slug: "chess", name: "Chess", icon: "trophy", tint: "teal" }] })
    areas = (await api("GET", "state"))[1].areas
    check("the areas setting wins; an area without an icon or colour takes its plugin's", areas.length === 2 && areas[0].name === "Lifting" &&
      areas[0].tint === "pink" && areas[0].icon === "dumbbell" && areas[1].tint === "teal" && areas[1].icon === "trophy", areas)
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    await api("POST", "logs", [{ area: "workouts", date: day, source: "claude", ext_id: "area-total", title: "Legs", data: { volume_kg: 1234.5, place: "Home" } }])
    write("Notes/Area options.md", "```block-area\narea: workouts\nmeta: [place, volume_kg]\ntotal: volume_kg\n```\n")
    txt = (await api("GET", "render?path=Notes/Area options.md"))[1]
    check("area: meta names fields shown on each row (numbers with their unit), total sums one over the week",
      txt.includes("Volume: 1,234.5 kg.") && txt.includes(`${day}: Legs · Home · 1,234.5 kg`), txt)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/logs/data.json"))
  }
}
