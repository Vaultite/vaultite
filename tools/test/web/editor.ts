import { check } from "../lib.ts"
import { plugin, same, web } from "./lib.ts"

// ---------- Clear formatting (plugins/core/editing/edit.ts) ----------
{
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const { clearFormatting } = await plugin("editing/edit.ts")
  const clear = (doc: string, from: number, to: number) => {
    const view = { state: EditorState.create({ doc, selection: EditorSelection.range(from, to) }), dispatch(tr: import("@codemirror/state").TransactionSpec) { this.state = this.state.update(tr).state } }
    clearFormatting(view as never)
    return view.state.doc.toString()
  }
  const line = "**alpha** ==beta== `x`"
  check("clear formatting: a whole line's marks", clear(line, 0, line.length) === "alpha beta x", clear(line, 0, line.length))
  check("clear formatting: a selection stopping at hidden marks (live preview's Home and End) takes them in",
    clear(line, 2, line.length - 1) === "alpha beta x", clear(line, 2, line.length - 1))
  check("clear formatting: a word in its marks; a lone * stays", clear("a **b** c", 4, 5) === "a b c" && clear("2*3 x", 2, 3) === "2*3 x", [clear("a **b** c", 4, 5), clear("2*3 x", 2, 3)])
}

// ---------- Highlight colours in the editor (web/src/core/highlights.ts, web/src/editor/highlights.ts) ----------
{
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const hl: typeof import("../../../web/src/core/highlights.ts") = await web("core/highlights.ts")
  const { clearFormatting } = await plugin("editing/edit.ts")
  type View = { state: import("@codemirror/state").EditorState; dispatch(tr: import("@codemirror/state").TransactionSpec): void; focus(): void }
  // "|" is the cursor, "[...]" a selection.
  const view = (doc: string): View => {
    const a = doc.indexOf("["), c = doc.indexOf("|")
    const text = doc.replace(/[[\]|]/g, "")
    const sel = c >= 0 ? EditorSelection.cursor(c) : EditorSelection.range(a, doc.indexOf("]") - 1)
    return { state: EditorState.create({ doc: text, selection: sel }), dispatch(tr) { this.state = this.state.update(tr).state }, focus() {} }
  }
  const shown = (v: View) => {
    const { from, to } = v.state.selection.main, t = v.state.doc.toString()
    return from === to ? t.slice(0, from) + "|" + t.slice(from) : `${t.slice(0, from)}[${t.slice(from, to)}]${t.slice(to)}`
  }
  const act = (doc: string, fn: (v: never) => unknown) => { const v = view(doc); fn(v as never); return shown(v) }
  const at = view("a ==🟢be|ta== c")
  const h = hl.highlightAt(at.state, at.state.selection.main.head)
  check("editor highlights: the one at the cursor, its marks and colour", h?.from === 2 && h.to === 12 && h.color === "green" && h.len === 2, h)
  check("editor highlights: none outside", hl.highlightAt(view("a| ==x==").state, 1) === null)
  check("editor highlights: recolour keeps the cursor in the text", act("a ==🟢be|ta== c", hl.colorHighlight("red")) === "a ==🔴be|ta== c", act("a ==🟢be|ta== c", hl.colorHighlight("red")))
  check("editor highlights: Default takes the emoji out", act("a ==🟢be|ta== c", hl.colorHighlight(null)) === "a ==be|ta== c" && act("a ==be|ta== c", hl.colorHighlight("blue")) === "a ==🔵be|ta== c")
  check("editor highlights: a selection highlighted in a colour, still selected", act("a [word] c", hl.colorHighlight("orange")) === "a ==🟠[word]== c", act("a [word] c", hl.colorHighlight("orange")))
  check("editor highlights: the word at the cursor; nowhere, the cursor between new marks", act("a wo|rd c", hl.colorHighlight("green")) === "a ==🟢wo|rd== c"
    && act("a | c", hl.colorHighlight("green")) === "a ==🟢|== c", [act("a wo|rd c", hl.colorHighlight("green")), act("a | c", hl.colorHighlight("green"))])
  const un = view("a ==🟣be|ta== c")
  check("editor highlights: toggling a coloured one off takes its colour too", hl.unhighlight(un as never) && shown(un) === "a be|ta c" && !hl.unhighlight(view("a ==be|ta== c") as never), shown(un))
  const { highlightIcon, highlightItems }: { highlightIcon(c: string | null, now?: boolean): unknown; highlightItems(view: never, at?: number): { label: string; icon?: unknown; run(): void }[] } = await web("core/highlightMenu.ts")
  const items = highlightItems(view("a ==🔵x|== c") as never)
  check("editor highlights: the menu's colours, the one there ringed", items.map((i) => i.label).join() === "Default,Red,Orange,Yellow,Green,Blue,Purple"
    && items.filter((i) => i.icon === highlightIcon(i.label === "Default" ? null : i.label.toLowerCase(), true)).map((i) => i.label).join() === "Blue", items.map((i) => i.label))
  const sw = view("a ==🔵x|== c")
  const swatch = highlightItems(sw as never, 2)
  swatch.find((i) => i.label === "Yellow")!.run()
  check("editor highlights: the swatch's menu recolours its highlight", shown(sw) === "a ==🟡x|== c", shown(sw))
  swatch.find((i) => i.label === "Remove highlight")!.run()
  check("editor highlights: and Remove highlight takes it out", shown(sw) === "a x| c", shown(sw))
  const clear = (doc: string) => act(doc, (v: never) => clearFormatting(v, hl.HIGHLIGHT_EMOJI))
  check("clear formatting: a coloured highlight's emoji goes with its marks (selected, at the cursor, or from where its marks hide)",
    clear("[==🟢beta== x]") === "[beta x]" && clear("a ==🟢be|ta== c") === "a [beta] c" && clear("==🟢[beta]==") === "[beta]", [clear("[==🟢beta== x]"), clear("a ==🟢be|ta== c"), clear("==🟢[beta]==")])

  // Typing == suggests the colours (CodeMirror's CompletionContext needs a page; the source reads its state and pos).
  const { highlightSource }: { highlightSource(ctx: never): unknown } = await web("editor/highlights.ts")
  const { markdown } = await import("@codemirror/lang-markdown")
  const suggest = (doc: string) => {
    const pos = doc.indexOf("|"), text = doc.replace("|", "")
    const state = EditorState.create({ doc: text, extensions: [markdown()] })
    const ctx = { state, pos, explicit: false, matchBefore(re: RegExp) {
      const l = state.doc.lineAt(pos), t = l.text.slice(0, pos - l.from), m = new RegExp(`(?:${re.source})$`, re.flags).exec(t)
      return m ? { from: l.from + m.index, to: pos, text: m[0] } : null
    } } as never
    return highlightSource(ctx) as { from: number; options: import("@codemirror/autocomplete").Completion[] } | null
  }
  const offered = suggest("A ==|")
  check("editor highlights: == suggests the six colours", offered?.options.map((o) => o.label).join() === "Red,Orange,Yellow,Green,Blue,Purple" && offered.from === 4, offered?.options.map((o) => o.label))
  check("editor highlights: narrowed by a name typed after it", suggest("A ==gr|")?.options.map((o) => o.label).join() === "Green" && suggest("A ==text|") === null)
  check("editor highlights: not for a closing ==, a === or in code", suggest("A ==text==|") === null && suggest("a ===|") === null && suggest("`a ==|`") === null)
  const pick = (doc: string) => {
    const r = suggest(doc)!, v = view(doc)
    const apply = r.options.find((o) => o.label === "Green")!.apply as (v: never, c: unknown, from: number, to: number) => void
    apply(v as never, null, r.from, v.state.selection.main.head)
    return shown(v)
  }
  check("editor highlights: a pick goes in with the closing == after the cursor, or alone before text", pick("A ==|") === "A ==🟢|==" && pick("A ==|word") === "A ==🟢|word",
    [pick("A ==|"), pick("A ==|word")])
}

