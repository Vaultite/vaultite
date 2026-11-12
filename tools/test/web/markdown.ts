import path from "node:path"
import { pathToFileURL } from "node:url"
import { check, cpuMs } from "../lib.ts"
import { type Any, plugin, ROOT, same, web } from "./lib.ts"

// ---------- Markdown's extras: headings and blocks to go to, tags, comments, highlights, note embeds ----------

// The editor reads a frontmatter of any size as one block (read on until it closes, not only its first MB).
{
  const { frontmatterSyntax } = await web("editor/frontmatter.ts")
  const { parser } = await import("@lezer/markdown")
  const big = `---\nnotes: ${"x".repeat(3 << 20)}\n---\n# After\n`
  const tree = parser.configure([frontmatterSyntax]).parse(big)
  const first = tree.topNode.firstChild
  check("editor: a frontmatter over a few MB is one block", first?.name === "Frontmatter" && first.to === big.indexOf("\n# After"), [first?.name, first?.to])
}

const md: { renderMarkdown(text: string, opts?: { resolves?: (t: string) => { kind: string } | null; asset?: (name: string) => string | null }): string } = await web("core/markdown.ts")
const formats: { embedOf(line: string): { target: string; height?: number; note?: boolean } | null } = await web("core/formats.ts")
const sec = await import(pathToFileURL(path.join(ROOT, "core", "sections.ts")).href)
const html = md.renderMarkdown("A ==bright== idea #idea/new and `#code`, %%hidden%% text ^b1\n\n%%\nnot shown\n%%\n\n[[Note#Plans]] and [x](Some%20Note.md#Plans) and [[#Top]]\n\n^alone\n",
  { resolves: (t) => (t.startsWith("Some Note") || t.startsWith("Note") ? { kind: "file" } : null) })
