import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, clearWs, vault, write } = $
  const { pluginsWas } = $.vars
  // iCloud holds a settings file while it uploads (EDEADLK): it reads as it last did, never {}, a save right after this
  // server's own write goes through, and one changed elsewhere meanwhile is refused.
  {
    vault.setConfig("plugins/workspaces/1", { name: "Lighthouse" })
    const held = path.join(VAULT, ".vaultite/plugins/workspaces/1.json")
    const readWas = fs.readFileSync
    const hold = () => { fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...a: unknown[]) => {
      if (p === held) throw Object.assign(new Error("EDEADLK"), { code: "EDEADLK" })
      return (readWas as (...x: unknown[]) => unknown)(p, ...a)
    }) as typeof fs.readFileSync }
    hold()
    try {
      vault.forgetConfig("plugins/workspaces/1")
      check("a settings file iCloud holds reads as it last did", vault.config("plugins/workspaces/1").name === "Lighthouse")
      const [st] = await api("PUT", "workspaces/1", { name: "Harbor" })
      fs.readFileSync = readWas
      check("a save while iCloud holds this server's own write goes through", st === 200 && JSON.parse(fs.readFileSync(held, "utf8")).name === "Harbor", st)
      fs.writeFileSync(held, JSON.stringify({ name: "Elsewhere, longer" }))
      hold()
      const [st2] = await api("PUT", "workspaces/1", { name: "Mine" })
      fs.readFileSync = readWas
      check("one changed elsewhere meanwhile isn't overwritten", st2 === 503 && JSON.parse(fs.readFileSync(held, "utf8")).name === "Elsewhere, longer", st2)
    } finally { fs.readFileSync = readWas }
    clearWs()
  }
  // A dashboard's subtitle under its title (/api/render) is Dashboards' (the service "page-head"): off, it's a plain file.
  write("Dashboards/Sub.md", "---\ntype: dashboard\nsubtitle: A line under it\n---\n\nText.\n")
  let [, sub] = await api("GET", "render?path=Dashboards/Sub.md")
  check("render: a dashboard's subtitle under its title", sub.includes("# Sub\n\nA line under it\n\nText."), sub)
  vault.setConfig("plugins", { ...pluginsWas, disabled: ["dashboards"] })
  ;[, sub] = await api("GET", "render?path=Dashboards/Sub.md")
  check("render: with Dashboards off, no subtitle", sub.includes("# Sub\n\nText."), sub)
  vault.setConfig("plugins", pluginsWas)
  fs.rmSync(path.join(VAULT, "Dashboards/Sub.md"))
}
