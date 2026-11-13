import fs from "node:fs"
import path from "node:path"
import { isObj } from "../../../core/values.ts"
import { tempDir } from "../lib.ts"
import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
const same = (pairs: [got: unknown, want: unknown][]) => pairs.every((pair) => {
  const [got, want] = pair.map((x) => JSON.stringify(x, (_k, v) => (isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)))
  return got === want
})
const orNone = <T, N>(f: () => T, none: N) => { try { return f() } catch { return none } }
const listed = <T>(m: Map<string, T>) => [...m]

const BAD_JSON = ["{bad", "", "null"]

async function tabHistory(check: Check) {
  const { framesFrom, pastsFrom } = await import("../../../electron/filewire.ts")
  const past = { profile: "default", index: 1, entries: [{ url: "https://example.com/a", title: "A" }, { url: "https://example.com/b", title: "B", pageState: "s" }], at: 5 }
  const frame = { url: "https://example.com/a", profile: "c-1", width: 800, height: 600, at: 7 }
  const pasts = (t: string) => orNone(() => listed(pastsFrom(t)), [])
  const frames = (t: string) => orNone(() => listed(framesFrom(t)), [])
  check("tab history: each tab's kept history and picture come back as written", same([
    [pasts(JSON.stringify({ t1: past, t2: { ...past, index: 0 } })), [["t1", past], ["t2", { ...past, index: 0 }]]],
    [frames(JSON.stringify({ t1: frame })), [["t1", frame]]], [pasts("{}"), []], [frames("[]"), []],
    ...BAD_JSON.flatMap((t): [unknown, unknown][] => [[pasts(t), []], [frames(t), []]]),
  ]))
}

async function popupsAndPlayer(check: Check) {
  const { playerPlaceFrom, popupsFrom } = await import("../../../electron/filewire.ts")
  const kept = (t: string, site: string) => orNone(() => { const k = popupsFrom(t)[site]; return k && typeof k === "object" ? k : {} }, {})
  const file = JSON.stringify({ "example.com": { bare: true, onTop: false }, "lighthouse.app": { onTop: true }, "five.org": 5, "nil.org": null })
  check("pop-outs: a site's kept look comes back, any other site's or a broken file's is none", same([
    [kept(file, "example.com"), { bare: true, onTop: false }], [kept(file, "lighthouse.app"), { onTop: true }], [kept(file, "other.net"), {}],
    [kept(file, "five.org"), {}], [kept(file, "nil.org"), {}], ...BAD_JSON.map((t): [unknown, unknown] => [kept(t, "example.com"), {}]),
  ]))
  const place = (t: string) => orNone(() => playerPlaceFrom(t), null)
  const at = { x: -100, y: 20, width: 800, height: 450 }
  check("player: its last place comes back when it's a usable size, else none", same([
    [place(JSON.stringify(at)), at], [place(JSON.stringify({ ...at, width: 159 })), null], [place(JSON.stringify({ ...at, height: 89 })), null],
    [place(JSON.stringify({ ...at, x: "1" })), null], [place(JSON.stringify({ ...at, y: null })), null], [place(JSON.stringify({ x: 0, y: 0, width: 800 })), null],
    [place("[]"), null], ...BAD_JSON.map((t): [unknown, unknown] => [place(t), null]),
  ]))
}

async function downloads(check: Check) {
  const { downloadsFrom } = await import("../../../electron/filewire.ts")
  const d = { id: 3, name: "a.pdf", path: "/Downloads/a.pdf", url: "https://example.com/a.pdf", profile: "default", state: "completed", received: 10, total: 10, at: 1, done: 2 }
  const e = { ...d, id: 4, path: "/Downloads/b.zip", state: "interrupted", resumable: false, agent: true, gone: true }
  const list = (t: string) => orNone(() => downloadsFrom(t), [])
  check("downloads: the kept list comes back, an entry without its number or file left out", same([
    [list(JSON.stringify([d, e])), [d, e]], [list(JSON.stringify([null, 5, "x", [], { ...d, id: "3" }, { ...d, path: null }, e])), [e]],
    [list(JSON.stringify({ 0: d })), []], ...BAD_JSON.map((t): [unknown, unknown] => [list(t), []]),
  ]))
}

