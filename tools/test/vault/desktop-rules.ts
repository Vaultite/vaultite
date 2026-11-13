import fs from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
const ROOT = path.resolve(import.meta.dirname, "../../..")

function winspawnFirst(check: Check) {
  const firstImport = (file: string) => /^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/m.exec(fs.readFileSync(path.join(ROOT, file), "utf8"))?.[1]
  check("desktop: winspawn is the first import of the main process and the server, so no program they start opens a console on Windows",
    firstImport("electron/main.ts") === "../core/winspawn.ts" && firstImport("server.ts") === "./core/winspawn.ts", [firstImport("electron/main.ts"), firstImport("server.ts")])
}

async function bridge(check: Check) {
  const { appPage } = await import("../../../electron/apppermissions.ts")
  const o = "http://127.0.0.1:8793"
  check("desktop: the bridge answers the app's own page only, never a vault's file served under its origin",
    appPage(`${o}/`, o) && appPage(`${o}/index.html?x=1#y`, o) &&
    !appPage(`${o}/v/Notes/page.html`, o) && !appPage(`${o}/api/raw?path=a.html`, o) && !appPage(`${o}/index.html/..%2fv/x`, o) &&
    !appPage("http://127.0.0.1:8794/", o) && !appPage("http://127.0.0.1:8793.evil.example/", o) && !appPage("not a url", o))
}

async function clipboard(check: Check) {
  const K = await import("../../../electron/browser/keypress.ts")
  const touches = Object.values(K.MAC_COMMANDS).filter((c) => /copy|cut|paste|yank/i.test(c))
  check("browser agents: no editing key a Mac page takes copies, cuts or pastes", !touches.length, touches)
  const refused = ["Meta+c", "Meta+x", "Meta+v", "Meta+Shift+v", "Control+c", "Ctrl+X", "control+v", "Shift+Insert", "Control+Insert", "Shift+Delete", "Meta + V"]
  const allowed = ["Meta+a", "Control+a", "Backspace", "Enter", "c", "Shift+c", "Alt+c", "Meta+z", "Delete"]
  check("browser agents: copy, cut and paste keys are refused on every platform, other keys aren't",
    refused.every(K.clipboardKey) && !allowed.some(K.clipboardKey), [refused.filter((k) => !K.clipboardKey(k)), allowed.filter(K.clipboardKey)])
  const down = (combo: string, os: NodeJS.Platform) => K.keyEvent(combo, os).down
  check("browser agents: a Mac's editing key goes as its command, elsewhere and for other keys none",
    JSON.stringify(down("Meta+a", "darwin").commands) === '["selectAll"]' && !("commands" in down("Meta+c", "darwin")) && !("commands" in down("Control+a", "linux")) &&
    down("a", "darwin").text === "a" && down("Shift+A", "linux").modifiers === 8)
}

async function snapshots(check: Check) {
  const { axLines } = await import("../../../electron/browser/axlines.ts")
  const S = "hunter2-secret"
  const v = (value: string) => ({ value })
  const nodes = [
    { nodeId: "1", role: v("RootWebArea"), name: v("Log in"), childIds: ["2", "4", "6"] },
    { nodeId: "2", role: v("textbox"), name: v("Password"), value: v(S), backendDOMNodeId: 20, childIds: ["3"] },
    { nodeId: "3", role: v("StaticText"), name: v(S), backendDOMNodeId: 30 },
    { nodeId: "4", role: v("textbox"), name: v("Shown password"), value: v("●●●●●●"), backendDOMNodeId: 40 },
    { nodeId: "6", role: v("textbox"), name: v("Email"), value: v("alice@example.com"), backendDOMNodeId: 60 },
  ]
  const refs = { byRef: new Map<string, number>(), byNode: new Map<number, string>(), n: 0, what: new Map<string, { role: string; name: string }>() }
  const lines = axLines(nodes, refs, (id) => id === 20, (s) => s).join("\n")
  check("browser agents: a snapshot never shows a filled secret, the text inside its field, or a password's length",
    !lines.includes(S) && !lines.includes("●") && /textbox "Password" \[ref=e\d\]: •••/.test(lines) && /textbox "Shown password" \[ref=e\d\]: •••/.test(lines) && lines.includes("alice@example.com"), lines)
  const { mask } = await import("../../../electron/browser/mask.ts")
  check("browser agents: secrets are masked longest first, so one inside another leaves none of it, typed or URL-encoded",
    mask("pw=abcdef", ["abc", "abcdef"]) === "pw=•••" && mask("q=a%20b+c&x=a b c", ["a b c"]) === "q=•••&x=•••" && mask("nothing", []) === "nothing",
    [mask("pw=abcdef", ["abc", "abcdef"]), mask("q=a%20b+c&x=a b c", ["a b c"])])
}

