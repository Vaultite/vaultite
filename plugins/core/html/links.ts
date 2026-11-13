
/** An absolute path (/x, Windows' C:/x, C:\x and \\server\x), never a vault one. */
export const outsideVault = (p: string) => /^(\/|[a-z]:[\\/]|\\\\)/i.test(p)

export function askBeforeOpening(page: string, url: string, said: Set<string>): string | null {
  if (outsideVault(page)) return null
  let site = ""
  try { const u = new URL(url); site = u.protocol === "mailto:" ? decodeURIComponent(u.pathname) : u.host } catch { return url }
  return said.has(site) ? null : site
}