check("markdown: ==highlight== is a mark", html.includes("<mark>bright</mark>"), html)
{
  // Obsidian's highlight colours (web/src/core/highlights.ts): an emoji first colours it and isn't shown.
  const colored = md.renderMarkdown("==🟢go== ==🟣️two words== ==🔴== ==plain== 🟢 alone")
  check("markdown: ==🟢text== is a green mark, the emoji (and a variation selector after it) not shown",
    colored.includes('<mark class="hl-green">go</mark>') && colored.includes('<mark class="hl-purple">two words</mark>') && colored.includes("<mark>plain</mark>")
    && !/🟢go|🟣/.test(colored) && colored.includes("🟢 alone"), colored)
  const hl: typeof import("../../../web/src/core/highlights.ts") = await web("core/highlights.ts")
  check("highlights: the colour a highlight starts with, and its emoji's length", hl.highlightColor("🔵sky")?.color === "blue" && hl.highlightColor("🔵sky")?.len === 2
    && hl.highlightColor("🟠\uFE0Fx")?.len === 3 && hl.highlightColor("sky") === null && hl.highlightColor("⚪x") === null)
  check("highlights: previews drop the emoji at a highlight's start only", hl.dropHighlightEmoji("A ==🟢green== and 🟢 ==x== a==🟢") === "A ==green== and 🟢 ==x== a==🟢",
    hl.dropHighlightEmoji("A ==🟢green== and 🟢 ==x== a==🟢"))
  check("highlights: a colour's class", hl.highlightClass("red") === "hl-red" && hl.highlightClass(null) === "" && hl.HIGHLIGHT_COLORS.map((c) => c.name).join() === "red,orange,yellow,green,blue,purple")
  const tt2: typeof import("../../../web/src/editor/tableText.ts") = await web("editor/tableText.ts")
  check("highlights: a table sorts a coloured highlight by its text", tt2.compareCells("==🔴b==", "a") > 0 && tt2.compareCells("==🟢a==", "b") < 0)
}
{
  // A highlight runs over a paragraph's soft line breaks (as ~~strike~~ does), never over blocks.
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const hl: typeof import("../../../web/src/core/highlights.ts") = await web("core/highlights.ts")
  const ed = await plugin("editing/edit.ts")
  const soft = md.renderMarkdown("A ==two\nlines== here\n\n- ==a\n- b==\n\n%%a\nb%% c\n\nz == y == x")
  check("markdown: a highlight runs over a soft line break, not over list items or a blank line",
    soft.includes("<mark>two<br>lines</mark>") && !soft.includes("<mark>a") && soft.includes("==a") && soft.includes("<p> c</p>") && soft.includes("z == y == x"), soft)
  const cells = md.renderMarkdown("| Key | How |\n| :-- | --- |\n| `wide: true` | The block takes the whole row, under the one before it |")
  check("markdown: a short table cell is marked to stay on one line, a long one isn't",
    cells.includes('<th align="left" class="md-cell-short">Key</th>') && cells.includes('<td align="left" class="md-cell-short"><code>wide: true</code></td>') &&
    cells.includes("<td>The block takes"), cells)
  const doc = (text: string) => EditorState.create({ doc: text }).doc
  const para = (text: string, at: number) => { const d = doc(text), p = hl.paragraphAt(d, at); return d.sliceString(p.from, p.to) }
  check("paragraphs: soft-wrapped lines are one, a blank line, list item, heading or table row ends it",
    para("a\nb\n\nc", 0) === "a\nb" && para("a\nb\n- c\n- d", 0) === "a\nb" && para("a\nb\n- c\n  e\n- d", 6) === "- c\n  e" &&
    para("# T\na\nb", 6) === "a\nb" && para("a\n| x | y |\n| 1 | 2 |", 0) === "a" && para("> a\n> b\nc", 0) === "> a\n> b\nc" && para("p\n> q", 0) === "p")
  const at = (text: string, from: number, to = from) => hl.highlightAt(EditorState.create({ doc: text }), from, to)
  check("highlights: one found over a soft break, from any line of it; none across blocks",
    at("==a\nb==", 5)?.to === 7 && at("x ==a\nb\nc== y", 6)?.from === 2 && at("==a\n\nb==", 1) === null && at("- ==a\n- b==", 3) === null)
  const run = (text: string, sel: [number, number], f: (v: any) => unknown) => {
    let state = EditorState.create({ doc: text, selection: EditorSelection.single(...sel), extensions: [EditorState.allowMultipleSelections.of(true)] })
    const v = { get state() { return state }, dispatch: (tr: any) => { state = state.update(tr).state } }
    f(v)
    return state.doc.toString()
  }
  const all = (t: string) => [0, t.length] as [number, number]
  const t1 = "one\ntwo\n\nthree\n- four\n- five"
  check("highlight toolbar: a selection over blocks is wrapped block by block", run(t1, all(t1), hl.colorHighlight(null)) === "==one\ntwo==\n\n==three==\n- ==four==\n- ==five==")
  check("highlight toolbar: inside a soft-wrapped paragraph one highlight spans its lines", run("one\ntwo", all("one\ntwo"), hl.colorHighlight(null)) === "==one\ntwo==")
  check("highlight toolbar: a colour changes a highlight over a soft break", run("==a\nb==", [1, 2], hl.colorHighlight("green")) === "==🟢a\nb==")
  check("mark toggle: a selection over blocks, bold and comment, block by block", run(t1, all(t1), ed.toggleMark("**")) === "**one\ntwo**\n\n**three**\n- **four**\n- **five**" &&
    run("a\n\nb", all("a\n\nb"), ed.toggleMark("%%")) === "%%a%%\n\n%%b%%")
  const marked = "==one\ntwo==\n\n==three==\n- ==four==\n- ==five=="
  check("mark toggle: off again over blocks; the selection stays on the text", run(marked, all(marked), ed.toggleMark("==")) === t1)
  check("mark toggle: only the unmarked blocks get marks when some are", run("==a==\n\nb", all("==a==\n\nb"), ed.toggleMark("==")) === "==a==\n\n==b==")
  check("mark toggle: a selection inside one paragraph is one mark", run("one\ntwo", all("one\ntwo"), ed.toggleMark("==")) === "==one\ntwo==")
  // ---- blocks that take no mark, selections that cover them ----
  const sel = (t: string) => run(t, all(t), ed.toggleMark("**")), col = (t: string) => run(t, all(t), hl.colorHighlight(null))
  const fence = "para\n\n```js\nlet a = 1\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx = 1\n$$\n\n> [!note] Title\n> body\n\nlast"
  const wrapped = "**para**\n\n```js\nlet a = 1\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx = 1\n$$\n\n> [!note] Title\n> **body**\n\n**last**"
  check("mark toggle: fences, code, rules, tables, math and callout heads are left out", sel(fence) === wrapped, sel(fence))
  check("highlight toolbar: the same blocks are left out", col(fence) === wrapped.replaceAll("**", "=="), col(fence))
  check("mark toggle: a triple-click over list items marks the text, not the bullets", sel("- a\n- b") === "- **a**\n- **b**" && sel("- [-] a\n- [x] b") === "- [-] **a**\n- [x] **b**" && sel("> q\n> r") === "> **q\n> r**")
  check("mark toggle: one item selected whole is marked on its text", sel("- a") === "- **a**" && sel("## Title") === "## **Title**")
  check("mark toggle: only code selected changes nothing", sel("```\ncode\n```") === "```\ncode\n```" && sel("a\n\n---") === "**a**\n\n---")
  {
    // the selection stays on the text after colouring several blocks
    let state = EditorState.create({ doc: "one\n\ntwo", selection: EditorSelection.single(0, 8) })
    hl.colorHighlight(null)({ get state() { return state }, dispatch: (tr: any) => { state = state.update(tr).state } } as any)
    const m = state.selection.main
    check("highlight toolbar: after colouring blocks the selection is on the text, inside the marks", state.doc.toString() === "==one==\n\n==two==" && m.from === 2 && m.to === 14, [state.doc.toString(), m.from, m.to])
  }
  check("clear formatting: marks across list items or headings aren't joined", run("**a\n- b**", all("**a\n- b**"), ed.clearFormatting) === "**a\n- b**" && run("- **a** and ==b==", all("- **a** and ==b=="), ed.clearFormatting) === "- a and b")
  const pa = (t: string, n = 0) => para(t, n)
  check("paragraphs: end at math, HTML, footnote definitions, a callout head, a quote's change, a table header, a setext underline",
    pa("a\n$$\nx\n$$") === "a" && pa("a\n<div>\nb") === "a" && pa("a\n[^1]: note") === "a" && pa("a\n> [!note] T\n> b") === "a" && pa("> a\n>> b") === "> a" &&
    pa("p\nh1 | h2\n--|--\nx | y") === "p" && pa("p\nh1 | h2\n--|--\nx | y", 3) === "h1 | h2" && pa("Title\n=====") === "Title" && pa("> a\nb") === "> a\nb")
  check("highlights: the colour list is offered for an opening == and not for a closing one", hl.closesHighlight("==a\nb") && !hl.closesHighlight("a == b ") && !hl.closesHighlight("a") && hl.closesHighlight("x ==y z") && !hl.closesHighlight("==a== b "))
  const unclosed = cpuMs(() => hl.highlightSpans("==x\n".repeat(20000)))
  check("highlights: unclosed openers are one linear pass", unclosed.value.length === 0 && unclosed.ms < 100, unclosed.ms)
  check("highlights: spans and comments over a paragraph's text", JSON.stringify(hl.highlightSpans("a ==b\nc== d ==e==")) === '[{"index":2,"length":7,"inner":"b\\nc"},{"index":12,"length":5,"inner":"e"}]'
    && JSON.stringify(hl.commentSpans("x %%a\nb%% y %%")) === "[[2,9]]")
  check("clear formatting: strips a mark over a soft break, not across a blank line",
    run("==a\nb==", all("==a\nb=="), ed.clearFormatting) === "a\nb")
}
check("markdown: #tags are clickable, not in code", html.includes('<a class="tag" data-tag="idea/new">#idea/new</a>') && html.includes("<code>#code</code>"), html)
check("markdown: comments and block ids are hidden", !html.includes("hidden") && !html.includes("not shown") && !html.includes("^b1") && !html.includes("alone"), html)
check("markdown: a heading link names the heading; same-file and Markdown links to notes are links",
  html.includes('data-wiki="Note#Plans">Note › Plans</a>') && html.includes('data-wiki="Some Note#Plans">x</a>') && html.includes('data-wiki="#Top">Top</a>'), html)