async function linkText(check: Check) {
  const L = await import("../../../electron/browser/linktext.ts"), { axLines } = await import("../../../electron/browser/axlines.ts"), page = "https://blog.example.com/posts/why"
  const shorts = ["https://en.wikipedia.org/wiki/Effective_altruism?utm_source=x&fbclid=y#History", "https://www.youtube.com/watch?v=abc&si=zz", "/posts/other/", "#notes",
    "https://blog.example.com/posts/why#top", "javascript:void(0)", "mailto:alice@example.com", "https://example.com/caf%C3%A9"].map((h) => L.shortUrl(h, page))
  check("link text: a link's destination is its host and path (no www, tracking or #part), a path alone on the same site; same-page anchors and scripts none",
    JSON.stringify(shorts) === JSON.stringify(["en.wikipedia.org/wiki/Effective_altruism", "youtube.com/watch?v=abc", "/posts/other", null, null, null, "mailto:alice@example.com", "example.com/café"]), shorts)
  const { parseHTML } = await import("linkedom")
  const { document } = parseHTML(`<html><body><article><p>Some call it <a href="https://en.wikipedia.org/wiki/Effective_altruism?utm_medium=s">effective altruism</a>, see <a href="#n1">1</a> and
    <a href="https://example.com/a">example.com/a</a>; also <a data-wiki="Lighthouse">the plan</a>, <a data-wiki="Alice Park">Alice Park</a>, and <a href="https://alice.example.org"><img alt=""></a>.</p></article></body></html>`)
  const art = document.querySelector("article"), first = document.querySelector("a")
  const read = art ? L.textWithLinks(art, L.shortUrl) : "", one = first ? L.textWithLinks(first, L.shortUrl) : ""
  const has = ["effective altruism (→ en.wikipedia.org/wiki/Effective_altruism),", "see 1 and", "example.com/a;", "the plan (→ [[Lighthouse]])"], hasnt = ["example.com/a (→", "Alice Park (→", "alice.example.org"]
  check("link text: a page's text has each link's destination after its words, a note's as its [[name]], none for anchors, bare addresses or names said as they are",
    has.every((w) => read.includes(w)) && !hasnt.some((w) => read.includes(w)) && one === "effective altruism (→ en.wikipedia.org/wiki/Effective_altruism)", [read, one])
  const v = (value: string) => ({ value }), link = (id: string, name: string, url: string) => ({ nodeId: id, role: v("link"), name: v(name), backendDOMNodeId: Number(id), properties: [{ name: "url", value: v(url) }] })
  const nodes = [{ nodeId: "1", role: v("RootWebArea"), name: v("Why"), childIds: ["2", "3", "4"] }, link("2", "effective altruism", "https://en.wikipedia.org/wiki/Effective_altruism?gclid=1"),
    link("3", "Notes", "https://blog.example.com/posts/why#notes"), link("4", "example.com/a", "https://example.com/a")]
  const tree = axLines(nodes, { byRef: new Map(), byNode: new Map(), n: 0, what: new Map() }, () => false, (s) => s, page).join("\n")
  const lines = [/link "effective altruism" \(→ en\.wikipedia\.org\/wiki\/Effective_altruism\) \[ref=e\d+\]$/m, /link "Notes" \[ref=e\d+\]$/m, /link "example\.com\/a" \[ref=e\d+\]$/m]
  check("link text: a snapshot's link says where it goes, but a same-page anchor's or one named by its address", lines.every((r) => r.test(tree)), tree)
}

