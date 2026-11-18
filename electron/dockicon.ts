import { app, nativeImage } from "electron"
import fs from "node:fs"
import path from "node:path"
import { ICON, MAC } from "./mainbase.ts"

// Never the bundle's icon: changing the bundle breaks its signature and updates.
export const DOCK_ICON = () => path.join(app.getPath("userData"), "dock-icon.png")
export function applyDockIcon() {
  if (!MAC || !app.dock) return
  if (fs.existsSync(DOCK_ICON())) app.dock.setIcon(DOCK_ICON())
  else if (!app.isPackaged && fs.existsSync(ICON)) app.dock.setIcon(ICON)
  else app.dock.setIcon(nativeImage.createEmpty())
}
