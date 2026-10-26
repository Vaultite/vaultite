import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, clearWs, sleep, vault, write } = $
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
  // Files iCloud evicted (Optimize Mac Storage), or another device changed, are placeholders a read can't bring down
  // (EDEADLK): asked for, and read once down. Never "no file", never indexed empty, settings never {}.
  {
    const { iCloud, slowReads } = await import("../../../core/vault.ts")
    const away = new Map<string, number>(), asked: string[] = [] // placeholders, and how long iCloud takes to give each
    const at = (p: unknown) => path.resolve(String(p)) // (as the file system takes it: Windows reads C:\v\a/b.md as C:\v\a\b.md)
    const was = { ...iCloud }, readSync = fs.readFileSync, readAsync = fs.promises.readFile
    const deadlock = () => Object.assign(new Error("Resource deadlock avoided"), { code: "EDEADLK", errno: -11 })
    fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...a: unknown[]) => {
      if (typeof p === "string" && away.has(at(p))) throw deadlock()
      return (readSync as (...x: unknown[]) => unknown)(p, ...a)
    }) as typeof fs.readFileSync
    fs.promises.readFile = ((p: string, ...a: unknown[]) => away.has(at(p)) ? Promise.reject(deadlock())
      : (readAsync as (...x: unknown[]) => Promise<unknown>)(p, ...a)) as typeof fs.promises.readFile
    Object.assign(iCloud, {
      on: true,
      evicted: (abs: string) => away.has(at(abs)),
      download: (p: string, done: (e: Error | null) => void) => { asked.push(at(p)); setTimeout(() => { away.delete(at(p)); done(null) }, away.get(at(p)) ?? 0) },
    })
    const evict = (rel: string, ms = 100) => away.set(path.join(VAULT, rel), ms) // (down before the read tries again)
    try {
      write("Notes/Phone.md", "---\ntype: note\n---\n\nWritten on the phone.\n")
      evict("Notes/Phone.md")
      await vault.synced()
      const e = vault.entries.get("Notes/Phone.md")
      check("evicted: a new file iCloud left as a placeholder is asked for and indexed with its text",
        !!e && !e.broken && e.body.includes("Written on the phone.") && asked.includes(path.join(VAULT, "Notes/Phone.md")), e)

      write("Dashboards/Desk.md", "---\ntype: dashboard\n---\n\nDesk text.\n")
      await vault.synced()
      evict("Dashboards/Desk.md")
      const [st, f] = await api("GET", "file?path=Dashboards/Desk.md")
      check("evicted: an indexed file evicted later reads (not 'no file')", st === 200 && f.text.includes("Desk text."), [st, f])
      evict("Dashboards/Desk.md")
      const [st2, r] = await api("GET", "render?path=Dashboards/Desk.md")
      check("evicted: and renders", st2 === 200 && String(r).includes("Desk text."), [st2, r])

      write(".vaultite/plugins/lighthouse/data.json", JSON.stringify({ beam: "north" }))
      evict(".vaultite/plugins/lighthouse/data.json")
      await vault.synced()
      check("evicted: a settings file reads as it is, not {}", vault.config("plugins/lighthouse/data").beam === "north", vault.config("plugins/lighthouse/data"))

      // One iCloud is slow to give: named as downloading meanwhile, not indexed empty; read when it arrives.
      write("Notes/Slow phone.md", "---\ntype: note\n---\n\nSlow to come.\n")
      evict("Notes/Slow phone.md", 2600)
      await vault.synced()
      check("evicted: one still coming isn't indexed empty, and is named", !vault.entries.has("Notes/Slow phone.md") && vault.downloading.includes("Notes/Slow phone.md"), vault.downloading)
      const [st3, slow] = await api("GET", "file?path=Notes/Slow phone.md")
      check("evicted: opening it waits for it", st3 === 200 && slow.text.includes("Slow to come."), [st3, slow])
      await vault.synced()
      check("evicted: then it's indexed", vault.entries.get("Notes/Slow phone.md")?.body.includes("Slow to come."))

      // A migration that changes files leaves one iCloud hasn't brought for a later start, never skips it for good.
      const { DONE, migrate } = await import("../../../core/migrations.ts")
      const STEP = "base-layout-2026-10", had = vault.readConfig("migrations")
      vault.setConfig("migrations", { done: DONE.filter((id) => id !== STEP) })
      write("Dashboards/Wide.md", "```base\nviews: []\nwide: true\n```\n")
      evict("Dashboards/Wide.md", 2600)
      await migrate(vault, false)
      const left = vault.readConfig("migrations")
      check("migrations: a file iCloud hasn't brought is left for later", left?.done.includes(STEP) && left.later?.[STEP]?.includes("Dashboards/Wide.md"), left)
      for (let i = 0; i < 50 && slowReads(0).includes(path.join(VAULT, "Dashboards/Wide.md")); i++) await sleep(100) // (iCloud gives it)
      await migrate(vault, false)
      check("migrations: and changed at the next start", fs.readFileSync(path.join(VAULT, "Dashboards/Wide.md"), "utf8") === "```base wide\nviews: []\n```\n"
        && !vault.readConfig("migrations")?.later, vault.readConfig("migrations"))
      if (had) vault.setConfig("migrations", had); else vault.removeConfig("migrations")
    } finally {
      fs.readFileSync = readSync
      fs.promises.readFile = readAsync
      Object.assign(iCloud, was)
      for (const rel of ["Notes/Phone.md", "Notes/Slow phone.md", "Dashboards/Desk.md", "Dashboards/Wide.md"]) fs.rmSync(path.join(VAULT, rel), { force: true })
      fs.rmSync(path.join(VAULT, ".vaultite/plugins/lighthouse"), { recursive: true, force: true })
    }
  }
  // A dashboard in /api/render: its title, then its text (no line of its own under the title).
  write("Dashboards/Sub.md", "---\ntype: dashboard\nicon: sun\n---\n\nText.\n")
  const [, sub] = await api("GET", "render?path=Dashboards/Sub.md")
  check("render: a dashboard is its title, then its text", sub.includes("# Sub\n\nText."), sub)
  fs.rmSync(path.join(VAULT, "Dashboards/Sub.md"))
}
