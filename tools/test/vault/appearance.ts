import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, exists, read, write } = $
  // Appearance: Obsidian themes as colour schemes, CSS snippets, appearance.json keys kept
  write(".vaultite/themes/Harbor/manifest.json", JSON.stringify({ name: "Harbor", version: "1.0.0", author: "Bob Lee" }))
  write(".vaultite/themes/Harbor/theme.css", `/* @settings
name: Harbor
id: harbor
settings:
  -
    id: harbor-accent
    type: class-select
    default: harbor-teal
*/
body { --accent-h: 200; --harbor-ink: 20, 30, 40; }
.theme-light { --background-primary: #fdfdfd; --background-secondary: #eeeeee; --text-normal: rgb(var(--harbor-ink)); --color-red: #c00; }
.theme-dark, .theme-dark.harbor-teal { --background-primary: #101820; --text-normal: #e0e0e0; }
.theme-dark.harbor-teal { --interactive-accent: #20b2aa; }
.theme-dark.harbor-plum { --interactive-accent: #8e4585; }
.theme-dark .markdown-preview-view { --background-primary: #ff00ff; }
@media (max-width: 400px) { body { --background-primary: #00ff00; } }
.theme-light { --h1-color: inherit; --h2-color: var(--color-red); }
`)
  {
    const [s1, themes] = await api("GET", "themes")
    const harbor = themes.find((t: Any) => t.name === "Harbor")
    check("themes: listed with their manifest", s1 === 200 && harbor?.author === "Bob Lee" && harbor.modes.length === 2, themes)
    const [s2, css] = await api("GET", "themes/Harbor.css")
    const light = String(css).split(".dark {")[0], dark = String(css).split(".dark {")[1] ?? ""
    check("themes: converted to a scheme keyed theme:<Name>", s2 === 200 && String(css).includes('[data-scheme="theme:Harbor"]'), String(css).slice(0, 200))
    check("themes: var() resolved, secondary is the light page", light.includes("--foreground: rgb(20, 30, 40);") && light.includes("--background: #eeeeee;"), light)
    check("themes: Style Settings defaults and specificity apply", dark.includes("--primary: #20b2aa;") && !String(css).includes("#8e4585"), dark)
    check("themes: rules for parts of the page and @media are left out", !String(css).includes("#ff00ff") && !String(css).includes("#00ff00"))
    check("themes: headings: inherit falls back, a colour maps", light.includes("--h1: rgb(20, 30, 40);") && light.includes("--h2: #c00;"), light)
    check("themes: Obsidian's defaults fill what it doesn't set", /--red: #fb464c;/.test(dark) && /--green: #08b94e;/.test(light), dark)
    const [s3] = await api("GET", "themes/Nope.css")
    check("themes: a missing one is a 404", s3 === 404, s3)
    write(".vaultite/themes/Night/theme.css", ".theme-dark { --background-primary: #000; --text-normal: #fff; }")
    const [, again] = await api("GET", "themes")
    check("themes: a dark-only theme says so", again.find((t: Any) => t.name === "Night")?.modes.join() === "dark", again)
  }
  {
    const [s1, made] = await api("POST", "snippets", { name: "Wide lines" })
    check("snippets: a new one is made in .vaultite/snippets", s1 === 200 && made.path === ".vaultite/snippets/Wide lines.css" && exists(made.path), made)
    const [, made2] = await api("POST", "snippets", { name: "Wide lines" })
    check("snippets: a taken name gets a number", made2.name === "Wide lines 1", made2)
    const [s2] = await api("POST", "snippets", { name: "../x" })
    check("snippets: names stay in the folder", s2 === 400, s2)
    write(".vaultite/snippets/Wide lines.css", ".vau-editor { max-width: none; }\n")
    const [s3, css] = await api("GET", "snippets/Wide%20lines.css")
    check("snippets: served as they are", s3 === 200 && css === ".vau-editor { max-width: none; }\n", css)
    const [, list] = await api("GET", "snippets")
    check("snippets: listed with their times", list.some((x: Any) => x.name === "Wide lines 1") && list.every((x: Any) => x.mtime > 0), list)
    const [, state] = await api("GET", "state")
    check("state: themes and snippets in appearance", state.appearance?.themes.some((t: Any) => t.name === "Night") && state.appearance?.snippets.some((x: Any) => x.name === "Wide lines"), state.appearance)
    const [s4, opened] = await api("GET", "file?path=.vaultite/snippets/Wide lines.css")
    check("snippets: open in the editor by path with hidden files off", s4 === 200 && opened.text.includes("max-width"), opened)
  }
  {
    write(".vaultite/appearance.json", JSON.stringify({ theme: "dark", scheme: "nord", density: "comfortable", fontSize: 18, fromCli: 1 }))
    await api("PUT", "config/appearance", { theme: "light", scheme: "theme:Harbor", snippets: ["Wide lines"] })
    const saved = JSON.parse(read(".vaultite/appearance.json"))
    check("appearance: a PUT keeps keys it doesn't send", saved.fromCli === 1 && saved.density === "comfortable" && saved.scheme === "theme:Harbor" && saved.snippets[0] === "Wide lines", saved)
  }
}
