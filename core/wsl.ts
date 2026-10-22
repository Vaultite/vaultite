// Windows' WSL, from the Windows side: its distros, and paths between the two (C:\x is /mnt/c/x there; a distro's own
// files are \\wsl.localhost\<distro>\... here). Pure but for distros(), so both sides and the tests share it.
import { execFile } from "node:child_process"

/** WSL's distros on this machine, the default first (none off Windows, or without WSL). Docker Desktop's are its own. */
export function distros(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([])
  return new Promise((ok) => execFile("wsl.exe", ["--list", "--quiet"], { encoding: "buffer", timeout: 5000, windowsHide: true }, (e, out) =>
    ok(e ? [] : distroList(out))))
}

/** `wsl --list --quiet`'s output (UTF-16, one distro a line) as names. */
export function distroList(out: Buffer): string[] {
  const text = out.includes(0) ? out.toString("utf16le") : out.toString("utf8")
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.replace(/\0/g, "").trim()).filter((l) => l && !/^docker-desktop/.test(l))
}

/** A Windows path as WSL sees it: C:\x is /mnt/c/x, \\wsl.localhost\<distro>\x (or \\wsl$\...) is /x in that distro;
 *  null for one it can't reach (another distro's, a network share). */
export function toWsl(p: string, distro?: string): string | null {
  const drive = /^([a-z]):(?:[\\/](.*))?$/i.exec(p)
  if (drive) return `/mnt/${drive[1].toLowerCase()}${drive[2] ? `/${drive[2].replace(/\\/g, "/")}` : ""}`.replace(/\/+$/, "") || "/"
  const unc = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i.exec(p)
  if (unc && (!distro || unc[1].toLowerCase() === distro.toLowerCase())) return `/${(unc[2] ?? "").replace(/\\/g, "/")}`.replace(/(.)\/+$/, "$1")
  return null
}

/** A WSL path (absolute) as Windows sees it: /mnt/c/x is C:\x, the rest is \\wsl.localhost\<distro>\... */
export function fromWsl(p: string, distro: string): string {
  const drive = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(p)
  if (drive) return `${drive[1].toUpperCase()}:\\${(drive[2] ?? "").replace(/\//g, "\\")}`
  return `\\\\wsl.localhost\\${distro}${p.replace(/\//g, "\\")}`.replace(/\\$/, "")
}
