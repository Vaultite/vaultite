import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, WS_DIR, api, app, check, exists, publicOf, read, vault, write } = $
  const { same } = $.vars
  // What the API sends has no private keys (_src...) and no records left empty; what had none is sent as it is, not copied.
  const plain = { a: [1, { b: 2 }], c: { d: "x" } }
  const mixed = { a: 1, _p: 2, list: [{ _raw: "l" }, { k: 1, _s: "s" }, plain, {}], plain }
  const pub = publicOf(mixed) as Any
  check("publicOf drops private keys and records left empty", same(pub, { a: 1, list: [{ k: 1 }, plain], plain }), pub)
  check("publicOf leaves what it doesn't change as it is", pub.plain === plain && pub.list[1] === plain && publicOf(plain) === plain && mixed._p === 2)

  // /api/state is worked out again only when something changed: a file, or a setting written by hand. (Compared across
  // calls, so first an earlier area's deleted folders let go of: the vault drops their files seconds later.)
  await $.settled()
  const stateNow = async () => { await vault.synced(); return (await app.run("GET", ["state"], {}, {})).body as Any }
  const st1 = await stateNow()
  check("state: the same answer while nothing changed", (await stateNow()) === st1 && Object.isFrozen(st1))
  const hotkeys = fs.existsSync(path.join(VAULT, ".vaultite/hotkeys.json")) ? read(".vaultite/hotkeys.json") : null
  write(".vaultite/hotkeys.json", JSON.stringify({ "files:new": ["Mod+Shift+N"] }))
  const st2 = await stateNow()
  check("state: a setting written by hand is in the next one", st2 !== st1 && same(st2.config.hotkeys, { "files:new": ["Mod+Shift+N"] }), st2.config.hotkeys)
  if (hotkeys === null) fs.rmSync(path.join(VAULT, ".vaultite/hotkeys.json")); else write(".vaultite/hotkeys.json", hotkeys)
  write("Notes/State check.md", "---\ntype: note\n---\n\nNew.\n")
  const st3 = await stateNow()
  check("state: a new file is in the next one", st3.files.files.some((f: Any) => f.path === "Notes/State check.md"))
  fs.rmSync(path.join(VAULT, "Notes/State check.md"))

  // The web app's refresh: GET /api/state?since=<v> answers what changed since state v (core/statepatch.ts), and the whole
  // state for a v it doesn't have. Applied to what the app had, a patch makes the same state as a full load.
  {
    const { applyPatch } = await import("../../../core/statepatch.ts")
    const since = async (v: string) => { await vault.synced(); return JSON.parse(String(((await app.run("GET", ["state"], { since: v }, {})).body as { text: string }).text)) }
    const full = async () => JSON.parse(JSON.stringify(publicOf(await stateNow())))
    // (quiet first: on a slow machine the watcher may still bring an earlier area's changes)
    let a0 = await since("0")
    for (let i = 0; i < 40 && (await since(a0.v)).patch !== null; i++) { await new Promise((r) => setTimeout(r, 250)); a0 = await since("0") }
    check("state since 0: the whole state, with its version", typeof a0.v === "string" && same(a0.state, await full()), Object.keys(a0))
    const a1 = await since(a0.v)
    check("state since now: nothing changed", a1.v === a0.v && a1.patch === null, a1)
    write("Notes/Patch check.md", "---\ntype: note\n---\n\nFirst [[Alice Park]].\n")
    const a2 = await since(a0.v)
    const had = a0.state, got = applyPatch(had, a2.patch) as Any
    check("state since: a new note comes as a patch that makes the same state", a2.v !== a0.v && a2.since === a0.v && same(got, await full()), a2)
    check("state since: only what changed travels, the rest is the app's objects", JSON.stringify(a2.patch).length < 3000 && got.people === had.people && got.config === had.config, JSON.stringify(a2.patch).slice(0, 300))
    write("Notes/Patch check.md", "---\ntype: note\n---\n\nSecond.\n")
    const a3 = await since(a2.v)
    check("state since: a note's text changed", same(applyPatch(got, a3.patch), await full()), a3.patch)
    check("state since: from an older state still kept, too", same(applyPatch(had, (await since(a0.v)).patch), await full()))
    check("state since: a state it doesn't have (another server's, before a restart) gets the whole state", same((await since("other.1")).state, await full()))
    const ws = `${WS_DIR}/1.json`, wsWas = exists(ws) ? read(ws) : null
    write(ws, JSON.stringify({ name: "Patch", panels: [], layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Notes/Patch check.md" }], active: "t1" } } }))
    const a4 = await since(a3.v)
    // (A new settings file also adds "workspaces" to `pluginSettings`, the plugins with a settings file, which Settings lists.)
    const keys = Object.keys(a4.patch.keys).filter((k) => !(wsWas === null && k === "pluginSettings"))
    check("state since: a workspace saved is only the workspaces", same(keys, ["workspaces"]) && JSON.stringify(a4.patch).length < 450, a4.patch)
    check("state: pluginSettings lists the plugins with a settings file", ((await full()).pluginSettings ?? []).includes("agent-files"), (await full()).pluginSettings)
    if (wsWas === null) fs.rmSync(path.join(VAULT, ws)); else write(ws, wsWas)
    fs.rmSync(path.join(VAULT, "Notes/Patch check.md"))
    const a5 = await since(a4.v)
    check("state since: a file gone", same(applyPatch(applyPatch(applyPatch(got, a3.patch), a4.patch), a5.patch), await full()))
  }

  // Reads arriving together share one sync (Vault.synced, what server.ts does for a GET), which still reads a file
  // written just before them.
  let syncs = 0
  const offSync = vault.afterSync(() => { syncs++ })
  write("Notes/Burst.md", "---\ntype: note\n---\n\nWritten just before the reads.\n")
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => app.run("GET", ["files"], {}, {})))
  check("reads asked together share one sync", syncs === 1, syncs)
  check("a shared sync reads a file written before the reads came", burst.every((r) => (r.body as Any).files.some((f: Any) => f.path === "Notes/Burst.md")))
  await vault.synced()
  check("a read after a sync gets a sync of its own", syncs === 2, syncs)
  offSync()
  fs.rmSync(path.join(VAULT, "Notes/Burst.md"))
  // The file tree is kept between requests (by the vault's version): a new or changed file that isn't Markdown, or a new
  // folder, is still in the next one.
  let [, filesNow] = await api("GET", "files")
  fs.mkdirSync(path.join(VAULT, "Burst/Empty"), { recursive: true })
  write("Burst/data.bin", "one")
  ;[, filesNow] = await api("GET", "files")
  const bin = () => filesNow.others.find((f: Any) => f.path === "Burst/data.bin")
  check("the file tree has a new file that isn't Markdown, and a new folder", bin()?.size === 3 && filesNow.folders.includes("Burst/Empty"), filesNow.folders)
  write("Burst/data.bin", "three")
  ;[, filesNow] = await api("GET", "files")
  check("the file tree has a changed file that isn't Markdown", bin()?.size === 5, bin())
  fs.rmSync(path.join(VAULT, "Burst"), { recursive: true })
  ;[, filesNow] = await api("GET", "files")
  check("the file tree lets go of a deleted folder", !bin() && !filesNow.folders.includes("Burst/Empty"), filesNow.folders)
}
