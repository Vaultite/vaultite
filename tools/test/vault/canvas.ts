import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  const { board } = $.vars
  // ---------- Canvas: JSON Canvas files; read as text; written back keeping what the app doesn't know ----------
  const { parseCanvas, writeCanvas, canvasMarkdown } = await import("../../../plugins/core/canvas/codec.ts")
  const [, ctext] = await api("GET", "render?path=Graph test/Board.canvas")
  check("canvas: render gives its cards, files as links, and connections", ctext.startsWith("# Board\n") && ctext.includes("- Web page: <https://example.com>") && ctext.includes("### Plan (green)") && ctext.includes("- Card (red): Start with [[Far]]") && ctext.includes("- File: [[Graph test/Spoke one]]") && ctext.includes('"Start with [[Far]]" → [[Graph test/Spoke one]]: then'), ctext)
  write("Graph test/Embeds a board.md", "Look:\n\n![[Board.canvas]]\n")
  const [, etext] = await api("GET", "render?path=Graph test/Embeds a board.md")
  check("canvas: an embedded canvas reads as its text", etext.includes("**Graph test/Board.canvas**") && etext.includes("Start with [[Far]]"), etext)
  const boardText = read("Graph test/Board.canvas")
  const cdoc = parseCanvas(boardText)
  check("canvas: written back unchanged when nothing changed", writeCanvas(cdoc, boardText) === boardText)
  cdoc.nodes[1] = { ...cdoc.nodes[1], x: 40.4 }
  const moved = JSON.parse(writeCanvas(cdoc, boardText))
  check("canvas: a change keeps unknown keys on the file, nodes and edges", moved.custom.keep === true && moved.nodes[0].mine === "kept" && moved.edges[0].extra === 1 && moved.nodes[1].x === 40, moved)
  check("canvas: keeps the file's indent (tabs)", writeCanvas(cdoc, boardText).includes('\n\t"nodes"') && writeCanvas(cdoc, JSON.stringify(board, null, 2)).includes('\n  "nodes"'))
  check("canvas: an empty file is an empty canvas; not JSON throws", parseCanvas("").nodes.length === 0 && (() => { try { parseCanvas("{nope"); return false } catch { return true } })())
  check("canvas: an empty canvas as text says so", canvasMarkdown('{"nodes":[],"edges":[]}') === "_An empty canvas._")
  const [cmade] = await api("POST", "file", { path: "Canvases/New.canvas", text: '{\n\t"nodes": [],\n\t"edges": []\n}\n' })
  const [, cread] = await api("GET", "file?path=Canvases/New.canvas")
  check("canvas: a .canvas is a JSON text file", cmade < 300 && cread.kind === null && cread.text.includes('"nodes"'), cread)

  // Link cards' previews (plugins/core/canvas/preview.ts): what a page's HTML says, and the addresses never fetched.
  const { parsePreview, decodeEntities } = await import("../../../plugins/core/canvas/preview.ts")
  const { blockedHost, blockedAddress, publicUrl: previewable } = await import("../../../core/web.ts")
  const pageHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>Lighthouse &amp; friends</title>
<!-- <meta property="og:title" content="Commented out"> -->
<meta property="og:title" content="Lighthouse &#8212; a plant reminder">
<meta property='og:site_name' content='Lighthouse'>
<meta name="description" content="Plain description">
<meta property="og:description" content="See   which plants
 need water &quot;at a glance&quot;">
