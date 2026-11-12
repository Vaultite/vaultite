import { check } from "../lib.ts"
import { same } from "./lib.ts"

// Places plugins fill and the user arranges (core/slots.ts), and a new tab's page (core/newtab.ts).
{
  const sl = await import("../../../core/slots.ts")
  const nt = await import("../../../core/newtab.ts")
  check("slots: the default is by sort, without hidden keys", same(sl.defaultOrder([{ key: "b", sort: 20 }, { key: "a", sort: 10 }, { key: "h", sort: 0, hidden: true }, { key: "c" }]), ["a", "b", "c"]))
  check("slots: a key put before another, or at the end", same(sl.placeKey(["a", "b", "c"], "c", "a"), ["c", "a", "b"]) && same(sl.placeKey(["a", "b"], "x", null), ["a", "b", "x"]) && same(sl.placeKey(["a", "b"], "a", "gone"), ["b", "a"]))
  const list = ["a", "b", "c"]
  check("slots: positions to anchors", sl.anchorFor(list, "c", "top") === "a" && sl.anchorFor(list, "a", "bottom") === null && sl.anchorFor(list, "b", "up") === "a" &&
    sl.anchorFor(list, "b", "down") === null && sl.anchorFor(list, "a", "2") === "c" && sl.anchorFor(list, "a", "0") === "b" && sl.anchorFor(list, "x", "2") === "b" && sl.anchorFor(list, "a", "sideways") === undefined)
  check("slots: down from the top lands second", same(sl.placeKey(list, "a", sl.anchorFor(list, "a", "down") ?? null), ["b", "a", "c"]))
  check("newtab: unset reads as nulls; lists read leniently", same(nt.readNewTab(undefined), { sections: null, actions: null, icons: null, page: null, opens: null }) &&
    same(nt.readNewTab({ sections: ["core:actions", 3, "core:actions", ""], actions: "file:new", icons: { "file:new": " star ", "palette:open": 3, x: "" }, page: 3 }),
      { sections: ["core:actions"], actions: null, icons: { "file:new": "star" }, page: null, opens: null }) &&
    nt.readNewTab({ page: " Dashboards/Start.md " }).page === "Dashboards/Start.md")
  check("newtab: `opens` is the switcher, a view's tab or unset (the page, its default, and anything else)", nt.readNewTab({ opens: "switcher" }).opens === "switcher" &&
    nt.readNewTab({ opens: " view:web " }).opens === "view:web" && nt.readNewTab({ opens: "page" }).opens === null && nt.readNewTab({ opens: "file:Notes/A.md" }).opens === null &&
    nt.readNewTab({ opens: "Switcher" }).opens === null)
  check("newtab: a button's icon set, changed and taken off (none left: unset)", same(nt.withIcon(null, "file:new", "star"), { "file:new": "star" }) &&
    same(nt.withIcon({ "file:new": "star", "palette:open": "x" }, "file:new", ""), { "palette:open": "x" }) && nt.withIcon({ "file:new": "star" }, "file:new", " ") === null)
  const all = [...nt.CORE_SECTIONS, { key: "terminal:sessions", sort: 5, hidden: true }, { key: "pages:tiles", sort: 0 }]
  check("newtab: the default page is by sort, without hidden sections", same(nt.shownSections(nt.readNewTab({}), all), ["pages:tiles", "core:actions", "core:opened", "core:changed"]))
  check("newtab: a saved page is as listed (an empty one too)", same(nt.shownSections(nt.readNewTab({ sections: ["terminal:sessions", "core:actions"] }), all), ["terminal:sessions", "core:actions"]) &&
    same(nt.shownSections(nt.readNewTab({ sections: [] }), all), []))
  check("newtab: the default buttons, else the saved ones", same(nt.shownActions(nt.readNewTab({})), nt.DEFAULT_ACTIONS) && same(nt.shownActions(nt.readNewTab({ actions: ["terminal:claude"] })), ["terminal:claude"]))
}

