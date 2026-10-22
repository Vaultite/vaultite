import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, vault, write } = $
  // Live updates (core/live.ts): changes on disk reach the index and the listeners, coalesced, without a request.
  const { Live, ignored } = await import("../../../core/live.ts")
  const live = new Live(vault).start()
  const heard: Any[] = []
  live.listen((c) => heard.push(c))
  const wait = async (ok: () => boolean, ms = 3000) => {
    for (const t = Date.now(); Date.now() - t < ms && !ok();) await new Promise((r) => setTimeout(r, 25))
    return ok()
  }
  const touched = (p: string) => heard.some((c) => c.paths === null || c.paths.includes(p))
  // FSEvents starts a moment after the watch: a probe is written until it's heard.
  for (let i = 0; i < 25 && !touched("Notes/Live probe.md"); i++) { write("Notes/Live probe.md", `probe ${i}\n`); await wait(() => touched("Notes/Live probe.md"), 200) }
  fs.rmSync(path.join(VAULT, "Notes/Live probe.md"))
  await wait(() => !vault.entries.has("Notes/Live probe.md"))
  heard.length = 0
  write("Notes/Live one.md", "---\ntype: note\ntitle: Live one\n---\n\nFrom disk.\n")
  check("live: a file written on disk is heard", await wait(() => touched("Notes/Live one.md")), heard)
  check("live: and indexed before the event goes out", vault.entries.has("Notes/Live one.md"))
  heard.length = 0
  for (let i = 0; i < 20; i++) write(`Notes/Burst ${i}.md`, `burst ${i}\n`)
  await wait(() => touched("Notes/Burst 19.md"))
  await new Promise((r) => setTimeout(r, 300))
  check("live: a burst of writes is one or two events", heard.length >= 1 && heard.length <= 2, heard.length)
  heard.length = 0
  fs.renameSync(path.join(VAULT, "Notes/Live one.md"), path.join(VAULT, "Notes/Live two.md"))
  check("live: a rename is heard as both names", await wait(() => touched("Notes/Live one.md") && touched("Notes/Live two.md")), heard)
  check("live: and the index follows it", vault.entries.has("Notes/Live two.md") && !vault.entries.has("Notes/Live one.md"))
  heard.length = 0
  await api("PUT", "file", { path: "Notes/Live two.md", text: "From the app.\n", base: read("Notes/Live two.md") })
  check("live: the app's own writes are heard too", await wait(() => touched("Notes/Live two.md")), heard)
  {
    // While the watcher hears nothing, the app's reads don't walk the vault; an agent's always do (it may have just
    // written a file the watcher hasn't told of yet).
    const sync = vault.sync
    let walks = 0
    vault.sync = function () { walks++; return sync.call(this) }
    await new Promise((r) => setTimeout(r, 300))
    await vault.synced()
    walks = 0
    await vault.synced({ trusting: true })
    check("live: the app's read, nothing heard since the last walk, doesn't walk", walks === 0 && vault.vouched(), walks)
    await vault.synced()
    check("live: an agent's read walks anyway", walks === 1, walks)
    vault.heard("Notes/Live two.md")
    check("live: hearing a file indexed as it is on disk (the server's own write) keeps the index vouched for", vault.vouched())
    write("Notes/Live four.md", "From disk, unasked.\n")
    check("live: a file written behind the app's back is heard and indexed", await wait(() => vault.entries.has("Notes/Live four.md")))
    walks = 0
    await vault.synced({ trusting: true })
    check("live: then the app's reads trust the watcher again", walks === 0, walks)
    write("Notes/Live four.md", "Edited on disk.\n")
    check("live: a note edited on disk is read again", await wait(() => !!vault.entries.get("Notes/Live four.md")?.body.includes("Edited")))
    check("live: on its own, without a walk", walks === 0 && vault.vouched(), walks)
    vault.heard("Notes/Live five.md")
    check("live: a change not in the index isn't vouched for", !vault.vouched())
    await vault.synced({ trusting: true })
    check("live: so the app's next read walks", walks === 1, walks)
    vault.setConfig("live-check", { on: true })
    check("live: a settings file the server writes isn't vouched for either (its state is old)", !vault.vouched())
    walks = 0
    await vault.synced({ trusting: true })
    check("live: so the app's next read walks", walks === 1, walks)
    vault.removeConfig("live-check")
    vault.sync = sync
  }
  {
    // A write the API indexed itself, heard after another change was told at that index: still told (once).
    const own = new Live(vault), got: Any[] = []
    own.listen((c) => got.push(c))
    await api("PUT", "file", { path: "Notes/Live three.md", text: "Indexed by the API.\n" })
    own.add(".vaultite/live-probe.json")
    await wait(() => got.length === 1)
    own.add("Notes/Live three.md")
    check("live: a file indexed before another change was told is told of too", await wait(() => got.some((c) => c.paths?.includes("Notes/Live three.md"))), got)
    own.add("Notes/Live three.md")
    await new Promise((r) => setTimeout(r, 300))
    check("live: the same file again, nothing new since, isn't", got.length === 2, got)
    own.close()
  }
  {
    // FSEvents tells of the folders above a write (iCloud touches them) and of the vault's own folder, by its name.
    fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/tabs"), { recursive: true })
    const own = new Live(vault), got: Any[] = []
    own.listen((c) => got.push(c))
    for (const p of [".vaultite", ".vaultite/plugins", ".vaultite/plugins/tabs", ".vaultite/plugins/tabs/device-x.json", path.basename(fs.realpathSync(VAULT))]) own.add(p)
    await wait(() => got.length > 0)
    check("live: folders told beside what changed in them, and the vault's own, aren't told", JSON.stringify(got[0]?.paths) === '[".vaultite/plugins/tabs/device-x.json"]', got)
    got.length = 0
    own.add("Notes")
    await wait(() => got.length > 0)
    check("live: a folder told alone is", JSON.stringify(got[0]?.paths) === '["Notes"]', got)
    own.close()
  }
  {
    // A window back after a while says where its changes ended: it hears only what changed since.
    const own = new Live(vault), got: Any[] = []
    own.listen((c) => got.push(c))
    const hello = (at?: string) => {
      const ws: Any = { readyState: 1, OPEN: 1, on() {}, close() {}, sent: [] as Any[], send(t: string) { ws.sent.push(JSON.parse(t)) } }
      own.client(ws, at)
      return ws.sent[0]
    }
    const at = hello().at
    own.add("Notes/Away one.md")
    await wait(() => got.length === 1)
    own.add("Notes/Away two.md")
    await wait(() => got.length === 2)
    check("live: back, a window hears what changed while it was away", JSON.stringify(hello(at).paths) === '["Notes/Away one.md","Notes/Away two.md"]', hello(at))
    check("live: and nothing when nothing did", JSON.stringify(hello(hello().at).paths) === "[]")
    check("live: from another server (restarted), anything may have", hello("other:0").paths === null && !("paths" in hello()))
    own.close()
  }
  check("live: .git, .DS_Store, iCloud placeholders and temp files are ignored",
    ignored(".git/index") && ignored("Notes/.DS_Store") && ignored("Notes/.a.md.icloud") && ignored("Notes/a.md.tmp-1-2") &&
    ignored(".vaultite/artifacts/x.html.json") && !ignored(".vaultite/cache/github.json") && !ignored("Notes/a.md"))
  // The user's window: a command it couldn't run says so; a window from before answers is sent it and not waited on.
  {
    const win = (answers: boolean, ran: boolean | null) => {
      const on: Record<string, (d: unknown) => void> = {}
      const ws: Any = { readyState: 1, OPEN: 1, close() {}, on: (k: string, f: (d: unknown) => void) => { on[k] = f }, sent: [] as Any[],
        send(t: string) {
          const m = JSON.parse(t); ws.sent.push(m)
          if (m.rid && ran !== null) setTimeout(() => on.message(JSON.stringify({ type: "ui-done", rid: m.rid, ran })), 5)
        } }
      live.client(ws)
      on.message(JSON.stringify({ type: "active", ...(answers ? { answers: true } : {}) }))
      return ws
    }
    win(true, false)
    const refused = await live.drive({ action: "command", id: "dispatch:claude" }).then(() => null, (e: Any) => e)
    check("ui: a command the window couldn't run is an error saying so", refused?.status === 422 && /isn't available/.test(refused.message), refused)
    win(true, true)
    check("ui: one it ran is sent", ((await live.drive({ action: "command", id: "theme:dark" })) as Any)?.ok === true)
    const old = win(false, null), t0 = Date.now()
    await live.drive({ action: "command", id: "theme:dark" })
    check("ui: a window that never answers isn't waited on", Date.now() - t0 < 500 && old.sent.at(-1)?.id === "theme:dark" && !old.sent.at(-1)?.rid)
  }
  live.close()
  Object.assign($.vars, { Live })
}
