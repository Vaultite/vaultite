// What a page's bridge lets out of the vault: an address it opens can carry what it read, so the user sees where it goes
// first; and its reads stay in the vault.

/** An absolute path (/x, Windows' C:/x, C:\x and \\server\x), never a vault one: a file the desktop app opened, or a
 *  page from outside the vault, which is given nothing of it. */
export const outsideVault = (p: string) => /^(\/|[a-z]:[\\/]|\\\\)/i.test(p)

/** The site to ask about before `page` opens `url` (a host, a mail's recipient), or null: the page is outside the vault,
 *  or the user said yes to it (`said`). A vault page is given the owner's name and what it kept: it has read the vault. */
export function askBeforeOpening(page: string, url: string, said: Set<string>): string | null {
  if (outsideVault(page)) return null
  let site = ""
  try { const u = new URL(url); site = u.protocol === "mailto:" ? decodeURIComponent(u.pathname) : u.host } catch { return url }
  return said.has(site) ? null : site
}
