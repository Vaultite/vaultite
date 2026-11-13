import { ipcMain, type WebContents } from "electron"
import { handle } from "./browser/engine.ts"
import { CONTAINER, MENUS } from "./webwire.ts"
import { pageOf, pages, profileOf, tell, web } from "./webbase.ts"

export let menus: { containers: { id: string; name: string }[]; glance: boolean } = { containers: [], glance: false }
export const tellGlance = (wc: WebContents) => { if (!wc.isDestroyed()) wc.send("vaultite:web:glance", menus.glance) }
handle("web:menus", (_win, m) => {
  const o = MENUS.parse(m)
  const containers = o.containers.flatMap((x) => { const c = CONTAINER.safeParse(x); return c.success && profileOf(c.data.id) ? [{ id: c.data.id, name: c.data.name.slice(0, 80) }] : [] }).slice(0, 50)
  const glance = o.glance === true, changed = glance !== menus.glance
  menus = { containers, glance }
  if (changed) for (const p of pages.values()) tellGlance(p.view.webContents)
})
ipcMain.on("vaultite:web:glance", (e, url) => {
  const p = pageOf(e.sender)
  if (p && !p.agent && menus.glance && e.senderFrame === e.sender.mainFrame && typeof url === "string" && web(url)) {
    tell(p.win, { type: "open", id: p.id, tab: p.tab, url, profile: p.profile, how: "glance" })
  }
})