<meta property="og:image" content="/img/card.png">
<link rel="apple-touch-icon" href="/touch.png">
<link rel="icon" type="image/png" sizes="16x16" href="/fav16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/fav32.png">
<script>document.title = "<title>Not this</title>"</script>
</head><body><svg><title>Icon title</title></svg></body></html>`
  const pv = parsePreview(pageHtml, "https://lighthouse.example.com/docs/intro")
  check("link preview: og tags over <title>, entities decoded, whitespace folded", pv.title === "Lighthouse — a plant reminder" && pv.site === "Lighthouse" && pv.description === 'See which plants need water "at a glance"', pv)
  check("link preview: image and icon made absolute; a 32 px icon over 16 px and the touch icon", pv.image === "https://lighthouse.example.com/img/card.png" && pv.icon === "https://lighthouse.example.com/fav32.png", pv)
  const bare = parsePreview(`<html><head><base href="https://cdn.example.org/x/"><TITLE>  Just a   title </TITLE><meta name=twitter:image content=pic.jpg></head><body><p>Hi</p></body></html>`, "http://plain.example.org/a")
  check("link preview: <title> when no og:title; <base href>; twitter:image; /favicon.ico when no icon", bare.title === "Just a title" && bare.image === "https://cdn.example.org/x/pic.jpg" && bare.icon === "http://plain.example.org/favicon.ico" && !bare.site && !bare.description, bare)
  check("link preview: a page that says nothing has only its favicon", JSON.stringify(parsePreview("not html at all", "https://example.org/")) === '{"icon":"https://example.org/favicon.ico"}')
  check("link preview: images that aren't http(s) are left out", !parsePreview(`<meta property="og:image" content="javascript:alert(1)">`, "https://example.org/").image)
  const ents = decodeEntities("a &amp; b &lt;c&gt; &#39;d&#x27; &nbsp;&bogus; &#0;")
  check("link preview: entities", ents === "a & b <c> 'd'  &bogus; &#0;", ents)
  const localHosts = ["localhost", "app.localhost", "printer.local", "box.tail1234.ts.net", "nas", "router.lan", "127.0.0.1", "10.1.2.3",
    "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.100.100.100", "100.64.0.1", "0.0.0.0", "[::1]", "[::]", "[fe80::1]",
    "[fd7a:115c:a1e0::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[64:ff9b::a00:1]", "[2002:c0a8:101::1]", "224.0.0.1", "255.255.255.255", "localhost."]
  const leaked = localHosts.filter((h) => !blockedHost(h))
  check("link preview: local, private and tailnet hosts are refused", leaked.length === 0, leaked)
  const publicHosts = ["example.com", "www.example.org", "93.184.215.14", "[2606:4700::6810:84e5]", "100.128.0.1", "172.32.0.1"]
  const refused = publicHosts.filter((h) => blockedHost(h))
  check("link preview: public hosts are fetched", refused.length === 0, refused)
  check("link preview: DNS answers are checked as addresses", blockedAddress("10.0.0.5") && blockedAddress("fd00::5") && blockedAddress("::ffff:192.168.0.1") && blockedAddress("not an ip") && !blockedAddress("8.8.8.8") && !blockedAddress("2001:4860:4860::8888"))
  check("link preview: only http(s), no logins", typeof previewable("ftp://example.com/") === "string" && typeof previewable("https://ana:pw@example.com/") === "string" && typeof previewable("file:///etc/hosts") === "string" && previewable("https://example.com/a#b") instanceof URL)
  const [lbad] = await api("GET", "canvas/link?url=ftp://example.com/x") // (this helper doesn't decode the query)
  const [lnone] = await api("GET", "canvas/link")
  const [llocal, llocalBody] = await api("GET", "canvas/link?url=http://127.0.0.1:8793/api/state")
  check("link preview route: not http(s) or no url is a 400; a local address answers just the url, unfetched", lbad === 400 && lnone === 400 && llocal === 200 && JSON.stringify(llocalBody) === JSON.stringify({ url: "http://127.0.0.1:8793/api/state" }), [lbad, lnone, llocal, llocalBody])

  // The board's edits (plugins/core/canvas/edit.ts) and snapping (geometry.ts): pure, on a made-up canvas.
  {
    const ed = await import("../../../plugins/core/canvas/edit.ts")
    const geo = await import("../../../plugins/core/canvas/geometry.ts")
    const base = {
      nodes: [
        { id: "g", type: "group", label: "G", x: 0, y: 0, width: 400, height: 300 },
        { id: "a", type: "text", text: "A", x: 20, y: 20, width: 100, height: 60, mine: 1 },
        { id: "b", type: "text", text: "B", x: 200, y: 100, width: 100, height: 60 },
        { id: "c", type: "text", text: "C", x: 600, y: 0, width: 100, height: 60 },
      ],
      edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "x" }, { id: "e2", fromNode: "b", toNode: "c" }],
      extra: true,
    }
    const dup = ed.duplicate(base, new Set(["g"]))
    const copies = dup.doc.nodes.filter((n) => dup.ids.has(n.id))
    check("canvas edit: duplicating a group copies what's in it and the arrows between them, with new ids",
      copies.length === 3 && dup.doc.nodes[0].type === "group" && dup.doc.edges.length === 3 && copies.some((n) => n.mine === 1 && n.x === 50) &&
      !copies.some((n) => ["g", "a", "b"].includes(n.id)) && dup.doc.extra === true, dup.doc)
    const text = ed.copyText(ed.slice(base, new Set(["a", "b"])))
    const back = ed.pastedCanvas(text)!
    const ins = ed.insert(base, back, 1000, 0)
    check("canvas edit: a copy pastes back as JSON Canvas, moved, with its arrow", back.nodes.length === 2 && back.edges.length === 1 &&
      ins.doc.nodes.length === 6 && ins.doc.edges.length === 3 && ins.doc.nodes.some((n) => ins.ids.has(n.id) && n.x === 1020), ins.doc)
    check("canvas edit: text that isn't a piece of a canvas doesn't paste as one", ed.pastedCanvas("hello") === null && ed.pastedCanvas('{"nodes": []}') === null && ed.pastedCanvas("{nope") === null)
    const rm = ed.remove(base, new Set(["b"]))
    check("canvas edit: removing a card removes its arrows", rm.nodes.length === 3 && rm.edges.length === 0)
    const ug = ed.ungroup(base, new Set(["g", "a"]))
    check("canvas edit: ungroup removes only the group", ug.nodes.length === 3 && ug.nodes.some((n) => n.id === "a") && ug.edges.length === 2)
    const al = ed.align(base, new Set(["a", "c"]), "left")
    check("canvas edit: align lines cards up on the selection's edge", al.nodes.find((n) => n.id === "c")!.x === 20 && al.nodes.find((n) => n.id === "b")!.x === 200)
    const e = base.edges[0]
    check("canvas edit: arrow directions write only what isn't the default", JSON.stringify(ed.setDirection(e, "both")) === JSON.stringify({ ...e, fromEnd: "arrow" }) &&
      JSON.stringify(ed.setDirection({ ...e, fromEnd: "arrow" }, "forward")) === JSON.stringify(e) && ed.setDirection(e, "none").toEnd === "none" &&
      ed.directionOf(ed.setDirection(e, "none")) === "none" && ed.directionOf(e) === "forward")
    const rv = ed.reverse({ ...e, fromSide: "right", toSide: "left" })
    check("canvas edit: reverse swaps the cards and their sides", rv.fromNode === "b" && rv.toNode === "a" && rv.fromSide === "left" && rv.toSide === "right", rv)
    check("canvas edit: a note's name from a card's first line", ed.nameFromText("## Plan: the [[Alice Park|launch]]\nmore") === "Plan the launch" && ed.nameFromText("   \n") === "Untitled" && ed.nameFromText("- [ ] Buy *milk*") === "Buy milk")
    const others = [{ x: 300, y: 0, width: 100, height: 100 }]
    const sm = geo.snapMove({ x: 197, y: 23, width: 100, height: 40 }, others, { grid: true, objects: true, tol: 6 })
    check("canvas snap: a box near another's edge snaps to it, with a guide; else to the grid", sm.dx === 3 && sm.guides.length === 1 && sm.guides[0].axis === "x" && sm.dy === -3, sm)
    const off = geo.snapMove({ x: 197, y: 50, width: 100, height: 40 }, others, { grid: false, objects: false, tol: 6 })
    check("canvas snap: off, nothing moves", off.dx === 0 && off.dy === 0 && !off.guides.length)
    const rs = geo.resizeBox({ x: 0, y: 0, width: 200, height: 100 }, "nw", 150, 90, [], { grid: false, objects: false, tol: 6 })
    check("canvas resize: never smaller than the minimum, the far corner stays", rs.box.width === geo.MIN_W && rs.box.height === geo.MIN_H && rs.box.x + rs.box.width === 200 && rs.box.y + rs.box.height === 100, rs.box)
    const keep = geo.resizeBox({ x: 0, y: 0, width: 200, height: 100 }, "se", 200, 0, [], { grid: false, objects: false, tol: 6, keep: true })
    check("canvas resize: a corner with Shift keeps the proportions", keep.box.width === 400 && keep.box.height === 200, keep.box)
    const pf = geo.placeFrom({ x: 500, y: 100 }, { x: 300, y: 100 }, 250, 60)
    check("canvas connect: a card made where an arrow was let go faces where it came from", pf.side === "left" && pf.box.x === 500 && pf.box.y === 70, pf)
  }

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  Object.assign($.vars, { same })
}
