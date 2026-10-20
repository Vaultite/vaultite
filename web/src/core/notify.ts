// Toasts: one line that goes away by itself, one action at most. The one toast system
// (sonner), in the plugin API; agents reach it with `vau notify`.
import { toast } from "sonner"
import { plainError, plainText, sentence } from "../../../core/plainerror.ts"
import { runCommandById } from "@/core/commands"
import { noteAppError } from "@/core/errors"

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

/** Past this a toast's text is cut: the CSS shows 3 lines (4 on phones), and a whole log in the DOM helps no one. */
const MAX = 400
const short = (text: string) => text.length > MAX ? `${text.slice(0, MAX - 1).trimEnd()}…` : text

/** Show a toast. Returns its id (dismissNotice closes it early). */
export function notify(text: string, opts: NotifyOptions = {}) {
  const { action, kind, id } = opts
  const duration = opts.duration ?? (action ? 8000 : kind === "error" ? 6000 : 4000)
  const data = {
    id, duration,
    action: action && {
      label: action.label,
      onClick: () => {
        Promise.resolve().then(action.run).catch((e) => notifyError(e, `Couldn't ${action.label.toLowerCase()}`))
      },
    },
  }
  return kind === "error" ? toast.error(short(text), data) : toast(short(text), data)
}

/** Close a toast before its time. */
export const dismissNotice = (id: string | number) => { toast.dismiss(id) }

/** An error the user is told of: its reason in plain words, or none (a bug): then it's kept in Errors (the server keeps
 *  its own, a 5xx) and that's the toast's Details. */
function said(e: unknown) {
  const p = plainError(e)
  const status = Number((e as { status?: unknown })?.status) || 0
  if (p.bug && status < 500) noteAppError("shown", e)
  return p
}

/** An error as a toast, `what` saying what failed ("Couldn't rename it"): "Couldn't rename it: the disk is full", or,
 *  for a bug, just `what` with Details (Errors, where its text is kept). */
export function notifyError(e: unknown, what?: string, opts: Pick<NotifyOptions, "action" | "id" | "duration"> = {}) {
  const { reason, bug } = said(e)
  const text = reason ? (what ? `${what}: ${reason}` : sentence(reason)) : what ?? "Something went wrong"
  const action = opts.action ?? (bug ? { label: "Details", run: () => { runCommandById("errors:open") } } : undefined)
  return notify(text, { ...opts, kind: "error", action })
}

/** Just the reason, to follow "Couldn't …: ", or null for a bug (kept in Errors). */
export const errorReason = (e: unknown) => said(e).reason

/** An error as a line of a page or a form (plainText), a bug kept in Errors. */
export function errorText(e: unknown, what?: string) {
  said(e)
  return plainText(e, what)
}