async function accounts(check: Check) {
  const { ACCOUNTS } = await import("../../../electron/siteaccounts.ts")
  const S = "tok_S3CRETxyz123"
  const json = { accessToken: S, token: S, sessionKey: S, csrf: S, email: "alice@example.com",
    user: { email: "alice@example.com", name: "Alice", username: "alice", accessToken: S, token: S, id: S },
    account: { email_address: "alice@example.com", uuid: S }, data: { name: "alice", modhash: S }, result: { email: "alice@example.com", api_token: S },
    form_data: { username: "alice", fb_dtsg: S }, query: { userinfo: { id: 1, name: "Alice", token: S } } }
  const html = `<meta name="csrf-token" content="${S}"><meta name="user-login" content="alice"><script>{"token":"${S}","NAME":"Alice"}</script>`
  const cookie = async () => `alice&${S}`
  const leaks: string[] = []
  for (const [site, rule] of Object.entries(ACCOUNTS)) {
    const said = await Promise.resolve().then(() => rule.read?.(rule.text ? html : json, cookie, `https://${site}/`)).catch(() => null)
    const looked = rule.look ? (() => { try { return rule.look.read({ handle: "alice", avatar: "", phone: S, token: S }) } catch { return null } })() : null
    if (JSON.stringify([said, looked]).includes(S)) leaks.push(site)
    if (Object.keys(rule.headers ?? {}).some((h) => /auth|cookie|token|csrf|secret/i.test(h))) leaks.push(`${site} headers`)
  }
  check("browser: who's signed in to a site never holds a token or a cookie's secret, whatever its answer carries", !leaks.length, leaks)
}

async function hangs(check: Check) {
  const H = await import("../../../electron/hang.ts")
  const machine = { load: 3.2, freeMB: 120, totalMB: 8192 }
  const at = (t: number, stack: string, cpuSeconds: number | null, more: { cpuPercent?: number; lateMs?: number } = {}) => ({ at: t, stack, cpuSeconds, cpuPercent: more.cpuPercent ?? null, memoryMB: 900, lateMs: more.lateMs ?? 0 })
  const run = (samples: ReturnType<typeof at>[], how: "recovered" | "reloaded" | "gone" | "still" = "recovered", frames: Parameters<typeof H.hangReport>[4] = []) =>
    H.hangReport("MyVault", samples.reduce(H.sampled, H.hangStarted(0)), { at: (samples.at(-1)?.at ?? 0) + 4000, how }, machine, frames)
  const loop = "at render (http://127.0.0.1:8793/assets/main.js:1:2)", other = "at parse (http://127.0.0.1:8793/assets/state.js:3:4)"
  const inScript = run([at(0, other, 0), at(3000, loop, 3), at(6000, loop, 6)])
  check("hangs: a script caught running says so, its most frequent stack first so Errors groups by it",
    inScript.message === "MyVault's page stopped responding (in its script)" && inScript.stack.startsWith(loop) && inScript.stack.includes(`also, 1 of 3 times:\n${other}`) &&
    inScript.stack.includes("10 s, then came back") && inScript.stack.includes("100% CPU, 900 MB"), inScript)
  check("hangs: no script caught, the renderer's CPU over the hang tells busy from waiting",
    run([at(0, "", 10), at(3000, "", 12.7)]).message.endsWith("(busy outside its script: layout, style or garbage collection)") &&
    run([at(0, "", 10), at(3000, "", 10.1)]).message.endsWith("(idle: waiting on something)") &&
    run([at(0, "", null)]).message.endsWith("(its script's stack unknown)") && run([]).message.endsWith("(its script's stack unknown)"))
  const framed = run([at(0, "", 1)], "recovered", [{ ms: 41_000, blockingMs: 40_950, scripts: [{ ms: 40_900, where: "TimerHandler:setTimeout tick http://127.0.0.1:8793/assets/main.js:120" }] }])
  check("hangs: how it ended, the machine, and the long frame that held it with its script",
    framed.stack.includes("this machine: load 3.2, 120 of 8192 MB free") && framed.stack.includes("a 41000 ms frame (40950 ms blocking):\n  40900 ms TimerHandler:setTimeout tick") &&
    run([], "reloaded").stack.includes("until it was reloaded") && run([], "still").stack.includes("and still not"), framed.stack)
  const starved = H.hangReport("MyVault", [at(0, "", null), at(5500, "", null)].reduce(H.sampled, H.hangStarted(0)), { at: 188_000, how: "recovered" }, machine, [])
  check("hangs: looks that came late or stopped coming say the app itself was held up (2 looks in 188 s, as on the M1 swapping)",
    starved.message.endsWith("(the whole app held up: this machine short of memory or CPU)") && /its looks came up to 177 s late/.test(starved.stack) &&
    run([at(0, "", null, { lateMs: 4000 }), at(7000, "", null)]).message.endsWith("(the whole app held up: this machine short of memory or CPU)") &&
    !run([at(0, "", 0), at(3000, "", 3)]).stack.includes("late"), starved)
  check("hangs: without its cumulative CPU, the renderer's percentages tell", run([at(0, "", null, { cpuPercent: 5 }), at(3000, "", null, { cpuPercent: 90 }), at(6000, "", null, { cpuPercent: 80 })]).stack.includes("85% CPU"))
  check("hangs: at most a few looks are kept", Array.from({ length: 30 }, (_, i) => at(i, "", null)).reduce(H.sampled, H.hangStarted(0)).samples.length === H.MAX_SAMPLES)
}

