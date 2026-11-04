// A site's own sign-in (HTTP Basic or Digest: a router, a NAS, a staging site): the user asked for a username and
// password over the page, as Chrome does, once extensions gave none. Chromium keeps what works for the session.
import { app, BrowserWindow, type AuthInfo, type AuthenticationResponseDetails, type WebContents } from "electron"
import { allPages, answerLogin, onLogin, webSessionMade, type Credentials } from "./engine.ts"
import { askSheet } from "./sheet.ts"

/** Questions on screen, by page and what asks: a page's several requests to one site ask once. */
const asking = new Map<string, Promise<Credentials | null>>()

function ask(wc: WebContents, details: AuthenticationResponseDetails, info: AuthInfo): Promise<Credentials | null> | undefined {
  const page = allPages().find((p) => p.wc === wc)
  // (an agent's page has nobody to ask: it's shown the site's 401, as without an answer)
  if (page && (!page.tab() || !page.visible())) return undefined
  const win = page?.win ?? BrowserWindow.fromWebContents(wc)
  if (!win || win.isDestroyed()) return undefined
  const where = `${info.host}${info.port && info.port !== 80 && info.port !== 443 ? `:${info.port}` : ""}`
  const key = `${wc.id} ${info.isProxy} ${where} ${info.realm}`
  let q = asking.get(key)
  if (!q) {
    const plain = /^http:/i.test(details.url) && !info.isProxy
    // (never the site's own words, its realm, as Chrome: a site could word it as someone else asking)
    const message = [info.isProxy ? `The proxy ${where} asks for a username and password.` : `${where} asks for a username and password.`,
      plain ? "Your connection to this site isn't private." : ""].filter(Boolean).join("\n")
    q = askSheet(win, { title: "Sign in", message, ok: "Sign in", until: wc,
      fields: [{ name: "username", label: "Username" }, { name: "password", label: "Password", password: true }] })
      .then((r) => (r ? { username: r.username, password: r.password } : null))
      .finally(() => asking.delete(key))
    asking.set(key, q)
  }
  return q
}
onLogin(ask, 10)
app.on("login", (e, wc, details, info, callback) => {
  if (!wc || !webSessionMade(wc.session)) return
  e.preventDefault()
  void answerLogin(wc, details, info).then((c) => (c ? callback(c.username, c.password) : callback()))
})
