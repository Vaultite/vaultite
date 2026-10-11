import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, vault, write } = $
  // Settings and Me
  await api("PUT", "config/plugins", { disabled: ["random-note"], order: [] })
  check("settings saved in .vaultite", JSON.parse(read(".vaultite/plugins.json")).disabled[0] === "random-note")
  // PATCH changes only the keys sent (which plugins don't update on their own), null removes one; the rest stay as on disk
  await api("PATCH", "config/plugins", { updatesOff: ["lighthouse"], order: null })
  {
    const conf = JSON.parse(read(".vaultite/plugins.json"))
    check("PATCH writes one key and keeps the others", conf.updatesOff?.[0] === "lighthouse" && conf.disabled[0] === "random-note" && !("order" in conf), conf)
  }
  await api("PATCH", "config/hotkeys", { "terminal:open": ["Mod+Shift+T"] })
  await api("PATCH", "config/hotkeys", { "file:new": [] })
  await api("PATCH", "config/hotkeys", { "file:new": null })
  check("hotkeys.json keeps one command per key", read(".vaultite/hotkeys.json") === '{\n  "terminal:open": [\n    "Mod+Shift+T"\n  ]\n}\n', read(".vaultite/hotkeys.json"))
  let [, s] = await api("GET", "state")
  check("hotkeys are in the state's config", s.config.hotkeys["terminal:open"][0] === "Mod+Shift+T", s.config)
  let me: Any
  ;[, me] = await api("PUT", "me", { location: "Denver, CO" })
  check("ME.md is written, without coordinates", me.lat === null && !read("ME.md").includes("coordinates"), me)
  check("the user's pin comes from the map's cache", (await api("GET", "state"))[1].me?.lat === 39.7392)
  {
    const { Kind } = await import("../../../core/vault.ts")
    const k = new Kind({ type: "me", collection: "me", file: "ME.md", parse: () => [{}, []], render: () => [{}, ""] })
    check("ME.md is the user's file in any case (Me.md from before), and only at the top", me.id === "ME" && k.owns("ME.md") && k.owns("Me.md") && !k.owns("Notes/Me.md"), me.id)
  }
  // Me is a plugin: its setting says where the user's file is, and remember follows; off, nothing breaks.
  {
    const meText = read("ME.md")
    const setMe = async (data: Any) => {
      fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/me"), { recursive: true })
      fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/me/data.json"), JSON.stringify(data))
      await api("GET", "state")
    }
    fs.mkdirSync(path.join(VAULT, "Personal"), { recursive: true })
    fs.renameSync(path.join(VAULT, "ME.md"), path.join(VAULT, "Personal/About.md"))
    write("Personal/About.md", meText.replace(/^---\ntype: me\n/, "---\n"))
    await setMe({ path: "Personal/About.md" })
    let [, ms] = await api("GET", "state")
    check("me: the setting's path is the user's file, without a type", ms.me?.id === "Personal/About", ms.me)
    const [, rem] = await api("POST", "ops/people.remember", { fact: "Grows tomatoes." })
    check("me: remember writes where the setting says", rem.path === "Personal/About.md" && read("Personal/About.md").includes("- Grows tomatoes.") && !exists("ME.md"), rem)
    await api("POST", "file/move", { from: "Personal", to: "Private" })
    check("me: moved in the app (its folder too), the setting follows", vault.config("plugins/me/data").path === "Private/About.md" && (await api("GET", "state"))[1].me?.id === "Private/About", vault.config("plugins/me/data"))
    await api("POST", "file/move", { from: "Private", to: "Personal" })
    const off = (on: boolean) => api("PUT", "config/plugins", { ...vault.config("plugins"), disabled: on ? [] : ["me"] })
    await off(false)
    const [rc, rr] = await api("POST", "ops/people.remember", { fact: "Grows beans." })
    const [sc] = await api("GET", "state")
    check("me: off, remember says why instead of writing, and the app still loads", rc === 409 && /Me plugin is off/.test(rr.error) && sc === 200 && !read("Personal/About.md").includes("beans"), [rc, rr])
    await off(true)
    await setMe({})
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/me"), { recursive: true })
    fs.rmSync(path.join(VAULT, "Personal"), { recursive: true })
    write("ME.md", meText)
    ;[, ms] = await api("GET", "state")
    check("me: back at ME.md", ms.me?.id === "ME", ms.me)
  }

  // A broken file is reported and keeps what it held
  const good = "---\ntype: person\nrelation: friend\n---\n"
  write("People/Broken Test.md", good)
  await api("GET", "state")
  write("People/Broken Test.md", "---\nrelation: [friend\n---\nbroken\n")
  ;[, s] = await api("GET", "state")
  check("broken frontmatter is reported", s.vault.problems.some((x: Any) => x.file === "People/Broken Test.md"), s.vault.problems)
  check("its person is still there", s.people.some((x: Any) => x.name === "Broken Test"))
  write("People/Broken Test.md", good)
  ;[, s] = await api("GET", "state")
  check("fixing it clears the problem", !s.vault.problems.some((x: Any) => x.file === "People/Broken Test.md"))
  write("People/Colleague Test.md", "---\ntype: person\nrelation: colleague\n---\n")
  ;[, s] = await api("GET", "state")
  check("a relation of one's own is fine, not a problem", !s.vault.problems.some((x: Any) => x.file === "People/Colleague Test.md") &&
    s.people.find((x: Any) => x.name === "Colleague Test")?.relation === "colleague", s.vault.problems)
  fs.rmSync(path.join(VAULT, "People/Colleague Test.md"))
}
