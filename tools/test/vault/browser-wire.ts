import crypto from "node:crypto"
import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
const same = (pairs: [got: {} | null | undefined, want: {} | null | undefined][]) => pairs.every(([got, want]) => JSON.stringify(got) === JSON.stringify(want))
const throws = (fn: () => void) => { try { fn(); return "ran" } catch { return "threw" } }

async function sessionCookies(check: Check) {
  const { parseKept } = await import("../../../electron/browser/cookieswire.ts")
  const sid = { name: "SID", value: "a", domain: ".example.com", hostOnly: false, path: "/", secure: true, httpOnly: true, sameSite: "lax" }
  const file = (cookies: unknown, v = 1) => JSON.stringify({ v, cookies })
  check("session cookies: a kept file's cookies come back, flags as booleans, anything malformed left out", same([
    [parseKept(file([sid])), [sid]],
    [parseKept(file([{ ...sid, hostOnly: "yes", secure: 0, httpOnly: 1, extra: 5 }])), [{ ...sid, hostOnly: true, secure: false, httpOnly: true }]],
    [parseKept(file([null, 5, "x", [], { ...sid, name: 5 }, { ...sid, value: null }, { ...sid, domain: "a b" }, { ...sid, domain: 5 }, { ...sid, path: "x" },
      { ...sid, path: 5 }, { ...sid, sameSite: "none" }, { ...sid, sameSite: undefined }, { ...sid, domain: "[::1]:8080" }])), [{ ...sid, domain: "[::1]:8080" }]],
    [parseKept(file([sid], 2)), []], [parseKept(file({ 0: sid })), []], [parseKept("null"), []], [parseKept("5"), []], [parseKept("[]"), []],
  ]))
  check("session cookies: a file that isn't JSON throws (the restore logs it)", throws(() => { parseKept("{bad") }) === "threw")
}

async function runSteps(check: Check) {
  const { fresh, scanLine, stepOf } = await import("../../../electron/browser/runwire.ts")
  const lines = [`{"t":100,"by":"Alice","task":"Book","url":"https://www.example.com/a","shot":"1.jpg"}`,
    `{"t":"200","failed":"no","title":"T","summary":"","shot":"x.png","by":"Bob"}`, "not json", "5", `"text"`, "[1]",
    `{"t":null,"task":5,"url":7,"failed":true,"summary":"S","shot":"2.jpg"}`, `{"url":"https://example.com/b","title":"","t":-3}`]
  const s = fresh()
  lines.forEach((l, i) => scanLine(s, l, i * 10))
  check("agent runs: a run's lines read into its steps, times, failures, pictures, sites and latest words", same([
    [{ ...s, hosts: [...s.hosts] }, { size: 0, mtime: 0, starts: [0, 10, 30, 40, 50, 60, 70], times: [100, 200, 0, 0, 0, 0, -3], fails: [200], shots: ["1.jpg", "2.jpg"],
      hosts: [["example.com", 2]], by: "Alice", task: "Book", summary: "S", title: "T", url: "https://example.com/b" }],
  ]), { ...s, hosts: [...s.hosts] })
  const objects = lines.filter((l) => l !== `"text"` && l !== "[1]")
  check("agent runs: a replay's steps are the lines as written, a picture's name only when it's one", same([
    [objects.flatMap(stepOf), [{ t: 100, by: "Alice", task: "Book", url: "https://www.example.com/a", shot: "1.jpg" },
      { t: "200", failed: "no", title: "T", summary: "", shot: null, by: "Bob" }, { shot: null },
      { t: null, task: 5, url: 7, failed: true, summary: "S", shot: "2.jpg" }, { url: "https://example.com/b", title: "", t: -3, shot: null }]],
  ]), objects.flatMap(stepOf))
}

