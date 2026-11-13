import { toast } from "sonner"
import { plainError, plainText, sentence } from "../../../core/plainerror.ts"
import { isObj } from "../../../core/values.ts"
import { announce } from "@/core/announce"
import { keyHint, runCommandById } from "@/core/commands"
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

const MAX = 400
const short = (text: string) => text.length > MAX ? `${text.slice(0, MAX - 1).trimEnd()}…` : text

// sonner's own key to the newest toast's button.
export const TOAST_KEYS = "Alt+T"

/** The toasts shown lately, newest last: what an agent asks after its command (`vau command`), and the companion when
 *  the user points at one that's gone. */
export type Notice = { text: string; kind?: "error"; at: number }
const shown: Notice[] = []
const KEPT_MS = 120_000
/** Toasts shown since `t` (ms), newest last. */
export const noticesSince = (t: number) => shown.filter((n) => n.at >= t)

// What's told before the toaster is drawn waits for it: sonner would drop it.
let drawn = false
const early: (() => void)[] = []
export function toasterDrawn() {
  drawn = true
  for (const show of early.splice(0)) show()
}

/** Show a toast. Returns its id (dismissNotice closes it early). */
export function notify(text: string, opts: NotifyOptions = {}) {
  const { action, kind, id } = opts
  const now = Date.now()
  shown.push({ text: short(text), ...(kind === "error" ? { kind } : {}), at: now })
  while (shown.length > 12 || (shown.length && now - shown[0].at > KEPT_MS)) shown.shift()
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
  announce(action ? `${short(text)}. ${action.label}: ${keyHint(TOAST_KEYS)}` : short(text), { assertive: kind === "error" })
  const show = () => kind === "error" ? toast.error(short(text), data) : toast(short(text), data)
  if (drawn) return show()
  data.id ??= `early-${now}-${early.length}`
  early.push(show)
  return data.id
}

/** Close a toast before its time. */
export const dismissNotice = (id: string | number) => { toast.dismiss(id) }

function said(e: unknown) {
  const p = plainError(e)
  const status = Number(isObj(e) ? e.status : undefined) || 0
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

export const errorReason = (e: unknown) => said(e).reason

/** An error as a line of a page or a form (plainText), a bug kept in Errors. */
export function errorText(e: unknown, what?: string) {
  said(e)
  return plainText(e, what)
}