async function store(check: Check) {
  const W = await import("../../../electron/filewire.ts")
  const dir = tempDir("vaultite-store-"), sha = "a".repeat(40)
  fs.mkdirSync(path.join(dir, "meta")); fs.mkdirSync(path.join(dir, "shell"))
  const put = (rel: string, text: string) => fs.writeFileSync(path.join(dir, rel), text)
  const files = ["current.json", `meta/${sha}.json`, "shell/bad.json", "built"]
  const read = (texts: (string | null)[]) => {
    files.forEach((f, i) => { const t = texts[i]; if (t === null) fs.rmSync(path.join(dir, f), { force: true }); else put(f, t) })
    return [W.storeCurrent(dir), W.storeFingerprint(dir, sha), Object.entries(W.shellBad(dir)).map(([k, v]) => [k, v.why]), W.shellBuiltAt(path.join(dir, "built"))]
  }
  const good = [{ commit: sha }, { commit: sha, fingerprint: "f1", deps: "d" }, { "/r/a": { why: "it crashed", t: 1 } }, 1731500000000].map((j) => JSON.stringify(j))
  const none = [undefined, undefined, [], 0], all = (t: string | null) => files.map(() => t)
  check("store: its current commit, a root's fingerprint, the shell's bad roots and when it last built, as written", same([
    [read(good), [sha, "f1", [["/r/a", "it crashed"]], 1731500000000]],
  ]), read(good))
  check("store: missing or broken files are none", same([
    [read(all(null)), none], [read(all("{}")), none], [read(all("[]")), none], ...BAD_JSON.map((t): [unknown, unknown] => [read(all(t)), none]),
  ]), BAD_JSON.map((t) => read(all(t))))
}

async function stamps(check: Check) {
  const { codeAt, shellAt } = await import("../../../electron/identity.ts")
  const { instanceAt } = await import("../../../electron/devinstance.ts")
  const root = tempDir("vaultite-stamps-")
  fs.mkdirSync(path.join(root, "electron"))
  const at = (shell: string, build: string, instance = build) => {
    fs.writeFileSync(path.join(root, "electron", "shell.json"), shell)
    fs.writeFileSync(path.join(root, "electron", "build.json"), build)
    fs.writeFileSync(path.join(root, "instance.json"), instance)
    return [shellAt(root), codeAt(root), instanceAt(root)]
  }
  const shell = { channel: "dev", release: true, branch: "fix-tabs", commit: "c1", fingerprint: "f1", appId: "app.lighthouse.dev", productName: "Lighthouse Dev" }
  const inst = { pid: 42, root: "/r", worktree: "/w", headless: true, debugPort: 9333, started: 5 }
  check("stamps: the shell's, the code's and a Dev instance's records come back as written", same([
    [at(JSON.stringify(shell), JSON.stringify({ commit: "c1", repo: "lighthouse/app", ...inst }), JSON.stringify(inst)), [shell, { commit: "c1", repo: "lighthouse/app" }, inst]],
    [at("{}", JSON.stringify(inst)), [{}, null, inst]], [at("{}", "{}", JSON.stringify({ ...inst, headless: false, debugPort: null })), [{}, null, { ...inst, headless: false, debugPort: null }]],
  ]))
  check("stamps: a code stamp or instance without its keys, or a broken one, is none", same([
    [at("{}", JSON.stringify({ commit: 5, repo: "r", pid: "42", root: "/r" })), [{}, null, null]], [at("{}", JSON.stringify({ commit: "c1", pid: 42 })), [{}, null, null]],
    ...BAD_JSON.map((t): [unknown, unknown] => [at(t, t), [{}, null, null]]),
  ]))
}