async function passwordsConfig(check: Check) {
  const { configOf } = await import("../../../electron/browser/passwordswire.ts")
  check("passwords: the config names its file and sealed password, else none", same([
    [configOf(`{"file":"/a.kdbx","key":"c2VhbGVk"}`), { file: "/a.kdbx", key: "c2VhbGVk" }], [configOf(`{"file":"/a.kdbx","key":5,"x":1}`), { file: "/a.kdbx", key: null }],
    [configOf(`{"file":"/a.kdbx"}`), { file: "/a.kdbx", key: null }], [configOf(`{"key":"k"}`), null], [configOf(`{"file":5}`), null],
    [configOf("null"), null], [configOf("[]"), null], [configOf("7"), null], [configOf("{bad"), null],
  ]))
}

async function passwordEdits(check: Check) {
  const ed = await import("../../../electron/browser/kdbxedit.ts")
  const { CHANGE } = await import("../../../electron/browser/passwordswire.ts")
  const { Credentials, Kdbx, ProtectedValue } = await import("../../../electron/browser/kdbx/index.ts")
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString("made-up")), "Main")
  const shown = (id: string) => {
    const e = ed.entryById(db, id)
    return e && Object.fromEntries([...e.fields].map(([k, v]) => [k, typeof v === "string" ? v : v.getText()]).concat([["tags", e.tags.join(",")]]))
  }
  const saved = (raw: {} | null) => {
    const c = CHANGE.safeParse(raw)
    try { return c.success ? shown(ed.applyChange(db, c.data)) : "refused" } catch (e) { return e instanceof Error ? e.message : "threw" }
  }
  const empty = { Title: "", UserName: "", Password: "", URL: "", Notes: "", tags: "" }
  check("passwords: an edit from the page is saved by its fields' types, a list as an empty one, anything else refused", same([
    [saved({ title: "Lighthouse", username: "alice", password: "pw-1", urls: ["https://l.example.com", "https://a.example.com"], tags: ["t1", "t1", " t2 "], notes: "n", otp: "otpauth://x" }),
      { Title: "Lighthouse", UserName: "alice", Password: "pw-1", URL: "https://l.example.com", Notes: "n", KP2A_URL: "https://a.example.com", otp: "otpauth://x", tags: "t1,t2" }],
    [saved({ title: 5, username: null, password: ["x"], urls: ["https://x.example.com", 5, " b ", ""], tags: "x", notes: { a: 1 }, otp: 7, extra: 1 }),
      { Title: "", UserName: "", Password: "", URL: "https://x.example.com", Notes: "", KP2A_URL: "b", tags: "" }],
    [saved({}), empty], [saved({ id: "", title: "empty id" }), { ...empty, Title: "empty id" }], [saved([]), empty],
    [saved({ id: "nope", title: "x" }), "that entry is gone from the file (changed elsewhere?)"], [saved({ id: 5, title: "x" }), "refused"], [saved({ group: 5 }), "refused"],
    [saved(null), "refused"], [saved(5), "refused"], [saved("x"), "refused"],
  ]))
}

async function extensionPolicy(check: Check) {
  const { POLICY } = await import("../../../electron/browser/extwire.ts")
  const ok = (j: {} | null) => POLICY.safeParse(j).success
  check("extensions: a managed policy file is read only with its extensions list", same([
    [POLICY.parse({ extensions: ["/a", 5], other: 1 }), { extensions: ["/a", 5] }], [ok({ extensions: [] }), true],
    [ok({}), false], [ok({ extensions: "/a" }), false], [ok(null), false], [ok([]), false], [ok("x"), false],
  ]))
}

async function chromeHistory(check: Check) {
  const { CHROME_ROWS, chromeVisits } = await import("../../../electron/browser/historyrows.ts")
  const at = 13_300_000_000_000, row = (t: number, url: string | number = "https://example.com/", title: string | null = "Example") => ({ at, t, url, title })
  const rows = [row(0), row(1, "https://example.com/t", null), row(3), row(0x10000000), row(0x30000000 | 7), row(0x20000000 | 9), row(8), row(0, "ftp://x/"),
    row(0, 5), row(0, "HTTPS://EXAMPLE.COM/"), row(6), row(11)]
  const want = (url: string, title: string, how: string) => ({ url, title, at: 1_655_526_400_000, profile: "p", how, source: "chrome" })
  check("import: a browser's visits as the history keeps them, not frames', reloads or a redirect chain's middle", same([
    [chromeVisits(CHROME_ROWS.parse(rows), "p", "chrome"), [want("https://example.com/", "Example", "link"), want("https://example.com/t", "", "typed"),
      want("https://example.com/", "Example", "form"), want("https://example.com/", "Example", "typed"), want("HTTPS://EXAMPLE.COM/", "Example", "link"),
      want("https://example.com/", "Example", "other")]],
  ]), chromeVisits(CHROME_ROWS.parse(rows), "p", "chrome"))
}

