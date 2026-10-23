import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, check } = $
  // Manage vaults on the web (core/vaults.ts): a list on this machine, any folder but hidden and system ones.
  const vaultsMod = await import("../../../core/vaults.ts")
  const opened: string[] = []
  const home = os.homedir()
  const vh = (method: string, route: string, query: Record<string, string>, body: Record<string, unknown> = {}): Promise<Any> =>
    vaultsMod.handle(method, ["vaults", ...route.split("/").filter(Boolean)], query, body, VAULT, async (p) => { opened.push(p) }).catch((e) => e)
  let vr = await vh("GET", "folders", {})
  check("vaults: home's folders, hidden ones left out", vr.path === home && !vr.folders.some((f: Any) => f.name.startsWith(".")), vr)
  vr = await vh("GET", "folders", { path: path.join(home, ".ssh") })
  check("vaults: a hidden folder can't be browsed", vr.status === 403 || vr.status === 404, vr)
  vr = await vh("POST", "open", {}, { path: home })
  check("vaults: home itself can't be a vault", vr.status === 403 && !opened.length, vr)
  vr = await vh("POST", "open", {}, { path: process.platform === "win32" ? process.env.SystemRoot || "C:\\Windows" : "/etc" })
  check("vaults: never a system folder", vr.status === 403 && !opened.length, vr)
  vr = await vh("POST", "open", {}, { path: "/" })
  check("vaults: nor the root folder", vr.status === 403 && !opened.length, vr)
  vr = await vh("POST", "open", {}, { path: path.join(home, "Library") })
  check("vaults: nor ~/Library", (vr.status === 403 || (vr.status === 404 && !fs.existsSync(path.join(home, "Library")))) && !opened.length, vr) // (none on Linux)
  check("vaults: a drive, a cloud drive and a folder outside home can be", ["/Volumes/Drive/Notes", "/run/media/alice/Drive/Notes",
    "/mnt/data/Notes", path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Notes")].every((p) => vaultsMod.refused(p, { vault: true }) === null))
  {
    const outside = fs.mkdtempSync(process.platform === "darwin" ? "/private/tmp/vaults-" : path.join(os.tmpdir(), "vaults-"))
    vr = await vh("POST", "open", {}, { path: outside })
    check("vaults: a folder outside home opens", opened.at(-1) === outside, vr)
    vr = await vh("GET", "folders", { path: "/" })
    check("vaults: the root's folders can be browsed, system ones left out", vr.parent === null && !vr.folders.some((f: Any) => ["etc", "usr", "System"].includes(f.name)), vr)
    fs.rmSync(outside, { recursive: true })
  }
  vr = await vh("GET", "", {})
  check("vaults: the served one is listed", vr.current === VAULT && vr.vaults.some((v: Any) => v.path === VAULT), vr)
}