async function obsidian(check: Check) {
  const S = await import("../../../electron/setup.ts")
  const home = tempDir("vaultite-obsidian-"), config = path.join(home, ".config", "obsidian")
  fs.mkdirSync(config, { recursive: true })
  const dir = (n: string) => { const p = path.join(home, n); fs.mkdirSync(p, { recursive: true }); return p }
  const w = { home, exe: "", vau: "", userData: home, platform: "linux" as const }
  const found = (j: string) => { fs.writeFileSync(path.join(config, "obsidian.json"), j); return S.obsidianVaults(w) }
  const json = <T,>(j: T) => found(JSON.stringify(j))
  const a = dir("Alpha"), b = dir("Beta")
  check("obsidian: its vaults that are folders, newest first, an entry with a bad time last", same([
    [json({ vaults: { x: { path: a, ts: 1 }, y: { path: b, ts: 9, open: true }, z: { path: path.join(home, "Gone"), ts: 5 } } }), [{ path: b, name: "Beta" }, { path: a, name: "Alpha" }]],
    [json({ vaults: { x: { path: a, ts: "x" }, y: { path: b, ts: 2 }, n: null, f: 5, p: { path: 5 } } }), [{ path: b, name: "Beta" }, { path: a, name: "Alpha" }]],
  ]))
  check("obsidian: a config without vaults, or broken, is none", same([
    [json({}), []], [json({ vaults: null }), []], [json({ vaults: 5 }), []], [json([]), []], ...BAD_JSON.map((t): [unknown, unknown] => [found(t), []]),
  ]))
}

async function refused(check: Check) {
  const W = await import("../../../electron/filewire.ts")
  const { shellAt } = await import("../../../electron/identity.ts")
  const { instanceAt } = await import("../../../electron/devinstance.ts")
  const past = { profile: "default", index: 0, entries: [{ url: "https://example.com/", title: "E" }], at: 5 }
  const frame = { url: "https://example.com/", profile: "default", width: 1, height: 1, at: 1 }
  const dir = tempDir("vaultite-refused-"), put = <T,>(f: string, j: T) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(j)) }
  put("electron/shell.json", { channel: 5, branch: "b", release: "yes" }); put("instance.json", { pid: 1, root: "/r", headless: "yes", started: "now" })
  put("current.json", { commit: 5 }); put("shell/bad.json", { "/r/a": {}, "/r/b": null, "/r/c": { why: "w" } }); put("built", "5")
  check("malformed entries are left out, and wrong types a default, where they used to be taken as they were", same([
    [[...W.pastsFrom(JSON.stringify({ t: 5, u: { ...past, entries: "x" }, v: past, w: { ...past, at: "1" } }))], [["v", past]]], [[...W.pastsFrom(JSON.stringify([past]))], []],
    [[...W.framesFrom(JSON.stringify({ a: { ...frame, width: "1" }, b: frame }))], [["b", frame]]], [W.popupsFrom(JSON.stringify({ a: { bare: "yes" }, b: [], c: { onTop: true } })), { c: { onTop: true } }],
    [W.popupsFrom("[]"), {}], [W.popupsFrom("null"), {}], [W.downloadsFrom(JSON.stringify([{ id: 1, path: "/x" }])), []], [W.storeCurrent(dir), undefined],
    [Object.keys(W.shellBad(dir)), ["/r/c"]], [W.shellBuiltAt(path.join(dir, "built")), 0], [shellAt(dir), { branch: "b" }],
    [instanceAt(dir), { pid: 1, root: "/r", worktree: "", headless: false, debugPort: null, started: 0 }],
  ]))
}

async function unreachable(check: Check) {
  const { UNREACHED } = await import("../../../electron/callwire.ts")
  const unreached = <T,>(e: T) => UNREACHED.parse(e)
  const failed = (code: string) => new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code }) })
  check("remote vaults: why a server couldn't be reached, in words", same([
    [unreached(new DOMException("timed out", "TimeoutError")), "It didn't answer"], [unreached(failed("ENOTFOUND")), "No machine has that name"],
    [unreached(failed("ECONNREFUSED")), "Nothing is listening there"], [unreached(failed("EHOSTUNREACH")), "fetch failed"], [unreached(new Error("boom")), "boom"],
    [unreached({ cause: { code: "ENOTFOUND" } }), "No machine has that name"], [unreached({ name: "TimeoutError" }), "It didn't answer"],
  ]))
}

