// Markdown's extras in notes and pages: code fences (highlighted, a language label and a copy button that copies),
// callouts (folded ones toggle), footnotes, $math$ and $$ blocks (KaTeX), ```mermaid diagrams (light and dark),
// <details>; in reading, live preview (clicking one shows its Markdown; ↑ and ↓ go into a table) and source mode, embeds
// and blocks inside code fences left alone, the Design page read as a dashboard, and a phone at 390px (no sideways
// scroll, copy always shown). WRITES a "Qa markdown" folder: throwaway only.
//   node web/qa/markdown.mjs <base url> [out dir]
import { SHOTS, apiAt, palette, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const PATH = "Qa markdown/Rich.md"
const TEXT = `Intro with a note[^1] and a second one[^b].

\`\`\`ts
const greet = (name: string) => \`Hello, \${name}\` // says hi
\`\`\`

> [!tip] A callout with **bold**
> Body with $x^2$ inline.

> [!warning]- Folded
> Hidden text

Math $E = mc^2$ and money: $5 and $10.

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$

\`\`\`mermaid
flowchart LR
  Idea --> Note --> Project
\`\`\`

<details>
<summary>A toggle</summary>

Inside **it**.

</details>

Last line.

[^1]: The note text.
[^b]: Another.
`
await fetch(`${B}api/file?path=${encodeURIComponent(PATH)}`, { method: "DELETE" })
await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: PATH, text: TEXT }) })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(B).origin })
const page = watch(await ctx.newPage())
const ed = page.locator(".vau-editor")

await page.goto(`${B}#file/${encodeURIComponent(PATH)}`); await wait(1500)
await palette(page, "Switch to reading view", 700)
await wait(2500)
check("reading: a fence shows its language", await ed.locator(".cm-fence-head .cm-fence-lang", { hasText: "ts" }).count() === 1)
// The language's parser is its own chunk: give it a moment.
for (let i = 0; i < 25 && (await ed.locator(".cm-codeblock span[class]").count()) <= 3; i++) await wait(200)
check("reading: the code in it is highlighted", await ed.locator(".cm-codeblock span[class]").count() > 3)
check("reading: no ``` lines", !(await ed.locator(".cm-line", { hasText: "```" }).count()))
check("reading: a tip callout", await ed.locator('.callout[data-callout="tip"]').count() === 1)
check("reading: a folded warning callout", await ed.locator('details.callout[data-callout="warning"]:not([open])').count() === 1)
check("reading: inline math drawn (in the text and in the callout)", await ed.locator(".math-inline .katex").count() >= 2)
check("reading: display math drawn", await ed.locator(".math-display .katex-display, .cm-block-math .katex").count() >= 1)
check("reading: $5 and $10 stays text", await ed.locator(".cm-line", { hasText: "$5 and $10" }).count() === 1)
check("reading: the mermaid diagram is drawn", await ed.locator(".cm-block-mermaid svg").count() === 1)
check("reading: footnote references are numbered", (await ed.locator(".cm-footnote-ref").allInnerTexts()).join(",") === "1,2")
check("reading: a definition shows its number", await ed.locator(".cm-footnote-label", { hasText: "1." }).count() === 1)
check("reading: <details> is a toggle", await ed.locator(".cm-block-details details summary", { hasText: "A toggle" }).count() === 1)
await page.screenshot({ path: `${OUT}markdown-reading.png`, fullPage: true })

// Folding a callout, opening <details>.
await ed.locator("details.callout summary").click(); await wait(200)
check("clicking a folded callout's title opens it", await ed.locator("details.callout[open]").count() === 1)
await ed.locator(".cm-block-details summary").click(); await wait(200)
check("clicking the toggle opens it", await ed.locator(".cm-block-details details[open]").count() === 1)
// A change elsewhere in the vault (the store reloads) doesn't redraw them shut.
await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "Qa markdown/Elsewhere.md", text: "Hi.\n" }) })
await wait(2000)
check("a change elsewhere in the vault leaves them open", await ed.locator("details.callout[open]").count() === 1 && await ed.locator(".cm-block-details details[open]").count() === 1)

