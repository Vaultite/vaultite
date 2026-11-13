import { app, shell } from "electron"
import { AppWindow } from "./appwindow.ts"
import { allPages, engineCall, engineLoaded, handle, mayOpen, pageKept, partitionOf, setOpener } from "./browser/engine.ts"
import { openElsewhere } from "./browser/default.ts"
import { shown } from "./pagespot.ts"
import { PASSED, RAISE } from "./stack.ts"
import { claim, letGo, MOVE_MS, tabGone, tabMoved, unmoved } from "./webpages.ts"
import fs from "node:fs"
import path from "node:path"
import { FIND, hostOfUrl, PAGE_HTML, RECT, siteOf, SITES } from "./webwire.ts"
import { loadDownloads, mine, pages, pagesChanged, profileOf, sessions, shows, stateOf, str, tabOf, tell, web } from "./webbase.ts"
import { keysOf } from "./webkeys.ts"
import { looks } from "./webpaint.ts"
import { readySession, readyView, webSession } from "./websession.ts"
import { hostIcon, loadIcons, staleIcons } from "./webicons.ts"
import { forgetSite, sitesOf, whoIn } from "./webaccounts.ts"
import { moveLogins, sealLogin } from "./weblogins.ts"
import { pointer, raise } from "./webstack.ts"
import { keyboardFrom, place, stow } from "./webspot.ts"
import { fromPlayer, leaveFull, toPlayer } from "./webplayer.ts"
import { end, keepPast, moveTo, own, restore, trim } from "./weblife.ts"
import { go } from "./webgo.ts"
import { make } from "./webpage.ts"

setOpener(async (win, url, profile) => {
  await engineLoaded()
  if (!shows(url)) throw new Error("only http and https pages")
  await readySession(profile)
  if (!mayOpen(profile)) throw new Error("this container is locked")
  const p = make(win as AppWindow, url, profile, "", { agent: true, ready: await readyView(profile) })
  pagesChanged(p.win)
  return allPages().find((x) => x.id === p.id)!
})
handle("web:adopt", (win, id, tab) => {
  const p = pages.get(Number(id)), to = tabOf(tab)
  if (!p || p.win !== win || p.closing || !to || p.agent) throw new Error("that page is gone")
  p.orphan = undefined
  own(p, to)
  if (p.downloaded) tell(p.win, { type: "close", tab: to })
})

let cloudLoaded: Promise<ReturnType<typeof import("./cloud.ts").cloudHandlers>> | null = null
const cloudNow = () => (cloudLoaded ??= import("./cloud.ts").then(({ cloudHandlers }) => cloudHandlers({
  page: (profile, site) => [...pages.values()].find((p) => p.profile === profile && !p.view.webContents.isDestroyed() && siteOf(hostOfUrl(p.view.webContents.getURL())) === site)?.view.webContents,
  session: readySession,
  used: (profile) => sessions.has(profile) || fs.existsSync(path.join(app.getPath("userData"), "Partitions", partitionOf(profile).replace(/^persist:/, ""))),
  tell, profileOf,
})))
const cloud = {
  "web:cloud": async (win: AppWindow, want: unknown) => (await cloudNow())["web:cloud"](win, want),
  "web:cloud-act": async (win: AppWindow, action: unknown, id: unknown, value: unknown) => (await cloudNow())["web:cloud-act"](win, action, id, value),
}

