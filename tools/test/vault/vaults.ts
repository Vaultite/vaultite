import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { skip } from "../lib.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, write } = $
  // Manage vaults on the web (core/vaults.ts): a list on this machine, any folder but hidden and system ones.
  const vaultsMod = await import("../../../core/vaults.ts")
  const opened: string[] = [], own: (string | null)[] = []
  const home = os.homedir()
  const vh = (method: string, route: string, query: Record<string, string>, body: Record<string, unknown> = {}): Promise<Any> =>
    vaultsMod.handle(method, ["vaults", ...route.split("/").filter(Boolean)], query, body, VAULT, async (p) => { opened.push(p) }, (n) => { own.push(n) }).catch((e) => e)
  let vr: Any
  // (root's home, /root, is a system folder)
  if (vaultsMod.refused(home)) skip("vaults: home's folders, hidden ones left out", `home (${home}) is a system folder`)
  else {
    vr = await vh("GET", "folders", {})
    check("vaults: home's folders, hidden ones left out", vr.path === home && !vr.folders.some((f: Any) => f.name.startsWith(".")), vr)
  }
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
    // (not $TMPDIR: /var/tmp is a system folder; Windows' temp is in home's AppData, also refused: the drive's root)
    const outside = fs.mkdtempSync(process.platform === "darwin" ? "/private/tmp/vaults-" : process.platform === "win32"
      ? `${process.env.SystemDrive || "C:"}\\vaults-` : "/tmp/vaults-")
    vr = await vh("POST", "open", {}, { path: outside })
    check("vaults: a folder outside home opens", opened.at(-1) === outside, vr)
    vr = await vh("GET", "folders", { path: "/" })
    check("vaults: the root's folders can be browsed, system ones left out", vr.parent === null && !vr.folders.some((f: Any) => ["etc", "usr", "System"].includes(f.name)), vr)
    fs.rmSync(outside, { recursive: true })
  }
  vr = await vh("GET", "", {})
  check("vaults: the served one is listed", vr.current === VAULT && vr.vaults.some((v: Any) => v.path === VAULT), vr)
  {
    const file = path.join(process.env.VAULTITE_LOCAL!, "vaults.json"), was = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
    fs.writeFileSync(file, "{not json")
    vr = await vh("GET", "", {})
    check("vaults: a list that isn't JSON is none", vr.vaults.length === 1 && vr.vaults[0].path === VAULT && vaultsMod.current("/x") === "/x", vr)
    fs.writeFileSync(file, JSON.stringify({ current: 5, vaults: [{ path: 5 }, null, { path: "/elsewhere", name: "elsewhere" }] }))
    vr = await vh("GET", "", {})
    check("vaults: what in it isn't a vault is left out", vr.vaults.map((v: Any) => v.path).join() === `${VAULT},/elsewhere` && vaultsMod.current("/x") === "/x", vr)
    if (was === null) fs.rmSync(file); else fs.writeFileSync(file, was)
  }

  const N = { ...await import("../../../core/vaultname.ts"), ...await import("../../../core/nickname.ts") }
  check("vault names: two folders of one name show as much of their paths as tells them apart",
    N.listNames([{ path: "/code/areth/vault" }, { path: "/code/lighthouse/vault" }, { path: "/notes/Main" }]).join() === "areth/vault,lighthouse/vault,Main")
  check("vault names: two nicknames of one name too, after the nickname",
    N.listNames([{ path: "/code/areth/vault", nickname: "Docs" }, { path: "/code/lighthouse/vault", nickname: "Docs" }]).join() === "Docs · areth/vault,Docs · lighthouse/vault")
  check("vault names: a path that ends another's shows one folder more",
    N.listNames([{ path: "/a/vault" }, { path: "/b/a/vault" }]).join() === "a/vault,b/a/vault")
  check("vault names: a nickname is one line of text, else none",
    N.nicknameOf({ name: "  Areth \n docs " }) === "Areth docs" && N.nicknameOf({ name: 5 }) === "" && N.nicknameOf({}) === "" && N.vaultName("/code/areth/vault", "") === "vault")
  {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "vaults-named-")), dir = path.join(other, "vault")
    fs.mkdirSync(path.join(dir, ".vaultite"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".vaultite", "vault.json"), JSON.stringify({ name: "Lighthouse" }))
    const file = path.join(process.env.VAULTITE_LOCAL!, "vaults.json"), was = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
    fs.writeFileSync(file, JSON.stringify({ vaults: [{ path: VAULT }, { path: dir }] }))
    vr = await vh("GET", "", {})
    check("vault names: the list names another vault by its nickname", vr.vaults.find((v: Any) => v.path === dir)?.name === "Lighthouse", vr)
    check("vault names: nicknameAt reads none where there's no vault.json", await N.nicknameAt(other) === "")
    const kept = () => JSON.parse(fs.readFileSync(path.join(dir, ".vaultite", "vault.json"), "utf8"))
    fs.writeFileSync(path.join(dir, ".vaultite", "vault.json"), JSON.stringify({ name: "Lighthouse", later: 1 }))
    vr = await vh("PATCH", "", {}, { path: dir, nickname: "  Harbour\n notes " })
    check("nickname: another vault's is set in its own folder, the file's other keys kept", vr.vaults?.find((v: Any) => v.path === dir)?.nickname === "Harbour notes" && JSON.stringify(kept()) === '{"later":1,"name":"Harbour notes"}', [vr, kept()])
    vr = await vh("PATCH", "", {}, { path: dir, nickname: "   " })
    const cleared = vr.vaults?.find((v: Any) => v.path === dir)
    check("nickname: a blank one clears it, back to the folder's name", cleared?.name.split("/").at(-1) === "vault" && cleared.nickname === undefined && JSON.stringify(kept()) === '{"later":1}', [vr, kept()])
    vr = await vh("PATCH", "", {}, { path: dir, nickname: "vault" })
    check("nickname: the folder's own name is none", JSON.stringify(kept()) === '{"later":1}', kept())
    vr = await vh("PATCH", "", {}, { path: VAULT, nickname: "Lighthouse" })
    check("nickname: the served vault's goes through its own settings", own.join() === "Lighthouse", own)
    vr = await vh("PATCH", "", {}, { path: other, nickname: "Elsewhere" })
    check("nickname: none for a folder that isn't in the list", vr.status === 404 && !fs.existsSync(path.join(other, ".vaultite")), vr)
    fs.writeFileSync(path.join(dir, ".vaultite", "vault.json"), "{not json")
    vr = await vh("PATCH", "", {}, { path: dir, nickname: "Harbour" })
    check("nickname: a vault.json that can't be read is left as it is", vr instanceof Error && fs.readFileSync(path.join(dir, ".vaultite", "vault.json"), "utf8") === "{not json", vr)
    fs.writeFileSync(path.join(dir, ".vaultite", "sandbox.json"), "{}")
    vr = await vh("PATCH", "", {}, { path: dir, nickname: "Harbour" })
    check("nickname: none for a playground", vr.status === 400, vr)
    if (was === null) fs.rmSync(file); else fs.writeFileSync(file, was)
    fs.rmSync(other, { recursive: true })
  }
  const folder = path.basename(VAULT)
  let [, st] = await api("GET", "state")
  check("vault names: unnamed, the vault is its folder's name", st.vault.name === folder && st.vault.nickname === undefined, st.vault)
  await api("PATCH", "config/vault", { name: "Lighthouse" })
  ;[, st] = await api("GET", "state")
  check("vault names: with a nickname, the state names it so, its folder as it was", st.vault.name === "Lighthouse" && st.vault.nickname === "Lighthouse" && fs.existsSync(VAULT), st.vault)
  write(".vaultite/vault.json", JSON.stringify({ name: ["not", "text"] }))
  ;[, st] = await api("GET", "state")
  check("vault names: a name that isn't text is none", st.vault.name === folder, st.vault)
  await api("PATCH", "config/vault", { name: null })
  ;[, st] = await api("GET", "state")
  check("vault names: null goes back to the folder's name", st.vault.name === folder && st.vault.nickname === undefined, st.vault)
}