// Copy.
await ed.locator(".cm-codeblock").first().hover(); await wait(200)
const copy = ed.locator(".cm-fence-copy").first()
check("hovering the code shows its copy button", await copy.evaluate((b) => getComputedStyle(b).opacity === "1"))
await copy.click(); await wait(300)
const clip = await page.evaluate(() => navigator.clipboard.readText())
check(`copy copies the code (${JSON.stringify(clip)})`, clip === "const greet = (name: string) => `Hello, ${name}` // says hi")

// Footnote click scrolls to its definition.
await ed.locator(".cm-footnote-ref").first().click(); await wait(500)
check("clicking a footnote shows its definition", await ed.locator(".cm-footnote-def").first().isVisible())

// Live preview: click into a callout and its Markdown shows.
await palette(page, "Switch to live preview", 700); await wait(800)
check("live: callouts drawn off the cursor", await ed.locator(".callout").count() === 2)
await ed.locator('.callout[data-callout="tip"] .callout-content').click(); await wait(400)
check("live: clicking a callout shows its Markdown", await ed.locator(".cm-line", { hasText: "[!tip] A callout" }).count() === 1)
await ed.locator(".cm-block-mermaid").click(); await wait(400)
check("live: clicking the diagram shows its source, the callout is drawn again", await ed.locator(".cm-line", { hasText: "```mermaid" }).count() === 1 && await ed.locator(".callout").count() === 2)
await ed.locator(".cm-line", { hasText: "Last line." }).click(); await wait(400)
check("live: leaving it draws it again", await ed.locator(".cm-block-mermaid svg").count() === 1)
await ed.locator(".cm-line", { hasText: "money" }).click(); await wait(300)
check("live: math on the cursor's line shows its TeX", await ed.locator(".cm-line", { hasText: "$E = mc^2$" }).count() === 1)
await page.screenshot({ path: `${OUT}markdown-live.png`, fullPage: true })

// Source: only highlighting.
await palette(page, "Switch to source mode", 700); await wait(800)
check("source: nothing drawn", !(await ed.locator(".callout, .katex, .cm-fence-head").count()))
check("source: code still highlighted", await ed.locator(".cm-codeblock span[class]").count() > 3)
await palette(page, "Switch to reading view", 700); await wait(800)

// Dark mode: the diagram is drawn again in dark colours.
const fill = () => ed.locator(".cm-block-mermaid svg").evaluate((s) => s.innerHTML.length + ":" + (s.querySelector(".node rect, rect")?.getAttribute("style") ?? getComputedStyle(s.querySelector("rect") ?? s).fill))
const before = await fill()
await page.evaluate(() => document.documentElement.classList.add("dark")); await wait(2000)
check("the diagram redraws for dark mode", await fill() !== before)
await page.screenshot({ path: `${OUT}markdown-dark.png`, fullPage: true })
await page.evaluate(() => document.documentElement.classList.remove("dark")); await wait(500)

// The Design page, read as a dashboard (core/markdown.ts + hydrate).
await page.goto(`${B}#file/${encodeURIComponent("Dashboards/Design.md")}`); await wait(3000)
const dash = page.locator(".dash-prose")
check("Design: code block with its label", await dash.locator(".md-code .md-code-lang", { hasText: "ts" }).count() === 1)
check("Design: callouts", await dash.locator('.callout[data-callout="tip"]').count() === 1 && await dash.locator("details.callout").count() === 1)
check("Design: math", await dash.locator(".katex").count() >= 2)
check("Design: mermaid", await dash.locator(".mermaid-diagram svg").count() === 1)
check("Design: footnote and its list", await dash.locator(".footnote-ref").count() === 1 && await dash.locator("section.footnotes li").count() === 1)
check("Design: <details>", await dash.locator("details:not(.callout) summary", { hasText: "A toggle" }).count() === 1)
const tsCode = dash.locator(".md-code", { has: page.locator(".md-code-lang", { hasText: "ts" }) })
await tsCode.hover()
await tsCode.locator(".md-copy").click(); await wait(300)
check("Design: copy copies", (await page.evaluate(() => navigator.clipboard.readText())).includes("const greet"))
await tsCode.screenshot({ path: `${OUT}markdown-design-code.png` })
await page.locator(".dash-prose").first().screenshot({ path: `${OUT}markdown-design.png` })