const closedTabs = new WeakMap<AppWindow, Map<string, number>>()
export const webHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  "web:open": async (win, url, rect, profile, tab) => {
    const asked = Date.now()
    await Promise.all([engineLoaded(), restore()])
    const u = str(url), prof = profileOf(profile), owner = tabOf(tab)
    if (!shows(u)) throw new Error("only http and https pages")
    await readySession(prof)
    if (!mayOpen(prof)) throw new Error("this container is locked")
    if (owner && (closedTabs.get(win)?.get(owner) ?? 0) >= asked) throw new Error("its tab closed")
    const { reuse, end: other } = claim(pages.values(), win, owner, prof)
    for (const x of other) { keepPast(x); end(x) }
    const p = reuse ?? make(win, u, prof, owner)
    if (p.win !== win) moveTo(p, win)
    p.holds++
    p.orphan = undefined
    pagesChanged(win)
    const r = RECT.safeParse(rect).data ?? null, wasHidden = !shown(p.spot)
    place(p, r)
    let focused = false
    if (r && wasHidden && shown(p.spot)) { focused = !!p.hadFocus; p.hadFocus = false }
    return { id: p.id, state: stateOf(p), focused }
  },
  "web:frame": async (win, tab, url, profile) => {
    const m = await restore(), t = tabOf(tab), f = m.frameFor(t, str(url), profileOf(profile))
    if (!f || [...pages.values()].some((p) => p.win === win && p.tab === t && !p.closing && !p.fresh)) return null
    return m.readFrame(t, f)
  },
  "web:titles": async () => (await restore()).pastTitles(),
  "web:place": (win, id, rect) => {
    const p = mine(win, id), r = mayOpen(p.profile) ? RECT.safeParse(rect).data ?? null : null, wasHidden = !shown(p.spot)
    place(p, r)
    if (r && wasHidden && shown(p.spot)) { const had = !!p.hadFocus; p.hadFocus = false; return { focused: had, shown: true } }
    return { focused: false, shown: shown(p.spot) }
  },
  "web:take": (win) => {
    const p = [...pages.values()].find((x) => x.win === win && x.view.webContents.isFocused())
    if (p) win.webContents.focus()
    const from = p?.id ?? keyboardFrom.get(win) ?? null
    keyboardFrom.delete(win)
    return from
  },
  "web:look": (win, color) => {
    const c = str(color)
    if (!/^#[0-9a-f]{6}$/i.test(c)) return
    looks.set(win, c)
    for (const p of pages.values()) if (p.win === win && p.fresh) p.view.setBackgroundColor(c)
  },
  "web:raise": (win, how) => raise(win, RAISE.parse(how)),
  "web:pointer": (win, id, m) => { const e = PASSED.safeParse(m); if (e.success) pointer(mine(win, id), e.data) },
  "web:release": (win, id) => {
    const p = pages.get(Number(id))
    if (!p || p.win !== win) return
    if (letGo(p, Date.now())) return end(p)
    if (p.holds) return
    p.want = null
    if (p.full && !p.player) leaveFull(p)
    if (!p.player) stow(p)
    void trim()
    pagesChanged(win)
  },
  "web:player": (win, id, on, fullScreen) => { const p = mine(win, id); if (on) return toPlayer(p, fullScreen === true); fromPlayer(p, true) },
  "web:close": (win, tab, moved) => {
    if (moved !== true) {
      const closed = closedTabs.get(win) ?? new Map<string, number>()
      closedTabs.set(win, closed)
      if (tabOf(tab)) closed.set(tabOf(tab), Date.now())
      for (const [t, at] of closed) if (Date.now() - at > 60_000) closed.delete(t)
      for (const p of pages.values()) if (p.win === win && p.tab && p.tab === tabOf(tab) && pageKept(p.id)) void engineCall(win, "agents:own", [p.id, ""]).catch(() => {})
      for (const p of tabGone(pages.values(), win, tabOf(tab))) end(p)
      return
    }
    tabMoved(pages.values(), win, tabOf(tab), Date.now())
    setTimeout(() => { for (const p of unmoved(pages.values(), Date.now())) end(p) }, MOVE_MS + 100).unref()
  },
  "web:go": (win, id, action, url) => go(mine(win, id), str(action), typeof url === "string" ? url : undefined),
  "web:find": (win, id, text, o) => {
    const wc = mine(win, id).view.webContents, t = str(text).slice(0, 1000), x = FIND.parse(o)
    if (!t) { wc.stopFindInPage("keepSelection"); return null }
    return wc.findInPage(t, { forward: x.forward !== false, findNext: x.next !== true, matchCase: x.matchCase === true })
  },
  "web:shot": async (win, id) => {
    const p = mine(win, id)
    if (!shown(p.spot)) return null
    const img = await p.view.webContents.capturePage()
    return img.isEmpty() ? null : img.toJPEG(90)
  },
  "web:html": async (win, id) => {
    const p = mine(win, id)
    // In a world of its own: the page's scripts can't stand in for what's read.
    const r = await p.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: "({ url: location.href, title: document.title, html: '<!doctype html>' + document.documentElement.outerHTML })" }])
    return PAGE_HTML.parse(r)
  },
  "web:external": (_win, url) => { const u = str(url); if (web(u)) openElsewhere(u); else if (/^mailto:/i.test(u)) void shell.openExternal(u) },
  "web:keys": (win, steps) => { keysOf.set(win, new Set(Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string") : [])) },
  "web:list": (win) => [...pages.values()].filter((p) => p.win === win && !p.closing)
    .map((p) => ({ id: p.id, profile: p.profile, tab: p.tab, shown: p.holds > 0, ...stateOf(p) })),
  "web:sites": (_win, profile) => sitesOf(profileOf(profile)),
  "web:who": (_win, site, profiles) => whoIn(str(site), Array.isArray(profiles) ? profiles.map(profileOf).filter(Boolean).slice(0, 40) : []),
  "web:forget": async (_win, profile, site) => forgetSite(profileOf(profile), str(site).toLowerCase()),
  "web:move": (_win, from, to, sites, copy) => moveLogins(profileOf(from), profileOf(to),
    SITES.parse(sites), copy === true),
  "web:seal": (_win, from, sites, to, key) => sealLogin(profileOf(from), SITES.parse(sites), profileOf(to), str(key)),
  ...cloud,
  "web:icons": (_win, hosts) => {
    const all = loadIcons(), keys = (Array.isArray(hosts) ? hosts : []).slice(0, 500).filter((h): h is string => typeof h === "string")
    for (const h of keys) if (!h.includes("/") && /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$|^localhost(:\d+)?$/i.test(h) && (!all.has(h) || staleIcons.has(h))) void hostIcon(webSession(""), h)
    return Object.fromEntries(keys.map((h) => [h, all.get(h) ?? ""]))
  },
  "web:engine": (win, name, ...args) => engineCall(win, name, args),
  "web:reveal": (_win, p) => {
    const file = path.resolve(str(p))
    if (path.dirname(file) === app.getPath("downloads") && fs.existsSync(file)) shell.showItemInFolder(file)
  },
  "web:downloads": async () => (await loadDownloads()).downloads(),
  "web:download": async (_win, id, what) => {
    const m = await loadDownloads()
    return typeof id === "number" ? m.act(id, str(what)) : what === "clear" ? (m.clearDownloads(), true) : what === "folder" ? (m.openDownloadsFolder(), true) : false
  },
}
