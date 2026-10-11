import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, vault, write } = $
  // Plugins' pages are built in (core/pages.ts): kept in .vaultite/pages as their templates are now, pinned once,
  // read-only; Copy to my vault makes one the user's file (pins and links follow), and only then is it theirs to change.
  const BI = (n: string) => `.vaultite/pages/Dashboards/${n}.md`
  const pinsNow = (): string[] => vault.config("pages").pinned ?? []
  const made = app.installPages()
  check("pages are built in: nothing outside .vaultite/", exists(BI("Today")) && exists(BI("People")) && !exists("Dashboards/Today.md"), made)
  const pinned = pinsNow()
  check("and pinned, only files (no phone Files page)", pinned.includes(BI("Today")) && !pinned.includes("files"), pinned)
  check("a new vault's pins follow the plugins' pageSort",
    pinned.slice(0, 5).join() === ["Today", "Health", "Learning", "People", "Projects"].map(BI).join(), pinned)
  check("the core's own page (Design) is built in and pinned", exists(BI("Design")) && pinned.includes(BI("Design")), pinned)
  check("a page's other tab is built in but not pinned", exists(BI("People map")) && !pinned.includes(BI("People map")) && pinned.includes(BI("People")), pinned)
  fs.writeFileSync(path.join(VAULT, BI("Today")), read(BI("Today")).replace("icon: sun", "icon: star")) // as if an older app's
  app.installPages()
  check("a built-in page updates with its plugin", read(BI("Today")).includes("icon: sun"), read(BI("Today")).slice(0, 80))
  let [rc] = await api("PUT", "file", { path: BI("Today"), text: "changed" })
  check("a built-in page is read-only", rc === 403 && read(BI("Today")).includes("icon: sun"), rc)
  ;[rc] = await api("DELETE", `file?path=${encodeURIComponent(BI("Today"))}`)
  check("...and isn't deleted (unpin it, or turn its plugin off)", rc >= 400 && exists(BI("Today")), rc)
  {
    const conf = vault.config("plugins")
    await api("PUT", "config/plugins", { ...conf, enabled: (conf.enabled ?? []).filter((x: string) => x !== "health") })
    app.installPages()
    check("its plugin off, its page goes", !exists(BI("Health")))
    const peopleOff = { ...conf, disabled: [...(conf.disabled ?? []), "people"] }
    await api("PUT", "config/plugins", peopleOff)
    check("a plugin whose requirement is off is off too: no hooks, ops or services", vault.switchedOff().has("people-map") && app.plugins.find((p) => p.id === "people-map")!.isOff())
    await api("PUT", "config/plugins", { ...conf, enabled: (conf.enabled ?? []).filter((x: string) => x !== "health") })
    await api("POST", "pins", { path: BI("Health"), pinned: false }).catch(() => {})
    await api("PUT", "config/plugins", conf)
    const back = app.installPages()
    check("on again, it's back, not pinned again as new", exists(BI("Health")) && !back.includes(BI("Health")), back)
  }
  // Copy to my vault: its pins and links follow the copy; the built-in one goes and stays gone while the copy's there.
  write("Notes/To today.md", "Open [[.vaultite/pages/Dashboards/Today|Today]].\n")
  let [cc, copied] = await api("POST", "ops/dashboard.copy", { path: "Today", folder: "Dashboards" })
  check("copy to my vault: the page is the user's file", cc === 200 && copied.path === "Dashboards/Today.md" && read("Dashboards/Today.md").includes("plugin: today") && !exists(BI("Today")), [cc, copied])
  check("...its pin follows it, in its place", pinsNow()[0] === "Dashboards/Today.md" && !pinsNow().includes(BI("Today")), pinsNow())
  check("...and so do links to it", !read("Notes/To today.md").includes(".vaultite/pages") && read("Notes/To today.md").includes("Today"), read("Notes/To today.md"))
  app.installPages()
  check("...and the built-in one doesn't come back", !exists(BI("Today")))
  ;[cc] = await api("POST", "ops/dashboard.copy", { path: "Notes/To today.md" })
  check("only a built-in page is copied", cc === 400 || cc === 404, cc)
  // Every other page copied too, as a vault from before pages were built in had them (the tests below use them).
  for (const n of fs.readdirSync(path.join(VAULT, ".vaultite/pages/Dashboards")).filter((x) => x.endsWith(".md"))) {
    await api("POST", "ops/dashboard.copy", { path: `.vaultite/pages/Dashboards/${n}`, folder: "Dashboards" })
  }
  write("Dashboards/Today.md", read("Dashboards/Today.md").replace("icon: sun", "icon: star"))
  // Folders are the user's: a copy moved into another folder is still the user's page (its name, type and plugin);
  // a path written before the move still renders.
  {
    const dash = () => fs.readdirSync(path.join(VAULT, "Dashboards")).filter((n) => n.endsWith(".md"))
    const pinsWere = read(".vaultite/pages.json")
    fs.mkdirSync(path.join(VAULT, "Personal/Dashboards"), { recursive: true })
    for (const n of dash()) fs.renameSync(path.join(VAULT, "Dashboards", n), path.join(VAULT, "Personal/Dashboards", n))
    await vault.sync()
    const madeNow = app.installPages()
    check("pages: a copy moved to another folder is still the user's, no built-in one made", !madeNow.length && !exists(BI("People")), madeNow)
    const [, moved] = await api("GET", "render?path=Dashboards/Today.md")
    check("render: a path from before a move still reads the file", typeof moved === "string" && moved.includes("# Today") && moved.includes("plugin: today"), String(moved).slice(0, 80))
    const [, movedState] = await api("GET", "state")
    check("pins: one whose file moved outside the app shows where it is now", JSON.parse(pinsWere).pinned.includes("Dashboards/Today.md") &&
      movedState.pinned.includes("Personal/Dashboards/Today.md") && !movedState.pinned.includes("Dashboards/Today.md"), movedState.pinned)
    for (const n of fs.readdirSync(path.join(VAULT, "Personal/Dashboards"))) fs.renameSync(path.join(VAULT, "Personal/Dashboards", n), path.join(VAULT, "Dashboards", n))
    fs.rmSync(path.join(VAULT, "Personal"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite/pages.json"), pinsWere)
    await vault.sync()
  }
  let tree: Any
  ;[, tree] = await api("GET", "files")
  const today = tree.files.find((x: Any) => x.path === "Dashboards/Today.md")
  check("the file index has a file's blocks and look", today.blocks[0][0] === "routines" && today.blocks[0][1].includes("wide: true")
    && today.icon === "star" && today.plugin === "today" && today.type === "dashboard", today) // (the icon the user gave it, above)

  // A folder deleted on disk (Finder, rm -rf): kept for a moment (it may be mid-move), then its files are let go.
  write("Gone soon/a.md", "hello\n")
  await vault.sync()
  fs.rmSync(path.join(VAULT, "Gone soon"), { recursive: true })
  await vault.sync()
  check("a vanished folder's files stay for a moment", vault.entries.has("Gone soon/a.md") && vault.waiting())
  await new Promise((r) => setTimeout(r, 3100))
  await vault.sync()
  check("then they're let go", !vault.entries.has("Gone soon/a.md") && !vault.waiting())
  Object.assign($.vars, { tree })
}
