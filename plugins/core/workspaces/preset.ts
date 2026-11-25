import { notify, revealPanel } from "@vaultite"
import { CODE, freeSlot } from "./code"
import { current, patch, slots, SLOTS, switchTo } from "./state"

export function newCodeWorkspace() {
  const n = freeSlot(SLOTS, (m) => !!slots()?.[m - 1], current())
  if (!n) return notify("All nine workspaces are in use: delete one to make a Code workspace")
  patch(n, CODE)
  switchTo(n)
  revealPanel("agents:agents")
}
