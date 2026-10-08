// Set up Vaultite's machine side (web/onboarding.html): where vaults go, Obsidian's vaults, and `vau` as a script running
// bin/vau with the app as Node, in ~/.local/bin (no password). No Electron: tools/test_setup.ts tests it.
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/** Where it looks and writes: a made-up home folder in tests and QA, never the user's. */
export type Where = {
  home: string
  /** The app's executable (run as Node) and its source folder (bin/vau). */
  exe: string
  root: string
  /** The app's userData (a vau of the app's own when ~/.local/bin has someone else's). */
  userData: string
  /** Variables the shim sets (VAULTITE_USER_DATA when the app runs with another). */
  env?: Record<string, string>
}

const MARK = "# vau, the Vaultite command, written by Set up Vaultite"
const exists = (p: string) => fs.existsSync(p)
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function writeAtomic(p: string, text: string, mode?: number) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.vaultite-${process.pid}.tmp`
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined)
  fs.renameSync(tmp, p)
}

// ---------- places ----------
/** iCloud Drive's folder (null when it's off) and Documents: where a new vault may go. */
export function places(w: Where) {
  const icloud = path.join(w.home, "Library", "Mobile Documents", "com~apple~CloudDocs")
  return { icloud: exists(icloud) ? icloud : null, documents: path.join(w.home, "Documents"), home: w.home }
}

/** Where Obsidian keeps its obsidian.json: a Mac's, then Linux's (its .deb or AppImage, Flatpak, Snap). */
const obsidianJson = (home: string) => [
  path.join(home, "Library", "Application Support", "obsidian", "obsidian.json"),
  path.join(home, ".config", "obsidian", "obsidian.json"),
  path.join(home, ".var", "app", "md.obsidian.Obsidian", "config", "obsidian", "obsidian.json"),
  path.join(home, "snap", "obsidian", "current", ".config", "obsidian", "obsidian.json"),
].find(exists)

/** Obsidian's vaults on this machine (its obsidian.json), last opened first; only folders that are there. */
export function obsidianVaults(w: Where): { path: string; name: string }[] {
  try {
    const j = JSON.parse(fs.readFileSync(obsidianJson(w.home) ?? "", "utf8"))
    const list = Object.values(j?.vaults ?? {}) as { path?: unknown; ts?: unknown }[]
    return list.filter((v) => typeof v?.path === "string" && fs.statSync(v.path, { throwIfNoEntry: false })?.isDirectory())
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
      .map((v) => ({ path: v.path as string, name: path.basename(v.path as string) }))
  } catch { return [] }
}

// ---------- vau ----------
const shimText = (w: Where) => [
  "#!/bin/sh",
  `${MARK} (${path.basename(w.exe)} runs it as Node). Safe to delete.`,
  ...Object.entries(w.env ?? {}).map(([k, v]) => `export ${k}=${quote(v)}`),
  `ELECTRON_RUN_AS_NODE=1 exec ${quote(w.exe)} ${quote(path.join(w.root, "bin", "vau"))} "$@"`,
  "",
].join("\n")

const ours = (p: string) => { try { return fs.readFileSync(p, "utf8").includes(MARK) } catch { return false } }
/** ~/.local/bin/vau, and the app's own when someone else's is there. */
const userBin = (w: Where) => path.join(w.home, ".local", "bin", "vau")
const appBin = (w: Where) => path.join(w.userData, "bin", "vau")

/** The folders on the user's PATH, as their login shell has it (the app's own PATH is launchd's). */
export function shellPath(w: Where): string[] {
  try {
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
    const out = execFileSync(shell, ["-ilc", "printf '\\n%s' \"$PATH\""], { env: { ...process.env, HOME: w.home }, timeout: 4000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out.split("\n").pop()!.split(":").filter(Boolean)
  } catch { return (process.env.PATH ?? "").split(":").filter(Boolean) }
}

export type VauStatus = { path: string | null; onPath: boolean; system: boolean
  /** A `vau` that isn't ours in ~/.local/bin, left as it is. */
  other: string | null }
/** Where our vau is (null: not installed) and whether typing `vau` in a terminal finds it. */
export function vauStatus(w: Where, dirs = shellPath(w)): VauStatus {
  const user = userBin(w), sys = "/usr/local/bin/vau"
  const other = exists(user) && !ours(user) ? user : null
  const at = !other && exists(user) ? user : exists(appBin(w)) && ours(appBin(w)) ? appBin(w) : null
  const system = ours(sys) // (a link to ours reads as ours)
  return { path: at, onPath: system || (!!at && dirs.includes(path.dirname(at))), system, other }
}

/** Write (or update) our vau. Returns where, and what was done. */
export function installVau(w: Where): { path: string; did: string } {
  const user = userBin(w)
  const target = exists(user) && !ours(user) ? appBin(w) : user
  const text = shimText(w)
  const same = (() => { try { return fs.readFileSync(target, "utf8") === text } catch { return false } })()
  if (!same) writeAtomic(target, text, 0o755)
  const where = target.startsWith(w.home + "/") ? `~${target.slice(w.home.length)}` : target
  return { path: target, did: same ? `vau is already at ${where}` : target === user ? `Wrote vau to ${where}` : `Wrote vau to ${where} (${tilde(w, user)} is another program's: left as it is)` }
}
const tilde = (w: Where, p: string) => (p.startsWith(w.home + "/") ? `~${p.slice(w.home.length)}` : p)

/** Link /usr/local/bin/vau to ours, as an administrator (macOS asks for the password; Linux, polkit's pkexec). Never
 *  over another program's. */
export function linkSystem(shim: string): Promise<void> {
  const sys = "/usr/local/bin/vau"
  if (fs.lstatSync(sys, { throwIfNoEntry: false }) && !ours(sys)) return Promise.reject(new Error(`${sys} is another program's: left as it is`))
  const script = `mkdir -p /usr/local/bin && ln -sf ${quote(shim)} ${sys}`
  if (process.platform !== "darwin") {
    // pkexec: 126 when the password dialog was dismissed, 127 when not allowed (or no polkit agent to ask).
    return new Promise((ok, fail) => execFile("pkexec", ["/bin/sh", "-c", script], (e) =>
      (e ? fail(new Error((e as { code?: unknown }).code === 126 ? "Cancelled" : (e as { code?: unknown }).code === "ENOENT" ? "pkexec isn't installed: run `sudo ln -sf " + shim + " " + sys + "`" : String(e.message))) : ok())))
  }
  return new Promise((ok, fail) => execFile("osascript", ["-e", `do shell script ${JSON.stringify(script)} with administrator privileges`],
    (e) => (e ? fail(new Error(/-128/.test(String(e)) ? "Cancelled" : String(e.message))) : ok())))
}
