import fs from "node:fs"
import path from "node:path"
import { tempDir } from "../lib.ts"
import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
const same = (pairs: [got: unknown, want: unknown][]) => pairs.every(([got, want]) => JSON.stringify(got) === JSON.stringify(want))
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

export default async ($: VaultTest) => {
  for (const t of [tabHistory, popupsAndPlayer, downloads, store, stamps, obsidian, refused]) await t($.check)
}
