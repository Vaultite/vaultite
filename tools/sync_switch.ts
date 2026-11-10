// The planned stop that moves a vault off iCloud onto device sync (plugins/core/sync), one machine at a time, with its
// way back. Run with this machine's server stopped.   node tools/sync_switch.ts <hashes|move|join|back> ...
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const [cmd, ...rest] = process.argv.slice(2)
const opt = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined }
const flag = (k: string) => rest.includes(`--${k}`)
const home = (p?: string) => (p ? path.resolve(p.replace(/^~(?=\/|$)/, os.homedir())) : undefined)
const say = (s: string) => console.log(s)
const die = (s: string): never => { console.error(`sync switch: ${s}`); process.exit(1) }
const dry = flag("dry")
const UNSYNCED = (rel: string) => rel.split("/").some((p) => p === ".git" || p === "node_modules" || p === ".Trash" || p === ".trash") ||
  /(^|\/)(\.DS_Store|Icon\r|\._[^/]*|[^/]*\.icloud|[^/]*\.sync-part)$/.test(rel)

/** Every synced file's sha-256, by NFC path, sorted: the same list on two machines means the same vault. */
function hashes(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name), rel = path.relative(root, abs).split(path.sep).join("/").normalize("NFC")
      if (UNSYNCED(rel)) continue
      if (d.isDirectory()) walk(abs)
      else if (d.isFile()) out.set(rel, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"))
    }
  }
  walk(root)
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)))
}
const listText = (m: Map<string, string>) => [...m].map(([p, h]) => `${h}  ${p}`).join("\n") + "\n"
function differences(a: Map<string, string>, b: Map<string, string>) {
  const out: string[] = []
  for (const [p, h] of a) if (b.get(p) !== h) out.push(b.has(p) ? `differs: ${p}` : `only in the first: ${p}`)
  for (const p of b.keys()) if (!a.has(p)) out.push(`only in the second: ${p}`)
  return out
}

const listening = (port: number) => new Promise<boolean>((ok) => {
  const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); ok(true) }); s.once("error", () => ok(false))
})
/** iCloud Drive has nothing left to send or bring (macOS): what's in the folder is what's everywhere. */
function iCloudIdle(): boolean {
  if (process.platform !== "darwin") return true
  try {
    const line = execFileSync("brctl", ["status", "com.apple.CloudDocs"], { encoding: "utf8", timeout: 30_000 }).split("\n").find((l) => l.includes("com.apple.CloudDocs")) ?? ""
    return /client:idle/.test(line) && /caught-up/.test(line)
  } catch { return false }
}
const vaultIdOf = (root: string) => { try { return String(JSON.parse(fs.readFileSync(path.join(root, ".vaultite/plugins/machines/vault.json"), "utf8")).id ?? "") } catch { return "" } }