// ---------- Suggestions: #tags in the editor, and a search query's operators and values (editor/tags.ts, QuerySuggest) ----------
{
  const { EditorState } = await import("@codemirror/state")
  const { markdown } = await import("@codemirror/lang-markdown")
  type Pairs = [string, number][]
  type TagCount = { tag: string; count: number; only?: string }
  type Found = { from: number; to: number; items: { text: string }[] } | null
  const { vocabOf }: { vocabOf(files: never[]): { tagFiles: TagCount[]; tags: Pairs; types: Pairs; folders: Pairs } } = await web("core/vocab.ts")
  const { tagSource }: { tagSource(tags: () => TagCount[]): (ctx: never) => { from: number; options: import("@codemirror/autocomplete").Completion[] } | null } = await web("editor/tags.ts")
  const sq = await import("../../../core/searchquery.ts")
  const file = (p: string, tags: string[], type: string | null = null) => ({ path: p, tags, type }) as never
  const files = [file("Notes/Idea.md", ["work", "Ideas"], "note"), file("Notes/Deep/Plan.md", ["work", "project/lighthouse"], "project"),
    file("People/Alice Park.md", ["work"], "person"), file("Draft.md", ["wor"]), file("Notes/Gone.md", ["secret"], "note")]
  ;(files[4] as { excluded?: boolean }).excluded = true
  const v = vocabOf(files)
  check("suggest vocab: tags by how many files have them, with the one file a tag is only in", JSON.stringify(v.tagFiles.slice(0, 2)) === '[{"tag":"work","count":3},{"tag":"Ideas","count":1,"only":"Notes/Idea.md"}]'
    && !v.tags.some(([t]) => t === "secret") && vocabOf(files) === v, v.tagFiles)
  check("suggest vocab: types, and folders counting the files under them", JSON.stringify(v.types) === '[["note",1],["project",1],["person",1]]'
    && JSON.stringify(v.folders) === '[["Notes",2],["Notes/Deep",1],["People",1]]', [v.types, v.folders])

  // Properties' names and values.
  const { fieldSuggestions, valuesOf } = await web("core/vocab.ts") as { fieldSuggestions(list: Pairs, typed: string, has?: string[]): Found
    valuesOf(rows: { path: string; value: unknown }[], except: string, near?: (path: string) => boolean): Pairs }
  const names: [string, number][] = [["status", 9], ["tags", 7], ["project", 3], ["start", 2]]
  const labels = (r: ReturnType<typeof fieldSuggestions>) => r?.items.map((i) => i.text).join() ?? null
  check("property suggest: every name for an empty field, but the file's own", labels(fieldSuggestions(names, "", ["tags"])) === "status,project,start")
  check("property suggest: the ones starting with what's typed first, then the most used", labels(fieldSuggestions(names, "st")) === "status,start" && labels(fieldSuggestions(names, "ta")) === "tags,status,start",
    [labels(fieldSuggestions(names, "st")), labels(fieldSuggestions(names, "ta"))])
  check("property suggest: none once what's typed is one of them (Enter keeps it), or nothing has it", fieldSuggestions(names, "Status") === null && fieldSuggestions(names, "zz") === null)
  const rows = [{ path: "a.md", value: "Draft" }, { path: "b.md", value: "draft" }, { path: "c.md", value: ["x", "y"] }, { path: "d.md", value: { a: 1 } },
    { path: "e.md", value: true }, { path: "f.md", value: 3 }, { path: "me.md", value: "mine" }, { path: "g.md", value: "a\nb" }]
  check("property suggest: a key's values elsewhere, each once without case, list items each, short text and numbers only",
    JSON.stringify(valuesOf(rows, "me.md")) === '[["Draft",2],["x",1],["y",1],["3",1]]', valuesOf(rows, "me.md"))
  check("property suggest: the values files of its type have first", JSON.stringify(valuesOf(rows, "me.md", (p) => p === "f.md").slice(0, 2)) === '[["3",1],["Draft",2]]'
    && labels(fieldSuggestions(valuesOf(rows, "me.md", (p) => p === "c.md"), "")) === "x,y,Draft,3", valuesOf(rows, "me.md", (p) => p === "f.md"))

  // The editor's # list ("|" is the cursor; CodeMirror's CompletionContext needs a page, so a made-up one).
  const tags = (doc: string, explicit = false) => {
    const pos = doc.indexOf("|"), text = doc.replace("|", "")
    const state = EditorState.create({ doc: text, extensions: [markdown()] })
    const ctx = { state, pos, explicit, matchBefore(re: RegExp) {
      const l = state.doc.lineAt(pos), t = l.text.slice(0, pos - l.from), m = new RegExp(`(?:${re.source})$`, re.flags).exec(t)
      return m ? { from: l.from + m.index, to: pos, text: m[0] } : null
    } } as never
    const r = tagSource(() => v.tagFiles.filter((t) => t.only !== "Draft.md"))(ctx)
    return r && { from: r.from, labels: r.options.map((o) => o.label), r, state }
  }
  const after = tags("Some text #|")
  check("editor tags: # after a space lists the vault's tags, most used first", after?.labels.join() === "#work,#Ideas,#project/lighthouse" && after.from === 10, after?.labels)
  check("editor tags: as the tag is typed it's still asked for (the list narrows it)", tags("a #wo|")?.from === 2 && tags("#wo|")?.from === 0)
  check("editor tags: not for a heading's #, a word's #, code, a link or the frontmatter",
    tags("#|") === null && tags("a#|") === null && tags("`a #|`") === null && tags("```\n#|\n```") === null && tags("[[Note #|") === null && tags("---\ntags: #|\n---\n") === null,
    [tags("#|")?.labels, tags("a#|")?.labels, tags("`a #|`")?.labels])
  check("editor tags: a tag only the note itself has isn't offered (it's the one being typed)", !after?.labels.includes("#wor"))
  const put = (doc: string, label: string) => {
    const t = tags(doc)!, o = t.r.options.find((x) => x.label === label)!
    const view = { state: EditorState.create({ doc: doc.replace("|", ""), selection: { anchor: doc.indexOf("|") } }), dispatch(tr: import("@codemirror/state").TransactionSpec) { this.state = this.state.update(tr).state } }
    ;(o.apply as (v: never, c: unknown, from: number, to: number) => void)(view as never, o, t.from, doc.indexOf("|"))
    const s = view.state, h = s.selection.main.head
    return s.doc.toString().slice(0, h) + "|" + s.doc.toString().slice(h)
  }
  check("editor tags: a pick goes in with a space after it, unless one's there", put("a #wo|", "#work") === "a #work |" && put("a #pro| b", "#project/lighthouse") === "a #project/lighthouse| b",
    [put("a #wo|", "#work"), put("a #pro| b", "#project/lighthouse")])

  // A query's operators and values.
  const ask = (q: string) => { const at = q.indexOf("|"), text = q.replace("|", ""); const r = sq.suggestQuery(text, at, v); return r && { ...r, labels: r.items.map((i) => i.label), texts: r.items.map((i) => i.text) } }
  check("query suggest: an empty box offers every operator, operators then their values",
    ask("|")?.labels[0] === "tag:" && ask("|")?.items.every((i) => i.more) && ask("|")!.items.length === sq.QUERY_OPTIONS.length, ask("|")?.labels)
  check("query suggest: an operator by its start", ask("ty|")?.labels.join() === "type:" && ask("work ta|")?.labels.join() === "tag:,task:,task-todo:,task-done:" && ask("work ta|")?.from === 5, ask("work ta|"))
  check("query suggest: tag:'s values, with or without #, the ones starting with it first", ask("tag:|")?.labels.join() === "#work,#Ideas,#project/lighthouse,#wor"
    && ask("tag:#li|")?.texts.join() === "tag:#project/lighthouse" && ask("tag:i|")?.texts[0] === "tag:#Ideas", [ask("tag:|")?.labels, ask("tag:i|")?.texts])
  check("query suggest: type: and folder:, quoted when they have a space; - and ( kept", ask("type:pe|")?.texts.join() === "type:person" && ask("-folder:Pe|")?.texts.join() === 'folder:People'
    && ask("-folder:Pe|")?.from === 1 && ask("(folder:Notes/D|")?.texts.join() === "folder:Notes/Deep", [ask("type:pe|"), ask("-folder:Pe|")])
  check("query suggest: a value with a space quoted", sq.suggestQuery("folder:My", 9, { ...v, folders: [["My notes", 2]] })?.items[0].text === 'folder:"My notes"')
  check("query suggest: #wo is a tag, as tag:#work", ask("#wo|")?.texts.join() === "tag:#work,tag:#wor", ask("#wo|")?.texts)
  check("query suggest: nothing inside a word, after a space, for a whole value typed, or other operators' values",
    ask("ta|g") === null && ask("work |") === null && ask("type:person|") === null && ask("path:No|") === null && ask("zz|") === null, [ask("type:person|"), ask("work |")])
}

