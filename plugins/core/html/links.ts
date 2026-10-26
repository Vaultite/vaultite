// A page's links out of the app (its bridge's `open`): an address can carry what the page read of the vault, so once
// it read some, the user sees where it goes first.

/** The site to ask about before opening `url` (a web page's host, a mail's recipient), or null: the page read nothing
 *  of the vault yet, or the user said yes to that site already (`said`). */
export function askBeforeOpening(read: boolean, url: string, said: Set<string>): string | null {
  if (!read) return null
  let site = ""
  try { const u = new URL(url); site = u.protocol === "mailto:" ? decodeURIComponent(u.pathname) : u.host } catch { return url }
  return said.has(site) ? null : site
}