type Switch = { at: string; from?: string; to: string; id: string; link?: string; linkWas?: string; plist?: string; plistWas?: string; unit?: string; unitWas?: string }
const setsFile = (local: string) => path.join(local, "sync", "sets.json")
const record = (local: string) => path.join(local, "sync", "switch.json")
function writeSets(local: string, change: (sets: Record<string, unknown>[]) => Record<string, unknown>[]) {
  let sets: Record<string, unknown>[] = []
  try { sets = JSON.parse(fs.readFileSync(setsFile(local), "utf8")).sets ?? [] } catch { /* none yet */ }
  const next = change(sets)
  if (dry) return say(`would write ${setsFile(local)}: ${JSON.stringify(next)}`)
  fs.mkdirSync(path.dirname(setsFile(local)), { recursive: true })
  if (fs.existsSync(setsFile(local))) fs.copyFileSync(setsFile(local), `${setsFile(local)}.before-switch`)
  fs.writeFileSync(setsFile(local), JSON.stringify({ sets: next }, null, 2) + "\n")
}
/** Point the vault link (~/.vaultite/vault), the launchd plist or the systemd unit at `to`, keeping what they said. */
function repoint(sw: Switch, to: string) {
  const link = home(opt("link")), plist = home(opt("plist")), unit = home(opt("unit"))
  if (link) {
    sw.link = link
    try { sw.linkWas = fs.readlinkSync(link) } catch { /* none */ }
    if (!dry) { fs.mkdirSync(path.dirname(link), { recursive: true }); fs.rmSync(link, { force: true }); fs.symlinkSync(to, link) }
    say(`${dry ? "would point" : "pointed"} ${link} at ${to}`)
  }
  if (plist) {
    sw.plist = plist
    sw.plistWas = execFileSync("plutil", ["-extract", "EnvironmentVariables.VAULTITE_VAULT", "raw", plist], { encoding: "utf8" }).trim()
    if (!dry) { fs.copyFileSync(plist, `${plist}.before-switch`); execFileSync("plutil", ["-replace", "EnvironmentVariables.VAULTITE_VAULT", "-string", to, plist]) }
    say(`${dry ? "would set" : "set"} VAULTITE_VAULT in ${plist} to ${to}`)
  }
  if (unit) {
    sw.unit = unit
    const text = fs.readFileSync(unit, "utf8"), m = /^Environment="VAULTITE_VAULT=([^"]*)"$/m.exec(text)
    sw.unitWas = m?.[1]
    if (!dry) { fs.copyFileSync(unit, `${unit}.before-switch`); fs.writeFileSync(unit, m ? text.replace(m[0], `Environment="VAULTITE_VAULT=${to}"`) : text.replace("[Service]\n", `[Service]\nEnvironment="VAULTITE_VAULT=${to}"\n`)) }
    say(`${dry ? "would set" : "set"} VAULTITE_VAULT in ${unit} to ${to} (systemctl --user daemon-reload)`)
  }
}