async function darkColors(check: Check) {
  const { tintFilter } = await import("../../../electron/browser/darkcolors.ts")
  const themes = [["#1e1e2e", "#cdd6f4"], ["#000000", "#ffffff"], ["#282828", "#ebdbb2"], ["#002b36", "#839496"], ["#ffffff", "#000000"], ["#3b0a45", "#ffd6f0"],
    ["#101820", "#f2aa4c"], ["#202124", "#e8eaed"], ["#1e1e1e", "#d4d4d4"], ["#0d1117", "#c9d1d9"]]
  const all = themes.map(([b, f]) => tintFilter(b, f))
  check("dark pages: a theme's tint is the fitted filter functions when they're close, else the exact matrix, as before",
    all[1] === "brightness(0.403) sepia(0.000) hue-rotate(0.0deg) saturate(0.900) brightness(2.316) contrast(1.152)"
    && all[2] === "brightness(0.486) sepia(0.466) hue-rotate(-0.5deg) saturate(1.645) brightness(1.778) contrast(0.801)"
    && crypto.createHash("sha256").update(all.join("\n")).digest("hex").slice(0, 16) === "4b74588f9be0b936", all)
}

async function cdpAnswers(check: Check) {
  const C = await import("../../../electron/browser/cdpwire.ts")
  const { axLines } = await import("../../../electron/browser/axlines.ts")
  const node = (nodeId: string, role: string, name: string, more = {}) => ({ nodeId, ignored: false, role: { type: "role", value: role }, chromeRole: { type: "internalRole", value: 1 },
    name: { type: "computedString", value: name, sources: [] }, frameId: "F1", ...more })
  const tree = { nodes: [node("1", "RootWebArea", "Shop", { childIds: ["2", "3"], backendDOMNodeId: 1 }), node("2", "button", "Buy", { parentId: "1", backendDOMNodeId: 7,
    properties: [{ name: "focusable", value: { type: "booleanOrUndefined", value: true } }] }), node("3", "textbox", "Email", { parentId: "1", backendDOMNodeId: 8, value: { type: "string", value: "a@b" } })] }
  const refs = () => ({ byRef: new Map<string, number>(), byNode: new Map<number, string>(), n: 0, what: new Map() })
  const lines = (nodes: Parameters<typeof axLines>[0]) => axLines(nodes, refs(), () => false, (t) => t, "https://shop.example/")
  check("DevTools answers: an accessibility tree reads into the same snapshot, Chromium's other fields aside", same([
    [lines(C.AX_TREE.parse(tree).nodes), lines(tree.nodes)], [C.AX_TREE.safeParse({ nodes: [{ role: { value: "button" } }] }).success, false],
    [C.AX_TREE.safeParse({}).success, false], [C.AX_TREE.safeParse(null).success, false],
  ]), lines(C.AX_TREE.parse(tree).nodes))
  const doc = { root: { nodeId: 1, backendNodeId: 1, nodeType: 9, nodeName: "#document", localName: "", nodeValue: "", documentURL: "https://shop.example/", children: [
    { nodeId: 2, backendNodeId: 2, nodeType: 1, nodeName: "FORM", localName: "form", nodeValue: "", attributes: ["id", "f"], shadowRoots: [{ backendNodeId: 5, nodeName: "#document-fragment", nodeValue: "" }],
      children: [{ backendNodeId: 3, nodeName: "IFRAME", nodeValue: "", contentDocument: { backendNodeId: 4, nodeName: "#document", nodeValue: "", documentURL: "https://pay.example/" } }] }] } }
  const parsed = C.DOCUMENT.parse(doc).root
  check("DevTools answers: a document's tree keeps its frames, shadow roots and attributes; a node without its ids is refused", same([
    [[parsed.children?.[0].attributes, parsed.children?.[0].shadowRoots?.[0].backendNodeId, parsed.children?.[0].children?.[0].contentDocument?.documentURL], [["id", "f"], 5, "https://pay.example/"]],
    [C.DESCRIBED.safeParse({ node: { nodeName: "SELECT", children: [] } }).success, false], [C.DESCRIBED.safeParse({ node: { backendNodeId: 1, nodeName: "SELECT" } }).success, true],
  ]))
  const quad = [0, 0, 10, 0, 10, 20, 0, 20]
  check("DevTools answers: a box, a resolved node, the viewport and a screencast frame by their types", same([
    [C.BOX.parse({ model: { content: quad, padding: quad, border: quad, margin: quad, width: 10, height: 20 } }).model, { content: quad, border: quad, width: 10, height: 20 }],
    [C.BOX.safeParse({ model: { content: quad } }).success, false], [C.RESOLVED.parse({ object: { type: "object", objectId: "o-1" } }), { object: { objectId: "o-1" } }],
    [C.RESOLVED.safeParse({ object: { type: "object" } }).success, false], [C.LAYOUT.parse({ cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0 } }), { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } }],
    [C.LAYOUT.parse({}), {}], [C.SCREENCAST_FRAME.parse({ data: "jpeg", sessionId: 3, metadata: { deviceWidth: 800, deviceHeight: 600, offsetTop: 0 } }), { data: "jpeg", sessionId: 3, metadata: { deviceWidth: 800, deviceHeight: 600 } }],
    [C.SCREENCAST_FRAME.safeParse({ data: "jpeg" }).success, false],
  ]))
}

