// vau inside WSL, for a Vaultite on Windows: one script on the Windows side (wslVauDir) that every distro runs, put
// first on PATH by Vaultite's WSL terminals and linked from a distro's ~/.local/bin by `vau wsl install`.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { wslShim } from "./vaushims.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const WSL_MARK = "vau for WSL, written by Vaultite: runs Windows' vau through WSL's interop. Safe to delete."

/** The folder holding vau for WSL, a Windows path (in WSL: wslpath -u, or core/wsl.ts' toWsl). */
const wslVauDir = (env: Record<string, string | undefined> = process.env) =>
  path.win32.join(env.LOCALAPPDATA || path.win32.join(os.homedir(), "AppData", "Local"), "Vaultite", "wsl")

/** Writes vau for WSL (when it changed) running this checkout's bin/vau with `exe` as Node (this process's by default:
 *  the app's executable or node.exe); returns its folder. */
export function writeWslVau(o: { exe?: string; dir?: string; env?: Record<string, string> } = {}): string {
  const dir = o.dir ?? wslVauDir()
  const env = o.env ?? (process.env.VAULTITE_USER_DATA ? { VAULTITE_USER_DATA: process.env.VAULTITE_USER_DATA } : {})
  const text = wslShim({ exe: o.exe ?? process.execPath, script: path.join(ROOT, "bin", "vau"), env, mark: WSL_MARK })
  const file = path.join(dir, "vau")
  let was = ""
  try { was = fs.readFileSync(file, "utf8") } catch { /* not written yet */ }
  if (was !== text) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${file}.tmp`, text, { mode: 0o755 })
    fs.renameSync(`${file}.tmp`, file)
  }
  return dir
}

/** In a distro: ~/.local/bin/vau a link to vau for WSL (never over another program's), then whether a login shell finds
 *  it. The script gets the Windows path as $1 and makes it WSL's itself (its mounts may not be /mnt). */
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

/** Puts vau in a distro (writing vau for WSL first); what was done, in words. */
export async function installInDistro(distro: string, dir = writeWslVau()): Promise<DistroResult> {
  const r = await wsl(["-d", distro, "-e", "sh", "-c", DISTRO_INSTALL, "sh", path.win32.join(dir, "vau")])
  const [what, ...rest] = r.out.split("\n").pop()!.split(" ")
  if (r.code || (what !== "linked" && what !== "other")) return { distro, ok: false, did: `couldn't: ${r.out || `wsl.exe exited ${r.code}`}` }
  if (what === "other") return { distro, ok: false, did: `${rest.join(" ")} is another program's: left as it is` }
  const found = (await wsl(["-d", distro, "-e", "sh", "-lc", "command -v vau"])).out.split("\n").pop()
  return { distro, ok: true, did: `linked ${rest.join(" ")}${found?.endsWith("/.local/bin/vau") ? "" : " (not on PATH in a login shell yet: add ~/.local/bin to PATH)"}` }
}
