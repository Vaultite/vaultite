// Site styles: each site's own CSS from the vault (the Browser's sites/<site>.css), with the vault's look as variables,
// in its frames before their first paint (sitestyles-preload.cjs) and again, without a reload, whenever either changes.
import { ipcMain, type Session } from "electron"
import { AppWindow } from "../appwindow.ts"
import { fileURLToPath } from "node:url"
import { eachPage, eachSession, handle, type EnginePage } from "./engine.ts"

const PRELOAD = fileURLToPath(new URL("./sitestyles-preload.cjs", import.meta.url))

type Style = { site: string; css: string }
/** What a window's vault has: the look's variables (a `:root` rule) and its sites' styles. */
type Choice = { vars: string; styles: Style[] }
const choices = new Map<number, Choice>()
let lastChoice: Choice = { vars: "", styles: [] }
/** A window's; pages outside one (a sign-in popup) follow the last told. */
const choiceOf = (win?: AppWindow | null) => (win && choices.get(win.id)) || lastChoice

const pages = new Map<number, EnginePage>() // by their contents' id
eachPage((p) => {
  const id = p.wc.id
  pages.set(id, p)
  p.wc.once("destroyed", () => pages.delete(id))
})
const sessions = new Set<Session>()
eachSession((s) => {
  sessions.add(s)
  s.registerPreloadScript({ type: "frame", filePath: PRELOAD })
})

/** The stylesheet of a frame at `url`: the styles of the sites it's on (a subdomain's after its site's, so it wins), in
 *  a layer so their !important beats the page's own; "" when none is. */
function sheetFor(c: Choice, url: string) {
  let host = ""
  try {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:") return ""
    host = u.hostname.toLowerCase().replace(/^www\./, "")
  } catch { return "" }
  const css = c.styles.filter((s) => host === s.site || host.endsWith(`.${s.site}`)).sort((a, b) => a.site.length - b.site.length).map((s) => s.css)
  return css.length ? `@layer vaultite-style {\n${c.vars}\n${css.join("\n")}\n}` : ""
}

// (sync: the preload adds it before the page's first paint; returnValue answers as it's set, once)
ipcMain.on("vaultite:sitestyles:frame", (e, url) => {
  e.returnValue = typeof url === "string" && sessions.has(e.sender.session) ? sheetFor(choiceOf(pages.get(e.sender.id)?.win), url) : ""
})

/** The vault's site styles and look (the app's sitestyles.ts): the window's pages show the change at once. */
handle("sitestyles:set", (win, x) => {
  const o = (x && typeof x === "object" ? x : {}) as { vars?: unknown; styles?: unknown }
  const vars = typeof o.vars === "string" && o.vars.length <= 20_000 ? o.vars : ""
  const styles = (Array.isArray(o.styles) ? o.styles : []).filter((s): s is Style => !!s && typeof s.site === "string"
    && /^[a-z0-9.-]+$/.test(s.site) && typeof s.css === "string" && s.css.length <= 1_000_000).slice(0, 500)
  const c: Choice = { vars, styles }
  const id = win.id, was = choices.get(id)
  if (was && JSON.stringify(was) === JSON.stringify(c)) return
  if (!was) win.once("closed", () => choices.delete(id))
  choices.set(id, lastChoice = c)
  for (const p of pages.values()) if (p.win === win && !p.wc.isDestroyed()) {
    for (const fr of p.wc.mainFrame.framesInSubtree) {
      try { if (/^https?:/i.test(fr.url)) fr.send("vaultite:sitestyles:css", sheetFor(c, fr.url)) } catch { /* a frame going away */ }
    }
  }
})
