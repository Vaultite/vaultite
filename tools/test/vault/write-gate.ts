import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check } = $
  // The write gate (core/writegate.ts): the user's own writes always pass; a plugin acting on its own writes outside
  // .vaultite/ only where it's granted, refused and told otherwise; timers it starts keep acting as it.
  {
    const { Vault, writeAtomic } = await import("../../../core/vault.ts")
    const { byUser, onItsOwn, WriteRefused } = await import("../../../core/writegate.ts")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-gate-"))
    const gv = new Vault(dir), told: string[] = []
    gv.mayWrite = (id, rel) => id === "recaps" && rel.startsWith("Recaps/")
    gv.writeRefused = (id, rel) => { told.push(`${id}:${rel}`) }
    const w = (rel: string) => { try { writeAtomic(path.join(dir, rel), "x"); return true } catch (e) { if (e instanceof WriteRefused) return false; throw e } }
    check("write gate: the user's own write passes", w("Notes/a.md") && byUser(() => w("Notes/b.md")))
    check("write gate: a plugin on its own, no grant: refused, nothing written, told", !onItsOwn("other", () => w("Notes/c.md")) && !fs.existsSync(path.join(dir, "Notes/c.md")) && told.join() === "other:Notes/c.md", told)
    check("write gate: ...but .vaultite/ is the app's own", onItsOwn("other", () => w(".vaultite/plugins/other/data.json")))
    check("write gate: with a grant, where it's granted only", onItsOwn("recaps", () => w("Recaps/2026-10-09.md")) && !onItsOwn("recaps", () => w("Notes/d.md")))
    check("write gate: the core's own work isn't a plugin's", onItsOwn("core", () => w("Notes/e.md")))
    const late = await onItsOwn("other", () => new Promise<boolean>((r) => setTimeout(() => r(w("Notes/later.md")), 1)))
    check("write gate: a timer a plugin started acts as it", !late && !fs.existsSync(path.join(dir, "Notes/later.md")))
    check("write gate: a request inside it is the user's", onItsOwn("other", () => byUser(() => w("Notes/f.md"))))
    const { writesProblems } = await import("../../../core/rules.ts")
    check("write gate: a manifest's writes is checked", !writesProblems({ writes: [{ folder: "Recaps", why: "a recap" }, { file: "AGENTS.md", why: "a line" }] }).length &&
      [[{ folder: ".vaultite/x", why: "x" }], [{ folder: "A" }], [{ folder: "A", file: "B", why: "x" }], [{ folder: "../up", why: "x" }], { folder: "A", why: "x" }]
        .every((writes) => writesProblems({ writes }).length === 1))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
