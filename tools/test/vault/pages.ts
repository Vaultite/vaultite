import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, TOOLS, ON, api, check, exists, read, vault, write } = $
  // Plugins' pages (core/pages.ts): turning a plugin on writes its pages once into the pages folder, pinned; opening a
  // vault writes none. dashboard.restore writes those missing, and moves the old copies in .vaultite/pages.
  const pinsNow = (): string[] => vault.config("pages").pinned ?? []
  check("opening a vault writes no page", !exists("Dashboards") && !exists(".vaultite/pages"))
  const OLD = (n: string) => `.vaultite/pages/Dashboards/${n}.md`
  write(OLD("Errors"), "---\ntype: dashboard\nplugin: errors\n---\n\nAn older template\n")
  write(OLD("Harbour"), "---\ntype: dashboard\n---\n\nA bundle's page\n")
  write(".vaultite/generated/pages.json", "[]\n")
  vault.setConfig("pages", { pinned: [OLD("Errors"), OLD("Harbour"), OLD("People map")] })
  const conf = vault.config("plugins"), without = (id: string) => ({ ...conf, enabled: ON.filter((x) => x !== id) })
  await api("PUT", "config/plugins", without("people-map"))
  vault.setConfig("newtab", { page: OLD("Harbour") })
  write("Notes/To errors.md", "Open [[.vaultite/pages/Dashboards/Errors|Errors]].\n")
  await vault.sync()
  let [rc, r] = await api("POST", "ops/dashboard.restore", {})
  check("restore: the pages of the plugins that are on, in Dashboards/, the plugin's as it is now", rc === 200 && read("Dashboards/Errors.md").includes("plugin: errors") &&
    !read("Dashboards/Errors.md").includes("An older template") && exists("Dashboards/People.md") && exists("Dashboards/Days.md") && r.made.includes("Dashboards/Errors.md"), [rc, r])
  check("...a bundle's page there moves too, and the design system isn't a page of the user's", read("Dashboards/Harbour.md").includes("A bundle's page") && !exists("Dashboards/Design.md"))
  check("...pins, links and the new tab's page follow (one to a plugin that's off, where its page will be), none added",
    pinsNow().join() === "Dashboards/Errors.md,Dashboards/Harbour.md,Dashboards/People map.md" && !exists("Dashboards/People map.md") &&
    read("Notes/To errors.md").includes("[[Dashboards/Errors|Errors]]") && vault.config("newtab").page === "Dashboards/Harbour.md", [pinsNow(), read("Notes/To errors.md")])
  check("...and the old folder goes", !exists(".vaultite/pages") && !exists(".vaultite/generated/pages.json"))
  ;[rc, r] = await api("POST", "ops/dashboard.restore", {})
  check("restore again changes nothing", rc === 200 && !r.made.length && !r.moved.length, r)
  await api("PUT", "config/plugins", conf)
  check("a plugin turned on writes its page, pinned once", exists("Dashboards/People map.md") && pinsNow().filter((p) => p === "Dashboards/People map.md").length === 1, pinsNow())
  fs.rmSync(path.join(VAULT, "Dashboards/Days.md"))
  ;[rc, r] = await api("POST", "ops/dashboard.restore", { plugin: "activity" })
  check("restore one plugin's: a page deleted comes back", rc === 200 && r.made.join() === "Dashboards/Days.md", [rc, r])
  ;[rc] = await api("POST", "ops/dashboard.restore", { plugin: "nope" })
  check("restore: a plugin there's none of", rc === 404, rc)
  vault.setConfig("pages", { pinned: ["Dashboards/Errors.md"] })
  vault.setConfig("newtab", {})
  {
    await api("PUT", "config/plugins", without("people-map"))
    fs.rmSync(path.join(VAULT, "Dashboards/People map.md"))
    await vault.sync()
    await api("PUT", "config/plugins", conf)
    check("turned on, a plugin writes its page and pins it", read("Dashboards/People map.md").includes("plugin: people-map") && pinsNow().includes("Dashboards/People map.md"), pinsNow())
    write("Dashboards/People map.md", read("Dashboards/People map.md") + "\nMine now.\n")
    await api("POST", "pins", { path: "Dashboards/People map.md", pinned: false })
    await api("POST", "ops/plugin.disable", { id: "people-map" })
    let [oc] = await api("POST", "ops/plugin.enable", { id: "people-map" })
    check("...once: turned on again (vau plugin on), the user's file stays as it is, and unpinned", oc === 200 && read("Dashboards/People map.md").includes("Mine now.") && !pinsNow().includes("Dashboards/People map.md"), pinsNow())
    fs.rmSync(path.join(VAULT, "Dashboards/People map.md"))
    ;[oc] = await api("POST", "ops/plugin.disable", { id: "people-map" })
    const pj = path.join(VAULT, ".vaultite/plugins.json")
    fs.writeFileSync(pj, JSON.stringify(conf, null, 2) + "\n") // (turned on by hand, or on another machine)
    await api("GET", "vault")
    await api("GET", "vault")
    check("...turned on outside the app (by hand, another machine), it writes nothing", oc === 200 && !vault.switchedOff().has("people-map") && !exists("Dashboards/People map.md"))
    await api("POST", "ops/dashboard.restore", { plugin: "people-map" })
    const peopleOff = { ...conf, disabled: [...(conf.disabled ?? []), "people"] }
    await api("PUT", "config/plugins", peopleOff)
    check("a plugin whose requirement is off is off too: no hooks, ops or services", vault.switchedOff().has("people-map") && $.app.plugins.find((p) => p.id === "people-map")!.isOff())
    await api("PUT", "config/plugins", conf)
  }
  vault.setConfig("pages", { pinned: ["Dashboards/Errors.md", "Dashboards/People.md"] })
  // The design system's page, as the sandbox has it (the tests below render it).
  write("Dashboards/Design.md", fs.readFileSync(path.join(TOOLS, "..", "core", "docs", "design.md"), "utf8"))
  await vault.sync()
  // A new page goes in the pages folder: the one set, else where most of the user's pages are, else Dashboards/.
  {
    let [nc, np] = await api("POST", "ops/dashboard.create", { name: "Mine", noPin: true })
    check("dashboard new: in the pages folder, Dashboards/", nc === 200 && np.path === "Dashboards/Mine.md", [nc, np])
    const folders = vault.config("folders"), had = exists(".vaultite/folders.json")
    vault.setConfig("folders", { ...folders, dashboards: "Personal/Dashboards" })
    ;[nc, np] = await api("POST", "ops/dashboard.create", { name: "Mine too", noPin: true })
    check("dashboard new: in the pages folder set", nc === 200 && np.path === "Personal/Dashboards/Mine too.md", [nc, np])
    if (had) vault.setConfig("folders", folders); else fs.rmSync(path.join(VAULT, ".vaultite/folders.json"))
    fs.rmSync(path.join(VAULT, "Personal"), { recursive: true })
    fs.rmSync(path.join(VAULT, "Dashboards/Mine.md"))
    await vault.sync()
  }
  write("Dashboards/Errors.md", read("Dashboards/Errors.md").replace("icon: alert-triangle", "icon: star"))
  // Folders are the user's: pages moved into another folder are still the user's pages (the pages folder follows
  // them); a path written before the move still renders.
  {
    const dash = () => fs.readdirSync(path.join(VAULT, "Dashboards")).filter((n) => n.endsWith(".md"))
    const pinsWere = read(".vaultite/pages.json")
    fs.mkdirSync(path.join(VAULT, "Personal/Dashboards"), { recursive: true })
    for (const n of dash()) fs.renameSync(path.join(VAULT, "Dashboards", n), path.join(VAULT, "Personal/Dashboards", n))
    await vault.sync()
    const [, again] = await api("POST", "ops/dashboard.restore", {})
    check("pages: moved to another folder, they're still the user's: none written again", !again.made.length && !dash().length, again)
    const [, moved] = await api("GET", "render?path=Dashboards/Errors.md")
    check("render: a path from before a move still reads the file", typeof moved === "string" && moved.includes("# Errors") && moved.includes("plugin: errors"), String(moved).slice(0, 80))
    const [, movedState] = await api("GET", "state")
    check("pins: one whose file moved outside the app shows where it is now", JSON.parse(pinsWere).pinned.includes("Dashboards/Errors.md") &&
      movedState.pinned.includes("Personal/Dashboards/Errors.md") && !movedState.pinned.includes("Dashboards/Errors.md"), movedState.pinned)
    for (const n of fs.readdirSync(path.join(VAULT, "Personal/Dashboards"))) fs.renameSync(path.join(VAULT, "Personal/Dashboards", n), path.join(VAULT, "Dashboards", n))
    fs.rmSync(path.join(VAULT, "Personal"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite/pages.json"), pinsWere)
    await vault.sync()
  }
  let tree: Any
  ;[, tree] = await api("GET", "files")
  const errs = tree.files.find((x: Any) => x.path === "Dashboards/Errors.md")
  check("the file index has a file's blocks and look", errs.blocks[0][0] === "errors" && errs.blocks[0][1].includes("wide: true")
    && errs.icon === "star" && errs.plugin === "errors" && errs.type === "dashboard", errs) // (the icon the user gave it, above)

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
