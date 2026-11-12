import { check } from "../lib.ts"

// ---------- Slides: a note as a deck, read as Advanced Slides reads one (plugins/core/slides/slides.ts) ----------
{
  const { cssFiles, cssPlaces, cssUrls, parseDeck, sizeOf, isTitleSlide, scopeCss, scopeSelector, upcoming, elapsedText, templateNames } = await import("../../../plugins/core/slides/slides.ts")
  const mds = (body: string, opts = {}) => parseDeck(body, opts).slides.map((s) => s.md)
  const got = mds("# Launch\n\n---\n\n## Why\n- one\n\n----\n```md\n---\nnot a split\n```\n---\n\n---\n![[chart.png]]\n")
  check("slides: split at --- lines, never inside code, empty ones dropped", got.length === 4 && got[0] === "# Launch" && got[2].includes("not a split") && got[3] === "![[chart.png]]", got)
  check("slides: a note without --- is one slide", mds("Just text\n").length === 1)
  check("slides: headings only (and a short line) is a title slide", isTitleSlide("# Launch\nQ3 plan") && !isTitleSlide("# Plan\n- one\n- two") && !isTitleSlide("Text only"))

  const deck = parseDeck("<style>\n.reveal h1 { color: red }\n</style>\n\n# Hi\n\nnotes:\nSay hi.\n\n- and this\n\n---\n# One\n--\n# One, below\nNote: under it\n---\n```\nnote: in code\n```\n")
  const [a, b, c, d] = deck.slides
  check("slides: notes: to the end of the slide are its notes, not on it", a.md === "# Hi" && a.notes === "Say hi.\n\n- and this" && c.notes === "under it" && !d.notes && d.md.includes("note: in code"), deck.slides)
  check("slides: -- makes vertical slides, in their column", deck.slides.length === 4 && b.h === 1 && b.v === 0 && c.h === 1 && c.v === 1 && d.h === 2, deck.slides.map((s) => [s.h, s.v]))
  check("slides: a <style> is the deck's, off its slide", deck.css === ".reveal h1 { color: red }" && !a.md.includes("style"))
  check("slides: a <style> in a %% comment is left out", parseDeck("%%\n<style>h1{}</style>\n%%\n# A").css === "")
  const custom = parseDeck("# A\n\n===\n\n# B\n>>\n# C\n??? said\n", { separator: "^===$", verticalSeparator: "\\n>>\\n", notesSeparator: "\\?\\?\\?" })
  check("slides: frontmatter's separator, verticalSeparator and notesSeparator", custom.slides.length === 3 && custom.slides[2].v === 1 && custom.slides[2].notes === "said", custom.slides)
  check("slides: a bad separator regex is matched as text", mds("a\n(\nb", { separator: "(" }).length === 2)

  const [bgd, frag, lst] = parseDeck('<!-- slide bg="[[pic.png]]" data-background-opacity="0.5" -->\n## Pic\n---\n<!-- .slide: class="big" style="color: red" -->\nFade in <!-- element class="fragment" data-fragment-index="2" -->\n---\n- Always\n+ First\n+ Second\n1) Third\n').slides
  check("slides: <!-- slide bg --> is the slide's background, its data-background-* its look", bgd.bg === "[[pic.png]]" && bgd.bgAttrs.opacity === "0.5" && bgd.md === "## Pic", bgd)
  const codeNote = parseDeck('Short syntax: `![](fas fa-envelope)<!-- .element: color="coral" -->`, as written').slides[0]
  check("slides: an annotation inside inline code is shown, not applied", codeNote.md === 'Short syntax: `![](fas fa-envelope)<!-- .element: color="coral" -->`, as written' && !codeNote.els.length, codeNote)
  const quoteNote = parseDeck('> [!tip] A tip\n> Its text\n<!-- element style="width:40%" -->\n\nAfter').slides[0]
  check("slides: an annotation right under a callout is the callout's, not its last line's", /Its text\n\n<span class="slide-el-0"><\/span>/.test(quoteNote.md) && quoteNote.els[0].style.includes("width:40%"), quoteNote.md)
  check("slides: <!-- .slide: --> gives the slide a class and style", frag.cls === "big" && frag.style === "color: red")
  check("slides: an element annotation is a marker where it was", frag.md === 'Fade in <span class="slide-el-0"></span>' && frag.els[0].cls === "fragment" && frag.els[0].index === 2, frag)
  check("slides: + and 1) list items are fragments, - ones aren't", lst.els.length === 3 && lst.els.every((e) => e.li && e.cls === "fragment") && !lst.md.split("\n")[0].includes("slide-el"), lst)
  const lay = (body: string) => parseDeck(body).slides[0]
  const sp = lay("<split even gap=\"3\">\n\n![[a.png]]\n![[b.png]]\n</split>\n::: block\nC\n:::")
  const [split, block] = sp.boxes as any[]
  check("slides: <split even gap>: a row whose items share it, 3em apart; each image line its own item", split.kind === "split" && split.style.includes("--split-gap: 3em") && split.kids.includes("flex: 1")
    && split.in.length === 1 && split.in[0] === "![[a.png]]\n\n![[b.png]]" && !sp.canvas, sp.boxes)
  check("slides: ::: block is a block box, its Markdown kept (and the slide's md is all of it, in order)", block.kind === "block" && block.cls === "block" && block.in[0] === "C" && sp.md === "![[a.png]]\n\n![[b.png]]\n\nC", sp)
  const lr = lay("<split left=\"2\" right=\"1\">\nA\n\nB\n</split>").boxes![0] as any, wr = lay("<split wrap=\"4\" no-margin>\nA\n</split>").boxes![0] as any
  check("slides: <split left right>: its first and second items' shares; wrap: so many to a row; no-margin: no gaps", JSON.stringify(lr.nth.slice(0, 2)) === '["flex: 2","flex: 1"]'
    && lr.style.includes("--split-gap: 0px") && wr.kids.includes("calc((100% - var(--split-gap) * 3) / 4)") && wr.kids.includes("margin: 0"), { lr, wr })
  const nest = lay("<grid drag=\"40 30\" drop=\"topleft\">\n<split even>\nA\n\nB\n</split>\n</grid>\n<split>\n<split>\nX\n</split>\n</split>")
  check("slides: layouts nest (a split in a grid, a split in a split)", nest.canvas && (nest.boxes![0] as any).in[0].kind === "split" && (nest.boxes![1] as any).in[0].kind === "split" && (nest.boxes![1] as any).in[0].in[0] === "X", nest.boxes)
  // (Advanced Slides' own test decks, test/gridComponent.unit.test.ts, and the styles its snapshots have)
  const place = (drag: string, drop: string) => (lay(`<grid ${drag ? `drag="${drag}" ` : ""}drop="${drop}">\nA\n</grid>`).boxes![0] as any).style.match(/left: [^;]+; top: [^;]+; width: [^;]+; height: [^;]+/)?.[0]
  check("slides: a grid's drop: x y, negative from the right and bottom, px of a 960 x 700 slide, named places; drag its size (50 x 100 when left out)",
    place("60 55", "5 10") === "left: 5%; top: 10%; width: 60%; height: 55%" && place("25 55", "-5 10") === "left: 70%; top: 10%; width: 25%; height: 55%"
    && place("30 30", "-40px 40px") === "left: 65.833%; top: 5.714%; width: 30%; height: 30%" && place("40 40", "-5 -20") === "left: 55%; top: 40%; width: 40%; height: 40%"
    && place("", "right") === "left: 50%; top: 0%; width: 50%; height: 100%" && place("55 50", "topright") === "left: 45%; top: 0%; width: 55%; height: 50%"
    && place("25 20", "center") === "left: 37.5%; top: 40%; width: 25%; height: 20%" && place("80 30", "bottom") === "left: 10%; top: 70%; width: 80%; height: 30%", place("30 30", "-40px 40px"))
  const sized = (parseDeck('<grid drag="480px 270px" drop="960px 540px">\nA\n</grid>', { width: 1920, height: 1080 }).slides[0].boxes![0] as any).style
  check("slides: a deck's width and height are what a drop's px are of", sized.includes("left: 50%; top: 50%; width: 25%; height: 25%"), sized)
  const sz = sizeOf({ width: "1280", height: 720, margin: 0.1, minScale: 0.2, maxScale: 3, center: false }), dz = sizeOf({ width: "wide", margin: 2 })
  check("slides: size and scale from frontmatter, Advanced Slides' size and the app's scale where unset or bad",
    sz.w === 1280 && sz.h === 720 && sz.margin === 0.1 && sz.minScale === 0.2 && sz.maxScale === 3 && !sz.center && dz.w === 960 && dz.h === 700 && dz.margin === undefined && dz.maxScale === undefined && dz.center, [sz, dz])
  const flexOf = (at: string) => (lay(`<grid drag="100 100" drop="0 0" ${at}>\nA\n</grid>`).boxes![0] as any).style.match(/flex-direction: [^;]+; align-items: [^;]+; justify-content: [^;]+/)?.[0]
  check("slides: a grid's flow and align place its items as Advanced Slides does", flexOf("") === "flex-direction: column; align-items: center; justify-content: center"
    && flexOf('flow="row" align="left"') === "flex-direction: row; align-items: center; justify-content: space-evenly" && flexOf('flow="col" align="left"') === "flex-direction: column; align-items: flex-start; justify-content: space-evenly"
    && flexOf('flow="col" align="bottomright"') === "flex-direction: column; align-items: flex-end; justify-content: flex-end" && flexOf('flow="row" align="top"') === "flex-direction: row; align-items: flex-start; justify-content: space-evenly"
    && flexOf('justify-content="space-between"') === "flex-direction: column; align-items: center; justify-content: space-between", flexOf('flow="row" align="top"'))
  const look = lay('<grid drag="30 25" drop="5 15" bg="#B565A7" filter="blur(10px)" rotate="-15" border="4px solid white" pad="0 50px" opacity="0.5" animate="fadeIn slower" frag="2">\nA\n</grid>\n+ One').boxes!
  const lg = look[0] as any
  check("slides: a grid's bg, filter, rotate, border, pad, opacity, animate and frag", lg.bg === "#B565A7" && ["filter: blur(10px)", "transform: rotate(-15deg)", "border: 4px solid white", "padding: 0 50px", "opacity: 0.5"].every((x) => lg.style.includes(x))
    && lg.cls === "fadeIn slower fragment" && lg.index === 2, lg)
  check("slides: a fragment list's items count from 1, beside a grid's frag", lay("+ One\n+ Two").els.map((e) => e.index).join() === "1,2")
  const st = lay("<grid drag=\"100 45\" drop=\"top\" flow=\"row\" align=\"stretch\">\nA\n</grid>").boxes![0] as any
  check("slides: align=\"stretch\" fills the grid with its items", st.cls === "stretch-row" && st.kids.includes("height: 100%; width: 1%"), st)
  const note = lay('### Noise <!-- element drag="55 50" drop="bottomright" bg="rgb(0,0,0)" -->')
  check("slides: an element annotation's drag, drop and bg place it too", note.canvas && note.els[0].bg === "rgb(0,0,0)" && note.els[0].style.includes("left: 45%; top: 50%"), note.els)
  const bl = lay('::: block <!-- element style="background-color: red;" -->\n\nred\n\n::: block <!-- element style="background-color: blue;" -->\n\nblue\n\n:::\n\nred\n\n:::\n\nno color').boxes!
  check("slides: ::: block <!-- element style -->: the block's style, blocks in blocks, what's after outside", (bl[0] as any).style === "background-color: red;" && (bl[0] as any).in[1].style === "background-color: blue;"
    && (bl[0] as any).in[1].in[0] === "blue" && (bl[0] as any).in[2] === "red" && bl[1] === "no color", bl)
  check("slides: layout tags inside code are text", !lay("```\n<split even>\n:::\n```").boxes && !lay("Use `<grid drop=\"center\">` here").boxes)

  const { moveOf } = await import("../../../plugins/core/slides/slides.ts")
  const tr = parseDeck('# A\n---\n<!-- slide data-transition="zoom" data-transition-speed="fast" data-background-transition="slide" bg="#000" -->\n# B\n--\n<!-- .slide: data-transition="fade-in convex-out" -->\n# C\n---\n<!-- slide data-auto-animate -->\n# T\n---\n<!-- slide data-auto-animate data-auto-animate-duration="2" -->\n# T\n## Sub <!-- element data-id="sub" data-auto-animate-delay="0.5" -->\n---\n<!-- slide data-auto-animate data-auto-animate-restart -->\n# T\n').slides
  check("slides: data-transition, -speed and data-auto-animate are the slide's data", tr[1].data.transition === "zoom" && tr[1].data["transition-speed"] === "fast" && tr[1].bgAttrs.transition === "slide" && tr[3].data["auto-animate"] === "" && !tr[1].md.includes("<!--"), tr[1])
  check("slides: an element annotation's data-* (data-id) are kept", tr[4].els[0]?.data?.id === "sub" && tr[4].els[0]?.data?.["auto-animate-delay"] === "0.5" && !("fragment-index" in (tr[4].els[0]?.data ?? {})), tr[4].els)
  const m01 = moveOf(tr[0], tr[1])
  check("slides: a slide comes in its own way, the one before leaves the deck's (slide), at their speeds", m01.in === "zoom" && m01.out === "slide" && m01.inMs === 400 && m01.outMs === 800 && !m01.vertical && !m01.back && !m01.auto, m01)
  check("slides: a background changing: its data-background-transition, else fade; the same one: none", m01.bg === "slide" && moveOf(tr[1], tr[0]).bg === "fade" && moveOf(tr[3], tr[4]).bg === "none" && moveOf(tr[3], tr[4], { bg: "#fff" }).bg === "none")
  const m12 = moveOf(tr[1], tr[2]), m21 = moveOf(tr[2], tr[1])
  check("slides: down a column is vertical; a pair like fade-in convex-out", m12.vertical && m12.in === "fade" && m12.out === "zoom" && m21.out === "convex" && m21.back && m21.vertical, [m12, m21])
  const fm = { transition: "concave", transitionSpeed: "slow", backgroundTransition: "zoom" }
  check("slides: frontmatter transition, transitionSpeed, backgroundTransition for the deck", moveOf(tr[0], tr[2], fm).in === "fade" && moveOf(tr[2], tr[3], fm).in === "concave" && moveOf(tr[2], tr[3], fm).inMs === 1200 && moveOf(tr[0], tr[1], fm).out === "concave" && moveOf(tr[1], tr[3], fm).bg === "zoom"
    && moveOf(tr[0], tr[3], { transition: "none" }).in === "none" && moveOf(tr[0], tr[3], { transition: "bogus" }).in === "slide")
  const auto = moveOf(tr[3], tr[4])
  check("slides: two data-auto-animate slides auto-animate, without a slide transition (duration in s, ease)", auto.auto?.ms === 2000 && auto.auto.easing === "ease" && auto.auto.unmatched && auto.in === "none" && auto.out === "none", auto)
  check("slides: auto-animate needs both, the same id, no restart on the later one, and autoAnimate not false",
    !moveOf(tr[2], tr[3]).auto && !moveOf(tr[4], tr[5]).auto && !moveOf(tr[5], tr[4]).auto && !!moveOf(tr[4], tr[3]).auto && !moveOf(tr[3], tr[4], { autoAnimate: false }).auto
    && moveOf(tr[3], tr[4], { autoAnimateUnmatched: false }).auto?.unmatched === false && moveOf(tr[4], tr[3], { autoAnimateDuration: 0.5 }).auto?.ms === 500)
  const ids = parseDeck('<!-- slide data-auto-animate data-auto-animate-id="a" -->\n# X\n---\n<!-- slide data-auto-animate data-auto-animate-id="b" -->\n# X\n').slides
  check("slides: different data-auto-animate-ids don't auto-animate", !moveOf(ids[0], ids[1]).auto)

  const tpls: Record<string, string> = {
    "tpl-footer": "<% content %>\n\n<grid drag=\"100 6\" drop=\"bottom\">\n<% footer %>\n</grid>",
    "tpl-opt": "<% content %>\n\n<%? source %>\n<style>.src { color: red }</style>",
    "tpl-outer": "# Outer\n<% content %>", "tpl-inner": "<!-- slide template=\"[[tpl-outer]]\" -->\n## Inner\n<% content %>",
  }
  const tdeck = parseDeck('<!-- slide template="[[tpl-footer]]" bg="red" -->\n# Main\n\n::: footer\n#### Foot\n:::\n\nnote: say it\n---\n<!-- slide template="[[tpl-opt]]" -->\nNo source\n---\n<!-- slide template="[[tpl-inner]]" -->\nText\n---\n<!-- slide template="[[missing]]" -->\nAs is\n', {}, (n) => tpls[n])
  const [t1, t2, t3, t4] = tdeck.slides
  const flat = (md: string) => md.replace(/\n+/g, "\n")
  check("slides: a template draws the slide as its <% content %>, a ::: name block as <% name %>, notes kept the slide's",
    flat(t1.md) === "# Main\n#### Foot" && /"kind":"grid".*Foot/.test(JSON.stringify(t1.boxes)) && t1.notes === "say it" && t1.bg === "red", t1)
  check("slides: a template's unset <%? name %> is left out, its <style> the deck's", t2.md === "No source" && tdeck.css.includes(".src"), [t2.md, tdeck.css])
  check("slides: a template may use a template; a missing one leaves the slide as written", flat(t3.md) === "# Outer\n## Inner\nText" && t4.md === "As is", [t3.md, t4.md])
  const dflt = parseDeck("# A\n---\n<!-- slide template=\"[[tpl-outer]]\" -->\nB\n", { defaultTemplate: "[[tpl-inner]]" }, (n) => tpls[n]).slides
  check("slides: defaultTemplate is every slide's, unless it names its own", flat(dflt[0].md) === "# Outer\n## Inner\n# A" && flat(dflt[1].md) === "# Outer\nB", dflt.map((x) => x.md))
  check("slides: the templates a deck names, defaultTemplate first", JSON.stringify(templateNames('x <!-- slide template="[[a]]" --> <!-- .slide: template="[[b|B]]" -->', { defaultTemplate: "[[c]]" })) === '["c","a","b"]')
  check("slides: the deck's CSS: the page and .reveal are the deck", scopeSelector(":root", "[d]") === "[d]" && scopeSelector(".reveal .slides section h1, .x", "[d]") === "[d] h1, [d] .x"
    && scopeSelector(".reveal.dark p", "[d]") === "[d].dark p" && scopeSelector("html .a", "[d]") === "[d] .a" && scopeSelector(":is(a, b) > c", "[d]") === "[d] :is(a, b) > c")
  const sc = scopeCss("@import url(x.css);\n/* c } */ body { margin: 0 }\n@media (min-width: 1px) { .reveal h2 { color: blue } }\n@font-face { font-family: X; }\n@page { size: A4 }\n.a::after { content: \"}\" }", "[d]")
  check("slides: the deck's CSS stays in the deck (@media scoped, @import and @page dropped)",
    sc.includes("[d] { margin: 0 }") && sc.includes("@media (min-width: 1px) {\n[d] h2 { color: blue }") && sc.includes("@font-face") && !sc.includes("@import") && !sc.includes("A4") && sc.includes('[d] .a::after { content: "}" }'), sc)
  check("slides: css: files (a list or commas) after a theme that's a file or an address; a theme's name isn't one",
    JSON.stringify(cssFiles({ theme: "css/my-theme.css", css: "a.css, [[b.css]]" })) === '["css/my-theme.css","a.css","b.css"]'
    && JSON.stringify(cssFiles({ theme: "night", css: ["x.css", "not css"] })) === '["x.css"]' && cssFiles({ theme: "https://t.example/robot.css" }).length === 1, cssFiles({ theme: "css/my-theme.css", css: "a.css, [[b.css]]" }))
  check("slides: a css: file beside the note, from the root, then in Advanced Slides' folder",
    JSON.stringify(cssPlaces("css/x.css", "Talks/Deck.md")) === '["Talks/css/x.css","css/x.css",".obsidian/plugins/obsidian-advanced-slides/css/x.css"]'
    && JSON.stringify(cssPlaces("../s.css", "A/B/Deck.md").slice(0, 1)) === '["A/s.css"]' && JSON.stringify(cssPlaces("/s.css", "A/Deck.md")) === '["s.css"]', cssPlaces("css/x.css", "Talks/Deck.md"))
  const urls = cssUrls("a { background: url('img/b.png') } b { src: url(https://f.example/x.woff2) } c { mask: url(#m) } d { x: url(data:image/png;base64,AA) }", "Talks/css", (p) => `raw:${p}`)
  check("slides: a stylesheet's relative url()s load from beside it, addresses kept", urls.includes('url("raw:Talks/css/img/b.png")') && urls.includes("url(https://f.example/x.woff2)") && urls.includes("url(#m)") && urls.includes("url(data:image"), urls)

  const up = (at: number, step: number, count: number) => JSON.stringify(upcoming(at, step, count, 3))
  check("slides: the presenter's next: the next fragment, else the next slide (none after the last)", up(0, 0, 2) === '{"at":0,"step":1}'
    && up(0, 2, 2) === '{"at":1,"step":0}' && up(1, Infinity, 1) === '{"at":2,"step":0}' && up(2, 0, 0) === "null" && up(2, 0, 1) === '{"at":2,"step":1}')
  check("slides: the presenter's timer", elapsedText(0) === "0:00" && elapsedText(245_900) === "4:05" && elapsedText(3_845_000) === "1:04:05" && elapsedText(-5) === "0:00")
}

