import fs from "node:fs"

export const INHERITED = "VAULTITE_INHERITED_FDS"
const CLOEXEC = 0o2000000

const linkOf = (fd: number) => {
  try { return fs.readlinkSync(`/proc/self/fd/${fd}`) } catch { return "" }
}
const keepsOnExec = (fd: number) => {
  try { return (parseInt(/^flags:\s*(\d+)/m.exec(fs.readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"))?.[1] ?? "0", 8) & CLOEXEC) === 0 } catch { return false }
}
const closable = (link: string) => /^(socket|pipe):\[\d+\]$/.test(link) || link.startsWith("/")

export function heldPastExec(firstFree = 4): string {
  if (process.platform !== "linux") return ""
  let fds: number[] = []
  try { fds = fs.readdirSync("/proc/self/fd").map(Number).filter((n) => n >= firstFree) } catch { return "" }
  return fds.filter(keepsOnExec).map((fd) => [fd, linkOf(fd)] as const).filter(([, link]) => closable(link))
    .map(([fd, link]) => `${fd} ${link}`).join("\n")
}

export function closeInherited(listed: string) {
  for (const line of listed.split("\n")) {
    const at = line.indexOf(" "), fd = Number(line.slice(0, at)), link = line.slice(at + 1)
    if (at > 0 && fd > 3 && closable(link) && linkOf(fd) === link) fs.closeSync(fd)
  }
}