async function boxes(check: Check) {
  const W = await import("../../../electron/callwire.ts")
  const appRect = <T,>(r: T) => W.APP_RECT.safeParse(r).data ?? null, widOf = <T,>(w: T) => W.WID.parse(w)
  const regionOf = <T,>(r: T) => W.BOX.safeParse(r).data ?? null, holdBoxes = <T,>(m: T) => W.HOLDS.safeParse(m).data?.boxes ?? null
  const box = { x: 10, y: -20.5, width: 300, height: 200 }
  const bads = [null, undefined, 5, "x", [], [1, 2, 3, 4], {}, { ...box, x: "10" }, { ...box, width: null }, { x: 1, y: 2, width: 3 }]
  check("app windows: a hole's place and a window's number, as the page says them; anything else none", same([
    [appRect(box), box], [appRect({ ...box, width: 2, height: 2 }), { ...box, width: 2, height: 2 }], [appRect({ ...box, width: 1.9 }), null], [appRect({ ...box, height: 0 }), null],
    [bads.map((b) => appRect(b)), bads.map(() => null)], [[7, 1, 0, -3, 2.5, "7", null, undefined, Infinity, NaN].map((w) => widOf(w)), [7, 1, 0, 0, 0, 0, 0, 0, 0, 0]],
  ]))
  check("overlay: a region the user drew, and the boxes a page holds the pointer over", same([
    [regionOf(box), box], [regionOf({ ...box, label: "x" }), box], [bads.map((b) => regionOf(b)), bads.map(() => null)],
    [holdBoxes({ boxes: [box, { ...box, x: "1" }, { x: 1 }, box] }), [box, box]], [holdBoxes({ boxes: Array(250).fill(box) })?.length, 200],
    [holdBoxes({ boxes: 5 }), null], [holdBoxes({}), null], [holdBoxes({ boxes: [] }), []],
  ]))
}

async function pen(check: Check) {
  const W = await import("../../../electron/callwire.ts")
  const script = { id: "p1", strokes: [{ start: 0, dur: 300, pts: [[1, 2], [3, 4]] }, { start: 300, dur: 100, pts: [], dry: true }], sound: true }
  const shift = <T,>(s: T) => { const p = W.PEN.safeParse(s); return p.success ? W.penShifted(p.data, 10, -5) : "refused" }
  check("overlay: the pen's strokes told the other displays, moved by where they are; none clears it; anything else refused", same([
    [shift(script), { ...script, strokes: [{ start: 0, dur: 300, pts: [[11, -3], [13, -1]] }, { start: 300, dur: 100, pts: [], dry: true }] }],
    [shift(null), null], [shift({ strokes: [] }), { strokes: [] }], [shift({}), "refused"], [shift({ strokes: 5 }), "refused"],
  ]))
}

async function menuSync(check: Check) {
  const { MENU } = await import("../../../electron/callwire.ts")
  const command = { id: "files:new", name: "New note", keys: ["Mod+N"], custom: true, on: true }
  const file = { path: "Notes/a.md", title: "A" }
  const sync = <T,>(snap: T) => MENU.safeParse(snap).data ?? null
  check("menu bar: the page's commands and files kept as their types say, anything else left out", same([
    [sync({ commands: [command, { ...command, id: "b", keys: ["K", 5], custom: 0, on: "yes", checked: true }], pinned: [file], recent: [file] }),
      { commands: [command, { ...command, id: "b", keys: ["K"], custom: false, on: true }], pinned: [file], recent: [file] }],
    [sync({ commands: [null, 5, { ...command, id: 1 }, { ...command, name: null }, { ...command, keys: "Mod+N" }], pinned: [null, { path: 1, title: "x" }, file], recent: "x" }),
      { commands: [], pinned: [file], recent: [] }],
    [sync({ commands: [], pinned: Array(50).fill(file), recent: Array(20).fill(file) }), { commands: [], pinned: Array(40).fill(file), recent: Array(15).fill(file) }],
    [sync({ commands: [command] }), { commands: [command], pinned: [], recent: [] }], [sync({ commands: {} }), null], [sync({}), null], [sync(null), null], [sync(5), null],
  ]))
}