// As in Obsidian: every Markdown link is a link, vault images show anywhere, `![[Note]]` mid-line embeds, raw HTML is drawn sanitized.
const vopts = { resolves: (t: string) => (/^(Note|files\/a\.pdf|photo\.png|Idea)/.test(t) ? { kind: "file" } : null), asset: (n: string) => (/photo\.png$/.test(n) ? "/api/raw?path=Img/photo.png" : null) }
const links = md.renderMarkdown("[a](Note) [b](files/a.pdf) [c](obsidian://open?vault=x) [d](zotero://select/items/1) [e](tel:+15551234) [f](file:///Users/x/a.pdf) [g](javascript:alert(1)) [h](https://example.com)", vopts)
check("markdown: a link with no extension, a relative file and any app's scheme are links; javascript: isn't",
  links.includes('data-wiki="Note">a</a>') && links.includes('data-wiki="files/a.pdf">b</a>') && links.includes('data-url="obsidian://open?vault=x">c</a>') &&
  links.includes('data-url="zotero://select/items/1">d</a>') && links.includes('data-url="tel:+15551234">e</a>') && links.includes('data-url="file:///Users/x/a.pdf">f</a>') &&
  !links.includes("javascript") && links.includes('href="https://example.com" target="_blank"'), links)
const broken = md.renderMarkdown("Vaultite\nLighthouse\n\nNext")
check("markdown: a line break is a break, as the editor shows it", broken.includes("Vaultite<br>Lighthouse") && broken.includes("<p>Next</p>"), broken)

// A .csv changed a field at a time (plugins/core/tables/csvedit.ts): the rest of its text as it was.
{
  const ce = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "tables", "csvedit.ts")).href)
  const src = '\ufeffa;b;c\r\n1;"x; y";3\r\n4;5\r\n'
  check("csv: a field changed alone, quoting, separator, BOM and CRLF kept", ce.setCell(src, 1, 1, "x; z") === '\ufeffa;b;c\r\n1;"x; z";3\r\n4;5\r\n'
    && ce.setCell(src, 2, 0, 'say "hi"') === '\ufeffa;b;c\r\n1;"x; y";3\r\n"say ""hi""";5\r\n' && ce.setCell(src, 2, 2, "6") === '\ufeffa;b;c\r\n1;"x; y";3\r\n4;5;6\r\n',
    [ce.setCell(src, 1, 1, "x; z"), ce.setCell(src, 2, 0, 'say "hi"'), ce.setCell(src, 2, 2, "6")])
  check("csv: a row added, after a last line without its break", ce.addRow("a,b\n1,2", 2) === "a,b\n1,2\n,\n" && ce.addRow("a,b\r\n", 2) === "a,b\r\n,\r\n", [ce.addRow("a,b\n1,2", 2), ce.addRow("a,b\r\n", 2)])
}