// Live preview from the keyboard, and Markdown inside code: ↓ and ↑ go into a drawn table (its Markdown shows) instead
// of over it; an embed or a block written in a code fence stays code; typing after a closing --- with no line break
// keeps the frontmatter; a checkbox in the trash doesn't tick. The files are the user's, made as the app makes them
// (a file an agent makes through the API gets `origin: ai`: Provenance).
const put = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
await put("Qa markdown/Keys.md", "Top line\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n![[Rich]]\n```\n\n````md\n```block-books\n```\n````\n\n$$\nx^2\n$$\n\nBottom line\n")
await page.goto(`${B}#file/${encodeURIComponent("Qa markdown/Keys.md")}`); await wait(1500)
await palette(page, "Switch to live preview", 700); await wait(800)
check("live: an embed or a block inside a code fence stays code", !(await ed.locator(".cm-block-embed, .cm-block-block").count()))
check("live: $$ after a ```` fence holding a ``` one is still drawn", await ed.locator(".cm-block-math").count() === 1)
await ed.locator(".cm-line", { hasText: "Top line" }).click(); await page.keyboard.press("End")
await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await wait(300)
check("live: ↓ goes into a table, its Markdown shows", await ed.locator(".cm-line", { hasText: "| a | b |" }).count() === 1 && !(await ed.locator(".cm-block-table").count()))
for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown")
await wait(300)
check("live: and out of it, drawn again", await ed.locator(".cm-block-table").count() === 1)
await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await wait(300)
check("live: ↑ goes back into it", !(await ed.locator(".cm-block-table").count()))
await put("Qa markdown/Only frontmatter.md", "---\ntype: note\n---")
await page.goto(`${B}#file/${encodeURIComponent("Qa markdown/Only frontmatter.md")}`); await wait(1500)
await ed.locator(".cm-content").click(); await page.keyboard.type("Typed."); await wait(1500)
const fmOnly = await (await fetch(`${B}api/file?path=${encodeURIComponent("Qa markdown/Only frontmatter.md")}`)).json()
// The Notes kind fills a note's id and dates into its frontmatter: what matters is that it's still one block, closed,
// with the typing after it.
check(`typing after a closing --- keeps the frontmatter (${JSON.stringify(fmOnly.text)})`,
  /^---\ntype: note\n(?:[^\n]*\n)*?---\nTyped\.$/.test(fmOnly.text) && fmOnly.text.split("\n").filter((l) => l === "---").length === 2)
// The trash is a hidden folder: it opens only with Show hidden files on (File explorer's settings).
const api = apiAt(B)
const hiddenBefore = (await api("GET", "config/files")).showHidden ?? null
await api("PATCH", "config/files", { showHidden: true })
await put("Qa markdown/Trashed.md", "- [ ] a task\n")
const trashed = (await (await fetch(`${B}api/file?path=${encodeURIComponent("Qa markdown/Trashed.md")}`, { method: "DELETE" })).json()).trashed
await page.goto(`${B}#file/${encodeURIComponent(trashed)}`); await wait(1500)
check(`a checkbox in the trash is disabled (${trashed})`, await ed.locator("input.cm-task[disabled]").count() === 1)
await api("PATCH", "config/files", { showHidden: hiddenBefore })

// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const pp = watch(await phone.newPage())
await pp.goto(`${B}#file/${encodeURIComponent(PATH)}`); await wait(3000)
check("phone: no sideways scroll", await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
const pc = pp.locator(".cm-fence-copy, .md-copy").first()
check("phone: copy button always shown", await pc.count() === 1 && await pc.evaluate((b) => getComputedStyle(b).opacity === "1"))
await pp.screenshot({ path: `${OUT}markdown-phone.png`, fullPage: true })

await browser.close()
await fetch(`${B}api/file?path=${encodeURIComponent("Qa markdown")}`, { method: "DELETE" })
await done()
