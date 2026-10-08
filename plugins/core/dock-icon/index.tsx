// The Dock icon: try another picture in the desktop app's Dock, drawn on Apple's icon grid and kept by the main
// process on this Mac until reset. Nothing in the vault.
import { ImageIcon, ImageUp } from "lucide-react"
import { definePlugin, dockIcon, notify, notifyError, rawUrl } from "@vaultite"

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)$/i
/** Apple's icon grid: a 1024 px icon's art is 824 px, centred; the rest is the Dock's margin around every icon. */
const GRID = 1024, ART = 824

/** Whether a picture of the user's is in the Dock now (asked once, then kept as it's changed). Asked on first use, never
 *  as the module loads: the bundle may run this before `dockIcon` itself is defined, and the app would fail to start. */
let custom = false, asked = false
function isCustom() {
  if (!asked) { asked = true; void dockIcon()?.custom().then((c) => { custom = c }, () => {}) }
  return custom
}

/** An image (any address an <img> takes) as a PNG data: URL on the icon grid, keeping its proportions. */
async function onGrid(src: string) {
  const img = new Image()
  img.src = src
  await img.decode()
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1 // an SVG may have no size
  const w = ratio >= 1 ? ART : ART * ratio, h = ratio >= 1 ? ART / ratio : ART
  const c = document.createElement("canvas")
  c.width = c.height = GRID
  c.getContext("2d")!.drawImage(img, (GRID - w) / 2, (GRID - h) / 2, w, h)
  return c.toDataURL("image/png")
}

async function apply(src: string, name: string) {
  const dock = dockIcon()
  if (!dock) return
  try {
    await dock.set(await onGrid(src))
    custom = true
    notify(`${name} is the Dock icon`, { action: { label: "Reset", run: () => void reset() } })
  } catch (e) { notifyError(e, "Couldn't set the Dock icon") }
}

async function reset() {
  try { await dockIcon()?.set(null); custom = false } catch (e) { notifyError(e, "Couldn't reset the Dock icon") }
}

async function pick() {
  const src = await dockIcon()?.pick().catch(() => null)
  if (src) await apply(src, "The image")
}

export default definePlugin({
  icon: ImageIcon,
  fileMenu: (path) => (dockIcon() && IMAGE.test(path)
    ? [{ label: "Use as Dock icon", icon: ImageUp, section: "more", run: () => void apply(rawUrl(path), path.split("/").pop()!) }]
    : []),
  commands: [
    { id: "dock-icon:pick", name: "Set Dock icon from a file…", when: () => !!dockIcon(), run: () => void pick() },
    { id: "dock-icon:reset", name: "Reset Dock icon", when: () => !!dockIcon() && isCustom(), run: () => void reset() },
  ],
})