async function cloudSessions(check: Check) {
  const C = await import("../../../electron/cloud.ts")
  const read = C.RAW_SESSION.safeParse
  const of = (r: ReturnType<typeof read>) => (r.success ? C.sessionOf(r.data, "p1", "org1") : null)
  const full = of(read({ id: "session_abc", title: "  Fix   the\nbug ", session_status: "requires_action", updated_at: "2026-11-12T10:00:00Z", unread: true, origin: "ios", environment_kind: "bridge",
    external_metadata: { post_turn_summary: { status_category: "need_input", needs_action: "Which branch?" } },
    session_context: { outcomes: [{ git_info: { repo: "alice/lighthouse", branches: ["feat/x"] } }, { git_info: { repo: "bad repo" } }, null, { git_info: { repo: "alice/other", branches: ["bad branch!"] } }],
      sources: [{ url: "https://github.com/alice/web.git" }, { url: 5 }] } }))
  check("cloud sessions: claude.ai's session read into ours, what's malformed in it left out",
    JSON.stringify(full) === JSON.stringify({ id: "session_abc", title: "Fix the bug", state: "waiting", updated: Date.parse("2026-11-12T10:00:00Z"), url: "https://claude.ai/code/session_abc", profile: "p1", account: "org1",
      summary: "Which branch?", outcome: "input", unread: true, repos: [{ repo: "alice/lighthouse", branch: "feat/x" }, { repo: "alice/other" }, { repo: "alice/web" }], origin: "phone", remote: true }), full)
  const bare = of(read({ id: "session_c", title: 3, post_turn_summary: { status_category: "review_ready", recent_action: "Opened a PR" }, origin: "claude_code_cli", session_context: { outcomes: "x" } }))
  check("cloud sessions: a session with little in it, and none without an id",
    JSON.stringify(bare) === JSON.stringify({ id: "session_c", title: "Claude Code session", state: "idle", updated: 0, url: "https://claude.ai/code/session_c", profile: "p1", account: "org1", summary: "Opened a PR", outcome: "review", origin: "cli" }) &&
    of(read({ title: "x" })) === null && of(read(null)) === null, bare)
}

