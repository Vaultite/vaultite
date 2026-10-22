// Who's signed in to a site, as its own pages ask it (electron/web.ts reads it with a set of logins' cookies): no
// Electron here, so tools/test_web.ts reads made-up answers with it.

/** Who's signed in to a site: the account's name, the others signed in beside it (Google's), its picture's address. */
export type Who = { account: string; more?: string[]; avatar?: string }
type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === "object" ? v as Json : {})
export const nonempty = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")

/** Sites whose account we know how to ask for: where (with the session's cookies; `page`: from an open page, for a site
 *  whose bot check only answers its pages), what names the account, and `with` sites the same login covers. */
export const ACCOUNTS: Record<string, {
  url: string; page?: true; text?: true; method?: "POST"; with?: Record<string, string>
  read: (body: unknown, cookie: (domain: string, name: string) => Promise<string>) => Who | string | null | Promise<Who | string | null>
}> = {
  "claude.ai": { url: "https://claude.ai/api/account", page: true, read: (b) => { const j = obj(b); return nonempty(j.email_address) || nonempty(obj(j.account).email_address) || nonempty(j.full_name) } },
  "chatgpt.com": { url: "https://chatgpt.com/api/auth/session", page: true, read: (b) => { const u = obj(obj(b).user); return { account: nonempty(u.email) || nonempty(u.name), avatar: nonempty(u.image) } } },
  // (the list Chrome asks for its own sign-in: every Google account signed in, the first the default one)
  "google.com": { url: "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard", method: "POST", text: true,
    with: { "youtube.com": "LOGIN_INFO" }, read: (b) => googleAccounts(String(b)) },
  "reddit.com": { url: "https://www.reddit.com/api/me.json", read: (b) => {
    const d = obj(obj(b).data), name = nonempty(d.name)
    return name ? { account: `u/${name}`, avatar: nonempty(d.icon_img).replace(/&amp;/g, "&") } : null
  } },
  "github.com": { url: "https://github.com/", text: true, read: (b) => {
    const login = /<meta name="user-login" content="([A-Za-z0-9-]{1,39})"/.exec(String(b))?.[1]
    return login ? { account: login, avatar: `https://github.com/${login}.png?size=64` } : null
  } },
  // (its page names the signed-in user among others: theirs is the one whose id the twid cookie has)
  "x.com": { url: "https://x.com/home", text: true, read: async (b, cookie) => {
    const id = /u%3D(\d+)|u=(\d+)/.exec(decodeURIComponent(await cookie("x.com", "twid")))?.slice(1).find(Boolean)
    if (!id) return null
    const html = String(b), at = html.indexOf(`"id_str":"${id}"`)
    if (at < 0) return null
    // (its fields, up to the next user's)
    const rest = html.slice(at + 10, at + 6000), own = rest.slice(0, (rest.indexOf('"id_str":"') + 1 || rest.length + 1) - 1)
    const name = /"screen_name":"(\w{1,15})"/.exec(own)?.[1]
    const pic = /"profile_image_url_https":"([^"]+)"/.exec(own)?.[1]?.replace(/\\\//g, "/")
    return name ? { account: `@${name}`, avatar: pic ?? "" } : null
  } },
}

/** Google's ListAccounts answer (JSON, or JSON inside the page it sometimes is): its accounts still signed in. */
export function googleAccounts(text: string): Who | null {
  const t = text.replace(/\\x22/g, '"').replace(/\\u0022/g, '"').replace(/\\\//g, "/")
  const at = t.indexOf('["gaia.l.a.r"')
  if (at < 0) return null
  let list: unknown
  try { list = JSON.parse(jsonEnd(t, at)) } catch { return null }
  const rows = Array.isArray(list) && Array.isArray(list[1]) ? list[1] as unknown[] : []
  const found = rows.flatMap((r) => {
    if (!Array.isArray(r) || r[0] !== "gaia.l.a") return []
    const email = nonempty(r[3])
    // ([14] is 1 for an account signed out but remembered)
    return email.includes("@") && r[14] !== 1 ? [{ email, photo: nonempty(r[4]) }] : []
  })
  if (!found.length) return null
  return { account: found[0].email, more: found.slice(1).map((f) => f.email), avatar: found[0].photo }
}
/** The JSON array starting at `at`, to its closing bracket. */
function jsonEnd(t: string, at: number) {
  let depth = 0, str = false
  for (let i = at; i < t.length; i++) {
    const c = t[i]
    if (str) { if (c === "\\") i++; else if (c === '"') str = false; continue }
    if (c === '"') str = true
    else if (c === "[") depth++
    else if (c === "]" && --depth === 0) return t.slice(at, i + 1)
  }
  return t.slice(at)
}

