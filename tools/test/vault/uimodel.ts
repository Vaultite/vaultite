import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check } = $
  // The companion's one UI model (core/desktop/uimodel.ts): targets resolved to the part that acts, conditions
  // read back, the same for Vaultite's window and another app's Accessibility. A made-up tree stands in for either.
  const M = await import("../../../core/desktop/uimodel.ts")
  type N = { t: Partial<import("../../../core/desktop/uimodel.ts").Thing> & { role: string; label: string }; kids: N[]; up?: N; rel?: N[] }
  const n = (t: N["t"], ...kids: N[]): N => { const x: N = { t, kids }; for (const k of kids) k.up = x; return x }
  const thing = (x: N): import("../../../core/desktop/uimodel.ts").Thing => {
    const inside: { role: string; label: string }[] = []
    for (let p = x.up; p; p = p.up) if (p.t.label) inside.push({ role: p.t.role, label: p.t.label })
    return { frame: { x: 0, y: 0, width: 10, height: 10 }, state: {}, actions: [], inside, ...x.t }
  }
  const tree = { parent: (x: N) => x.up ?? null, children: (x: N) => x.kids, thing: (x: N) => (x.t.state?.disabled === undefined && x.t.label === "hidden" ? null : thing(x)), related: (x: N) => x.rel ?? [] }

  // A window: a left sidebar with a folded Files panel (its heading the disclosure), a tab strip, a settings row
  const heading = n({ role: "button", label: "Files", state: { expanded: false }, actions: ["press"] })
  const projects = n({ role: "text", label: "Projects" })
  const row = n({ role: "treeitem", label: "Projects", actions: ["press"] }, projects)
  const files = n({ role: "region", label: "Files", ui: "panel:files:files" }, heading, n({ role: "tree", label: "" }, row))
  const notesTab = n({ role: "tab", label: "Notes", state: { selected: false }, actions: ["press"] })
  const tabs = n({ role: "tablist", label: "Tabs" }, notesTab, n({ role: "tab", label: "Today", state: { selected: true }, actions: ["press"] }))
  const toggle = n({ role: "switch", label: "", state: { checked: false }, actions: ["press"] })
  const label = n({ role: "text", label: "Dark mode" })
  label.rel = [toggle]
  const settings = n({ role: "group", label: "Appearance" }, label, toggle)
  const win = n({ role: "window", label: "Vaultite" }, n({ role: "region", label: "Left sidebar" }, files), tabs, settings, n({ role: "button", label: "hidden" }))

  const at = (t: import("../../../core/desktop/uimodel.ts").Target, a?: import("../../../core/desktop/uimodel.ts").Action) => M.resolve(tree, win, t, a)?.e
  check("uimodel: a panel named or by its id resolves to its disclosure heading, not its container", at({ name: "Files" }) === heading && at({ ui: "panel:files:files" }) === heading && at({ name: "files" }, "expand") === heading)
  check("uimodel: words inside a row resolve to the row, a label to its control, a role to its kin",
    at({ name: "Projects" }) === row && M.actingPart(tree, projects) === row && at({ name: "Dark mode" }) === toggle && at({ role: "button", name: "Notes" }) === notesTab && at({ role: "tab", name: "Notes" }) === notesTab)
  check("uimodel: what's in a container narrows it; hidden things are never found", at({ name: "Projects", inside: "Files" }) === row && at({ name: "Projects", inside: "Settings" }) === undefined && at({ name: "hidden" }) === undefined)
  check("uimodel: the resolved thing carries its labelled ancestors nearest first and its ui id",
    JSON.stringify(M.resolve(tree, win, { name: "Projects" })!.thing.inside.map((i) => i.label)) === JSON.stringify(["Files", "Left sidebar", "Vaultite"]) && M.resolve(tree, win, { ui: "panel:files:files" })!.named.ui === "panel:files:files")

  const view = (root: N, extra = "") => ({ find: (t: import("../../../core/desktop/uimodel.ts").Target) => M.resolve(tree, root, t)?.thing ?? null, shows: (w: string) => JSON.stringify(root, (k, v) => (k === "up" ? undefined : v)).toLowerCase().includes(w.toLowerCase()), snapshot: () => JSON.stringify(root, (k, v) => (k === "up" ? undefined : v)) + extra })
  const P = M.parseCondition
  check("uimodel: conditions read as written, aliases to one kind",
    JSON.stringify(P(`expanded "Files"`)) === JSON.stringify({ kind: "expanded", target: { name: "Files" } }) && P(`collapsed "Files"`).not === true && P(`not folded "Files"`).not === undefined &&
    P(`selected tab "Notes"`).target?.role === "tab" && P(`shows "Saved"`).text === "Saved" && P("changed").kind === "changed" && P(`gone button "Save" in "Toolbar"`).target?.inside === "Toolbar" &&
    P(`value textbox "Title" is "Lighthouse"`).text === "Lighthouse" && P(`checked ui:switch:dark`).target?.ui === "switch:dark" && M.conditionText(P(`not selected tab "Notes"`)) === `not selected tab "Notes"`)
  check("uimodel: a condition that can't be read says how it's written", (() => { try { P(`wobbly "x"`); return false } catch (e) { return /no condition "wobbly"/.test(String(e)) } })() && (() => { try { P("shows Saved"); return false } catch (e) { return /in quotes/.test(String(e)) } })())
  const v = view(win), before = v.snapshot()
  check("uimodel: a check reads the state back and says what it saw",
    !M.check(P(`expanded "Files"`), v).ok && M.check(P(`expanded "Files"`), v).saw === `"Files" is folded` && M.check(P(`collapsed "Files"`), v).ok &&
    M.check(P(`selected tab "Today"`), v).ok && !M.check(P(`selected "Notes"`), v).ok && !M.check(P(`checked "Dark mode"`), v).ok && M.check(P(`exists "Projects"`), v).ok &&
    M.check(P(`gone "Lighthouse"`), v).ok && M.check(P(`expanded "Lighthouse"`), v).saw === `no "Lighthouse" on screen` && M.check(P(`expanded tab "Today"`), v).saw === `"Today" doesn't open or fold`)
  heading.t.state = { expanded: true }
  check("uimodel: changed compares with the snapshot before the step", M.check(P("changed"), view(win), before).ok && !M.check(P("changed"), view(win), view(win).snapshot()).ok && !M.check(P("changed"), view(win)).ok)
  check("uimodel: a step's effect, from before and after", M.stepEffect("click", { ...thing(heading), state: { expanded: false } }, thing(heading), true).ok &&
    M.stepEffect("click", thing(heading), thing(heading), false).saw === `"Files" is still open` && !M.stepEffect("click", thing(toggle), thing(toggle), false).ok && !M.stepEffect("click", null, null, false).ok)
  check("uimodel: Accessibility's roles and actions in the model's words",
    M.roleOfAx("AXButton") === "button" && M.roleOfAx("AXCheckBox", "AXSwitch") === "switch" && M.roleOfAx("AXRadioButton", "AXTabButton") === "tab" && M.roleOfAx("AXOutlineRow") === "treeitem" && M.roleOfAx("AXWeird") === "weird" &&
    JSON.stringify(M.actionsOfAx(["AXPress", "AXShowMenu", "AXScrollToVisible"])) === JSON.stringify(["press", "menu"]))
  check("uimodel: a thing as one line, its ui id when it has one", M.thingText({ ...thing(heading), id: "a3" }) === `a3 button "Files" (open) in "Files"` && M.thingText(thing(files)) === `region "Files" in "Left sidebar" ui:panel:files:files`)
  // Another app's things as its helper sends them (screen.swift near()): Accessibility's words, read into the model
  const ax = [{ role: "disclosure triangle", ax: "AXDisclosureTriangle", label: "Advanced", frame: { x: 10, y: 20, width: 12, height: 12 }, state: { expanded: false }, actions: ["AXPress"], inside: [{ ax: "AXGroup", label: "Network" }] },
    { role: "check box", ax: "AXCheckBox", sub: "AXSwitch", label: "Wi-Fi", frame: { x: 10, y: 50, width: 30, height: 20 }, state: { checked: true, bogus: 1 }, actions: ["AXPress"], inside: [] },
    { role: "text", label: "", frame: { x: 0, y: 0, width: 1, height: 1 } }, { label: "no frame" }].map(M.thingFrom)
  const things = ax.filter((t): t is NonNullable<typeof t> => !!t), av = M.listView(things)
  check("uimodel: an app's things read into the model, odd ones dropped, unknown state keys left out",
    things.length === 2 && things[0].role === "button" && things[0].inside[0].role === "group" && things[1].role === "switch" && JSON.stringify(things[1].state) === `{"checked":true}` && things[1].ax === "AXCheckBox" && JSON.stringify(things[0].actions) === `["press"]`)
  check("uimodel: an app's list checked as Vaultite's window is", M.check(P(`collapsed "Advanced"`), av).ok && M.check(P(`checked switch "Wi-Fi"`), av).ok && M.check(P(`exists button "Advanced" in "Network"`), av).ok &&
    M.check(P(`shows "Wi-Fi"`), av).ok && !M.check(P(`shows "Bluetooth"`), av).ok && M.check(P("changed"), M.listView(things.slice(1)), av.snapshot()).ok)
}