async function webWire(check: Check) {
  const W = await import("../../../electron/webwire.ts")
  const good = { name: "SID", value: "v", domain: ".google.com", path: "/", sameSite: "lax", secure: true, hostOnly: "yes", expirationDate: 123.5 }
  const list = [good, { ...good, domain: "accounts.google.co.uk" }, { ...good, domain: "evil.com" }, { ...good, sameSite: undefined }, { ...good, path: "x" },
    { ...good, domain: "bad domain" }, { ...good, expirationDate: "1" }, null, ...Array.from({ length: 600 }, (_, i) => ({ ...good, name: `n${i}` }))]
  const got = W.cookiesFrom(list, ["google.com", "google.co.uk"])
  check("browser: a login from another machine brings only its sites' well-formed cookies, at most 500",
    got.length === 500 && got[0].hostOnly === false && got[0].secure && got[1].domain === "accounts.google.co.uk" && !got.some((c) => c.domain === "evil.com" || c.path !== "/"), got.slice(0, 3))
  const sealed = W.SEALED_LOGIN.parse({ at: 1, names: ["Google.com", 3], known: { "google.com": { login: "h", who: { account: "a@example.com", more: "x" } }, "evil.com": { login: "h", who: { account: "b" } }, "x.com": { who: {} } } })
  check("browser: what a sealed login says is read field by field, malformed parts left out",
    JSON.stringify(sealed.names) === '["google.com"]' && JSON.stringify(W.knownFrom(sealed.known ?? {}, sealed.names ?? [])) === '{"google.com":{"login":"h","who":{"account":"a@example.com"}}}' &&
    JSON.stringify(W.SEALED_LOGIN.parse("x")) === "{}")
  const rect = (r: Parameters<typeof W.RECT.safeParse>[0]) => W.RECT.safeParse(r).data ?? null
  check("browser: a page's box from the app, its corner radius kept within 0 to 40, nothing for a malformed one",
    rect({ x: 1, y: 2, width: 3, height: 4 })?.radius === 0 && rect({ x: 1, y: 2, width: 3, height: 4, radius: 99 })?.radius === 40 &&
    rect({ x: 1, y: 2, width: 3, height: 4, radius: Infinity })?.radius === 0 && rect({ x: 1, y: 2, width: 3, height: NaN }) === null && rect("r") === null)
}

const same = (pairs: [got: unknown, want: unknown][]) => pairs.every(([got, want]) => JSON.stringify(got) === JSON.stringify(want))

async function agentAsks(check: Check) {
  const { BY } = await import("../../../electron/browser/agentwire.ts")
  check("browser agents: who asks is read field by field, spaces folded and cut, remote only when true, nothing from a non-object", same([
    [BY.parse({ name: "  Claude\n Code ", session: 5, task: "t".repeat(90), summary: "s".repeat(400), remote: "yes" }), { name: "Claude Code", session: "5", task: "t".repeat(80), summary: "s".repeat(300) }],
    [BY.parse({ name: "a", remote: true }), { name: "a", remote: true }], [BY.parse(null), {}], [BY.parse("x"), {}], [BY.parse({ name: "  " }), {}],
  ]))
}

async function agentActs(check: Check) {
  const { ACT } = await import("../../../electron/browser/agentwire.ts")
  const act = ACT.parse({ action: "fill", ref: "e12", value: 42, at: { x: "1", y: 2 }, html: { b: 1 }, diff: "none", files: "x", extra: true })
  check("browser agents: an act's words are text, a malformed point or file list left out, its diff kept as given",
    same([[act, { action: "fill", ref: "e12", value: "42", diff: "none" }], [[act.html, act.at, act.files], [null, null, null]]]), act)
  const fields = ACT.parse({ action: "fill", fields: [{ ref: " e3 ", value: true }, { name: " Email ", value: null }, { ref: "e4", value: "x" }, ...Array.from({ length: 300 }, () => ({ ref: "e5", value: 1 }))] }).fields ?? []
  check("browser agents: a form's fields each by its ref or name, values as text, at most 200",
    same([[fields.length, 200], [fields.slice(0, 3), [{ ref: "e3", value: "true" }, { ref: "", name: "Email", value: "" }, { ref: "e4", value: "x" }]]]), fields.slice(0, 3))
  const { messageOf } = await import("../../../electron/browser/messageof.ts")
  const refused = (x: Parameters<typeof ACT.parse>[0]) => { try { ACT.parse(x); return "" } catch (e) { return messageOf(e) } }
  const each = "fields: each needs a ref (e12) or its control's name, and its value", list = "fields: a list of { ref, value }"
  check("browser agents: malformed fields are refused saying how, no fields at all is no form", same([
    [refused({ action: "fill", fields: [] }), list], [refused({ action: "fill", fields: "e3=x" }), list],
    [refused({ action: "fill", fields: [{ ref: "e1", value: "x" }, { value: "x" }] }), each], [refused({ action: "fill", fields: [null] }), each],
    [[ACT.parse({ action: "click", ref: "e1", fields: 0 }).fields, ACT.parse({ action: "click", ref: "e1", fields: null }).fields], [null, null]],
  ]), [refused({ action: "fill", fields: [] }), refused({ action: "fill", fields: [{ value: "x" }] })])
  check("browser agents: no act is no action, an upload's files each with a name and data as text", same([
    [ACT.parse(null).action, ""], [ACT.parse([1]).action, ""], [ACT.parse({ action: 3 }).action, "3"],
    [ACT.parse({ action: "upload", ref: "e2", files: [{ name: "cv.pdf", data: "QQ==" }, null, { name: 7 }] }).files, [{ name: "cv.pdf", data: "QQ==" }, { name: "", data: "" }, { name: "7", data: "" }]],
  ]))
}

