// A chat's actions, the same in its header, its tab's menu and the phone's … menu: what its tab last knew of it.
import { Copy, Square, SquareTerminal } from "lucide-react"
import { confirmDialog, copyText, isViewOpen, notify, notifyError, onMachine, op, openAgent, openView, splitMachine, type MenuItem } from "@vaultite"
import { NEW } from "./titles"

export type Known = { ready: boolean; running: boolean; busy: boolean; tui: string | null; driven: boolean }
const known = new Map<string, Known>()
/** Its tab's view of it (ChatTab.tsx sets it as it changes; outside a tab, menus offer what needs nothing known). */
export const knowChat = (id: string, k: Known | null) => { if (k) known.set(id, k); else known.delete(id) }

/** It, in Claude Code in a terminal: its terminal when it runs in one, else resumed there (stopped here first). */
export async function toTerminal(id: string) {
  const k = known.get(id)
  if (k && !k.ready) return
  if (k?.tui) { const to = `terminal/${onMachine(k.tui, splitMachine(id)[1])}`; return openView(to, { newTab: !isViewOpen(to) }) }
  if (k?.busy) {
    const ok = await confirmDialog({ title: "Open it in a terminal?", body: "Claude is working on it here. Opening it in a terminal stops what it's doing; the conversation goes on there.", confirm: "Stop and open" })
    if (!ok) return
  }
  try {
    if (k?.running) await op("claude-code.chat-stop", { id })
    const [sid, machine] = splitMachine(id)
    await openAgent("claude", { resume: sid, machine, newTab: true })
  } catch (e) { notifyError(e, "Couldn't open it in a terminal") }
}

/** Whether it can go to a terminal: a plugin's session running here has tools no terminal serves. */
export const terminalOk = (id: string) => { const k = known.get(id); return !(k?.driven && k.running) }

export function chatMenu(id: string, { terminal = true }: { terminal?: boolean } = {}): MenuItem[] {
  if (!id || id === NEW) return []
  const k = known.get(id)
  return [
    ...(terminal && terminalOk(id) ? [{ label: k?.tui ? "Show terminal" : "Open in terminal", icon: SquareTerminal, disabled: k ? !k.ready : false, run: () => void toTerminal(id) }] : []),
    { label: "Copy session id", icon: Copy, run: () => void copyText(splitMachine(id)[0]).then(() => notify("Session id copied")) },
    ...(k?.running ? [{ label: "Stop session", icon: Square, sep: true, run: () => void op("claude-code.chat-stop", { id }).then(() => notify("Stopped: a message resumes it"), (err) => notifyError(err, "Couldn't stop it")) } satisfies MenuItem] : []),
  ]
}
