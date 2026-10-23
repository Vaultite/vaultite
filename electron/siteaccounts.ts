// Who's signed in to a site, as its own pages ask it (electron/web.ts reads it with a set of logins' cookies): no
// Electron here, so tools/test_web.ts reads made-up answers with it.

/** Who's signed in to a site: the account's name, the others signed in beside it (Google's), its picture's address. */
export type Who = { account: string; more?: string[]; avatar?: string }
type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === "object" ? v as Json : {})
export const nonempty = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")

/** X's sidebar in an open page: the profile link's handle and the account button's picture. */
const X_LOOK = `(() => { const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]'); const img = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img')
  return a ? { handle: (a.getAttribute("href") || "").slice(1), avatar: img ? img.src : "" } : null })()`

/** One site's way to say who's signed in, with a set of logins' own cookies. Only a name, handle or email: never a
 *  token or a cookie's secret. */
export type Rule = {
  /** A "who am I" address its own pages ask, read by `read`; `text`: a page, not JSON. */
  url?: string; text?: true; method?: "POST"
  /** The fixed headers its pages send with it (an app id), never a secret. */
  headers?: Record<string, string>
  /** Asked from an open page of the site when there is one, as its own scripts would. */
  page?: true
  /** The login's cookie, which alone says it's signed in (and that it's still the same login). */
  signed?: string
  /** Sites the same login covers, by its cookie there. */
  with?: Record<string, string>
  /** Read off an open page instead (`code` in a world of its own): who, false when plainly signed out, null unsure. */
  look?: { code: string; read: (v: unknown) => Who | false | null }
  /** Who the answer names (given the address it ended at), null for nobody. */
  read?: (body: unknown, cookie: (domain: string, name: string) => Promise<string>, url: string) => Who | string | null | Promise<Who | string | null>
}

/** A string at a dotted path of a JSON answer ("user.email"), or "". */
export const at = (v: unknown, path: string) => nonempty(path.split(".").reduce((o, k) => obj(o)[k], v))
/** "alice" → "@alice"; nothing for anything but a handle. */
const handle = (v: string, max = 30) => (new RegExp(`^[\\w.]{1,${max}}$`).test(v) ? `@${v}` : null)

/** WhatsApp Web: its chats (the number it's linked to, as it keeps it), or the QR code to link it. */
const WHATSAPP_LOOK = `(() => { if (document.querySelector("#pane-side")) return { phone: String(localStorage.getItem("last-wid-md") || "") }
  return document.querySelector("[data-ref] canvas") ? { out: true } : null })()`

/** Sites whose account we know how to ask for, by site ("ycombinator.com" for news.ycombinator.com), each tested in
 *  tools/test_web.ts. Never discord.com: running anything in its pages (a look, a page fetch) signs you out. */