async function agentWaits(check: Check) {
  const { PAGE_TEXT, WAIT } = await import("../../../electron/browser/agentwire.ts")
  check("browser agents: a wait's text and address only when given, its flags as yes or no", same([
    [WAIT.parse({ text: "Saved", url: "", download: 1, helped: undefined }), { text: "Saved", download: true, helped: false }],
    [WAIT.parse({ text: 5 }), { text: "5", download: false, helped: false }], [WAIT.parse("x"), { download: false, helped: false }],
  ]))
  const page = { url: "https://example.com/", title: "Example", text: "hi" }
  check("browser agents: a page's text is read only with its address, title and text", same([
    [PAGE_TEXT.safeParse({ ...page, as: "md" }).data, { ...page, as: "md" }], [PAGE_TEXT.safeParse({ ...page, as: 3 }).data, page], [PAGE_TEXT.safeParse({ url: "u", title: "t" }).success, false],
  ]))
}

async function takeoverSteps(check: Check) {
  const { STEP } = await import("../../../electron/takeoverlogic.ts")
  const { stepOf } = await import("../../../plugins/core/companion/takeover.ts")
  const near = [{ id: "a1", role: "button", ax: "AXButton", label: "Save", frame: { x: 1, y: 2, width: 3, height: 4 }, state: {}, actions: [], inside: [] }]
  const sent = [stepOf({ action: "click", ax: "a1" }, near), stepOf({ action: "scroll", sx: 10.4, sy: 20, direction: "up" }, near), stepOf({ action: "type", value: "hi", doing: " Typing " }, near),
    stepOf({ action: "click", app: "Mail", find: "Send", role: "AXButton" }, near), stepOf({ action: "scroll", direction: "left" }, near)]
  const read = sent.map((s) => STEP.safeParse(s).data)
  check("takeover: each step the server sends is read as it was sent, a scroll's unknown way as down",
    isDeepStrictEqual(read.slice(0, 4), sent.slice(0, 4)) && read[4]?.direction === "down", read)
  check("takeover: a step without its action, or with a malformed element or point, is refused, never acted on",
    [null, "click", { el: near[0] }, { action: "click", el: { frame: { x: 1, y: 2 } } }, { action: "click", at: { x: "1", y: 2 } }, { action: 5 }].every((s) => !STEP.safeParse(s).success))
}

