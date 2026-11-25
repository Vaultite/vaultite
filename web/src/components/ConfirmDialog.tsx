import { signal } from "@/core/signal"
import { answerUi } from "@/core/askers"

export type ConfirmOptions = {
  title: string
  body?: string
  /** The confirm button's label (default "OK"). */
  confirm?: string
  /** The cancel button's label (default "Cancel"). */
  cancel?: string
  /** It destroys something: the confirm button is red. */
  danger?: boolean
  /** A secret to give before confirming: hidden text, or a file's contents. Never shown, never kept. */
  field?: "secret" | "file"
  /** An agent's ask: the user may give one from their passwords, or keep what they give there (`setSecretKeeper`). */
  keepable?: boolean
}
/** The user's passwords (the desktop app's, web-viewer's passwords.ts), for an agent's ask: what's set up there. */
export type SecretKeeper = {
  /** Entries to pick from; null while locked and nothing unlocked them (Touch ID declined). */
  entries: () => Promise<{ id: string; title: string; username: string }[] | null>
  value: (id: string) => Promise<string>
  keep: (title: string, value: string) => Promise<void>
}
let keeper: SecretKeeper | null = null
export const secretKeeper = () => keeper
export const setSecretKeeper = (k: SecretKeeper | null) => { keeper = k }
export type Given = { value: string; base64: boolean }
export type Ask = ConfirmOptions & { done: (ok: boolean, given?: Given) => void }

let asking: Ask | null = null
const subs = signal()
const set = (a: Ask | null) => { asking = a; subs.notify() }
export const useAsking = () => subs.use(() => asking)
export const askEnded = (a: Ask) => { if (asking === a) set(null) }

/** Ask; resolves true when confirmed, false when cancelled. A second question while one is open cancels the first. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  asking?.done(false)
  return new Promise((resolve) => set({ ...opts, done: resolve }))
}

/** Ask for a secret (opts.field: hidden text, or a file); null when cancelled or `ended` (the asker stopped waiting). It
 *  goes where the caller sends it, never kept or shown. */
export function secretDialog(opts: ConfirmOptions & { field: "secret" | "file" }, ended?: AbortSignal): Promise<Given | null> {
  asking?.done(false)
  return new Promise((resolve) => {
    const a: Ask = { ...opts, done: (ok, given) => resolve(ok && given ? given : null) }
    ended?.addEventListener("abort", () => { if (asking === a) { set(null); a.done(false) } })
    set(a)
  })
}

answerUi("secret", (m, ended) => secretDialog({
  title: typeof m.prompt === "string" ? m.prompt : "A secret", confirm: "Send", field: m.file ? "file" : "secret", keepable: true,
  body: `${typeof m.from === "string" && m.from ? m.from : "An agent"} asks for this. It goes to that machine only, never into the vault.`,
}, ended))