export const ACCOUNTS: Record<string, Rule> = {
  "claude.ai": { url: "https://claude.ai/api/account", page: true, signed: "sessionKey", read: (b) => at(b, "email_address") || at(b, "account.email_address") || at(b, "full_name") },
  "chatgpt.com": { url: "https://chatgpt.com/api/auth/session", page: true, read: (b) => ({ account: at(b, "user.email") || at(b, "user.name"), avatar: at(b, "user.image") }) },
  "perplexity.ai": { url: "https://www.perplexity.ai/api/auth/session", page: true, read: (b) => at(b, "user.email") || at(b, "user.username") },
  // (the list Chrome asks for its own sign-in: every Google account signed in, the first the default one)
  "google.com": { url: "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard", method: "POST", text: true,
    signed: "SID", with: { "youtube.com": "SID", "google.*": "SID" }, read: (b) => googleAccounts(String(b)) },
  "reddit.com": { url: "https://www.reddit.com/api/me.json", page: true, read: (b) => {
    const name = at(b, "data.name")
    return name ? { account: `u/${name}`, avatar: at(b, "data.icon_img").replace(/&amp;/g, "&") } : null
  } },
  "github.com": { url: "https://github.com/", text: true, signed: "user_session", read: (b) => {
    const login = /<meta name="user-login" content="([A-Za-z0-9-]{1,39})"/.exec(String(b))?.[1]
    return login ? { account: login, avatar: `https://github.com/${login}.png?size=64` } : null
  } },
  // (its API takes the web session's cookie)
  "gitlab.com": { url: "https://gitlab.com/api/v4/user", read: (b) => ({ account: at(b, "username"), avatar: at(b, "avatar_url") }) },
  // (its page names the signed-in user among others: theirs is the one whose id the twid cookie has; its bot check
  // often turns that away, so an open page's sidebar says it too)
  "x.com": { url: "https://x.com/home", text: true, signed: "auth_token", look: { code: X_LOOK, read: xLooked }, read: async (b, cookie) => {
    const id = /u%3D(\d+)|u=(\d+)/.exec(decodeURIComponent(await cookie("x.com", "twid")))?.slice(1).find(Boolean)
    if (!id) return null
    const html = String(b), i = html.indexOf(`"id_str":"${id}"`)
    if (i < 0) return null
    // (its fields, up to the next user's)
    const rest = html.slice(i + 10, i + 6000), own = rest.slice(0, (rest.indexOf('"id_str":"') + 1 || rest.length + 1) - 1)
    const name = /"screen_name":"(\w{1,15})"/.exec(own)?.[1]
    const pic = /"profile_image_url_https":"([^"]+)"/.exec(own)?.[1]?.replace(/\\\//g, "/")
    return name ? { account: `@${name}`, avatar: pic ?? "" } : null
  } },
  // (its web app's id, as its pages send it)
  "instagram.com": { url: "https://www.instagram.com/api/v1/accounts/edit/web_form_data/", headers: { "x-ig-app-id": "936619743392459" }, signed: "sessionid",
    read: (b) => handle(at(b, "form_data.username")) },
  // (any page of its has the user it's for; c_user, the login's user id, says which)
  "facebook.com": { url: "https://www.facebook.com/settings/", text: true, page: true, signed: "c_user", read: async (b, cookie) => facebookName(String(b), await cookie("facebook.com", "c_user")) },
  // (/in/me/ takes you to your own profile: its address names you)
  "linkedin.com": { url: "https://www.linkedin.com/in/me/", text: true, signed: "li_at", read: (_b, _c, url) => {
    const slug = decodeURIComponent(/linkedin\.com\/in\/([^/?#]+)/.exec(url)?.[1] ?? "")
    return slug && slug !== "me" && /^[\p{L}\p{N}_-]{3,100}$/u.test(slug) ? slug : null
  } },
  "whatsapp.com": { look: { code: WHATSAPP_LOOK, read: (v) => looked(v, (o) => phoneOf(nonempty(o.phone))) } },
  "cloudflare.com": { url: "https://dash.cloudflare.com/api/v4/user", headers: { "x-cross-site-security": "dash" }, signed: "vses2", read: (b) => at(b, "result.email") },
  "cursor.com": { url: "https://cursor.com/api/auth/me", signed: "WorkosCursorSessionToken", read: (b) => ({ account: at(b, "email"), avatar: at(b, "picture") }) },
  // An Apple Account (developer.apple.com's, App Store Connect's): the session App Store Connect's pages ask for
  "apple.com": { url: "https://appstoreconnect.apple.com/olympus/v1/session", signed: "myacinfo", read: (b) => at(b, "user.emailAddress") || at(b, "user.fullName") },
  "wikipedia.org": { url: "https://en.wikipedia.org/w/api.php?action=query&meta=userinfo&format=json", read: (b) => {
    const u = obj(obj(obj(b).query).userinfo)
    return Number(u.id) > 0 && !("anon" in u) ? nonempty(u.name) || null : null // (signed out, it names your IP address)
  } },
  // Hacker News: its login cookie is "<name>&<hash>"
  "ycombinator.com": { signed: "user", read: async (_b, cookie) => /^[\w-]{2,15}(?=&)/.exec(await cookie("news.ycombinator.com", "user"))?.[0] ?? null },
}

/** What a look found: signed out, can't tell, or who (its name as `name` makes it, "" when it doesn't say). */
function looked(v: unknown, name: (o: Json) => string | null): Who | false | null {
  if (!v || typeof v !== "object") return null
  const o = v as Json
  return o.out ? false : { account: name(o) ?? "" }
}

/** WhatsApp's own id for the number ("5511987654321:12@c.us", maybe quoted) → "+5511987654321". */
export function phoneOf(wid: string) {
  const n = /^"?(\d{8,15})[:@]/.exec(wid)?.[1]
  return n ? `+${n}` : ""
}

/** Facebook's page: the name of the user it's for, if that's `id` (its c_user cookie). */
export function facebookName(html: string, id: string) {
  const i = html.indexOf('"CurrentUserInitialData"')
  if (i < 0 || !/^\d+$/.test(id)) return null
  const data = html.slice(i, i + 3000)
  if (/"USER_ID":"(\d+)"/.exec(data)?.[1] !== id) return null
  const name = /"NAME":"((?:[^"\\]|\\.)+)"/.exec(data)?.[1]
  try { return name ? nonempty(JSON.parse(`"${name}"`)) || null : null } catch { return null }
}

/** Whether `site` is one a `with` key names. */
export const covers = (key: string, site: string) => key.endsWith(".*") ? site.startsWith(key.slice(0, -1)) && site !== `${key.slice(0, -2)}.com` : site === key

/** What X_LOOK found. */
export function xLooked(v: unknown): Who | null {
  const o = obj(v), handle = nonempty(o.handle)
  return /^\w{1,15}$/.test(handle) ? { account: `@${handle}`, avatar: nonempty(o.avatar) } : null
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