async function historyRows(check: Check) {
  const H = await import("../../../electron/browser/historyrows.ts")
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(":memory:")
  db.exec(H.TABLES)
  db.exec(`INSERT INTO urls (id, url, title, host, visits, typed, last, frecency) VALUES (1, 'https://lighthouse.example.com/', 'Lighthouse', 'lighthouse.example.com', 2, 1, 20, 140.5), (2, 'https://example.com/a', '', 'example.com', 0, 0, 0, 0);
    INSERT INTO visits (id, url, at, profile, how) VALUES (1, 1, 10, 'p1', 'typed'), (2, 1, 20, 'p1', 'sideways')`)
  const counts = H.COUNTS.parse(db.prepare("SELECT count(*) AS n, sum(how = 'typed') AS typed, max(at) AS last FROM visits WHERE url = ?").get(1))
  const none = H.COUNTS.parse(db.prepare("SELECT count(*) AS n, sum(how = 'typed') AS typed, max(at) AS last FROM visits WHERE url = ?").get(2))
  const ranked = H.RANKED.parse(db.prepare("SELECT url, title, host, visits, typed, last, frecency FROM urls WHERE frecency > 0").all())
  const visits = H.VISITS.parse(db.prepare("SELECT v.id, v.at, v.profile, v.how, u.url, u.title, u.host FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.at").all())
  const gone = H.GONE.parse(db.prepare("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE u.host = ?").all("lighthouse.example.com"))
  check("browser history: its SQLite rows read as their types, a visit's unknown way as other", same([
    [counts, { n: 2, typed: 1, last: 20 }], [none, { n: 0, typed: null, last: null }], [ranked.map((r) => r.frecency), [140.5]],
    [visits.map((v) => v.how), ["typed", "other"]], [gone.map((g) => [g.id, g.urlId, g.source]), [[1, 1, ""], [2, 1, ""]]],
  ]), [counts, none, visits])
  db.close()
  const back = H.RESTORED.parse([{ url: "https://a.example.com/", title: "A", at: 5, profile: "p1", how: "link", source: "chrome" }, { url: 5, at: 1 }, null,
    { url: "https://b.example.com/", at: NaN }, { url: "https://c.example.com/", at: 7, how: "sideways", title: 3 }])
  check("browser history: visits given back are each well-formed or left out, as the app's undo sends them", same([
    [back, [{ url: "https://a.example.com/", title: "A", at: 5, profile: "p1", how: "link", source: "chrome" }, { url: "https://c.example.com/", title: "", at: 7, profile: "", how: "other", source: "" }]],
    [H.RESTORED.parse("x"), []], [H.REMOVE_ASK.parse({ visits: ["3", 4], urls: [5] }), { visits: [3, 4], urls: ["5"] }], [H.REMOVE_ASK.parse(null), { visits: [], urls: [] }],
  ]), back)
}

async function extManifests(check: Check) {
  const X = await import("../../../electron/browser/extwire.ts")
  const m = X.MANIFEST.parse({ name: "__MSG_name__", version: "1.2", manifest_version: 3, permissions: ["storage", { fileSystem: ["write"] }, "tabs"], host_permissions: ["<all_urls>"],
    action: { default_title: "Lighthouse", default_popup: "popup.html", default_icon: { 16: "i16.png" } }, commands: { _execute_action: { description: "Open" }, bad: 5 }, key: 5, options_ui: "x" })
  check("extensions: a manifest's fields read as their types, a malformed one as absent", same([
    [m.permissions, ["storage", "tabs"]], [m.action, { default_title: "Lighthouse", default_icon: { 16: "i16.png" }, default_popup: "popup.html" }],
    [m.commands, { _execute_action: { description: "Open" }, bad: {} }], [[m.key, m.options_ui], [null, null]], [X.MANIFEST.safeParse(null).success, false],
  ]), m)
  const raw = { name: "x", content_scripts: [{ js: ["a.js"], matches: ["<all_urls>"] }, { js: ["b.js"], world: "MAIN" }, { js: ["vaultite/content.js", "c.js"] }, { css: ["x.css"] }], extra: 1 }
  check("extensions: the manifest written for Electron has its key and the storage shim first in each isolated content script, the rest as it was", same([
    [X.prepared(raw, "vaultite/content.js", "KEY"), { ...raw, key: "KEY", content_scripts: [{ js: ["vaultite/content.js", "a.js"], matches: ["<all_urls>"] }, ...raw.content_scripts.slice(1)] }],
    [X.prepared({ key: "MINE" }, "s.js", "KEY"), { key: "MINE" }], [X.prepared({ content_scripts: "x" }, "s.js"), { content_scripts: "x" }],
  ]))
  check("extensions: a locale's messages, another browser's profile names and a native app's manifest read as their types", same([
    [X.MESSAGES.parse({ name: { message: "Lighthouse" }, bad: 3, n: { message: 4 } }), { name: { message: "Lighthouse" }, bad: {}, n: {} }], [X.MESSAGES.parse("x"), {}],
    [X.PROFILE_NAMES.parse({ profile: { info_cache: { Default: { name: "Alice" }, "Profile 1": { name: 5 } } } }), { Default: { name: "Alice" }, "Profile 1": {} }], [X.PROFILE_NAMES.parse(null), {}],
    [X.NATIVE_HOST.safeParse({ path: "/bin/x", allowed_origins: "chrome-extension://abc/" }).success, false], [X.NATIVE_HOST.safeParse({ path: "/bin/x", allowed_origins: [1, "o"] }).success, true],
  ]))
}

