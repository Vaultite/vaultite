import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, vault, write } = $
  // ---------- One file or setting can't take the vault down: a fill that throws, a link back up, a settings file that's null ----------
  {
  const person: Any = vault.kinds.find((k: Any) => k.type === "person")!
  Object.defineProperty(person, "fill", { value: () => { throw new Error("a plugin bug") }, configurable: true })
  write("People/Fill Bug.md", "---\ntype: person\n---\n\nMade up.\n")
  await vault.sync()
  let synced: unknown = null
  try { await vault.fillIn("People/Fill Bug.md", null); synced = true } catch (e) { synced = e }
  check("resilience: a kind's fill that throws doesn't fail the write", synced === true, String(synced))
  check("… the file is indexed, its problem said", vault.entries.get("People/Fill Bug.md")?.problems.some((x: string) => x.includes("couldn't fill in")), vault.entries.get("People/Fill Bug.md")?.problems)
  delete person.fill // (its class's again)
  fs.rmSync(path.join(VAULT, "People/Fill Bug.md"))

  fs.mkdirSync(path.join(VAULT, "Loop"), { recursive: true })
  write("Loop/Inside.md", "In the loop.\n")
  fs.symlinkSync("..", path.join(VAULT, "Loop/up"))
  fs.symlinkSync(".", path.join(VAULT, "Loop/self"))
  await vault.sync()
  const looped = [...vault.entries.keys()].filter((r) => r.startsWith("Loop/"))
  check("resilience: links back up a folder are walked once, not until paths are too long",
    looped.includes("Loop/Inside.md") && !looped.some((r) => r.startsWith("Loop/up/")) && !looped.some((r) => r.startsWith("Loop/self/self/")), looped)
  fs.rmSync(path.join(VAULT, "Loop"), { recursive: true, force: true })
  await vault.sync()

  const pj = path.join(VAULT, ".vaultite/plugins.json"), had = fs.existsSync(pj) ? fs.readFileSync(pj, "utf8") : null
  for (const bad of ["null", "\"terminal\"", "[1]"]) {
    fs.writeFileSync(pj, bad)
    vault.forgetConfig("plugins")
    const [st] = await api("GET", "state")
    check(`resilience: plugins.json that's ${bad}: the state still answers`, st === 200, st)
  }
  if (had === null) fs.rmSync(pj); else fs.writeFileSync(pj, had)
  await vault.sync()
  }
}
