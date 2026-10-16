import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { tidy } from "../../../core/bundles.ts"
import { officialRepos } from "../official.ts"

export default async ($: VaultTest) => {
  const { ON, VAULT, api, app, check, exists, read, write, writeWs } = $
  let s: Any
  // Bundles (core/bundles.ts): applying is small edits that leave unrelated keys alone, and restoring is a round trip.
  {
    const conf = (name: string) => { try { return JSON.parse(read(`.vaultite/${name}.json`)) } catch { return null } }
    const setConf = (name: string, o: unknown) => write(`.vaultite/${name}.json`, JSON.stringify(o))
    // Its plugins (Activity off) and pins are put back at the end: the areas after it need them.
    const pluginsBefore = conf("plugins"), pagesBefore = conf("pages")
    setConf("plugins", { disabled: ["clipper"], enabled: ON, updatesOff: ["lighthouse"], order: ["people"] })
    setConf("appearance", { theme: "light", textFont: "Georgia", scheme: "nord" })
    setConf("pages", { pinned: ["People/Alice Park.md", "Dashboards/People.md"] })
    setConf("plugins/page-preview/data", { delay: 300 })
    await api("PATCH", "config/plugin/terminal", { allowRemote: true })
    for (const f of ["sidebars", "hotkeys"]) { try { fs.unlinkSync(path.join(VAULT, `.vaultite/${f}.json`)) } catch { /* none */ } }
    const desk = { name: "Desk", sidebars: { left: ["files:files"], right: [], collapsed: [] }, pinned: ["People/Alice Park.md", "Dashboards/People.md"] }
    writeWs({ workspaces: [desk] })
    const NAMES = ["plugins", "appearance", "pages", "sidebars", "hotkeys", "plugins/page-preview/data", "plugins/terminal/data", "plugins/history/data", "plugins/activity/data"]
    const before = Object.fromEntries(NAMES.map((n) => [n, conf(n)]))
    const slot1 = async () => (await api("GET", "workspaces"))[1].workspaces[0]
    const deskBefore = await slot1()

    let [code, r] = await api("GET", "bundles")
    check("bundles: the app's three, readable, Standard first and the default", r.bundles.filter((b: Any) => b.source === "app").map((b: Any) => b.id).join() === "standard,life-os,agent-cockpit" &&
      r.bundles.every((b: Any) => !b.problems.length || b.source !== "app") && r.default === "standard", r.bundles.map((b: Any) => [b.id, b.problems]))
    const LIFE = "Dashboards/Today.md,Dashboards/Home.md,Dashboards/People.md,Dashboards/Health.md,Dashboards/Learning.md,Dashboards/Projects.md,People/Alice Park.md"
    // (the pages of the plugins it installs are known once they are)
    const PREVIEWED = "Dashboards/Home.md,Dashboards/People.md,People/Alice Park.md"
    ;[code, r] = await api("GET", "bundles/life-os?workspace=1")
    const plan = r.plan
    check("bundles: the preview says what changes", code === 200 && plan.plugins.off.includes("machines") && plan.settings.some((s: Any) => s.plugin === "page-preview" && s.key === "trigger" && s.to === "hover") &&
      plan.pins.list.join() === PREVIEWED && plan.pins.workspace?.join() === plan.pins.list.join() && plan.panels.workspace === 1 &&
      plan.files.add.includes("Dashboards/Home.md") && !plan.empty, plan)
    ;[code, r] = await api("POST", "bundles/life-os/apply", { workspace: 1 })
    check("bundles: one installing a plugin asks first (it runs code)", code === 409 && r.error.includes("Books"), [code, r])
    // (Books and others moved out of the app: Life OS installs them from a made-up Vaultite/plugins here)
    const github = process.env.VAULTITE_GITHUB
    process.env.VAULTITE_GITHUB = officialRepos(path.join($.tmp, "official"))
    ;[code, r] = await api("POST", "bundles/life-os/apply", { workspace: 1, allowCode: true })
    check("bundles: apply", code === 200 && r.applied === "Life OS", r)
    check("bundles: a plugin it installs is installed from Vaultite's plugins, on and allowed here", exists(".vaultite/plugins/books/manifest.json") &&
      conf("plugins-lock")?.books?.source === "Vaultite/plugins/books" && !!app.vaultPlugins.trust.approved("books", app.vaultPlugins.found.get("books")?.digest.content ?? ""), conf("plugins-lock"))
    if (github === undefined) delete process.env.VAULTITE_GITHUB; else process.env.VAULTITE_GITHUB = github
    const pj = conf("plugins"), look = conf("appearance")
    check("bundles: plugins.json keeps its other keys", pj.updatesOff?.[0] === "lighthouse" && pj.order?.[0] === "people" && pj.enabled.includes("today") && !pj.enabled.includes("machines") && pj.enabled.includes("books"), pj)
    check("bundles: appearance keeps the keys the bundle doesn't set; one it sets to the default is removed", look.textFont === "Georgia" && !("theme" in look) && look.scheme === "flexoki" &&
      look.density === "comfortable", look)
    check("bundles: a plugin's settings: the key set, the others kept", JSON.stringify(conf("plugins/page-preview/data")) === JSON.stringify({ delay: 300, trigger: "hover" }), conf("plugins/page-preview/data"))
    check("bundles: pins are the bundle's, then the user's own", conf("pages").pinned.join() === LIFE, conf("pages"))
    check("bundles: its dashboard is added", exists("Dashboards/Home.md") && read("Dashboards/Home.md").includes("```base"))
    check("bundles: sidebars.json is the bundle's", JSON.stringify(conf("sidebars").left) === JSON.stringify(["search:search", "pages:pages", "files:files"]), conf("sidebars"))
    let d = await slot1()
    check("bundles: the current workspace follows: its own panels go, its pins get the same edits, the rest stays", d.name === "Desk" && !d.sidebars && d.pinned?.join() === LIFE, d)
    ;[, s] = await api("GET", "state")
    check("bundles: /api/state says what can be restored", s.bundles?.previous?.name === "Life OS" && s.bundles.onboarding === false, s.bundles)
    ;[, r] = await api("GET", "bundles/life-os?workspace=1")
    check("bundles: applied again it changes nothing", r.plan.empty === true, r.plan)
    // A vault that applied one of the bundles folded into others since has the one it's in now.
    const prevFile = read(".vaultite/bundles/previous.json")
    write(".vaultite/bundles/previous.json", JSON.stringify({ ...JSON.parse(prevFile), bundle: "pages", name: "Pages and databases" }))
    write(".vaultite/bundles/standard/bundle.json", JSON.stringify({ name: "Standard" }))
    tidy(app.vault)
    const moved = JSON.parse(read(".vaultite/bundles/previous.json"))
    check("bundles: tidied, a folded bundle applied is the one it's in, and one of the user's under the app's id moves", moved.bundle === "life-os" && moved.name === "Life OS" &&
      moved.config && !exists(".vaultite/bundles/standard") && exists(".vaultite/bundles/standard-2/bundle.json"), [moved.bundle, moved.name])
    write(".vaultite/bundles/previous.json", JSON.stringify({ ...JSON.parse(prevFile), bundle: "everything", name: "Everything" }))
    tidy(app.vault)
    check("bundles: tidied, one that's gone stays as it was (restore still works)", JSON.parse(read(".vaultite/bundles/previous.json")).bundle === "everything")
    write(".vaultite/bundles/previous.json", prevFile)
    fs.rmSync(path.join(VAULT, ".vaultite/bundles/standard-2"), { recursive: true })
    ;[code, r] = await api("POST", "bundles/restore")
    check("bundles: restore", code === 200 && r.restored === "Life OS" && r.trashed.includes("Dashboards/Home.md"), r)
    const after = Object.fromEntries(NAMES.map((n) => [n, conf(n)]))
    check("bundles: apply then restore is a round trip (every settings file as it was, absent ones absent)", JSON.stringify(after) === JSON.stringify(before),
      NAMES.filter((n) => JSON.stringify(after[n]) !== JSON.stringify(before[n])).map((n) => [n, before[n], after[n]]))
    d = await slot1()
    check("bundles: the workspace is as it was", JSON.stringify({ n: d.name, s: d.sidebars, p: d.pinned }) === JSON.stringify({ n: deskBefore.name, s: deskBefore.sidebars, p: deskBefore.pinned }), [d, deskBefore])
    check("bundles: the dashboard it added is in the trash, and nothing to restore any more", !exists("Dashboards/Home.md") && !exists(".vaultite/bundles/previous.json"))
    ;[code] = await api("POST", "bundles/restore")
    check("bundles: restore twice is a 404", code === 404, code)

    // A bundle of the user's that brings a vault plugin (runs code) and tries to set a `local` setting.
    write(".vaultite/bundles/coder/bundle.json", JSON.stringify({ name: "Coder" }))
    write(".vaultite/bundles/coder/plugins.json", JSON.stringify({ enabled: ["hello"] }))
    write(".vaultite/bundles/coder/plugins/hello/manifest.json", JSON.stringify({ id: "hello", name: "Hello", description: "Says hello", category: "other" }))
    write(".vaultite/bundles/coder/plugins/terminal/data.json", JSON.stringify({ allowRemote: false, allowUsers: ["x@example.com"] }))
    ;[code, r] = await api("GET", "bundles/coder")
    check("bundles: a local setting is skipped, never set", r.plan.skipped.length === 2 && !r.plan.settings.length && r.plan.code[0]?.id === "hello", r.plan)
    ;[code, r] = await api("POST", "bundles/coder/apply", {})
    check("bundles: code needs allowCode", code === 409 && !exists(".vaultite/plugins/hello/manifest.json"), [code, r])
    ;[code] = await api("POST", "bundles/coder/apply", { allowCode: true })
    check("bundles: with allowCode, the vault plugin is copied in and turned on", code === 200 && exists(".vaultite/plugins/hello/manifest.json") && conf("plugins").enabled.includes("hello") &&
      (await api("GET", "config/plugin/terminal"))[1].allowRemote === true, conf("plugins"))
    const hello = ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "hello")
    check("bundles: a vault plugin it brought with allowCode is allowed on this machine", hello?.loaded && !hello.approval, hello)
    ;[code] = await api("POST", "bundles/restore")
    check("bundles: restored, the plugin is off and its folder in the trash", code === 200 && !exists(".vaultite/plugins/hello") && !(conf("plugins").enabled ?? []).includes("hello"), conf("plugins"))

    // Save the current setup, export, import, delete.
    ;[code, r] = await api("POST", "bundles", { name: "My desk", workspace: 1 })
    const saved = (f: string) => { try { return JSON.parse(read(`.vaultite/bundles/my-desk/${f}`)) } catch { return null } }
    check("bundles: save writes the user's bundle", code === 200 && r.bundle.id === "my-desk" && saved("bundle.json")?.name === "My desk", r)
    check("bundles: saved: plugins, the workspace's pins, settings that differ from their defaults, never local ones", saved("plugins.json")?.disabled?.includes("clipper") &&
      saved("pages.json")?.pinned?.join() === deskBefore.pinned.join() && saved("plugins/page-preview/data.json")?.delay === 300 && saved("plugins/terminal/data.json") === null &&
      saved("appearance.json")?.scheme === "nord" && saved("hotkeys.json") === null, fs.readdirSync(path.join(VAULT, ".vaultite/bundles/my-desk"), { recursive: true }))
    ;[code, r] = await api("GET", "bundles/my-desk/export")
    const exported = JSON.parse(r)
    check("bundles: export is one JSON file", code === 200 && exported.vaultite === "bundle" && exported.files["plugins.json"].disabled.includes("clipper"), exported)
    ;[code, r] = await api("POST", "bundles/import/preview", { file: exported, workspace: 1 })
    check("bundles: an import's preview: the bundle as it would be added, its plan, nothing written", code === 200 && r.bundle?.id === "my-desk-2" && !!r.plan && r.replaces === null &&
      r.file?.vaultite === "bundle" && !exists(".vaultite/bundles/my-desk-2"), [code, r?.bundle?.id, r?.replaces])
    ;[code, r] = await api("POST", "bundles/import", { file: r.file })
    check("bundles: import adds it under a free id", code === 200 && r.bundle.id === "my-desk-2" && exists(".vaultite/bundles/my-desk-2/pages.json"), r)
    const fromRepo = { ...exported, files: { ...exported.files, "bundle.json": { name: "Shared desk", from: "alice/desk" } } }
    const first = (await api("POST", "bundles/import", fromRepo))[1]
    ;[code, r] = await api("POST", "bundles/import/preview", fromRepo)
    check("bundles: one from a repository the user has replaces theirs", code === 200 && r.replaces === first.bundle?.id && r.bundle.id === first.bundle?.id, [first.bundle?.id, r.replaces])
    await api("DELETE", `bundles/${first.bundle?.id}`)
    ;[code, r] = await api("POST", "bundles/import", { vaultite: "bundle", files: { "../x.json": "{}" } })
    check("bundles: an import with a bad path is refused", code === 400, [code, r])
    ;[code] = await api("DELETE", "bundles/my-desk-2")
    check("bundles: delete one of yours (to the trash)", code === 200 && !exists(".vaultite/bundles/my-desk-2"))
    ;[code] = await api("DELETE", "bundles/life-os")
    check("bundles: the app's can't be deleted", code === 400, code)

    // Sharing leaves out what's the user's own: the picture, a page with their text, pins to their notes.
    write(".vaultite/bundles/my-desk/Dashboards/Desk.md", "---\ntype: dashboard\n---\n\nPlans for Bob's party\n\n```block-inbox\n```\n")
    write(".vaultite/bundles/my-desk/Dashboards/Plain.md", "---\ntype: dashboard\n---\n\n## Today\n\n```block-inbox\n```\n")
    fs.writeFileSync(path.join(VAULT, ".vaultite/bundles/my-desk/preview.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
    ;[code, r] = await api("GET", "bundles/my-desk/share")
    const item = (f: string) => r.items?.find((x: Any) => x.path === f)
    check("bundles: share lists the parts, the user's own off", code === 200 && item("preview.png")?.on === false && item("Dashboards/Desk.md")?.own && !item("Dashboards/Desk.md").on &&
      item("Dashboards/Plain.md")?.on && item("plugins/page-preview/data.json")?.keys?.includes("delay") && r.dropped.join() === "People/Alice Park.md", r)
    let out = JSON.parse((await api("GET", "bundles/my-desk/export"))[1])
    check("bundles: shared, it's without them: the pin to a note of the user's is taken out, the app's page kept", !out.files["preview.png"] && !out.files["Dashboards/Desk.md"] &&
      !!out.files["Dashboards/Plain.md"] && out.files["pages.json"].pinned.join() === "Dashboards/People.md", Object.keys(out.files))
    out = JSON.parse((await api("POST", "bundles/my-desk/export", { include: ["preview.png"], leave: ["plugins/page-preview/data.json"] }))[1])
    check("bundles: what's sent can be chosen", !!out.files["preview.png"]?.base64 && !out.files["plugins/page-preview/data.json"], Object.keys(out.files))
    out = JSON.parse((await api("GET", "bundles/my-desk/export?all=1"))[1])
    check("bundles: all of it, as kept (a delete's Undo)", !!out.files["preview.png"] && !!out.files["Dashboards/Desk.md"] && out.files["pages.json"].pinned.includes("People/Alice Park.md"), Object.keys(out.files))

    // Files that aren't text (an image) go in and out as their bytes; one that can't be read is listed, saying why.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe, 0x01])
    write(".vaultite/bundles/pics/bundle.json", JSON.stringify({ name: "Pics" }))
    fs.mkdirSync(path.join(VAULT, ".vaultite/bundles/pics/Lighthouse"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, ".vaultite/bundles/pics/Lighthouse/lamp.png"), png)
    ;[code, r] = await api("GET", "bundles")
    check("bundles: one with an image is listed, readable", r.bundles.some((b: Any) => b.id === "pics" && !b.problems.length), r.bundles.map((b: Any) => [b.id, b.problems]))
    ;[code, r] = await api("GET", "bundles/pics/export")
    const pics = JSON.parse(r)
    check("bundles: export keeps an image's bytes", Buffer.from(pics.files["Lighthouse/lamp.png"]?.base64 ?? "", "base64").equals(png), pics.files)
    ;[code, r] = await api("POST", "bundles/import", pics)
    check("bundles: import writes them back", code === 200 && fs.readFileSync(path.join(VAULT, `.vaultite/bundles/${r.bundle?.id}/Lighthouse/lamp.png`)).equals(png), [code, r])
    await api("DELETE", `bundles/${r.bundle?.id}`)
    ;[code] = await api("POST", "bundles/pics/apply", {})
    check("bundles: applied, the image is in the vault as it was", code === 200 && fs.readFileSync(path.join(VAULT, "Lighthouse/lamp.png")).equals(png), code)
    ;[code, r] = await api("POST", "bundles/restore")
    check("bundles: restored, the image unchanged goes to the trash", code === 200 && !exists("Lighthouse/lamp.png") && r.trashed.includes("Lighthouse/lamp.png"), r)
    await api("DELETE", "bundles/pics")
    write(".vaultite/bundles/locked/bundle.json", JSON.stringify({ name: "Locked" }))
    fs.chmodSync(path.join(VAULT, ".vaultite/bundles/locked/bundle.json"), 0o000)
    ;[code, r] = await api("GET", "bundles")
    const locked = r.bundles.find((b: Any) => b.id === "locked")
    check("bundles: one that can't be read is listed with why", /can't be read/.test(locked?.problems?.[0] ?? ""), locked)
    ;[code] = await api("POST", "bundles/locked/apply", {})
    check("bundles: and isn't applied", code === 400, code)
    fs.chmodSync(path.join(VAULT, ".vaultite/bundles/locked/bundle.json"), 0o644)
    fs.rmSync(path.join(VAULT, ".vaultite/bundles/locked"), { recursive: true })

    // A bundle of only the look and the new tab (its page a dashboard it brings), with a picture, as the app's Save the
    // look made them: applied over any setup, plugins, panels and pins as they are.
    write("Dashboards/Lamp room.md", "---\ntype: dashboard\n---\n\n```block-inbox\n```\n")
    const lookBefore = conf("newtab"), appearanceBefore = conf("appearance")
    write(".vaultite/bundles/lamp-light/bundle.json", JSON.stringify({ name: "Lamp light", icon: "palette" }))
    write(".vaultite/bundles/lamp-light/appearance.json", JSON.stringify({ scheme: "nord" }))
    write(".vaultite/bundles/lamp-light/newtab.json", JSON.stringify({ page: "Dashboards/Lamp room.md", actions: ["file:new"] }))
    write(".vaultite/bundles/lamp-light/Dashboards/Lamp room.md", read("Dashboards/Lamp room.md"))
    fs.writeFileSync(path.join(VAULT, ".vaultite/bundles/lamp-light/preview.png"), png)
    fs.rmSync(path.join(VAULT, "Dashboards/Lamp room.md"))
    ;[code, r] = await api("GET", "bundles/lamp-light/preview.png")
    check("bundles: its picture is served as its bytes", code === 200 && Buffer.isBuffer(r) && r.equals(png), [code, typeof r])
    ;[code] = await api("POST", "bundles", { name: "Not a picture", preview: Buffer.from("hello").toString("base64") })
    check("bundles: a picture that isn't a PNG is refused", code === 400, code)
    setConf("appearance", { ...appearanceBefore, scheme: "dracula" })
    ;[code, r] = await api("GET", "bundles/lamp-light")
    check("bundles: only the look's plan: the scheme and the new tab's page, built in as it brings it; plugins and pins untouched", r.bundle.on === null &&
      r.plan.appearance.some((c: Any) => c.key === "scheme" && c.to === "nord") && r.plan.newtab.some((c: Any) => c.key === "page" && c.to === "Dashboards/Lamp room.md") &&
      r.plan.pins === null && !r.plan.plugins.on.length && !r.plan.plugins.off.length && !r.plan.panels.changed, r.plan)
    ;[code] = await api("POST", "bundles/lamp-light/apply", {})
    check("bundles: applied, the new tab shows its page", code === 200 && conf("newtab")?.page === "Dashboards/Lamp room.md" && conf("appearance")?.scheme === "nord" &&
      exists("Dashboards/Lamp room.md"), conf("newtab"))
    ;[code] = await api("POST", "bundles/restore")
    check("bundles: restored, the new tab as it was", code === 200 && !conf("newtab")?.page && conf("appearance")?.scheme === "dracula", conf("newtab"))
    await api("DELETE", "bundles/lamp-light")
    if (lookBefore) setConf("newtab", lookBefore); else fs.rmSync(path.join(VAULT, ".vaultite/newtab.json"), { force: true })
    setConf("appearance", appearanceBefore)

    // Plugins the user added (the vault's, on) that a bundle doesn't name: listed and left alone, or off too with
    // offAdded, which restore undoes.
    const pluginsHere = read(".vaultite/plugins.json")
    ;[code] = await api("POST", "bundles/coder/apply", { allowCode: true })
    ;[, r] = await api("GET", "bundles/standard")
    check("bundles: a plugin you added that it doesn't name is listed, left alone", code === 200 && r.plan.plugins.added.includes("hello") && !r.plan.plugins.off.includes("hello"), r.plan.plugins)
    ;[code] = await api("POST", "bundles/standard/apply", { offAdded: true })
    check("bundles: with offAdded, it's turned off too", code === 200 && !(conf("plugins").enabled ?? []).includes("hello"), conf("plugins"))
    ;[code] = await api("POST", "bundles/restore")
    check("bundles: restored, it's on again", code === 200 && conf("plugins").enabled.includes("hello"), conf("plugins"))
    await api("POST", "ops/plugin.uninstall", { id: "hello" })
    write(".vaultite/plugins.json", pluginsHere)

    // A plugin in both of plugins.json's lists (its default changed since): switching it leaves it in one, and opening
    // the vault tidies the rest.
    setConf("plugins", { ...conf("plugins"), disabled: ["clipper", "vim"], enabled: ["clipper", "vim", "books"] })
    await api("POST", "ops/plugin.enable", { id: "vim" })
    check("bundles: switched on, an opt-in plugin is only in enabled", !conf("plugins").disabled.includes("vim") && conf("plugins").enabled.includes("vim"), conf("plugins"))
    app.tidyPluginLists()
    check("bundles: tidied, each is in the list that counts for it", conf("plugins").disabled.join() === "clipper" && [...conf("plugins").enabled].sort().join() === "books,vim", conf("plugins"))
    write(".vaultite/plugins.json", pluginsHere)

    // A number the user set higher stays: a bundle never lowers it.
    const hist = conf("plugins/history/data")
    setConf("plugins/history/data", { keep_days: 90 })
    ;[, r] = await api("GET", "bundles/agent-cockpit")
    check("bundles: a number you set higher is never lowered", !r.plan.settings.some((x: Any) => x.plugin === "history" && x.key === "keep_days") &&
      r.plan.skipped.some((x: Any) => x.plugin === "history" && x.key === "keep_days" && /higher/.test(x.why)), [r.plan.settings, r.plan.skipped])
    if (hist) setConf("plugins/history/data", hist); else fs.rmSync(path.join(VAULT, ".vaultite/plugins/history/data.json"), { force: true })
    for (const [name, was] of [["plugins", pluginsBefore], ["pages", pagesBefore]] as const) {
      if (was) setConf(name, was); else fs.rmSync(path.join(VAULT, `.vaultite/${name}.json`), { force: true })
    }
  }
}
