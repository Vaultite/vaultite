import fs from "node:fs"
import path from "node:path"
import type { Version, VersionText } from "../../../plugins/core/sync-conflicts/plugin.ts"
import type { Any, VaultTest } from "./harness.ts"

// iCloud's hidden versions (plugins/core/sync-conflicts): found, shown with their base from File history and how they
// merge, resolved only when asked. A made-up store stands in for macOS's: nothing here touches a real version.
export default async ($: VaultTest) => {
  const { VAULT, api, app, check, sleep, write } = $
  const sc = await import("../../../plugins/core/sync-conflicts/plugin.ts")
  const P = "Synced/Two Macs.md", BASE = "---\ntype: note\n---\n\nOne.\n\nTwo.\n"

  {
    const [, r] = await api("POST", "ops/sync-conflicts.list", { scan: true })
    check("sync conflicts: a vault outside iCloud Drive has none to look for", r.on === false && !r.files.length, r)
  }

  const real = fs.realpathSync(VAULT)
  /** The made-up store: each file's versions, by vault path; `resolved`, what it was asked to resolve. */
  const versions = new Map<string, VersionText[]>(), resolved: string[] = []
  const was = { ...sc.store }
  const abs = (rel: string) => path.join(real, rel)
  /** A path's vault path, from the vault's folder as given or as the helper walks it (a link followed). */
  const relIn = (p: string) => [real, VAULT].map((r) => path.relative(r, p)).find((x) => !x.startsWith(".."))!.split(path.sep).join("/")
  Object.assign(sc.store, {
    on: () => true,
    scan: async (paths: string[]) => {
      const out = new Map<string, Version[]>()
      for (const p of paths) {
        const under = relIn(p)
        for (const [rel, vs] of versions) if (vs.length && (!under || under === rel)) out.set(abs(rel), vs.map(({ id, at, from }) => ({ id, at, from })))
      }
      return out
    },
    read: async (p: string) => versions.get(relIn(p)) ?? [],
    resolve: async (p: string, ids: string[]) => {
      const rel = relIn(p), vs = versions.get(rel) ?? []
      resolved.push(...ids.map((id) => `${rel}#${id}`))
      versions.set(rel, vs.filter((v) => !ids.includes(v.id)))
      return vs.length - (versions.get(rel)?.length ?? 0)
    },
  })
  try {
    // The note as both Macs had it (kept in File history), then this one's edit; the other Mac's, kept apart.
    write(P, BASE)
    await api("GET", "state")
    await api("POST", "history/keep", { path: P, text: BASE })
    await sleep(30)
    write(P, BASE.replace("One.", "One, here."))
    await api("GET", "state")
    const other = BASE.replace("Two.", "Two, on the mini.")
    versions.set(P, [{ id: "v1", at: Date.now(), from: "lighthouse-mini", text: other }])

    let [code, r] = await api("POST", "ops/sync-conflicts.list", { scan: true })
    check("sync conflicts: a scan finds the file iCloud kept another version of", code === 200 && r.on && r.files.length === 1 && r.files[0].path === P && r.files[0].versions[0].id === "v1", r)
    const [, st] = await api("GET", "state")
    check("...and the app's state lists it, for the note's banner", st.syncConflicts?.[P]?.[0]?.from === "lighthouse-mini", st.syncConflicts)

    ;[code, r] = await api("GET", `sync-conflicts/versions?path=${P}`)
    const v = r.versions?.[0]
    check("sync conflicts: a version comes with its text, the base both had (File history) and a clean merge", code === 200 && v?.text === other && v.base === BASE && v.merge === "clean" && v.label === "lighthouse-mini", r)

    // An older state of the note this machine had before it changed: nothing of it is lost.
    versions.set(P, [{ id: "v0", at: Date.now() - 60_000, from: "lighthouse-mini", text: BASE }])
    ;[, r] = await api("GET", `sync-conflicts/versions?path=${P}`)
    check("sync conflicts: a version this machine had before the note changed merges as the same", r.versions?.[0]?.merge === "same", r.versions?.[0])

    // Both changed the same line: it clashes.
    versions.set(P, [{ id: "v2", at: Date.now(), from: "lighthouse-mini", text: BASE.replace("One.", "One, there.") }])
    ;[, r] = await api("GET", `sync-conflicts/versions?path=${P}`)
    check("sync conflicts: one that changed the same line clashes", r.versions?.[0]?.merge === "clashes", r.versions?.[0])

    // A file that changes is looked at again a moment later, with no scan.
    const Q = "Synced/Later.md"
    write(Q, "Here.\n")
    versions.set(Q, [{ id: "q1", at: Date.now(), from: "lighthouse-mini", text: "There.\n" }])
    app.changed([Q]) // (what the watcher tells, core/live.ts)
    let seen: Any = null
    for (let i = 0; i < 40 && !seen; i++) { await sleep(200); seen = (await api("GET", "state"))[1].syncConflicts?.[Q] }
    check("sync conflicts: a changed file is looked at again on its own", seen?.[0]?.id === "q1", seen)

    check("sync conflicts: nothing is resolved till asked", !resolved.length, resolved)
    ;[code, r] = await api("POST", "sync-conflicts/resolve", { path: P, id: "v2" })
    const [, after] = await api("GET", "state")
    check("sync conflicts: resolving one resolves that version only, and the note leaves the list", code === 200 && r.resolved === 1 && resolved.join() === `${P}#v2` && !after.syncConflicts?.[P] && !!after.syncConflicts?.[Q],
      [r, resolved, after.syncConflicts])
    ;[code] = await api("POST", "sync-conflicts/resolve", { path: "../outside.md", id: "x" })
    check("sync conflicts: a path outside the vault is refused", code === 400, code)

    // File history lists them beside its own.
    ;[, r] = await api("GET", `history?path=${Q}`)
    check("sync conflicts: File history lists iCloud's other versions", r.others?.some((o: Any) => o.source === "icloud" && o.versions[0]?.id === "q1"), r.others)
    ;[code, r] = await api("GET", `history/version?path=${Q}&source=icloud&id=q1`)
    check("...and reads one", code === 200 && String(r) === "There.\n", [code, r])
  } finally {
    Object.assign(sc.store, was)
    fs.rmSync(path.join(VAULT, "Synced"), { recursive: true, force: true })
  }
}
