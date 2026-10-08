// Vim in the core's keyboard lists (core/keylist.ts: j/k, h/l, gg/G) and the canvas (h/j/k/l pan); a motion answers
// whether it did something, else index.tsx scrolls the pane. Ctrl+W h/l moves into and out of the sidebars.
import { foldInList, inKeyList, moveInList, runCommandById, type PluginCommand } from "@vaultite"

/** A canvas board has the keyboard (not a card being edited: that's typing, which Vim's keys never see). */
const onCanvas = () => !!document.activeElement?.closest("[data-canvas-board]")
const canvas = (id: string) => { runCommandById(`canvas:${id}`); return true }

export const down = () => (inKeyList() ? moveInList(1) : onCanvas() ? canvas("pan-down") : false)
export const up = () => (inKeyList() ? moveInList(-1) : onCanvas() ? canvas("pan-up") : false)
export const left = () => (inKeyList() ? foldInList(false) : onCanvas() ? canvas("pan-left") : false)
export const right = () => (inKeyList() ? foldInList(true, true) : onCanvas() ? canvas("pan-right") : false)
export const top = () => (inKeyList() ? moveInList("first") : onCanvas() ? canvas("fit") : false)
export const bottom = () => (inKeyList() ? moveInList("last") : false)

/** Its own commands: none (the core's list, sidebar and canvas commands do the work). */
export const listCommands: PluginCommand[] = []
/** Keys it gives the app's commands, by id. */
export const listKeys: Record<string, string[]> = {
  "sidebar:focus-left": ["Space W E"],
  "sidebar:focus-right": ["Space W Shift+E"],
}
