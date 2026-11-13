import { foldInList, inKeyList, moveInList, runCommandById, type PluginCommand } from "@vaultite"

const onCanvas = () => !!document.activeElement?.closest("[data-canvas-board]")
const canvas = (id: string) => { runCommandById(`canvas:${id}`); return true }

export const down = () => (inKeyList() ? moveInList(1) : onCanvas() ? canvas("pan-down") : false)
export const up = () => (inKeyList() ? moveInList(-1) : onCanvas() ? canvas("pan-up") : false)
export const left = () => (inKeyList() ? foldInList(false) : onCanvas() ? canvas("pan-left") : false)
export const right = () => (inKeyList() ? foldInList(true, true) : onCanvas() ? canvas("pan-right") : false)
export const top = () => (inKeyList() ? moveInList("first") : onCanvas() ? canvas("fit") : false)
export const bottom = () => (inKeyList() ? moveInList("last") : false)

export const listCommands: PluginCommand[] = []
export const listKeys: Record<string, string[]> = {
  "sidebar:focus-left": ["Space W E"],
  "sidebar:focus-right": ["Space W Shift+E"],
}