// The sidebars' panels (core/sidebars.ts, shared with the CLI and Workspaces): read leniently, moves anchored on panels.
{
  const sb = await import("../../../core/sidebars.ts")
  const s = sb.readSidebars({ left: ["search:search", "pages:pages", 3, "files:files", "pages:pages"], right: ["files:files", "tags:tags"], collapsed: ["pages:pages", "gone:gone"] })!
  check("sidebars: read leniently (not text, repeats and folds of panels not shown go)", JSON.stringify(s) ===
    JSON.stringify({ left: ["search:search", "pages:pages", "files:files"], right: ["tags:tags"], collapsed: ["pages:pages"], heights: {} }), s)
  check("sidebars: unset reads as null; one side is enough", sb.readSidebars({ other: 1 }) === null && sb.readSidebars(undefined) === null &&
    JSON.stringify(sb.readSidebars({ right: ["a"] })) === JSON.stringify({ left: [], right: ["a"], collapsed: [], heights: {} }))
  const tall = sb.readSidebars({ left: ["a", "b"], heights: { a: 180.4, b: -1, gone: 90, c: "x" } })!
  check("sidebars: heights of panels shown, whole pixels", JSON.stringify(tall.heights) === JSON.stringify({ a: 180 }), tall)
  const moved = sb.placePanel(tall, "a", { side: "right", before: null })
  check("sidebars: a height moves with its panel; hidden, it goes", moved.heights.a === 180 && !("a" in sb.withoutPanel(tall, "a").heights), moved)
  check("sidebars: a height set and cleared", sb.setHeight(tall, "b", 99).heights.b === 99 && !("a" in sb.setHeight(tall, "a", null).heights))
  // Heights drawn in proportion to the sidebar's height they were set at (heightsAt).
  const at = sb.setHeight(tall, "b", 100, 800)
  check("sidebars: a height set at a sidebar's height remembers it", at.heightsAt === 800 && at.heights.b === 100 && at.heights.a === 180, at)
  check("sidebars: drawn in proportion on a taller screen", sb.heightIn(at, "b", 1200) === 150 && sb.heightIn(at, "a", 400) === 90 && sb.heightIn(tall, "a", 1200) === 180)
  const again = sb.setHeight(at, "b", 120, 400)
  check("sidebars: set on another screen, the others are put in its terms", again.heightsAt === 400 && again.heights.a === 90 && again.heights.b === 120, again)
  check("sidebars: heightsAt read back, and dropped with no heights", sb.readSidebars({ left: ["a"], heights: { a: 50 }, heightsAt: 700 })!.heightsAt === 700 &&
    !("heightsAt" in sb.readSidebars({ left: ["a"], heightsAt: 700 })!))
  const pins = await import("../../../core/pins.ts")
  check("pins: placed at the end, before another, moved, kept before itself, unpinned", pins.placePin(["a", "b"], "c", true).join() === "a,b,c" &&
    pins.placePin(["a", "b"], "c", true, "a").join() === "c,a,b" && pins.placePin(["a", "b"], "b", true, "a").join() === "b,a" &&
    pins.placePin(["a", "b"], "a", true).join() === "a,b" && pins.placePin(["a", "b"], "a", false).join() === "b" &&
    pins.placePin(["a", "b"], "a", true, "a").join() === "a,b")
  check("pins: follow a moved folder, go with the trash", pins.repinList(["N/a", "N/b", "M"], "N", "O").join() === "O/a,O/b,M" &&
    pins.repinList(["N/a", "M"], "N/a", null).join() === "M")
  check("pins: a heading follows its note, a search stays", pins.repinList(["N/a.md#Plan", "search:N/a.md", "N/a.md"], "N/a.md", "O/b.md").join() === "O/b.md#Plan,search:N/a.md,O/b.md" &&
    pins.repinList(["N/a.md#Plan", "M"], "N", null).join() === "M" && JSON.stringify(pins.pinKind("N/a.md#^id")) === '{"file":"N/a.md","heading":"^id"}' &&
    JSON.stringify(pins.pinKind("view:terminal/resume-claude-a.md#x")) === '{"view":"view:terminal/resume-claude-a.md#x"}' && pins.repinList(["view:terminal/resume-claude-1"], "view:terminal", "x").join() === "view:terminal/resume-claude-1",
    pins.repinList(["N/a.md#Plan", "search:N/a.md", "N/a.md"], "N/a.md", "O/b.md"))
  check("pins: a pinned folder is a path; it follows its move and its parent's, and goes with the trash",
    JSON.stringify(pins.pinKind("Projects/Lighthouse")) === '{"file":"Projects/Lighthouse"}' &&
    pins.repinList(["Projects/Lighthouse", "Projects/Lighthouse/a.mp4", "Projects"], "Projects/Lighthouse", "Archive/Lighthouse").join() === "Archive/Lighthouse,Archive/Lighthouse/a.mp4,Projects" &&
    pins.repinList(["Projects/Lighthouse"], "Projects", "Work").join() === "Work/Lighthouse" && pins.repinList(["Projects/Lighthouse", "M"], "Projects/Lighthouse", null).join() === "M" &&
    pins.repinList(["Projects/Lighthouse2"], "Projects/Lighthouse", "X").join() === "Projects/Lighthouse2")
  check("sidebars: the default is by sort, without hidden panels", sb.defaultSidebars([{ key: "b", sort: 20 }, { key: "a", sort: 10 }, { key: "h", sort: 0, hidden: true }]).left.join() === "a,b")
  const sided = sb.defaultSidebars([{ key: "b", sort: 20 }, { key: "c", sort: 5, side: "right" }, { key: "a", sort: 10 }])
  check("sidebars: a panel that starts on the right is there by default", sided.left.join() === "a,b" && sided.right.join() === "c", sided)
  const up = sb.placePanel(s, "files:files", { side: "left", before: "search:search" })
  check("sidebars: moved before another", up.left.join() === "files:files,search:search,pages:pages", up)
  const right = sb.placePanel(s, "pages:pages", { side: "right", before: null })
  check("sidebars: to the other sidebar's end, folded as it was", right.right.join() === "tags:tags,pages:pages" && !right.left.includes("pages:pages") && right.collapsed.includes("pages:pages"), right)
  const self = sb.placePanel(s, "files:files", { side: "left", before: "files:files" })
  check("sidebars: an anchor that's gone (itself) puts it at the end", self.left.join() === "search:search,pages:pages,files:files", self)
  const hid = sb.withoutPanel(s, "pages:pages")
  check("sidebars: hidden, its fold goes too (shown again, it's open)", !hid.left.includes("pages:pages") && !hid.collapsed.length, hid)
  check("sidebars: fold and open", sb.setCollapsed(s, "files:files", true).collapsed.join() === "pages:pages,files:files" && !sb.setCollapsed(s, "pages:pages", false).collapsed.length)
  const many = sb.setHeights(at, { a: 60, b: null }, 400)
  check("sidebars: several heights set at once", many.heights.a === 60 && !("b" in many.heights) && many.heightsAt === 400, many)

  // Laying out panels in their own boxes (fitPanels, dragPanels, heightsAfterDrag): px.
  const search = { content: 32, min: 112 }, pinned = { content: 68, min: 112 }, terms = { content: 68, min: 112 }
  const tree = { content: 1600, min: 112, greedy: true }
  const fit = sb.fitPanels([search, pinned, terms, tree], 700)
  check("fit: panels that draw little keep their whole height, the tree takes the rest", JSON.stringify(fit) === JSON.stringify([32, 68, 68, 532]), fit)
  const small = sb.fitPanels([pinned, { content: 300, min: 112, greedy: true }], 700)
  check("fit: everything fits: each as tall as it draws, the rest empty at the bottom", JSON.stringify(small) === JSON.stringify([68, 300]), small)
  const two = sb.fitPanels([{ content: 216, min: 112 }, tree], 600)
  check("fit: a panel that doesn't fit gets all it draws while the tree keeps half", JSON.stringify(two) === JSON.stringify([216, 384]), two)
  const three = sb.fitPanels([{ content: 430, min: 112 }, { content: 380, min: 112 }, tree], 728)
  check("fit: several that don't fit share half, evenly; the tree the other half", JSON.stringify(three) === JSON.stringify([182, 182, 364]), three)
  const uneven = sb.fitPanels([{ content: 150, min: 112 }, { content: 900, min: 112 }, tree], 800)
  check("fit: one needing less than its share keeps only that", JSON.stringify(uneven) === JSON.stringify([150, 250, 400]), uneven)
  const dragged = sb.fitPanels([{ content: 400, min: 112, height: 300 }, tree], 700)
  check("fit: a saved height kept, the tree takes the rest", JSON.stringify(dragged) === JSON.stringify([300, 400]), dragged)
  const stale = sb.fitPanels([{ content: 68, min: 112, height: 400 }, tree], 700)
  check("fit: a saved height taller than what it draws: clamped (no empty room inside)", JSON.stringify(stale) === JSON.stringify([68, 632]), stale)
  const back = sb.fitPanels([{ content: 300, min: 112, height: 150 }, { content: 200, min: 112 }], 700)
  check("fit: room to spare: one dragged short takes it back", JSON.stringify(back) === JSON.stringify([300, 200]), back)
  const tight = sb.fitPanels([{ content: 400, min: 112, height: 300 }, { content: 400, min: 112, height: 300 }, tree], 400)
  check("fit: short of room: the tree at its least, saved heights give way in proportion", tight[2] === 112 && tight[0] === 144 && tight[1] === 144, tight)
  const tiny = sb.fitPanels([{ content: 400, min: 112 }, tree, { content: 30, min: 112, fixed: true }], 100)
  check("fit: no room at all: all at their least (the sidebar scrolls)", JSON.stringify(tiny) === JSON.stringify([112, 112, 30]), tiny)
  check("fit: whole pixels that add up to the room", sb.fitPanels([{ content: 333, min: 50 }, { content: 333, min: 50 }, { content: 333, min: 50 }], 500).reduce((a, b) => a + b) === 500)

  const ps = [pinned, { content: 400, min: 112 }, tree], start = sb.fitPanels(ps, 700)
  const down = sb.dragPanels(ps, start, 1, 80)
  check("drag: down, the panel above grows and the one below gives", down[1] === start[1] + 80 && down[2] === start[2] - 80 && down[0] === start[0], [start, down])
  const capped = sb.dragPanels(ps, start, 1, 900)
  check("drag: never taller than what it draws", capped[1] === 400 && capped.reduce((a, b) => a + b) === start.reduce((a, b) => a + b), capped)
  const none = sb.dragPanels(ps, start, 0, 50)
  check("drag: a panel that draws little can't grow past it (nor the ones above it)", JSON.stringify(none) === JSON.stringify(start), none)
  const upward = sb.dragPanels(ps, start, 1, -500)
  check("drag: up, it gives down to its least and the tree below grows", upward[1] === 112 && upward[2] === start[2] + start[1] - 112, upward)
  const cascade = sb.dragPanels([{ content: 400, min: 112 }, { content: 300, min: 112 }, tree], [200, 200, 300], 1, -250)
  check("drag: past its least, the next one up gives too", JSON.stringify(cascade) === JSON.stringify([112, 112, 476]), cascade)
  const save = sb.heightsAfterDrag(ps, 700, down)
  check("drag: saves the dragged panel's height, not the tree's (it takes the rest anyway)", save.get(1) === down[1] && !save.has(2) && !save.has(0), [...save])
  const full = sb.heightsAfterDrag([pinned, { content: 400, min: 112, height: 200 }, tree], 700, [68, 400, 232])
  check("drag: dragged out to all it draws: the height it needs", full.get(1) === 400 && !full.has(2), [...full])
}