{
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const { markdown } = await import("@codemirror/lang-markdown")
  const { ensureSyntaxTree } = await import("@codemirror/language")
  const paste: typeof import("../../../web/src/editor/paste.ts") = await web("editor/paste.ts")
  const { htmlToMarkdown } = await import("../../../core/htmlmd.ts")
  type View = { state: import("@codemirror/state").EditorState; dispatch(tr: import("@codemirror/state").TransactionSpec): void }
  const view = (doc: string, from: number, to = from, more?: [number, number]): View => {
    const ranges = [EditorSelection.range(from, to), ...(more ? [EditorSelection.range(...more)] : [])]
    const state = EditorState.create({ doc, selection: EditorSelection.create(ranges), extensions: [markdown(), EditorState.allowMultipleSelections.of(true)] })
    ensureSyntaxTree(state, state.doc.length, 5000)
    return { state, dispatch(tr) { this.state = this.state.update(tr).state } }
  }
  const clip = (data: Record<string, string>) => {
    let prevented = false
    const e = { clipboardData: { types: Object.keys(data), getData: (t: string) => data[t] ?? "" }, preventDefault: () => { prevented = true } }
    return { e, prevented: () => prevented }
  }
  const linked = (v: View, url: string) => { const c = clip({ "text/plain": url }); const took = paste.pasteLink(c.e, v); return { took, text: v.state.doc.toString() } }
  check("paste a link over a selection: [text](url), every range", same(linked(view("see the docs here", 8, 12), "https://x.test/a"), { took: true, text: "see the [docs](https://x.test/a) here" }) &&
    linked(view("a b c", 0, 1, [4, 5]), " https://x.test ").text === "[a](https://x.test) b [c](https://x.test)")
  check("paste a link: not with nothing selected, a URL selected, text that isn't one, lines, or in code",
    [view("docs", 2), view("https://old.test", 0, 16), view("a\nb", 0, 3), view("`code`", 1, 5)].every((v) => !linked(v, "https://x.test").took) &&
    !linked(view("docs", 0, 4), "not a url").took)
  await import("../../../core/htmlmd.ts")
  const pasted = async (v: View, data: Record<string, string>) => {
    const c = clip(data), took = paste.pasteHtml(c.e, v), was = v.state.doc
    for (let i = 0; took && v.state.doc === was && i < 50; i++) await new Promise((r) => setImmediate(r))
    return { took, prevented: c.prevented(), text: v.state.doc.toString() }
  }
  const page = { "text/html": '<meta charset="utf-8"><h2>Plan</h2><p>Go <b>now</b>, see <a href="https://x.test">this</a>.</p><ul><li>one</li><li>two</li></ul>', "text/plain": "Plan\nGo now, see this.\none\ntwo" }
  check("paste HTML: Markdown at the cursor", same(await pasted(view("A\n\nB", 1), page), { took: true, prevented: true, text: "A## Plan\n\nGo **now**, see [this](https://x.test).\n\n- one\n- two\n\nB" }),
    await pasted(view("A\n\nB", 1), page))
  check("paste HTML: plain paragraphs, code editors' colours, inside code and with several cursors go in as text",
    !(await pasted(view("x", 1), { "text/html": "<p>Just text</p>", "text/plain": "Just text" })).took &&
    !(await pasted(view("x", 1), { "text/html": '<div style="white-space: pre;"><span style="font-style: italic;">// c</span></div>', "text/plain": "// c" })).took &&
    !(await pasted(view("x", 1), { "vscode-editor-data": "{}", ...page })).took &&
    !(await pasted(view("```\nx\n```", 5), page)).took && !(await pasted(view("ab", 0, 0, [1, 1]), page)).took)
  check("html to Markdown: Google Docs' wrapper isn't bold, the app's own links come back as wikilinks",
    htmlToMarkdown('<b style="font-weight:normal;" id="docs-internal-guid-1"><p>Hi <span style="font-weight:700">there</span></p></b>') === "Hi **there**" &&
    htmlToMarkdown('<a class="wikilink" data-wiki="Idea#Plans">Idea › Plans</a> and <a data-wiki="Idea">the idea</a>') === "[[Idea#Plans]] and [[Idea|the idea]]",
    [htmlToMarkdown('<b style="font-weight:normal;"><p>Hi <span style="font-weight:700">there</span></p></b>'), htmlToMarkdown('<a class="wikilink" data-wiki="Idea#Plans">Idea › Plans</a> and <a data-wiki="Idea">the idea</a>')])
}