async function siteAccounts(check: Check) {
  const sa = await import("../../../electron/siteaccounts.ts")
  const look = <T,>(site: string, v: T) => sa.ACCOUNTS[site]?.look?.read(v)
  const read = <T,>(site: string, b: T) => sa.ACCOUNTS[site]?.read?.(b, async () => "", "")
  check("site accounts: who a site's answer names at its dotted path; anything but an object along it is none", same([
    [sa.at({ user: { email: " a@example.com " } }, "user.email"), "a@example.com"], [sa.at({ user: [{ email: "x" }] }, "user.email"), ""],
    [sa.at({ user: "a" }, "user.length"), ""], [sa.at(5, "a"), ""], [sa.at({ a: { b: { c: "deep" } } }, "a.b.c"), "deep"],
    [await read("wikipedia.org", { query: { userinfo: { id: "12", name: "Alice Park" } } }), "Alice Park"], [await read("wikipedia.org", { query: [] }), null],
    [await read("wikipedia.org", "x"), null], [sa.xLooked({ handle: 5 }), null], [sa.xLooked("alicepark"), null], [sa.xLooked({ handle: "alice", avatar: 5 }), { account: "@alice", avatar: "" }],
    [look("whatsapp.com", null), null], [look("whatsapp.com", 5), null], [look("whatsapp.com", "x"), null], [look("whatsapp.com", { out: 1 }), false],
    [look("whatsapp.com", { phone: 5511987654321 }), { account: "" }],
  ]))
  const google = <T,>(rows: T) => sa.googleAccounts(JSON.stringify(rows))
  const row = <T,>(email: T, out?: number) => { const r: unknown[] = ["gaia.l.a", 1, "Alice", email, "https://a/p.png"]; r[14] = out; return r }
  check("site accounts: Google's list, its rows that are accounts still signed in", same([
    [google(["gaia.l.a.r", [row("a@example.com"), row("b@example.com", 1), row(5), ["other"], null, row("c@example.com")]]), { account: "a@example.com", more: ["c@example.com"], avatar: "https://a/p.png" }],
    [google(["gaia.l.a.r", 5]), null], [google(["gaia.l.a.r"]), null], [sa.googleAccounts('["gaia.l.a.r",{"a":1}]'), null], [sa.googleAccounts('["gaia.l.a.r",[bad'), null],
  ]))
}

async function refusedCalls(check: Check) {
  const W = await import("../../../electron/callwire.ts")
  const sa = await import("../../../electron/siteaccounts.ts")
  const box = { x: 1, y: 2, width: 3, height: 4 }
  check("what a page or helper says that used to throw, or be taken as it was, is refused or left out", same([
    [W.PEN.safeParse({ strokes: [{ pts: [[1, "2"]] }] }).success, false], [W.PEN.safeParse({ strokes: [{}] }).success, false], [W.PEN.safeParse(undefined).success, false],
    [W.HOLDS.safeParse({ boxes: [null, box, 5] }).data?.boxes, [box]], [W.UNREACHED.parse(null), "null"], [W.UNREACHED.parse("down"), "down"],
    [sa.ACCOUNTS["whatsapp.com"]?.look?.read([]), null], [sa.at({ user: [{ email: "x" }] }, "user.0.email"), ""], [sa.at(["a"], "0"), ""],
  ]))
}

export default async ($: VaultTest) => {
  for (const t of [tabHistory, popupsAndPlayer, downloads, store, stamps, obsidian, refused, unreachable, boxes, pen, menuSync, siteAccounts, refusedCalls]) await t($.check)
}