// Tables edited cell by cell (editor/tables.ts) rewrite only what changed, in the table's own style.
const tt: typeof import("../../../web/src/editor/tableText.ts") = await web("editor/tableText.ts")
{
  const src = "|a|b|\n|---|:-:|\n| 1 | x \\| y |\n|2|"
  const t = tt.parseTable(src)!
  check("tables: cells split at unescaped pipes, short rows filled", t.rows[1].cells.join(",") === "1,x \\| y" && t.rows[2].cells.join(",") === "2," && t.align.join() === ",center")
  check("tables: unchanged, written as it was", tt.writeTable(t) === src, tt.writeTable(t))
  t.rows[2].cells[1] = tt.escape("a|b")
  const out = tt.writeTable(t).split("\n")
  check("tables: only the changed row is rewritten, its pipe escaped", out[0] === "|a|b|" && out[2] === "| 1 | x \\| y |" && out[3] === "| 2 | a\\|b |", out.join("\n"))
  t.align.push(""); t.rows.forEach((r) => r.cells.push(""))
  check("tables: a new column gets its own separator", tt.writeTable(t).split("\n")[1] === "|---|:-:|---|", tt.writeTable(t))
  const g = tt.parseTable("|a|b|c|d|e|\n|-|-|-|-|-|\n|1|2||4|5|\n|x|||y||")!
  const at = (r: number, c: number, dr: number, dc: number) => { const e = tt.edgeFrom(g, { r, c }, dr, dc); return `${e.r},${e.c}` }
  check("tables: ⌘ arrows go to the end of a run of filled cells, from a blank to the next filled, else the edge",
    at(1, 0, 0, 1) === "1,1" && at(1, 1, 0, 1) === "1,3" && at(1, 3, 0, 1) === "1,4" && at(1, 4, 0, 1) === "1,4" && at(2, 1, 0, 1) === "2,3" && at(2, 3, 0, 1) === "2,4"
    && at(0, 0, 1, 0) === "2,0" && at(2, 0, -1, 0) === "0,0" && at(0, 2, 1, 0) === "2,2",
    [at(1, 0, 0, 1), at(1, 1, 0, 1), at(1, 3, 0, 1), at(1, 4, 0, 1), at(2, 1, 0, 1), at(2, 3, 0, 1), at(0, 0, 1, 0), at(2, 0, -1, 0), at(0, 2, 1, 0)])
  const dup = tt.parseTable("|a|b|\n|-|-|\n|1|x|\n|2|y|")!
  tt.duplicateRow(dup, 1); tt.duplicateRow(dup, 0)
  check("tables: a row duplicated under it, never the header", tt.writeTable(dup) === "|a|b|\n|-|-|\n|1|x|\n| 1 | x |\n|2|y|", tt.writeTable(dup))
  const fd = tt.parseTable("|a|b|\n|-|-|\n|1|x|\n|2|y|\n|3|z|")!
  const down = (a: [number, number], h: [number, number]) => { const t = tt.parseTable(tt.writeTable(fd))!; const ok = tt.fillDown(t, { r: a[0], c: a[1] }, { r: h[0], c: h[1] }); return ok ? tt.writeTable(t).split("\n").slice(2).join(";") : "no" }
  check("tables: ⌘D fills down from the selection's top row; one row from the row above, never the header",
    down([1, 0], [3, 0]) === "|1|x|;| 1 | y |;| 1 | z |" && down([3, 1], [3, 1]) === "|1|x|;|2|y|;| 3 | y |" && down([1, 0], [1, 1]) === "no",
    [down([1, 0], [3, 0]), down([3, 1], [3, 1]), down([1, 0], [1, 1])])
  const ragged = tt.parseTable("|a|\n|-|\n|1|2|")!
  ragged.rows[1].cells[0] = "3"
  check("tables: a row wider than its header keeps its extra cells as cells change", tt.writeTable(ragged) === "|a|\n|-|\n| 3 | 2 |", tt.writeTable(ragged))
  tt.widen(ragged); tt.insertRow(ragged, 2)
  check("tables: a change to its shape makes them columns, the header's empty", tt.writeTable(ragged) === "| a |  |\n|---|---|\n| 3 | 2 |\n|  |  |", tt.writeTable(ragged))
  const padded = tt.parseTable("  | Name  | Qty |\n  | ----- | --- |\n  | Apple | 3   |")!
  padded.rows[1].cells[0] = "Pineapple"
  check("tables: a padded table stays lined up, indented as it was", tt.writeTable(padded) === "  | Name      | Qty |\n  | --------- | --- |\n  | Pineapple | 3   |", tt.writeTable(padded))
  check("tables: a line break in a cell is <br>", tt.escape("a\nb") === "a<br>b" && tt.unescape("x\\|y") === "x|y")
}
// Column widths in the separator's dashes, as Pandoc reads them; a table written the usual ways has none.
{
  const long = "x".repeat(90)
  const usual = ["|a|b|\n|---|---|\n|1|2|", "| a | b |\n| --- | :-: |\n| 1 | 2 |", `| Name | Note |\n| ---- | ${"-".repeat(90)} |\n| Pear | ${long} |`,
    `| ${"h".repeat(40)} | ${"k".repeat(40)} |\n|${"-".repeat(42)}|${"-".repeat(42)}|\n| 1 | 2 |`, `|a|\n|${"-".repeat(80)}|\n|1|`]
  for (const src of usual) {
    const t = tt.parseTable(src)!
    check(`tables: no widths, written as it was (${JSON.stringify(src.slice(0, 30))})`, t.widths === null && tt.columnShares(t) === null && tt.writeTable(t) === src, t.widths)
  }
  const sep = `|${"-".repeat(20)}|${"-".repeat(59)}:|`
  const set = tt.parseTable(`| Name | Qty |\n${sep}\n| pear | 10 |`)!
  check("tables: a separator past 72 columns sets the columns' widths", same(set.widths, [20, 60]) && Math.abs(tt.columnShares(set)![0] - 0.25) < 1e-9, set.widths)
  set.rows[1].cells[0] = "Apple"
  check("tables: editing a cell keeps them", tt.writeTable(set).split("\n")[1] === sep, tt.writeTable(set))
  tt.insertColumn(set, 2); set.rows[0].cells[2] = "When"
  const grown = tt.writeTable(set).split("\n")[1]
  check("tables: a new column gets the others' average, alignment kept", /^\|-+\|-+:\|-+\|$/.test(grown) && same(tt.parseTable(tt.writeTable(set))!.widths, [13, 40, 27]), grown)
  tt.moveColumn(set, 0, 2)
  check("tables: a moved column takes its width along", same(tt.parseTable(tt.writeTable(set))!.widths, [40, 27, 13]), tt.writeTable(set))
  tt.setWidths(set, [1, 1, 2])
  const out = tt.writeTable(set)
  check("tables: widths set are written in the separator, scaled to 80 dashes", out.split("\n")[1] === `|${"-".repeat(19)}:|${"-".repeat(20)}|${"-".repeat(40)}|` && same(tt.parseTable(out)!.widths, [20, 20, 40]), out)
  tt.setWidths(set, null)
  check("tables: and back to as wide as their text", tt.writeTable(set).split("\n")[1] === "|--:|---|---|" && tt.parseTable(tt.writeTable(set))!.widths === null, tt.writeTable(set))
  const padded = tt.parseTable("| Name  | Qty |\n| ----- | --- |\n| Apple | 3   |")!
  tt.setWidths(padded, [3, 1])
  check("tables: a padded table given widths keeps its rows as they were", tt.writeTable(padded) === `| Name  | Qty |\n|${"-".repeat(60)}|${"-".repeat(20)}|\n| Apple | 3   |`, tt.writeTable(padded))
  tt.deleteColumn(padded, 1)
  check("tables: one column left has no widths", padded.widths === null && tt.writeTable(padded).split("\n")[1] === "|---|", tt.writeTable(padded))
  // Read as Pandoc reads them: dashes and colons past 72 with the pipes; spaces don't count.
  const spaced = tt.parseTable(`| a | b | c |\n| ${"-".repeat(22)} | ${"-".repeat(22)} | ${"-".repeat(22)} |\n| 1 | 2 | 3 |`)!
  check("tables: a separator long only by its spaces sets no widths", spaced.widths === null, spaced.widths)
  const cjk = "東京".repeat(20), cjkPad = tt.parseTable(`| City | Note |\n| ${"-".repeat(40)} | ${"-".repeat(40)} |\n| ${cjk} | ${"n".repeat(40)} |`)!
  check("tables: padded by a formatter counting a wide character as one column, no widths", cjkPad.widths === null, cjkPad.widths)
  const byHead = tt.parseTable(`| ${"Name ".repeat(8).trim()} | ${"Description ".repeat(3).trim()} |\n| ${"-".repeat(39)} | ${"-".repeat(35)} |\n| a | ${"b".repeat(50)} |`)!
  check("tables: dashes as long as each header, no widths", byHead.widths === null, byHead.widths)
  // Pandoc's own pipe table (writer: floor(share * (72 - cols - 1)) + 2 dashes, its rows too long to pad)
  const pd = tt.parseTable(`| Name | Notes |\n|${"-".repeat(22)}|${"-".repeat(50)}|\n| Pear | ${"word ".repeat(16).trim()} |`)!
  check("tables: a table Pandoc wrote with widths has them", same(pd.widths, [22, 50]), pd.widths)
  // (dashes set that happen to be each column's text as wide: one more, so they still read as set)
  const fits = tt.parseTable(`| ${"x".repeat(40)} | ${"y".repeat(38)} |\n|---|---|\n| 1 | 2 |`)!
  tt.setWidths(fits, [1, 1])
  check("tables: widths that match the text still read as set", same(tt.parseTable(tt.writeTable(fits))!.widths?.length, 2), tt.writeTable(fits))
  // Drawn outside the editor (a dashboard's text, an embed): the same widths, in a box that scrolls.
  const drawnSet = md.renderMarkdown(`| Name | Qty |\n${sep}\n| pear | 10 |\n`), drawnUsual = md.renderMarkdown(usual[1])
  check("tables: Markdown drawn elsewhere draws set widths", drawnSet.startsWith('<div class="md-table-view"><table class="has-widths" style="min-width: ')
    && drawnSet.includes('<colgroup><col style="width: 25.000%"><col style="width: 75.000%"></colgroup>') && drawnSet.includes('<td align="right"'), drawnSet)
  check("tables: and others as they were", drawnUsual.startsWith("<table>\n<thead>") && !drawnUsual.includes("colgroup"), drawnUsual)
  const inList = md.renderMarkdown(`- item\n\n  | Name | Qty |\n  ${sep}\n  | pear | 10 |\n`)
  check("tables: a table in a list item keeps its widths", inList.includes("has-widths"), inList)
}
{
  const t = tt.parseTable("| Name | Qty | When |\n| --- | --: | --- |\n| pear | 10 | 2026-03-01 |\n| Apple | 9 | 2025-12-31 |\n|  | 1,200 |  |\n| banana | 2.5 | 2026-01-15 |")!
  const col = (c: number) => t.rows.slice(1).map((r) => r.cells[c]).join(",")
  tt.sortRows(t, 1)
  check("tables: sorting by a column orders numbers as numbers, the header first", t.rows[0].cells[0] === "Name" && col(1) === "2.5,9,10,1,200", col(1))
  tt.sortRows(t, 0)
  check("tables: text sorts ignoring case, empty cells last", col(0) === "Apple,banana,pear,", col(0))
  tt.sortRows(t, 2, true)
  check("tables: dates sort as dates, descending too, empty still last", col(2) === "2026-03-01,2026-01-15,2025-12-31,", col(2))
  const out = tt.writeTable(t).split("\n")
  check("tables: a sort moves rows as they were written, alignment kept", out[1] === "| --- | --: | --- |" && out[2] === "| pear | 10 | 2026-03-01 |" && out[5] === "|  | 1,200 |  |", out.join("\n"))
  check("tables: numbers before words in the same column compare as text", tt.compareCells("10", "9") > 0 && tt.compareCells("**b**", "a") > 0 && tt.compareCells("[[Zed]]", "Abe") > 0)
  tt.moveRow(t, 1, 3); tt.moveRow(t, 2, 0)
  check("tables: a row moves among the body rows, never above the header", col(0) === "banana,Apple,pear," && t.rows[0].cells[0] === "Name", col(0))
  tt.moveColumn(t, 1, 0)
  check("tables: a column moves with its alignment", t.rows[0].cells.join() === "Qty,Name,When" && tt.writeTable(t).split("\n")[1] === "|--:|---|---|", tt.writeTable(t))
  tt.fillCells(t, { r: 4, c: 1 }, [["x|y", "a\nb", "new"], ["z"]])
  check("tables: cells pasted past its edges add rows and columns, pipes and line breaks escaped",
    t.align.length === 4 && t.rows.length === 6 && t.rows[4].cells.join() === "1,200,x\\|y,a<br>b,new" && t.rows[5].cells.join() === ",z,,", tt.writeTable(t))
  tt.clearCells(t, { r: 5, c: 1 }, { r: 4, c: 2 })
  check("tables: clearing empties a range of cells", t.rows[4].cells.join() === "1,200,,,new" && t.rows[5].cells.join() === ",,,", t.rows[4].cells.join())
  const wide = tt.parseTable("| 名前 | 数  |\n| ---- | --- |\n| 東京 | 1   |")!
  check("tables: a padded table lines up by display width (CJK is two)", wide.padded && tt.width("東京") === 4 && tt.width("ab") === 2)
  tt.insertRow(wide, 1)
  check("tables: padded, a new row is padded too", tt.writeTable(wide) === "| 名前 | 数  |\n| ---- | --- |\n|      |     |\n| 東京 | 1   |", tt.writeTable(wide))
  check("tables: the cell a column of a line is in", tt.cellAt("| a | b \\| c | d |", 2) === 0 && tt.cellAt("| a | b \\| c | d |", 10) === 1 && tt.cellAt("a | b", 4) === 1)
}
// Cells on the clipboard (editor/tablePaste.ts): a spreadsheet's, a page's table or CSV in; tab-separated and HTML out.
{
  const tp: typeof import("../../../web/src/editor/tablePaste.ts") = await web("editor/tablePaste.ts")
  const sheets = '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" border="1"><colgroup><col width="100"/></colgroup><tbody><tr><td>Name</td><td>Note</td></tr><tr><td>Alice &amp; co</td><td>two<br/>lines</td></tr></tbody></table>'
  check("paste: a spreadsheet's HTML table", same(tp.htmlTable(sheets), [["Name", "Note"], ["Alice & co", "two\nlines"]]), tp.htmlTable(sheets))
  check("paste: not a page with a table somewhere in it", tp.htmlTable("<p>Intro</p><table><tr><td>a</td><td>b</td></tr></table>") === null)
  check("paste: a cell spanning columns keeps the rest under their headings", same(tp.htmlTable("<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td colspan=2>x</td><td>y</td></tr></table>"), [["a", "b", "c"], ["x", "", "y"]]))
  check("paste: tab-separated, quoted cells hold tabs, line breaks and quotes", same(tp.delimited('a\t"b\tc"\n"two\nlines"\t"say ""hi"""\n', "\t"), [["a", "b\tc"], ["two\nlines", 'say "hi"']]))
  check("paste: into a cell, a spreadsheet's cells", same(tp.clipCells("a\tb\n1\t2", sheets), [["a", "b"], ["1", "2"]]) && same(tp.clipCells("a\tb"), [["a", "b"]]))
  check("paste: into a cell, CSV lines", same(tp.clipCells("name,qty\npear,\"1,5\""), [["name", "qty"], ["pear", "1,5"]]))
  check("paste: into a cell, a line or a paragraph is text", tp.clipCells("Hello, world") === null && tp.clipCells("one\ntwo") === null && tp.clipCells("x", "<table><tr><td>x</td></tr></table>") === null)
  check("paste: the app's own copy keeps its Markdown (its text), not what its HTML drew", same(tp.clipCells("**a**\n[[B]]", "<table><tr><td><strong>a</strong></td></tr><tr><td><a>B</a></td></tr></table>"), [["**a**"], ["[[B]]"]]))
  check("paste: in the text, lines with the same tabs are a table", same(tp.pastedTable("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]))
  check("paste: in the text, not one line, uneven tabs, tab-indented code, or one column",
    tp.pastedTable("a\tb") === null && tp.pastedTable("a\tb\n1\t2\t3") === null && tp.pastedTable("\tfoo()\n\tbar()") === null && tp.pastedTable("x", "<table><tr><td>a</td></tr><tr><td>b</td></tr></table>") === null)
  check("paste: in the text, a page's table", same(tp.pastedTable("", sheets), [["Name", "Note"], ["Alice & co", "two\nlines"]]))
  check("paste: rows as a Markdown table, pipes and line breaks escaped", tp.markdownTable([["a", "b|c"], ["1", "x\ny"]]) === "| a | b\\|c |\n| --: | --- |\n| 1 | x<br>y |", tp.markdownTable([["a", "b|c"], ["1", "x\ny"]]))
  const page = '<table><tr><th>Name</th><th>Site</th></tr><tr><td><b>Lighthouse </b>keeper</td><td><a href="https://example.com/a(b)">the <em>site</em></a></td></tr><tr><td><s>old</s> <code>x</code></td><td><a href="https://example.com">https://example.com</a></td></tr></table>'
  check("paste: a page's table keeps its emphasis, code and links as Markdown", same(tp.pastedTable("", page), [["Name", "Site"], ["**Lighthouse** keeper", "[the *site*](https://example.com/a%28b%29)"], ["~~old~~ `x`", "https://example.com"]]), tp.pastedTable("", page))
  const boldBody = '<google-sheets-html-origin><table><tr><td style="font-weight:bold;">Name</td><td style="font-weight:bold;">Site</td></tr><tr><td style="font-weight:bold;">Total</td><td><a href="https://example.com">Report</a></td></tr></table>'
  check("paste: a spreadsheet's bold header row as the header, a bold cell and a link below it as Markdown", same(tp.pastedTable("Name\tSite\nTotal\tReport", boldBody), [["Name", "Site"], ["**Total**", "[Report](https://example.com)"]]), tp.pastedTable("Name\tSite\nTotal\tReport", boldBody))
  check("paste: a table's columns of numbers aligned right", tp.markdownTable([["Item", "Qty", "Cost"], ["pear", "10", "$1.50"], ["fig", "", "12%"], ["kiwi", "3", "n/a"]]).split("\n")[1] === "| --- | --: | --- |",
    tp.markdownTable([["Item", "Qty", "Cost"], ["pear", "10", "$1.50"], ["fig", "", "12%"], ["kiwi", "3", "n/a"]]))
  check("copy: cells as tab-separated text, quoted where they must be", tp.tsvText([["a", "b\tc"], ["x\ny", 'say "hi"']]) === 'a\t"b\tc"\n"x\ny"\t"say ""hi"""')
}
const imgs = md.renderMarkdown("Before ![[photo.png|300]] and ![alt|200](../Img/photo.png) and ![[Idea]] after\n", vopts)
check("markdown: vault images show (with widths), and an embed mid-line is drawn in its place",
  imgs.includes('<img src="/api/raw?path=Img/photo.png" alt="photo.png" width="300"') && imgs.includes('alt="alt" width="200"') &&
  imgs.includes('<span class="md-embed" data-md-embed="Idea"><a class="wikilink" data-wiki="Idea" data-wiki-embed>Idea</a></span>'), imgs)
const raw = md.renderMarkdown('Line<br>two H<sub>2</sub>O x<sup>2</sup> <kbd>Cmd</kbd> <span style="color: red; position: fixed" onclick="x()">red</span>\n\n<details><summary>More</summary>\n\nInside\n\n</details>\n\n<script>alert(1)</script>\n\n<img src="photo.png" onerror="x()" width="50"> <a href="Idea">idea</a> <a href="javascript:x()">bad</a> <iframe src="https://x.test" onload="x()" allowfullscreen></iframe> <iframe src="http://x.test"></iframe> <custom>tag</custom>\n\n<span class="mine" id="a1">styled</span> <a class="mine" href="Idea">mine</a>\n', vopts)
check("markdown: raw HTML is drawn sanitized: safe tags and attributes (class, id), links, vault images, https frames sandboxed; no scripts or handlers",
  raw.includes("Line<br>two") && raw.includes("<sub>2</sub>") && raw.includes("<sup>2</sup>") && raw.includes("<kbd>Cmd</kbd>") && raw.includes('<span style="color: red">red</span>') &&
  raw.includes("<details><summary>More</summary>") && !raw.includes("alert") && !raw.includes("onclick") && !raw.includes("onerror") && !raw.includes("position") &&
  raw.includes('<img src="/api/raw?path=Img/photo.png" width="50" loading="lazy">') && raw.includes('data-wiki="Idea">idea</a>') && raw.includes("<a>bad</a>") &&
  raw.includes('<iframe src="https://x.test" allowfullscreen="" sandbox="allow-scripts allow-same-origin allow-presentation"') && !raw.includes("http://x.test") &&
  raw.split("</iframe>").length === 2 && raw.includes("&#60;custom&#62;tag&#60;/custom&#62;") && raw.includes('<span id="a1" class="mine">styled</span>') &&
  raw.includes('<a class="mine wikilink" data-wiki="Idea">mine</a>'), raw)
const styled = md.renderMarkdown('<div style="color: red; posit\\69on:fixed;ins\\65t:0;z-ind\\65x:99999;/**/top:0;left/**/:0;background:u\\72l(https://x.test)">x</div>\n', vopts)
check("markdown: raw HTML's style keeps no declaration written with CSS escapes or comments", styled.includes('<div style="color: red">x</div>'), styled)
check("embeds: a note, a section, a block, a heading here", same([formats.embedOf("![[Idea]]"), formats.embedOf("![[Idea#Plans]]"), formats.embedOf("![[Idea#^b1]]"), formats.embedOf("![[#Top]]")].map((e) => e?.note),
  [true, true, true, true]) && formats.embedOf("![[photo.png]]") === null && formats.embedOf("![[v1.2 notes]]")?.note === true)
const note = "---\ntags: [a]\n---\n# Top\n\nIntro #intro and `#no` [[X#y]] ^p1\n\n## Plans\n\n- one ^li\n  - under\n- two\n\n```\n# not a heading #no\n```\n\n## After\n"
check("sections: headings (not in code or the frontmatter)", same(sec.headingsOf(note).map((h: Any) => h.text), ["Top", "Plans", "After"]), sec.headingsOf(note))
check("sections: fences close with their own character, at least as long", JSON.stringify(sec.scan("````md\n```js\n```\n````\n~~~\n```\n~~~\n```x").fences)
  === JSON.stringify([{ open: 0, close: 3, info: "md" }, { open: 4, close: 6, info: "" }, { open: 7, close: null, info: "x" }]), sec.scan("````md\n```js\n```\n````").fences)
check("sections: a heading's section", sec.extract(note, "Plans") === "## Plans\n\n- one ^li\n  - under\n- two\n\n```\n# not a heading #no\n```", sec.extract(note, "plans"))
check("sections: a block (its id taken off), a list item with what's under it", sec.extract(note, "^p1") === "Intro #intro and `#no` [[X#y]]" && sec.extract(note, "^li") === "- one\n  - under",
  [sec.extract(note, "^p1"), sec.extract(note, "^li")])
{
  // A section edited alone (FileEditor's `section`): its lines out and back in, the file around them as it was.
  const day = "---\ntype: day\n---\n## Plan\n\n- [ ] a\n### Later\nb\n\n## Notes\nhi\n"
  const p = sec.sectionParts(day, "plan")
  check("sections: a section's lines to edit alone, back in unchanged", p.part === "- [ ] a\n### Later\nb" && sec.joinSection(p, p.part) === day &&
    sec.joinSection(p, "- [x] a") === "---\ntype: day\n---\n## Plan\n\n- [x] a\n\n## Notes\nhi\n", [p, sec.joinSection(p, "- [x] a")])
  const empty = ["## Plan\n\n## Notes\n", "## Plan\n## Notes", "## Plan"].map((t) => { const q = sec.sectionParts(t, "Plan"); return [q.gap && sec.joinSection(q, "") === t, sec.joinSection(q, "- [ ] x")] })
  check("sections: lines written in an empty section get lines of their own", same(empty, [[true, "## Plan\n- [ ] x\n\n## Notes\n"], [true, "## Plan\n- [ ] x\n\n## Notes"], [true, "## Plan\n- [ ] x\n"]]) &&
    sec.sectionParts(day, "Lunch") === null, empty)
}
check("sections: tags from the frontmatter and the text", same(sec.tagsOf({ tags: ["a"] }, note), ["a", "intro"]), sec.tagsOf({ tags: ["a"] }, note))
check("sections: nested tags count for their parents", sec.hasTag(["project/lighthouse"], "project") && !sec.hasTag(["projects"], "project"))
check("sections: reading hides comments and ids", sec.stripHidden("a %%x%% b ^id\n%%\ngone\n%%\nc") === "a  b\nc", sec.stripHidden("a %%x%% b ^id\n%%\ngone\n%%\nc"))
