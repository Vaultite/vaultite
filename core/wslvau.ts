import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { vauEntry } from "./appentry.ts"
import { writeAtomic } from "./vault.ts"
import { wslShim } from "./vaushims.ts"

const WSL_MARK = "vau for WSL, written by Vaultite: runs Windows' vau through WSL's interop. Safe to delete."

const wslVauDir = (env: Record<string, string | undefined> = process.env) =>
  path.win32.join(env.LOCALAPPDATA || path.win32.join(os.homedir(), "AppData", "Local"), "Vaultite", "wsl")

/** Writes vau for WSL (when it changed) running vau's entry (core/appentry.ts) with `exe` as Node (this process's by default:
 *  the app's executable or node.exe); returns its folder. */
export function writeWslVau(o: { exe?: string; dir?: string; env?: Record<string, string> } = {}): string {
  const dir = o.dir ?? wslVauDir()
  const env = o.env ?? (process.env.VAULTITE_USER_DATA ? { VAULTITE_USER_DATA: process.env.VAULTITE_USER_DATA } : {})
  const text = wslShim({ exe: o.exe ?? process.execPath, script: vauEntry(), env, mark: WSL_MARK })
  const file = path.join(dir, "vau")
  let was = ""
  try { was = fs.readFileSync(file, "utf8") } catch { /* not written yet */ }
  if (was !== text) writeAtomic(file, text, { mode: 0o755 })
  return dir
}

/** $1 is the Windows path: the script makes it WSL's itself, as a distro's mounts may not be /mnt. */
const DISTRO_INSTALL = `set -e
t=$(wslpath -u "$1")
f="$HOME/.local/bin/vau"
if [ -e "$f" ] && [ ! -L "$f" ] && ! grep -q 'written by Vaultite' "$f"; then echo "other $f"; exit 0; fi
mkdir -p "$HOME/.local/bin"
ln -sf "$t" "$f"
echo "linked $f"`

export type DistroResult = { distro: string; ok: boolean; did: string }

const wsl = (args: string[]) => new Promise<{ code: number; out: string }>((ok) =>
  execFile("wsl.exe", args, { timeout: 120_000, windowsHide: true, encoding: "utf8" }, (e, out, err) =>
    ok({ code: e ? Number((e as { code?: unknown }).code) || 1 : 0, out: `${out}${e ? err || e.message : ""}`.replace(/\0/g, "").trim() })))

export async function installInDistro(distro: string, dir = writeWslVau()): Promise<DistroResult> {
  const r = await wsl(["-d", distro, "-e", "sh", "-c", DISTRO_INSTALL, "sh", path.win32.join(dir, "vau")])
  const [what, ...rest] = r.out.split("\n").pop()!.split(" ")
  if (r.code || (what !== "linked" && what !== "other")) return { distro, ok: false, did: `couldn't: ${r.out || `wsl.exe exited ${r.code}`}` }
  if (what === "other") return { distro, ok: false, did: `${rest.join(" ")} is another program's: left as it is` }
  const found = (await wsl(["-d", distro, "-e", "sh", "-lc", "command -v vau"])).out.split("\n").pop()
  return { distro, ok: true, did: `linked ${rest.join(" ")}${found?.endsWith("/.local/bin/vau") ? "" : " (not on PATH in a login shell yet: add ~/.local/bin to PATH)"}` }
}
