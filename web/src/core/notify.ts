// Toasts: one line that goes away by itself, one action at most. The one toast system
// (sonner), in the plugin API; agents reach it with `vau notify`.
import { toast } from "sonner"

export type NotifyOptions = {
  /** One button: "Undo", "Open". A run that throws shows its error as another toast. */
  action?: { label: string; run: () => unknown }
  /** An error: a red icon, and it stays a little longer. */
  kind?: "error"
  /** ms; about 4 s by default, longer with an action or for an error. */
  duration?: number
  /** A toast with the same id replaces it instead of stacking another (a message that repeats). */
  id?: string
}

const message = (e: unknown) => String((e as Error)?.message ?? e)

/** Show a toast. Returns its id (dismissNotice closes it early). */
export function notify(text: string, opts: NotifyOptions = {}) {
  const { action, kind, id } = opts
  const duration = opts.duration ?? (action ? 8000 : kind === "error" ? 6000 : 4000)
  const data = {
    id, duration,
    action: action && {
      label: action.label,
      onClick: () => {
        Promise.resolve().then(action.run).catch((e) => notify(message(e), { kind: "error" }))
      },
    },
  }
  return kind === "error" ? toast.error(text, data) : toast(text, data)
}

/** Close a toast before its time. */
export const dismissNotice = (id: string | number) => { toast.dismiss(id) }

/** An error as a toast: `notify(message, {kind: "error"})` for a caught exception, with what was being done. */
export const notifyError = (e: unknown, what?: string) => notify(what ? `${what}: ${message(e)}` : message(e), { kind: "error" })
