import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { check, section } from "../lib.ts"
import { type Any, ROOT, web } from "./lib.ts"
import { messageOf } from "../../../core/values.ts"

await section("companion reach", async () => {
  const r: Any = await import(pathToFileURL(path.join(ROOT, "plugins/core/companion/reach.ts")).href)
  const home = os.homedir(), at = (v: string) => r.screenshotDir(() => v), none = r.screenshotDir(() => { throw new Error("not set") })
  const mac = process.platform === "darwin"
  check("companion reach: screenshots where the Mac saves them (~ read), else the Desktop; never home itself, Library or a dotfolder",
    (!mac || (at("~/Pictures/Screenshots\n") === path.join(home, "Pictures/Screenshots") && at(home) === path.join(home, "Desktop") && at("~/Library/Shots") === path.join(home, "Desktop") && at("~/.secret") === path.join(home, "Desktop")))
      && none === path.join(home, "Desktop"), [at("~/Pictures/Screenshots"), at("~/Library/Shots"), none])
  const inside = r.readableDirs(path.join(home, "Pictures/Screenshots")), outside = r.readableDirs(path.join(home, "Shots"))
  check("companion reach: the desktop, downloads and pictures besides code and documents; a screenshots folder elsewhere joins them",
    ["Projects", "Documents", "Desktop", "Downloads", "Pictures"].every((d) => inside.dirs.includes(path.join(home, d))) && inside.dirs.length === 5 && outside.dirs.at(-1) === path.join(home, "Shots"), [inside, outside])
  check("companion reach: its prompt names the folders, screenshots' too", /~[\\/]Desktop/.test(r.readableText(inside)) && /screenshots are saved to ~[\\/]Pictures[\\/]Screenshots/.test(r.readableText(inside)), r.readableText(inside))
})