// ---------- Slides themes: reveal's and Advanced Slides' themes in the app's colours (plugins/core/slides/themes.ts) ----------
{
  const { revealTheme, THEME_NAMES } = await import("../../../plugins/core/slides/themes.ts")
  const all = ["black", "white", "league", "beige", "sky", "night", "serif", "simple", "solarized", "blood", "moon", "dracula", "black-contrast", "white-contrast", "consult", "mattropolis"]
  const th = (n: string) => revealTheme(n)!
  check("slides themes: every reveal and Advanced Slides theme is one", all.every((n) => THEME_NAMES.includes(n) && revealTheme(n)?.name === n) && THEME_NAMES.length === all.length, THEME_NAMES)
  const dark = THEME_NAMES.filter((n) => th(n).tone === "dark")
  check("slides themes: their tone", dark.join() === "black,black-contrast,league,night,moon,blood,dracula,mattropolis", dark)
  check("slides themes: by name in any case, default is black; a CSS file, an unknown name or none keep the app's look", th(" Night ").name === "night" && th("Default").name === "black"
    && [undefined, "", 3, "css/my-theme.css", "https://x.test/robot.css", "constructor", "__proto__"].every((n) => revealTheme(n) === null))
  const KEYS = ["--r-background-color", "--r-main-font", "--r-main-font-size", "--r-main-color", "--r-heading-font", "--r-heading-color", "--r-heading-text-transform", "--r-heading1-size", "--r-heading1-font-weight", "--r-link-color"]
  check("slides themes: each sets reveal's --r-* vars", all.every((n) => KEYS.every((k) => th(n).vars[k])), all.filter((n) => !KEYS.every((k) => th(n).vars[k])))
  const hex = all.filter((n) => Object.values(th(n).vars).some((v) => /#[0-9a-f]{3,8}\b/i.test(v)))
  check("slides themes: colours come from the app's tokens, never hex", !hex.length && all.every((n) => /var\(--/.test(th(n).vars["--r-link-color"]) && /var\(--|^white$/.test(th(n).vars["--r-background-color"])), hex)
  const [black, night, serif, league, dracula, sky] = ["black", "night", "serif", "league", "dracula", "sky"].map(th)
  check("slides themes: black: Source Sans, upper case, semibold, blue links", black.vars["--r-heading-font"].startsWith("'Source Sans Pro'") && black.vars["--r-heading-text-transform"] === "uppercase"
    && black.vars["--r-heading2-font-weight"] === "600" && black.vars["--r-link-color"] === "var(--blue)", black.vars)
  check("slides themes: night: Montserrat, tight, as written, a gold accent", night.vars["--r-heading-font"].startsWith("Montserrat") && night.vars["--r-heading-letter-spacing"] === "-0.03em"
    && night.vars["--r-heading-text-transform"] === "none" && /--orange.*--yellow/.test(night.vars["--r-link-color"]))
  check("slides themes: serif: Palatino for headings and text", /Palatino/.test(serif.vars["--r-heading-font"]) && serif.vars["--r-main-font"] === serif.vars["--r-heading-font"] && serif.vars["--r-heading-text-transform"] === "none")
  check("slides themes: league: League Gothic, its 3D title and glow", league.vars["--r-heading-font"].startsWith("'League Gothic'") && /0 5px 0/.test(league.vars["--r-heading1-text-shadow"]) && !!league.vars["--deck-glow"])
  check("slides themes: dracula: purple headings, pink links, its coloured bold, italics and code", dracula.vars["--r-heading-color"] === "var(--purple)" && dracula.vars["--r-link-color"] === "var(--pink)"
    && dracula.vars["--r-bold-color"] === "var(--orange)" && dracula.vars["--r-inline-code-color"] === "var(--green)")
  check("slides themes: reveal's text and heading sizes (px of a 960-wide slide)", black.vars["--r-main-font-size"] === "42px" && black.vars["--r-heading1-size"] === "2.5em"
    && league.vars["--r-main-font-size"] === "40px" && league.vars["--r-heading1-size"] === "3.77em" && th("consult").vars["--r-main-font-size"] === "16px" && th("mattropolis").vars["--r-main-font-size"] === "24px")
  check("slides themes: sky: rounded headings; consult: smaller text than black", /--font-rounded/.test(sky.vars["--r-heading-font"]) && parseFloat(th("consult").vars["--r-main-font-size"]) < parseFloat(black.vars["--r-main-font-size"]))
}
