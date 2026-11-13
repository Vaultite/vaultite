/** The sign-in `url` asks for, if it's one (an OAuth or OpenID Connect authorization request, SAML's, OpenID 2's): its
 *  identity provider's host, and where it answers (`back`: the site signed in to; "" when it doesn't say). */
export function signInOf(url: string): { host: string; back: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null
  const q = u.searchParams, host = u.hostname.toLowerCase()
  if (q.get("client_id") && (q.has("redirect_uri") || q.has("response_type"))) return { host, back: web(q.get("redirect_uri")) }
  if (q.has("SAMLRequest")) return { host, back: "" }
  if (q.get("openid.mode") === "checkid_setup") return { host, back: web(q.get("openid.return_to")) }
  return null
}
const web = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : "")