await section("screen drawings", async () => {
  const sm: Any = await import(pathToFileURL(path.join(ROOT, "core/desktop/screenmarks.ts")).href)
  const kept: Any = await import(pathToFileURL(path.join(ROOT, "plugins/core/companion/kept.ts")).href)
  const lay: Any = await web("screendraw/layout.ts")
  const dr: Any = await import(pathToFileURL(path.join(ROOT, "electron/drawing.ts")).href)
  const err = (marks: unknown) => { try { sm.checkMarks(marks); return "" } catch (e) { return messageOf(e) } }
  // ---- the vocabulary, checked
  const ok = sm.checkMarks([{ type: "ring", at: [10, 20, 30, 40], label: "Share", beat: 1 }, { type: "point", at: [5, 6] }, { type: "connect", from: { el: "e12" }, to: { x: 1, y: 2, width: 3, height: 4 } },
    { type: "paper", title: "Plan", grid: true, items: [{ type: "chart", kind: "bar", values: [1, 2] }, { type: "arrow", from: [0, 0], to: [100, 50], label: "then" }] },
    { type: "button", label: "Next", do: { ask: "Go on" } }, { type: "scroll", at: { ui: "tab:t3" } }])
  check("screen drawings: spots read as boxes, el/pane/ui kept; defaults filled (scroll down, a pad's size, a chart's box)",
    JSON.stringify(ok[0].at) === '{"x":10,"y":20,"w":30,"h":40}' && JSON.stringify(ok[1].at) === '{"x":5,"y":6,"w":0,"h":0}' && ok[2].from.el === "e12" && ok[2].to.w === 3 &&
    ok[3].w === 360 && ok[3].items[0].w === 328 && ok[5].dir === "down" && ok[0].beat === 1, ok)
  const bad = {
    type: err([{ type: "circle", at: [1, 2] }]), spot: err([{ type: "ring", at: [1, 2, 3] }]), el: err([{ type: "ring", at: { el: "a b" } }]), url: err([{ type: "open", url: "javascript:alert(1)" }]),
    outside: err([{ type: "paper", items: [{ type: "rect", x: 300, y: 10, w: 100, h: 20 }] }]), labels: err([{ type: "paper", items: [{ type: "chart", kind: "bar", values: [1, 2], labels: ["a"] }] }]),
    action: err([{ type: "button", label: "x", do: { run: "rm" } }]), many: err(Array.from({ length: 41 }, () => ({ type: "check", at: [0, 0] }))), list: err({ type: "ring" }),
  }
  check("screen drawings: what's wrong says which mark and how it's written (no unknown types, scripts, links but http, items off the pad)",
    bad.type.startsWith("marks[0] (circle): type is one of") && bad.spot.includes("[x, y, w, h] or [x, y]") && bad.spot.includes("{\"find\"") && bad.el.includes("at.el: an id") && bad.url.includes("http(s)") &&
    bad.outside.includes("items[0]: x, y, w, h: inside the paper") && bad.labels.includes("one per value") && bad.action.includes("do:") && bad.many.includes("at most 40") && bad.list.includes("a JSON list"), bad)
  check("screen drawings: the app's places a drawing names, to find on screen", sm.appPlaces(ok).join() === "ui:tab:t3")
  // ---- beats, with the words' sentences
  check("screen drawings: words read as sentences (a line's end too)", sm.sentences("Click Share. Then pick who!\nDone").join("|") === "Click Share.|Then pick who!|Done")
  const times = sm.beatTimes("Click Share up here. Then pick who you want in the list.", 2)
  check("screen drawings: each beat starts when the sentence before is read, longer ones later; past the words, a steady pace", times[0] === 0 && times[1] >= 700 && times[2] - times[1] > times[1] && times[2] - times[1] <= 3500, times)
  // ---- paced to the voice: each beat while its sentence is heard
  const cap = "Click **Share** up here. Then pick who you want in the list. Done."
  const heard = sm.heardBeats(cap, [{ text: "Let me look.", at: 500, dur: 600 }, { text: "Click Share up here.", at: 1000, dur: 1400 }, { text: "Then pick who you want in the list.", at: 2600, dur: 2000 }])
  check("screen drawings: the caption's sentences matched in order to those heard (its words, Markdown aside), none for one not said yet",
    JSON.stringify(heard) === '[{"at":1000,"dur":1400},{"at":2600,"dur":2000},null]', heard)
  const paced = sm.pacedBeats(cap, 2, heard, 800), still = sm.pacedBeats(cap, 2, undefined, 0)
  check("screen drawings: heard, a beat starts as its sentence does and spreads over it; not yet heard, as the last one ends; no voice, the reading pace",
    JSON.stringify(paced.times) === "[200,1800,3800]" && JSON.stringify(paced.spread) === "[1400,2000,null]" && JSON.stringify(still.times) === JSON.stringify(sm.beatTimes(cap, 2)) &&
    sm.pacedBeats(cap, 1, [{ at: 0, dur: 500 }, null], 2000).times.join() === "0,0", { paced, still })
  // ---- labels: never over what they name, always on screen
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647 } })(), screen = { x: 0, y: 25, w: 1280, h: 775 }
  const bads: unknown[] = []
  for (let i = 0; i < 400; i++) {
    const w = 10 + rnd() * 400, h = 10 + rnd() * 200, t = { x: rnd() * (1280 - w), y: 25 + rnd() * (775 - h), w, h }, size = { w: 40 + rnd() * 120, h: 22 }
    const taken = [{ x: t.x + t.w + 10, y: t.y - 30, w: 80, h: 22 }], l = lay.labelAt(t, size, screen, taken)
    if (!lay.inside(l, screen) || lay.overlaps(l, t)) bads.push({ t, l })
  }
  check("screen drawings: a label never covers its target and stays on screen (400 random targets, edges and corners)", !bads.length, bads.slice(0, 3))
  const huge = lay.labelAt({ x: 0, y: 25, w: 1280, h: 775 }, { w: 60, h: 22 }, screen)
  check("screen drawings: a target as big as the screen: its label still on screen", lay.inside(huge, screen), huge)
  const corner = lay.labelAt({ x: 1240, y: 26, w: 40, h: 20 }, { w: 90, h: 22 }, screen)
  check("screen drawings: in the top right corner it goes below or left, never off screen", lay.inside(corner, screen) && !lay.overlaps(corner, { x: 1240, y: 26, w: 40, h: 20 }), corner)
  // ---- calm space, a whole drawing placed
  const avoid = [{ x: 100, y: 100, w: 600, h: 300 }], spot = lay.calmSpot({ w: 300, h: 200 }, screen, avoid, { x: 400, y: 250 })
  check("screen drawings: a card goes on calm space nearest where it's wanted, clear of what's marked", lay.inside(spot, screen) && !lay.overlaps(spot, lay.inflate(avoid[0], 24)), spot)
  const d = { id: "d1", agent: "Claude", tint: "orange", t: 0, places: { "el:e1": { x: 1500, y: 300, w: 80, h: 30 } }, marks: sm.checkMarks([
    { type: "ring", at: { el: "e1" }, label: "This one" }, { type: "connect", from: { el: "e1" }, to: [200, 300, 100, 40], label: "goes here" }, { type: "frame", at: [180, 280, 140, 80], label: "Area" },
    { type: "point", at: [1700, 700], label: "There" }, { type: "write", text: "A note on calm space" }, { type: "sticky", text: "Remember" }, { type: "check", at: [600, 600, 40, 20] }]) }
  const one = { width: 1280, height: 800, origin: { x: 0, y: 0 }, home: true, top: 25 }, two = { width: 1280, height: 800, origin: { x: 1280, y: 0 }, home: false, top: 25 }
  const size = (m: Any) => (m.label ? { w: m.label.length * 7 + 18, h: 22 } : null)
  const a = lay.place(d, one, size), b = lay.place(d, two, size)
  const types = (ps: Any[]) => ps.map((p) => p.mark.type).join()
  check("screen drawings: each display draws its marks (a connect on both its ends'), the home one the cards", types(a) === "connect,frame,write,sticky,check" && types(b) === "ring,connect,point", [types(a), types(b)])
  const ring = b.find((p: Any) => p.mark.type === "ring")
  check("screen drawings: a display's marks in its own points", ring.box.x === 220 && ring.box.y === 300, ring.box)
  const all = [...a, ...b], marks = all.filter((p: Any) => p.box && !sm.CARDS.has(p.mark.type)).map((p: Any) => p.box)
  const labelsBad = all.filter((p: Any) => p.label && (!lay.inside(p.label, { x: 0, y: 25, w: 1280, h: 775 }) || (p.mark.type !== "connect" && lay.overlaps(p.label, p.box))))
  check("screen drawings: placed labels stay on screen, off their targets", all.filter((p: Any) => p.label).length === 5 && !labelsBad.length, labelsBad)
  const cards = a.filter((p: Any) => p.card)
  check("screen drawings: placed cards apart, on screen, clear of every mark", cards.length === 2 && !lay.overlaps(cards[0].card, cards[1].card) && cards.every((c: Any) => lay.inside(c.card, { x: 0, y: 25, w: 1280, h: 775 }) && !marks.some((m: Any) => lay.overlaps(c.card, m))), cards.map((c: Any) => c.card))
  const busy = [{ x: 0, y: 25, w: 1280, h: 300 }], roomy = lay.calmSpot({ w: 200, h: 100 }, screen, busy, { x: 600, y: 200 })
  check("screen drawings: a card goes to the emptiest room, not just next to what's on screen", roomy.y >= 325 + 24 + 120, roomy)
  const own = { ...d, places: { "el:b": { x: 600, y: 300, w: 80, h: 30, label: "Share" } }, marks: sm.checkMarks([{ type: "ring", at: { el: "b" }, label: "share" }, { type: "ring", at: { el: "b" }, label: "Send it here" }]) }
  const ownLabels = lay.place(own, one, size).map((p: Any) => !!p.label).join()
  check("screen drawings: a label that only repeats its element's own word is left out", ownLabels === "false,true", ownLabels)
  // ---- frames: side by side a hairline apart, their labels snug at them on one side, never on each other
  const sections = [[8, 40, 274, 36], [8, 76, 274, 120], [8, 196, 274, 300], [8, 496, 274, 101], [8, 597, 274, 255], [8, 852, 274, 45]]
  const sidebar = { ...d, places: {}, marks: sm.checkMarks(sections.map((r, i) => ({ type: "frame", at: r, label: ["Search", "Pinned", "Tabs", "Inbox", "Files", "Vault"][i], beat: i }))) }
  const tall = { width: 1470, height: 956, origin: { x: 0, y: 0 }, home: true, top: 33 }, framed = lay.place(sidebar, tall, size)
  const inkClash = framed.flatMap((p: Any, i: number) => framed.slice(i + 1).filter((q: Any) => lay.overlaps(p.ink, q.ink)).map((q: Any) => [p.mark.label, q.mark.label]))
  const gapTo = (l: Any, f: Any) => Math.hypot(Math.max(0, f.x - (l.x + l.w), l.x - (f.x + f.w)), Math.max(0, f.y - (l.y + l.h), l.y - (f.y + f.h)))
  const loose = framed.filter((p: Any) => !p.label || gapTo(p.label, p.ink) > 3 || lay.overlaps(p.label, p.ink) || !lay.inside(p.label, { x: 0, y: 33, w: 1470, h: 923 }))
  const tagClash = framed.flatMap((p: Any, i: number) => framed.slice(i + 1).filter((q: Any) => lay.overlaps(p.label, q.label)).map((q: Any) => [p.mark.label, q.mark.label]))
  const sides = new Set(framed.map((p: Any) => p.label.x - (p.ink.x + p.ink.w)))
  check("screen drawings: stacked frames (a sidebar's panels) never overlap; each label snug at its frame, on screen, none on another, all on one side",
    !inkClash.length && !loose.length && !tagClash.length && sides.size === 1, { inkClash, loose: loose.map((p: Any) => [p.mark.label, p.label, p.ink]), tagClash, sides: [...sides] })
  const firstThree = lay.place({ ...sidebar, marks: sidebar.marks.slice(0, 3) }, tall, size).map((p: Any) => JSON.stringify(p.label)).join()
  check("screen drawings: the next frame down (a walkthrough's next beat) moves no label before it", firstThree === framed.slice(0, 3).map((p: Any) => JSON.stringify(p.label)).join(), firstThree)
  const guessed = lay.place({ ...d, places: {}, marks: sm.checkMarks([{ type: "frame", at: [100, 100, 200, 100] }, { type: "frame", at: [100, 190, 200, 100] }]) }, one, size)
  check("screen drawings: frames a little over each other (boxes guessed from the picture) are drawn apart too", !lay.overlaps(guessed[0].ink, guessed[1].ink), guessed.map((p: Any) => p.ink))
  const lone = lay.place({ ...d, places: {}, marks: sm.checkMarks([{ type: "frame", at: [400, 300, 200, 100], label: "Chart" }]) }, one, size)[0]
  check("screen drawings: a frame alone is named over its top left, as a design tool names one", lone.label.x === lone.ink.x && lone.label.y + lone.label.h === lone.ink.y - 3, [lone.label, lone.ink])
  // ---- the electron side: which display has the cards; only what the drawing offers runs
  const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 } }, { id: 2, bounds: { x: 1280, y: 0, width: 1280, height: 800 } }]
  check("screen drawings: the home display is where its first place is, else the pointer's", dr.homeOf(d, displays, { x: 10, y: 10 }) === 2 && dr.homeOf({ ...d, marks: [{ type: "write", text: "x" }] }, displays, { x: 1300, y: 10 }) === 2, dr.homeOf(d, displays, { x: 10, y: 10 }))
  check("screen drawings: an ask's elements become its places, by id", JSON.stringify(dr.elementPlaces([{ id: "a3", role: "AXButton", label: "Share", frame: { x: 1, y: 2, width: 3, height: 4 } }])) === '{"el:a3":{"x":1,"y":2,"w":3,"h":4,"label":"Share"}}')
  const offer = { ...d, marks: sm.checkMarks([{ type: "copy", text: "abc" }, { type: "button", label: "Go", do: { open: "https://lighthouse.test" } }]) }
  check("screen drawings: a copy or an open runs only when the drawing offers it", dr.offered(offer, { id: "d1", kind: "copy", text: "abc" }) && dr.offered(offer, { id: "d1", kind: "open", url: "https://lighthouse.test" }) &&
    !dr.offered(offer, { id: "d1", kind: "open", url: "https://evil.test" }) && !dr.offered(offer, { id: "d1", kind: "copy", text: "other" }))
  // ---- kept: an .excalidraw scene
  const scene = kept.toExcalidraw(sm.checkMarks([{ type: "paper", title: "Plan", items: [{ type: "rect", x: 10, y: 10, w: 100, h: 50, label: "Idea" }, { type: "arrow", from: [110, 35], to: [200, 35] },
    { type: "chart", kind: "bar", x: 10, y: 100, w: 200, h: 100, values: [1, -2, 3], labels: ["a", "b", "c"] }, { type: "path", points: [[0, 0], [10, 10], [20, 5]] }] },
    { type: "sticky", text: "Remember" }, { type: "ring", at: [10, 10, 20, 20] }]), { tint: "blue" })
  const els = scene.elements, ids = new Set(els.map((e: Any) => e.id))
  const box = els.find((e: Any) => e.type === "rectangle" && e.boundElements), label = box && els.find((e: Any) => e.id === box.boundElements[0].id)
  check("screen drawings: kept as Excalidraw's JSON: unique ids, a shape's label bound both ways, arrows' points relative, its tint as Excalidraw's blue",
    scene.type === "excalidraw" && scene.version === 2 && ids.size === els.length && label?.containerId === box.id && label.text === "Idea" &&
    els.some((e: Any) => e.type === "arrow" && e.endArrowhead === "arrow" && e.points[0][0] === 0 && e.points[1][0] === 90) && els.some((e: Any) => e.strokeColor === "#1971c2") &&
    els.every((e: Any) => Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.width) && e.width >= 0 && e.height >= 0), els.slice(0, 4))
  check("screen drawings: a chart's bars (a negative one below its axis) and labels; the sticky beside the pad; screen marks only with all",
    els.filter((e: Any) => e.type === "rectangle" && e.fillStyle === "hachure").length === 3 && els.filter((e: Any) => e.type === "text" && ["a", "b", "c"].includes(e.text)).length === 3 &&
    els.some((e: Any) => e.type === "rectangle" && e.backgroundColor === "#ffec99" && e.x >= 400) && !els.some((e: Any) => e.type === "ellipse" && e.width === 40), els.length)
  const withMarks = kept.toExcalidraw(sm.checkMarks([{ type: "ring", at: { el: "e1" } }]), { all: true, places: { "el:e1": { x: 10, y: 10, w: 20, h: 20 } } })
  check("screen drawings: with all, the marks too, where the overlay found them; nothing worth keeping, none", withMarks?.elements.some((e: Any) => e.type === "ellipse") && kept.toExcalidraw(sm.checkMarks([{ type: "ring", at: [1, 1] }])) === null)
  // ---- media cards, svg, Excalidraw's shapes on a pad, and changes in place by id
  const mediaMarks = sm.checkMarks([{ type: "image", src: "screenshot", at: "top right", caption: "Latest", url: "javascript:x" }, { type: "video", src: "https://lighthouse.test/a.mp4", at: [20, 30] }])
  check("screen drawings: an image or video card: its source as given (never a url of the agent's), an area or a point for where",
    mediaMarks[0].at.area === "top-right" && mediaMarks[0].url === undefined && mediaMarks[0].caption === "Latest" && mediaMarks[1].at.x === 20 && sm.unshown(mediaMarks).every((x: unknown) => x === null), mediaMarks)
  check("screen drawings: an area places only a card", err([{ type: "ring", at: "centre" }]).includes("an area places a card") && err([{ type: "sticky", text: "x", at: "middle" }]).includes("an area"))
  const svgItem = sm.checkMarks([{ type: "paper", w: 200, h: 200, items: [{ type: "svg", style: "sketch", viewBox: "0 0 24 24", paths: [{ d: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0Z", fill: "green" }, { d: "m7 12 3 3 7-7", color: "ink", width: 3 }] }] }])[0].items[0]
  check("screen drawings: svg is path data, its box the pad's by default, its viewBox read", svgItem.type === "svg" && svgItem.w === 176 && svgItem.viewBox.join() === "0,0,24,24" && svgItem.paths[1].color === "ink" && svgItem.style === "sketch", svgItem)
  const svgBad = [err([{ type: "paper", items: [{ type: "svg", paths: [{ d: "<script>alert(1)</script>" }] }] }]), err([{ type: "paper", items: [{ type: "svg", paths: [{ d: "M0 0 L10 10 url(#x)" }] }] }]),
    err([{ type: "paper", items: [{ type: "svg", d: "M0 0 L10 10", fill: "url(javascript:x)" }] }]), err([{ type: "paper", items: [{ type: "svg", paths: [{ d: "L10 10" }] }] }])]
  check("screen drawings: svg takes path data only: no markup, no urls, no colour but a name or #hex, starting with M", svgBad.every((e) => /d: |fill: |colour|color/.test(e)), svgBad)
  const sp: Any = await import(pathToFileURL(path.join(ROOT, "core/desktop/svgpath.ts")).href)
  const circle = sp.boundsOf(sp.flatten("M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0Z")), quad = sp.flatten("M0 0 Q10 20 20 0 T40 0 H50 V10 h-5 z")
  check("screen drawings: path data flattened: arcs as their circle, curves sampled, relative and closing commands",
    Math.abs(circle[0] - 2) < 0.2 && Math.abs(circle[2] - 20) < 0.3 && Math.abs(circle[3] - 20) < 0.3 && quad.length === 1 && quad[0].closed && quad[0].pts.at(-1).join() === "0,0", { circle, quad })
  const flow = sm.checkMarks([{ type: "paper", id: "flow", w: 400, h: 160, items: [{ type: "rectangle", id: "in", x: 10, y: 50, label: "Sign in" }, { type: "diamond", id: "ok", x: 160, y: 30, w: 100, h: 100, label: "Valid?" },
    { type: "rect", id: "home", x: 290, y: 50, label: "Home", fill: "green" }, { type: "arrow", from: "in", to: "ok" }, { type: "arrow", id: "yes", from: "ok", to: "home", label: "yes" }] }])
  check("screen drawings: Excalidraw's shapes on a pad: sized by their label, arrows bound to shapes by id", flow[0].items[0].type === "rect" && flow[0].items[0].w >= 100 && flow[0].items[4].from === "ok", flow[0].items)
  check("screen drawings: an arrow bound to a shape that isn't on the pad, or an id twice, is refused",
    err([{ type: "paper", items: [{ type: "arrow", from: "nope", to: [10, 10] }] }]).includes("isn't a shape's id") && err([{ type: "paper", items: [{ type: "rect", id: "a", x: 1, y: 1, w: 9, h: 9 }, { type: "rect", id: "a", x: 1, y: 1, w: 9, h: 9 }] }]).includes("twice"))
  const edgeAt = sm.edgeOf("in", "ok", flow[0].items)
  check("screen drawings: a bound arrow leaves its shape at its edge, toward the other", Math.abs(edgeAt[0] - (10 + flow[0].items[0].w + 6)) < 1 && Math.abs(edgeAt[1] - 78) < 1, edgeAt)
  const tE = 1000, ed = sm.editMarks(flow, [{ op: "move", id: "home", dx: -20, dy: -10 }, { op: "change", id: "home", fill: "red", label: "Start" }, { op: "add", type: "rect", id: "err", x: 160, y: 0, w: 90, h: 24, label: "Retry" },
    { op: "add", type: "arrow", from: "ok", to: "err" }, { op: "delete", id: "in" }, { op: "add", mark: { type: "image", src: "a.png", at: "bottom-left" } }, { op: "move", id: "flow", at: "top-left" }], tE)
  const edPad = ed.marks[0], home = edPad.items.find((i: Any) => i.id === "home")
  check("screen drawings: changed in place by id: moved, recoloured, relabelled, added to the last pad, a mark added, a card moved to an area",
    home.x === 290 - 20 && home.y === 40 && home.fill === "red" && home.label === "Start" && edPad.items.some((i: Any) => i.id === "err") && ed.added.length === 1 && ed.added[0].type === "image" &&
    edPad.at.area === "top-left" && flow[0].items[2].x === 290, { home, touched: ed.touched })
  check("screen drawings: erasing a shape erases what's bound to it, its pen run backward, then it's gone for good",
    edPad.items.find((i: Any) => i.id === "in").gone === tE && edPad.items[3].gone === tE && !edPad.items[4].gone && sm.pruned(ed.marks, tE + sm.ERASE_MS + 1)[0].items.every((i: Any) => !i.gone), edPad.items.map((i: Any) => [i.id, i.gone]))
  const edErr = (a: unknown) => { try { sm.editMarks(flow, a); return "" } catch (e) { return messageOf(e) } }
  check("screen drawings: a change says which action and why: an id not up, an op, nothing to change",
    edErr([{ op: "move", id: "zz", dx: 1 }]).startsWith("actions[0] (move): no \"zz\"") && edErr([{ op: "spin", id: "in" }]).includes("add, move, change or delete") && edErr([{ op: "change", id: "in" }]).includes("what changes"))
  const upText = sm.drawingText({ id: "d", agent: "Claude", tint: "orange", t: 0, marks: [...flow, ...sm.checkMarks([{ type: "image", id: "pic", src: "x.png", at: "centre" }])] })
  check("screen drawings: what's up reads by id: a pad's items, arrows between ids, a card's place", upText.includes("flow paper 400x160:") && upText.includes("in rect \"Sign in\" at 10,50") && upText.includes("yes arrow ok -> home \"yes\"") && upText.includes("pic image x.png at centre"), upText)
  const keptK = kept.toExcalidraw([...flow, ...sm.checkMarks([{ type: "paper", items: [{ type: "svg", paths: [{ d: "M0 0 L100 0 L50 80 Z", fill: "yellow" }] }] }, { type: "image", id: "pic", src: "x.png" }, { type: "video", id: "vid", src: "https://lighthouse.test/v.mp4" }])],
    { files: { pic: { dataURL: "data:image/png;base64,AAAA", mime: "image/png", px: [800, 600] } } })
  const kEls = keptK.elements, arrowK = kEls.find((e: Any) => e.id === "yes"), homeK = kEls.find((e: Any) => e.id === "home")
  check("screen drawings: kept, Excalidraw's own: a diamond, arrows bound both ways, fills by name, an svg as closed filled lines, a picture embedded, a video as a link",
    kEls.some((e: Any) => e.type === "diamond" && e.id === "ok") && arrowK.startBinding.elementId === "ok" && arrowK.endBinding.elementId === "home" && homeK.boundElements.some((b: Any) => b.id === "yes") &&
    homeK.backgroundColor === "#b2f2bb" && kEls.some((e: Any) => e.type === "line" && e.backgroundColor === "#ffec99" && e.points.length > 3) &&
    kEls.some((e: Any) => e.type === "image" && keptK.files[e.fileId]?.dataURL.startsWith("data:image/png") && e.width === 480 && e.height === 360) &&
    kEls.some((e: Any) => e.type === "rectangle" && e.link === "https://lighthouse.test/v.mp4") && new Set(kEls.map((e: Any) => e.id)).size === kEls.length, kEls.map((e: Any) => [e.id, e.type]))
  const keptV = kept.toExcalidraw(sm.checkMarks([{ type: "video", id: "v", src: "Clips/Dark pages that stay dark on every load.mp4", caption: "Dark pages" }, { type: "video", id: "w", src: "Clips/Video cards you can hear and pause, and choices by your pointer.mp4" },
    { type: "sticky", text: "The dark theme must stay dark on every page load, including the first paint before the styles arrive, and on every window." },
    { type: "copy", text: "vau companion layer --hide", label: "Copy the command" }, { type: "open", url: "https://lighthouse.test/docs" },
    { type: "button", label: "The watcher", do: { ask: "Fix the watcher" } }, { type: "button", label: "The video cards", do: { ask: "Fix the video cards" } }])
    .map((m: Any) => (m.type === "video" ? { ...m, url: `api/raw/x?path=${encodeURIComponent(m.src)}` } : m)),
    { question: "Which one first?", files: { v: { dataURL: "data:image/png;base64,BBBB", mime: "image/png", px: [1024, 640] } } })
  const vEls = keptV.elements, byIdV = new Map<unknown, Any>(vEls.map((e: Any) => [e.id, e]))
  const poster = vEls.find((e: Any) => e.type === "image"), badge = vEls.filter((e: Any) => e.groupIds.length && e.groupIds[0] === poster?.groupIds[0])
  // (a bound label inside its box: no line wider than the box, the box as tall as its lines)
  const fits = vEls.filter((e: Any) => e.type === "text" && e.containerId && byIdV.get(e.containerId).type === "rectangle").every((t: Any) => {
    const c: Any = byIdV.get(t.containerId)
    return t.text.split("\n").every((l: string) => l.length * t.fontSize * 0.6 <= c.width - 10 + 0.01) && t.height <= c.height - 10 + 0.01 && t.x >= c.x && t.y >= c.y && t.originalText.replace(/\s+/g, " ") === t.text.replace(/\s+/g, " ")
  })
  check("screen drawings: kept as it looked: a video as its first frame with a play badge, one group linked to the video; one with no frame, a box sized to its name; labels wrapped inside their boxes",
    poster?.width === 480 && poster.height === 300 && poster.link === "Clips/Dark pages that stay dark on every load.mp4" && badge.length === 3 && keptV.files[poster.fileId] &&
    vEls.some((e: Any) => e.type === "rectangle" && e.link?.endsWith("by your pointer.mp4") && e.width > 240) && fits, vEls.map((e: Any) => [e.type, e.width, e.height, e.text]))
  const chipsV = vEls.filter((e: Any) => e.type === "text" && e.containerId && ["Copy the command", "Open", "The watcher", "The video cards"].includes(e.text))
  const q = vEls.find((e: Any) => e.text === "Which one first?"), watcher = chipsV.find((e: Any) => e.text === "The watcher"), open = chipsV.find((e: Any) => e.text === "Open")
  check("screen drawings: kept buttons as buttons: copy with what it copies under it, open linked, a choice's question atop its answers",
    chipsV.length === 4 && byIdV.get(open.containerId).link === "https://lighthouse.test/docs" && vEls.some((e: Any) => e.text === "vau companion layer --hide" && e.fontFamily === 3) &&
    q && q.y > open.y && q.y < watcher.y, chipsV.map((e: Any) => [e.text, e.y]))
  const here1 = { width: 1440, height: 900, origin: { x: 0, y: 0 }, home: true, top: 25, pointer: { x: 700, y: 400 } }
  const putCards = lay.place({ id: "d", agent: "C", tint: "orange", t: 0, places: { "el:b": { x: 600, y: 300, w: 120, h: 40 } }, marks: sm.checkMarks([
    { type: "image", id: "a", src: "x.png", at: "top-right" }, { type: "sticky", text: "beside", at: { el: "b" } }, { type: "write", text: "here", at: [100, 700] }, { type: "video", id: "v", src: "y.mp4", size: "l" }]) }, here1, size)
  const [tr, beside, pt, vid] = putCards.map((p: Any) => p.card)
  check("screen drawings: a card goes where it's put: an area's corner, beside a thing (never over it), a point, by the cursor; on screen, at most its share of the display",
    tr.x + tr.w === 1440 - 24 && tr.y === 25 + 24 && !lay.overlaps(beside, { x: 600, y: 300, w: 120, h: 40 }) && pt.x === 100 && pt.y === 700 &&
    vid.w <= 1440 * 0.4 + 1 && vid.h <= 875 * 0.45 + 1 && putCards.every((p: Any) => lay.inside(p.card, { x: 0, y: 25, w: 1440, h: 875 })), putCards.map((p: Any) => p.card))
  // ---- a video's sound and play, and a choice's answers
  const vids = sm.checkMarks([{ type: "video", id: "v", src: "y.mp4", sound: true, paused: false }])
  check("screen drawings: a video may be heard (only said so) or paused; sound is a video's",
    vids[0].sound === true && vids[0].paused === undefined && /sound: true or false, a video's/.test(err([{ type: "image", src: "x.png", sound: true }])) && /paused/.test(err([{ type: "video", src: "y.mp4", paused: "yes" }])), vids)
  const muted = sm.editMarks(sm.editMarks(vids, [{ op: "change", id: "v", paused: true }]).marks, [{ op: "change", id: "v", sound: false, paused: false }]).marks[0]
  check("screen drawings: a video changed in place: what's turned off goes, not left as it was", muted.sound === undefined && muted.paused === undefined && muted.src === "y.mp4", muted)
  const ch = sm.checkMarks([{ type: "button", id: "a", label: "A", do: { ask: "Pick A" } }, { type: "button", id: "b", label: "B", do: { ask: "B" } }, { type: "button", label: "Copy", do: { copy: "x" } }, { type: "button", label: "Here", do: { ask: "x" }, at: [10, 10] }])
  check("screen drawings: buttons that ask with no place are a choice's answers, gone at the next ask; others are cards",
    ch.map((m: Any) => sm.isAnswer(m)).join() === "true,true,false,false" && sm.lifeOf(ch[0]) === "ask" && sm.lifeOf(ch[2]) === "dismiss", ch)
  const upV = sm.drawingText({ id: "d", agent: "C", tint: "orange", t: 0, marks: [...vids, ch[0], ch[1]] })
  check("screen drawings: what's up says a video's state and what each answer sends", upV.includes("v video y.mp4 (playing, with sound)") && upV.includes("a button \"A\" (an answer: sends \"Pick A\")") && upV.includes("b button \"B\" (an answer)"), upV)
  const chosen = lay.place({ id: "d", agent: "C", tint: "orange", t: 0, question: "Which one should take it?", places: {}, marks: [...sm.checkMarks([{ type: "video", id: "v", src: "y.mp4" }]), ch[0], ch[1]] }, here1, size)
  const qCard = chosen.find((p: Any) => p.answers)?.card, ptr = here1.pointer
  check("screen drawings: a choice is one card with all its answers, by the pointer (beside it, not under it), placed before other cards",
    chosen.filter((p: Any) => p.card && p.mark.type === "button").length === 1 && chosen.find((p: Any) => p.answers).answers.length === 2 && Math.hypot(qCard.x + qCard.w / 2 - ptr.x, qCard.y + qCard.h / 2 - ptr.y) < qCard.w / 2 + 80 &&
    !(ptr.x >= qCard.x && ptr.x <= qCard.x + qCard.w && ptr.y >= qCard.y && ptr.y <= qCard.y + qCard.h) && !lay.overlaps(qCard, chosen[0].card), chosen.map((p: Any) => p.card))
  const shot = lay.mediaSize({ type: "image", src: "s", px: [2880, 1800] }, 1440, 875), tiny = lay.mediaSize({ type: "image", src: "s", px: [32, 32], caption: "x" }, 1440, 875)
  check("screen drawings: a picture's size: a Retina screenshot fitted to its share; a tiny one at least 160 wide, with room for its caption", shot.w <= 432 && Math.abs(shot.w / shot.h - 1.6) < 0.02 && tiny.w === 160 && tiny.h === 160 + lay.CAPTION_H, { shot, tiny })
  // ---- marks anchor to what's meant: words to find, and a guessed pixel snapped to what's there
  const found = sm.checkMarks([{ type: "ring", at: { find: "Morning report" } }, { type: "connect", from: { find: "A" }, to: { el: "a1" } }])
  check("screen drawings: a spot can be words to find; they're the places the screen must find, read back from them",
    found[0].at.find === "Morning report" && sm.findsOf(found).join() === "Morning report,A" && sm.rectOf({ find: "A" }, { "find:A": { x: 1, y: 2, w: 3, h: 4 } })?.w === 3 &&
    /find/.test(err([{ type: "ring", at: { find: "" } }])), found)
  // (the pinned icons: a section 0,120 270x100, an icon in it; they drew a ring round the section)
  const places = { "el:a1": { x: 140, y: 150, w: 30, h: 30 }, "el:a2": { x: 0, y: 120, w: 270, h: 100 }, "el:a3": { x: 400, y: 400, w: 60, h: 20 } }
  const at = (marks: unknown[], drawn: unknown[] = []) => sm.snapMarks(sm.checkMarks(marks), places, drawn).map((m: Any) => m.at)
  const [inRing, onIcon, byButton, alone, likeSection, pointed] = at([{ type: "ring", at: [100, 200] }, { type: "ring", at: [155, 165] }, { type: "frame", at: [395, 410] },
    { type: "ring", at: [900, 900] }, { type: "frame", at: [8, 125, 260, 92] }, { type: "point", at: [150, 170] }], [{ x: 0, y: 101, w: 293, h: 146 }, { x: 145, y: 155, w: 20, h: 20 }])
  check("screen drawings: a ring at a guessed pixel goes round what they drew there (the smallest; round the elements in it), the element it's on or by, else stays; a box like an element's is it; a point is a point",
    JSON.stringify(inRing) === '{"x":0,"y":120,"w":270,"h":100}' && JSON.stringify(onIcon) === '{"x":145,"y":155,"w":20,"h":20}' && byButton.el === "a3" &&
    alone.x === 900 && alone.w === 0 && likeSection.el === "a2" && pointed.x === 150 && at([{ type: "ring", at: [155, 165] }])[0].el === "a1", [inRing, onIcon, byButton, alone, likeSection, pointed])
  // (the sidebar's tab groups, circled: a ring at a pixel in it, or a box much like it, frames the groups, not one of them)
  const groups = { "el:g1": { x: 4, y: 262, w: 90, h: 24 }, "el:g2": { x: 4, y: 290, w: 90, h: 24 }, "el:g3": { x: 4, y: 318, w: 90, h: 24 }, "el:x": { x: 70, y: 290, w: 16, h: 16 } }
  const ink = [{ x: 0, y: 258, w: 97, h: 129 }]
  const [ringed, boxed] = [sm.snapMarks(sm.checkMarks([{ type: "ring", at: [48, 310], label: "Tab groups" }]), groups, ink)[0], sm.snapMarks(sm.checkMarks([{ type: "frame", at: [0, 258, 141, 131] }]), groups, ink)[0]]
  check("screen drawings: what they circled is framed whole, round the things inside it: a ring there is a frame",
    ringed.type === "frame" && ringed.label === "Tab groups" && JSON.stringify(ringed.at) === '{"x":4,"y":262,"w":90,"h":80}' && boxed.type === "frame" && JSON.stringify(boxed.at) === '{"x":4,"y":262,"w":90,"h":80}', [ringed, boxed])
  const spotsFound = [{ x: 100, y: 100, w: 50, h: 20, q: 2 }, { x: 800, y: 100, w: 50, h: 20, q: 2 }, { x: 900, y: 600, w: 50, h: 20, q: 1 }]
  check("screen drawings: of the places words were found, the best match, then the nearest what they drew or pointed at",
    sm.bestFound(spotsFound, [{ x: 820, y: 90, w: 0, h: 0 }])?.x === 800 && sm.bestFound(spotsFound, [{ x: 120, y: 90, w: 0, h: 0 }])?.x === 100 && sm.bestFound(spotsFound)?.x === 100 &&
    sm.bestFound([...spotsFound, { x: 0, y: 0, w: 5, h: 5, q: 3 }], [{ x: 820, y: 90, w: 0, h: 0 }])?.q === 3 && sm.bestFound([]) === null)
  const near = [{ id: "a1", label: "Address and search bar" }, { id: "a2", label: "Send" }, { id: "a3", label: "Send later" }, { id: "a4", label: "New tab" }]
  check("screen drawings: words name the element saying them all, in order: the same words first; never one saying only some",
    sm.byLabel(near, "send")?.id === "a2" && sm.byLabel(near, "Send later")?.id === "a3" && sm.byLabel(near, "address bar") === null && sm.byLabel(near, "and search")?.id === "a1" &&
    sm.byLabel(near, "the New tab button") === null && sm.byLabel(near, "sen") === null && sm.byLabel([...near, { id: "a5", label: "Agents" }], "4:24 PM · Agents") === null && sm.byLabel(near, "") === null)
  const tg: Any = await import(pathToFileURL(path.join(ROOT, "plugins/core/companion/tags.ts")).href)
  const { said, tags } = tg.parseTags('Here [ring "Morning report"] and there [arrow a1 "Send"], with [ring a2 "Share"].')
  check("screen drawings: a mark tag with words alone marks the thing saying them (no label repeating them); an arrow's end can be words",
    said === "Here and there, with." && tags.length === 3 && JSON.stringify(tg.markOf(tags[0])) === '{"type":"ring","at":{"find":"Morning report"}}' &&
      JSON.stringify(tg.markOf(tags[1]).to) === '{"find":"Send"}' && tg.markOf(tags[2]).label === "Share" && tg.markOf(tags[2]).at.el === "a2", [said, tags])
  const long = tg.parseTags(`[frame "The Morning report bug (Bug 2026-11-06 08.49) has a different cause: folded callouts with videos in the editor, where an embed is mounted and dropped 3 ms later. Hand it to its own session?" "Morning report bug"] That one.`), wrong = tg.parseTags("[frame] Here. [ring] There.")
  const streaming = tg.parseTags(`Look [frame "The Morning report bug (Bug 2026-11-06 08.49) has a different cause: folded callouts with videos in the editor, where an embed is mounted and dropped 3 ms later. Hand it to its own session?`)
  const subject = tg.parseTags('The top bar: [ring "Recent captures"] reopens them. [ring "Undo"] and [ring "Redo"] step back. [ring "Select"] Select moves. Press this one [ring "Save"] here. [ring "iCloud"] iCloud holds it.')
  check("screen drawings: a tag standing for its sentence's subject says its words there; one beside words naming it, or mid-sentence, says nothing",
    subject.said === "The top bar: Recent captures reopens them. Undo and Redo step back. Select moves. Press this one here. iCloud holds it." && subject.tags.length === 6 &&
      tg.parseTags('Here: [ring "Recent captures"] re').said === "Here:", subject.said)
  check("screen drawings: a tag naming its kind is never said, however long its words (it's a mark) or wrong (dropped), streamed too",
    long.said === "That one." && long.tags.length === 1 && wrong.said === "Here. There." && !wrong.tags.length && streaming.said === "Look", [long, wrong, streaming])
  // ---- choreography: rings shaped to their thing, the pen first, marks that follow
  {
  const ink: Any = await web("screendraw/ink.ts"), pen: Any = await web("screendraw/pen.ts")
  const row = { x: 100, y: 100, w: 300, h: 28 }, icon = { x: 500, y: 100, w: 32, h: 30 }, tall = { x: 50, y: 50, w: 30, h: 200 }
  const loop = ink.ringLine(lay.ringBox({ type: "ring" }, row), ink.seeded(3), lay.ringShape(row)), ringed = lay.ringBox({ type: "ring" }, row)
  const xs = loop.map((p: number[]) => p[0]), ys = loop.map((p: number[]) => p[1])
  check("screen drawings: a ring is a rounded box round a wide or tall thing (a row, a button), an ellipse round a square-ish one, by aspect",
    lay.ringShape(row) === "box" && lay.ringShape(tall) === "box" && lay.ringShape(icon) === "ellipse" && lay.ringShape({ x: 0, y: 0, w: 60, h: 40 }) === "ellipse", [lay.ringShape(row), lay.ringShape(icon)])
  check("screen drawings: a box ring hugs its row (its corners inside, a few points out) and overshoots its start",
    Math.min(...xs) < row.x && Math.min(...xs) > row.x - 16 && Math.max(...ys) > row.y + row.h && Math.max(...ys) < row.y + row.h + 18 && ringed.h < row.h + 20 && loop.length >= 48 &&
      Math.hypot(loop[0][0] - loop.at(-1)[0], loop[0][1] - loop.at(-1)[1]) < 60 && loop.at(-1)[0] > loop[0][0], { ringed, first: loop[0], last: loop.at(-1) })
  const at = (i: number, x: number, y: number) => ({ i, mark: { type: "check" }, box: { x, y, w: 0, h: 0 } })
  const close = [at(0, 100, 100), at(1, 130, 110)], far = [at(0, 100, 100), at(1, 1100, 700)], cards = [at(0, 100, 100), { i: 1, mark: { type: "sticky" }, box: { x: 1200, y: 800, w: 0, h: 0 }, card: { x: 1200, y: 800, w: 200, h: 100 } }]
  const startOf = (i: number) => 1000 + i * 170, seed = () => 7
  const nearT = pen.waitForPen(close, seed, startOf), farT = pen.waitForPen(far, seed, startOf), cardT = pen.waitForPen(cards, seed, startOf)
  const firstEnd = Math.max(...pen.penStrokes([far[0]], seed, () => 1000).map((s: Any) => s.start + s.dur))
  check("screen drawings: a far mark waits for the pen to finish the last one and hop over; a near one goes on as a hand does; cards don't wait",
    nearT.get(1) === startOf(1) && farT.get(1) >= firstEnd + 300 && farT.get(0) === 1000 && cardT.get(1) === startOf(1), { near: [...nearT], far: [...farT], firstEnd })
  const pl: Any = await web("core/pilot.ts"), strokes = pen.penStrokes(far, seed, (i: number) => farT.get(i))
  const tip = (t: number) => pl.penAt({ id: "f", strokes }, t, { x: 0, y: 0 }, 0)
  check("screen drawings: so the pen is at a far mark as its ink starts there, and says when it's inking (a frame's drag lays none)",
    Math.hypot(tip(farT.get(1)).p.x - strokes.find((s: Any) => s.start >= farT.get(1)).pts[0][0], tip(farT.get(1)).p.y - strokes.find((s: Any) => s.start >= farT.get(1)).pts[0][1]) < 2 &&
      tip(1050).ink === true && tip(firstEnd + 100).ink !== true && pen.penStrokes([{ i: 0, mark: { type: "frame" }, box: { x: 0, y: 0, w: 50, h: 50 } }], seed, () => 0)[0].dry === true, [tip(farT.get(1)), strokes.map((s: Any) => s.start)])
  const ps: Any = await web("core/pensound.ts")
  check("screen drawings: the pen's sound is silent when it's slow, soft and rising with its speed, never past its quiet peak",
    ps.penLevel(10) === 0 && ps.penLevel(400) > 0 && ps.penLevel(400) < ps.penLevel(1200) && ps.penLevel(99999) === 1 && ps.PEN_PEAK <= 0.02, [ps.penLevel(400), ps.penLevel(1200)])
  const dw: Any = await import(pathToFileURL(path.join(ROOT, "plugins/core/companion/drawings.ts")).href)
  const layer = { id: "d1", agent: "Claude", tint: "blue", t: 0, places: { "el:a3": { x: 10, y: 20, w: 40, h: 20 } },
    marks: [{ type: "ring", id: "m1", at: { el: "a3" } }, { type: "underline", id: "m2", at: { el: "a3" } }, { type: "check", id: "m3", at: { x: 300, y: 300, w: 0, h: 0 } }, { type: "sticky", id: "m4", text: "x" }] }
  const sh = dw.shifted(layer, [{ mark: "m1", dx: 5, dy: -10 }, { mark: "m2", dx: 5, dy: -10 }, { mark: "m3", dx: 0, dy: 40 }])
  check("screen drawings: marks whose things moved follow them: a shared place moves once, a box with its mark, nothing else",
    JSON.stringify(sh.places["el:a3"]) === '{"x":15,"y":10,"w":40,"h":20}' && JSON.stringify(sh.marks[2].at) === '{"x":300,"y":340,"w":0,"h":0}' && sh.marks[3] === layer.marks[3] &&
      dw.shifted(layer, [{ mark: "m1", dx: 0, dy: 0 }]) === layer, sh)
  }
})