async function pageMessages(check: Check) {
  const P = await import("../../../electron/browser/pagewire.ts")
  const X = await import("../../../electron/browser/extwire.ts")
  const { LIVE_INPUT } = await import("../../../electron/browser/agentwire.ts")
  check("Shields: a page's classes, ids and links as text only, at most 5000 each; nothing from a non-object", same([
    [P.FOUND.parse({ classes: ["a", 5, "b"], ids: "x", hrefs: [null, "h"] }), { classes: ["a", "b"], ids: [], hrefs: ["h"] }], [P.FOUND.parse({ classes: Array(6000).fill("c") }).classes.length, 5000],
    [P.FOUND.safeParse(null).success, false], [P.FOUND.safeParse("x").success, false],
  ]))
  check("Shields: the window's choice, on unless false, its sites down trimmed and lowercase", same([
    [P.SHIELDS.parse({ on: false, down: [" A.com ", 3, "b"] }), { on: false, down: ["a.com", "b"] }], [P.SHIELDS.parse({ on: "no", down: "a" }), { on: "no", down: [] }],
    [P.SHIELDS.parse(null), { down: [] }], [P.SHIELDS.parse([1]), { down: [] }],
  ]))
  check("live: a watched page's input keeps its fields as given, nothing from a non-object", same([
    [LIVE_INPUT.parse({ type: "tap", x: 0.5, y: "0.2", count: 2, extra: 1 }), { type: "tap", x: 0.5, y: "0.2", count: 2 }], [LIVE_INPUT.parse(null), {}], [LIVE_INPUT.parse([1]), {}],
  ]))
  check("extensions: a popup's place and its page's size by their types", same([
    [X.POPUP_AT.parse({ x: 1, y: 2, width: 3, height: 4, z: 5 }), { x: 1, y: 2, width: 3, height: 4 }], [X.POPUP_AT.safeParse({ x: 1 }).success, false],
    [X.POPUP_SIZE.parse([320, 400]), [320, 400]], [X.POPUP_SIZE.safeParse([320]).success, false], [X.POPUP_SIZE.safeParse("320x400").success, false],
  ]))
}

export default async ($: VaultTest) => {
  for (const t of [sessionCookies, runSteps, passwordsConfig, passwordEdits, extensionPolicy, chromeHistory, darkColors, cdpAnswers, pageMessages]) await t($.check)
}
