import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const PRELOAD = path.join(ROOT, "electron", "preload.cjs")
export const DIST = path.join(ROOT, "web", "dist")
export const ICON = path.join(ROOT, "web", "public", "icon-512.png")
export const MAC = process.platform === "darwin"
export const LINUX = process.platform === "linux"
export const WIN = process.platform === "win32"
