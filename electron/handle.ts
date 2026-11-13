import { ipcMain, type IpcMainInvokeEvent } from "electron"
import { pathToFileURL } from "node:url"
import { appPage } from "./apppermissions.ts"
import { DIST } from "./mainbase.ts"
import { popouts, type Win, wins } from "./servers.ts"
import { manager } from "./vaultwindow.ts"

export function who(e: IpcMainInvokeEvent): Win | null {
  const url = e.senderFrame?.url ?? ""
  for (const w of wins.values()) if (w.win.webContents === e.sender && appPage(url, `http://127.0.0.1:${w.port}`)) return w
  const pop = popouts.get(e.sender)
  if (pop && appPage(url, `http://127.0.0.1:${pop.port}`)) return pop
  if (manager && e.sender === manager.webContents && url.startsWith(pathToFileURL(DIST).href)) return null
  throw new Error("not a Vaultite window")
}
const MAIN_ONLY = new Map<string, [] | undefined>([["app:ready", []], ["menu:sync", undefined]])
export function handle(name: string, fn: (w: Win | null, ...args: never[]) => unknown) {
  ipcMain.handle(name, (e, ...args) => {
    const w = who(e)
    if (MAIN_ONLY.has(name) && popouts.has(e.sender)) return MAIN_ONLY.get(name)
    return fn(w, ...(args as never[]))
  })
}
export const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
export const folderName = (x: unknown) => str(x).replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()