async function main() {
  const local = home(opt("local")), to = home(opt("to")), from = home(opt("from")), port = Number(opt("port") || 8793)
  if (cmd === "hashes") {
    const dir = home(rest[0]) ?? die("which folder? node tools/sync_switch.ts hashes <folder>")
    return void process.stdout.write(listText(hashes(dir)))
  }
  if (cmd === "move" || cmd === "join") {
    if (!local || !to) die("say --local <the server's data folder> and --to <the vault's new folder>")
    if (!flag("no-port-check") && await listening(port)) die(`a server answers on ${port}: stop it first (the switch moves the folder it serves)`)
    if (fs.existsSync(to!) && fs.readdirSync(to!).filter((n) => n !== ".DS_Store").length) die(`${to} isn't empty: the switch makes it`)
    const sw: Switch = { at: new Date().toISOString(), to: to!, id: "" }
    if (cmd === "move") {
      if (!from || !fs.existsSync(from)) die("say --from <the vault's folder now>")
      sw.from = from
      sw.id = vaultIdOf(from!) || die(`${from} has no vault id (.vaultite/plugins/machines/vault.json)`)
      if (!flag("no-icloud-wait")) {
        say("waiting for iCloud Drive to be idle…")
        for (let i = 0; !iCloudIdle(); i++) { if (i > 120) die("iCloud Drive is still busy after 10 minutes: try again"); await new Promise((r) => setTimeout(r, 5000)) }
      }
      const before = hashes(from!)
      say(`${before.size} files in ${from}`)
      const against = home(opt("against"))
      if (against) {
        const theirs = new Map(fs.readFileSync(against, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(66), l.slice(0, 64)] as [string, string]))
        const diff = differences(before, theirs)
        if (diff.length) die(`the other machine's list differs (${diff.length}):\n${diff.slice(0, 20).join("\n")}`)
        say("the other machine's hash list matches")
      }
      if (!dry) {
        fs.mkdirSync(path.dirname(to!), { recursive: true })
        fs.mkdirSync(path.join(local!, "sync"), { recursive: true })
        // (Windows has no cp: CI's Git Bash puts one on PATH, a user's machine doesn't)
        if (process.platform === "darwin") execFileSync("cp", ["-c", "-R", from!, to!])
        else if (process.platform === "win32") fs.cpSync(from!, to!, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
        else execFileSync("cp", ["-a", from!, to!])
        const after = hashes(to!), diff = differences(before, after)
        if (diff.length) { fs.rmSync(to!, { recursive: true, force: true }); die(`the copy differs (${diff.length}), removed:\n${diff.slice(0, 20).join("\n")}`) }
        fs.writeFileSync(path.join(local!, "sync", `hashes-${sw.at.slice(0, 10)}.txt`), listText(after), { flag: "w" })
      }
      say(`${dry ? "would copy" : "copied"} ${from} to ${to} (APFS clone: no space until files change)`)
    } else {
      sw.id = opt("vault") ?? die("say --vault <the vault's id> (a machine without the vault gets it from the others)")
      if (!dry) {
        fs.mkdirSync(path.join(to!, ".vaultite/plugins/machines"), { recursive: true })
        fs.writeFileSync(path.join(to!, ".vaultite/plugins/machines/vault.json"), JSON.stringify({ id: sw.id }, null, 2) + "\n")
      }
      say(`${dry ? "would make" : "made"} ${to}: the vault comes from the others once the server starts`)
    }
    const device = opt("device") ?? die("say --device <this machine's id in Machines>")
    const copy = home(opt("copy")), git = home(opt("git"))
    writeSets(local!, (sets) => [...sets.filter((s) => s.id !== sw.id && s.id !== `${sw.id}-shadow`),
      { id: sw.id, folder: to, device, ...(copy ? { copy } : {}), ...(git ? { git } : {}) }])
    repoint(sw, to!)
    if (!dry) fs.writeFileSync(record(local!), JSON.stringify(sw, null, 2) + "\n")
    return say(`done${dry ? " (dry run: nothing changed)" : ""}: start the server; the vault is ${to}. The way back: node tools/sync_switch.ts back --local ${local}`)
  }
  if (cmd === "back") {
    if (!local) die("say --local <the server's data folder>")
    let sw: Switch
    try { sw = JSON.parse(fs.readFileSync(record(local!), "utf8")) } catch { return die(`no switch recorded in ${record(local!)}`) }
    if (!flag("no-port-check") && await listening(port)) die(`a server answers on ${port}: stop it first`)
    writeSets(local!, (sets) => sets.filter((s) => s.id !== sw.id))
    if (sw.link && sw.linkWas && !dry) { fs.rmSync(sw.link, { force: true }); fs.symlinkSync(sw.linkWas, sw.link) }
    if (sw.plist && sw.plistWas && !dry) execFileSync("plutil", ["-replace", "EnvironmentVariables.VAULTITE_VAULT", "-string", sw.plistWas, sw.plist])
    if (sw.unit && !dry) {
      const text = fs.readFileSync(sw.unit, "utf8")
      fs.writeFileSync(sw.unit, sw.unitWas ? text.replace(/^Environment="VAULTITE_VAULT=[^"]*"$/m, `Environment="VAULTITE_VAULT=${sw.unitWas}"`) : text.replace(/^Environment="VAULTITE_VAULT=[^"]*"\n/m, ""))
    }
    if (!dry) fs.renameSync(record(local!), `${record(local!)}.undone-${Date.now()}`)
    return say(`${dry ? "would undo" : "undone"}: the vault is ${sw.linkWas ?? sw.plistWas ?? sw.unitWas ?? sw.from} again (its sync stopped; ${sw.to} is left as it is). Start the server.`)
  }
  die("node tools/sync_switch.ts hashes <folder> | move --from <dir> --to <dir> --local <dir> --device <id> [--copy <dir>] [--git <dir>] [--link <path>] [--plist <file>] [--unit <file>] [--against <hashes>] [--dry] | join --to <dir> --vault <id> --local <dir> --device <id> | back --local <dir>")
}
await main()
