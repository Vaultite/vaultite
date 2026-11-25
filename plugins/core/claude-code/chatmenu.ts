import { Copy, Square, SquareTerminal } from "lucide-react"
import { confirmDialog, copyText, isViewOpen, notify, notifyError, onMachine, op, openView, scopedState, splitMachine, type MenuItem } from "@vaultite"
import { NEW } from "./titles"
import { handOff } from "./handoff"
import { HARNESSES } from "./harness"

export type Known = { ready: boolean; running: boolean; busy: boolean; tui: string | null; driven: boolean }
const known = new Map<string, Known>()
export const knowChat = (id: string, k: Known | null) => { if (k) known.set(id, k); else known.delete(id) }

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
    await handOff(HARNESSES.claude, sid, { machine })
  } catch (e) { notifyError(e, "Couldn't open it in a terminal") }
}

export const terminalOk = (id: string) => { const k = known.get(id); return !(k?.driven && k.running) }

const inPlace = (): MenuItem => {
  const picks = scopedState<{ checkout?: "current" }>("claude-code:chat", {}), on = picks.get().checkout === "current"
  return { label: "Run in current checkout", checked: on, run: () => picks.set({ ...picks.get(), checkout: on ? undefined : "current" }) }
}

export function chatMenu(id: string, { terminal = true }: { terminal?: boolean } = {}): MenuItem[] {
  if (id === NEW) return [inPlace()]
  if (!id) return []
  const k = known.get(id)
  return [
    ...(terminal && terminalOk(id) ? [{ label: k?.tui ? "Show terminal" : "Open in terminal", icon: SquareTerminal, disabled: k ? !k.ready : false, run: () => toTerminal(id) }] : []),
    { label: "Copy session id", icon: Copy, run: () => copyText(splitMachine(id)[0]).then(() => notify("Session id copied")) },
    ...(k?.running ? [{ label: "Stop session", icon: Square, sep: true, run: () => op("claude-code.chat-stop", { id }).then(() => notify("Stopped: a message resumes it"), (err) => notifyError(err, "Couldn't stop it")) } satisfies MenuItem] : []),
  ]
}
