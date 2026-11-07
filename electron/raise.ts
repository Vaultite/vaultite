// A tab held over another of a vault's windows (web core/windows.ts): that one to the front, the keyboard left where
// the drag is unless `focus` (it took the tabs). Loaded the first time a drag needs it.
import type { WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"

/** Window `popout` (its pop-out id; null: the vault's window, `pages`' first) to the front: whether it came. */
export function raise(pages: WebContents[], popout: unknown, focus: boolean) {
  const pid = (wc: WebContents) => URL.parse(wc.getURL())?.searchParams.get("popout") ?? null
  const page = popout === null ? pages[0] : pages.find((wc) => !wc.isDestroyed() && pid(wc) === popout)
  const win = page && !page.isDestroyed() ? AppWindow.fromWebContents(page) : null
  if (!win || win.isMinimized()) return false
  if (focus) win.focus(); else win.moveTop()
  return true
}
