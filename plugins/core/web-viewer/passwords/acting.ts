import { afterSheets, openWebLink } from "@vaultite"
import { byHand } from "./byhand"
import { state, webUrl } from "./store"
import type { Row } from "./types"

export function acting(): Row | null {
  const at = document.activeElement
  const el = at instanceof HTMLDialogElement ? at.querySelector("[data-password-id]") : at?.closest("[data-password-id]")
  const id = el instanceof HTMLElement ? el.dataset.passwordId : undefined
  return (id && state.get().entries?.find((e) => e.id === id)) || null
}
export const canAct = (is: (e: Row) => boolean = () => true) => { const e = acting(); return !!e && is(e) && !getSelection()?.toString() }
export function act<T>(fn: (e: Row) => T) {
  const e = byHand() ? acting() : null
  return e ? fn(e) : undefined
}

export const openSite = (url: string) => afterSheets(() => openWebLink(webUrl(url)))
