import { createRoot, type Root, type RootOptions } from "react-dom/client"
import { noteAppError } from "@/core/errors"

/** React stops logging caught errors once given onCaughtError: log them as it would. */
export const caughtError: NonNullable<RootOptions["onCaughtError"]> = (error, info) => {
  // oxlint-disable-next-line no-console -- the browser's console is where a developer looks first
  console.error(error)
  noteAppError("boundary", error, { component: info.componentStack })
}

export const recoveredError: NonNullable<RootOptions["onRecoverableError"]> = (error, info) =>
  noteAppError("boundary", error instanceof Error && error.cause !== undefined ? error.cause : error, { component: info.componentStack })

export function partRoot(el: Element | DocumentFragment): Root {
  return createRoot(el, { onCaughtError: caughtError, onRecoverableError: recoveredError })
}
