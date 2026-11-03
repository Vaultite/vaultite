import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { modesEnforced } from "../lib.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, vault } = $
  // ---------- what the server keeps out of the vault (core/kept.ts): memory, its own disk, other machines ----------
  const { Kept, keptOf } = await import("../../../core/kept.ts")
  const { Live } = await import("../../../core/live.ts")
  const k = keptOf(VAULT)
  check("kept: nothing is there, the fallback", k.get("qa/nothing", 7) === 7)
  check("kept: a name is <plugin>/<name>", (() => { try { k.set("no-slash", 1); return false } catch { return true } })())
  const seq0 = k.seq
  check("kept: set, then read as a new copy", k.set("qa/one", { a: [1] }) && k.get<Any>("qa/one").a[0] === 1 && k.get("qa/one") !== k.get("qa/one"))
  const copy = k.get<Any>("qa/one")
  copy.a.push(2)
  check("kept: changing a copy changes nothing kept", k.get<Any>("qa/one").a.length === 1)
  check("kept: the same again is no change", !k.set("qa/one", { a: [1] }) && k.seq === seq0 + 1)
  k.set("qa/two", "shared", { shared: true })
  check("kept: names by prefix", k.names("qa/").join() === "qa/one,qa/two")
  const out = k.since(seq0)
  check("kept: since a change, only the shared entries (what other machines get)", out.entries.length === 1 && out.entries[0].name === "qa/two" && out.seq === k.seq, out)

  // Another machine's entries: the newest wins, a tie goes the same way everywhere, and nothing older undoes a change.
  const at = k.at("qa/two")
  check("kept: an older write from elsewhere loses", !k.merge([{ name: "qa/two", at: at - 10, data: "old" }]).length && k.get("qa/two") === "shared")
  check("kept: a newer one wins, and is shared", k.merge([{ name: "qa/two", at: at + 10, data: "theirs" }]).join() === "qa/two" && k.get("qa/two") === "theirs" && k.isShared("qa/two"))
  check("kept: a removal travels too", k.merge([{ name: "qa/two", at: at + 20, data: null }]).length === 1 && k.get("qa/two", "gone") === "gone" && !k.names("qa/").includes("qa/two"))
  check("kept: and an older write doesn't bring it back", !k.merge([{ name: "qa/two", at: at + 15, data: "late" }]).length && k.get("qa/two", "gone") === "gone")
  check("kept: names from elsewhere are checked", !k.merge([{ name: "../etc", at: Date.now() + 1e6, data: 1 }, { name: "qa/three", at: Number.NaN, data: 1 }]).length)

  // On disk: a moment after a change (now, as the server does when it stops), read back by a store opened again.
  k.set("qa/disk", { big: "x".repeat(1000) }, { shared: true })
  k.flush()
  const again = new Kept(k.dir)
  check("kept: written to the server's own disk, never the vault", fs.existsSync(path.join(k.dir, "qa.json")) && !k.dir.startsWith(fs.realpathSync(VAULT)) &&
    (!modesEnforced || (fs.statSync(path.join(k.dir, "qa.json")).mode & 0o777) === 0o600))
  check("kept: read back as it was (shared, when, removals too)", again.get<Any>("qa/disk").big.length === 1000 && again.isShared("qa/disk") &&
    again.at("qa/disk") === k.at("qa/disk") && again.get("qa/two", "gone") === "gone" && again.id === k.id && again.seq === k.seq)

  // The app's state: a change to what it showed makes a new one, and the windows hear of it; a change to something else
  // kept only tells the routes.
  const live = new Live(vault), w: Any = { OPEN: 1, readyState: 1, got: [] as Any[], close: () => {}, on: () => {} }
  w.send = (t: string) => w.got.push(JSON.parse(t))
  live.client(w)
  const hello = w.got.find((m: Any) => m.type === "hello")
  check("kept: a window is told where the store is as it connects", typeof hello?.kept === "string" && typeof hello.state === "number", hello)
  const v0 = k.stateVersion
  await api("GET", "state")
  k.set("qa/one", { a: [3] })
  await new Promise((r) => setTimeout(r, 100))
  const told = w.got.filter((m: Any) => m.type === "kept")
  check("kept: a change is told to the windows, by name", told.length === 1 && told[0].names.join() === "qa/one" && told[0].state === v0, told)
  check("kept: one the state didn't show leaves it as it was", k.stateVersion === v0)
  await api("PUT", "workspaces/1", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Notes/A.md" }], active: "t1" }, focus: "g0" } })
  const [, s1] = await api("GET", "state")
  await api("PUT", "workspaces/1", { layout: { root: { id: "g0", tabs: [{ id: "t2", to: "file:Notes/B.md" }], active: "t2" }, focus: "g0" } })
  const [, s2] = await api("GET", "state")
  check("kept: one it showed makes a new state (a workspace's tabs)", k.stateVersion > v0 && s1.workspaces[0].layout.root.tabs[0].id === "t1" && s2.workspaces[0].layout.root.tabs[0].id === "t2", [s1.workspaces, s2.workspaces])
  await api("DELETE", "workspaces/1")
  live.close()

  // vau kept: what's kept, one entry, and a change to one.
  let [st, r] = await api("POST", "ops/kept.list", { prefix: "qa/" })
  check("vau kept: lists entries, their size and when they changed", st === 200 && r.entries.map((e: Any) => e.name).join() === "qa/disk,qa/one" && r.entries[0].shared === true, r)
  ;[st, r] = await api("POST", "ops/kept.get", { name: "qa/one" })
  check("vau kept get: one entry", st === 200 && r.a[0] === 3, r)
  ;[st, r] = await api("POST", "ops/kept.get", { name: "qa/none" })
  check("vau kept get: nothing there is a 404", st === 404, [st, r])
  ;[st, r] = await api("POST", "ops/kept.set", { name: "qa/disk", data: null })
  check("vau kept set: null forgets one", st === 200 && r.changed && k.get("qa/disk", null) === null, r)
  k.set("qa/one", null)
  check("kept: nothing of it in the vault's .vaultite/", !fs.readdirSync(path.join(VAULT, ".vaultite")).includes("kept"))
  void app
}