async function extState(check: Check) {
  const X = await import("../../../electron/browser/extwire.ts")
  const id = "a".repeat(32), good = { id, dir: "1-abc", name: "Lighthouse", version: "1", on: true, pinned: true, from: "store", added: 5, granted: ["tabs"], later: "kept" }
  const st = X.STATE.parse({ list: [good, { id: "b".repeat(32), dir: "2-def" }, { id: "nope", dir: "x" }, { id }, null], checked: 9, seen: { p1: { [id]: "1" }, p2: 3 }, partitions: { p1: "persist:p1" } })
  check("extensions: the installed list keeps each well-formed one as it was, an older one's missing fields as off, unpinned and from a folder", same([
    [st.list, [good, { id: "b".repeat(32), dir: "2-def", name: "", version: "", on: false, pinned: false, from: "folder", added: 0 }]], [st.seen, { p1: { [id]: "1" }, p2: {} }],
    [[st.checked, st.partitions], [9, { p1: "persist:p1" }]], [X.STATE.parse("x"), { list: [], checked: 0, seen: {}, partitions: {} }],
  ]), st)
}

async function extCalls(check: Check) {
  const X = await import("../../../electron/browser/extwire.ts")
  const icon = X.BUTTON_ASK.parse({ tabId: 3, imageData: { 16: new Uint8Array([1]), 32: "x" } })
  check("extensions: a button's details by their types, nothing from a non-object", same([
    [[icon.tabId, icon.imageData?.[16]?.length, icon.imageData?.[32]?.length], [3, 1, 0]], [X.BUTTON_ASK.parse({ tabId: "3", title: 5 }), { title: 5 }], [X.BUTTON_ASK.parse(null), {}],
  ]))
  check("extensions: tabs.query reads each filter by its type, and refuses what isn't a query", same([
    [X.TABS_QUERY.parse(undefined), {}], [X.TABS_QUERY.parse({ active: true, windowId: "x", title: "*Mail*", index: 2 }), { active: true, title: "*Mail*", index: 2 }],
    [X.TABS_QUERY.safeParse(null).success, false], [X.PERMISSIONS.parse(undefined), {}], [X.PERMISSIONS.safeParse({ permissions: "tabs" }).success, false],
  ]))
  const cookie = { url: "https://example.com/", name: "SID", value: "v", secure: true, sameSite: "lax", storeId: "0" }
  check("extensions: cookies.set takes only what Electron does, well-formed", same([
    [X.COOKIE_SET.parse(cookie), { url: "https://example.com/", name: "SID", value: "v", secure: true, sameSite: "lax" }],
    [X.COOKIE_SET.safeParse({ name: "SID" }).success, false], [X.COOKIE_SET.safeParse({ ...cookie, sameSite: "none" }).success, false],
    [X.COOKIE_FILTER.parse({ domain: "example.com", storeId: "0", partitionKey: {} }), { domain: "example.com" }],
  ]))
  check("extensions: a blocking listener's reply keeps what's well-formed, nothing from a non-object", same([
    [X.REPLY.parse({ cancel: true }), { cancel: true }], [X.REPLY.parse({ requestHeaders: [{ name: "A", value: "1" }, null], redirectUrl: 5 }), {}],
    [X.REPLY.parse({ responseHeaders: [{ name: "A", value: 1 }] }), { responseHeaders: [{ name: "A" }] }], [X.REPLY.parse("x"), null], [X.REPLY.parse({ authCredentials: { username: "u" } }), {}],
  ]))
}

export default async ($: VaultTest) => {
  winspawnFirst($.check)
  for (const t of [bridge, clipboard, snapshots, linkText, accounts, hangs, cloudSessions, webWire, agentAsks, agentActs, agentWaits, takeoverSteps, historyRows, extManifests, extState, extCalls]) await t($.check)
}
