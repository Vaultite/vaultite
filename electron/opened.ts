import { type BrowserWindowConstructorOptions, type WebContents, webContents } from "electron"

/** The page Chromium made for a window.open: Electron puts it in `createWindow`'s options, which its types leave out. */
export function openedPage(o: BrowserWindowConstructorOptions): WebContents {
  const made = "webContents" in o ? o.webContents : null, wc = webContents.getAllWebContents().find((c) => c === made)
  if (!wc) throw new Error("window.open's page isn't in its options")
  return wc
}
