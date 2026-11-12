import { notifyError } from "@vaultite"
import type { Term } from "./vt/term"

let pendingCopy: string | null = null
/** Safari writes the clipboard only during a tap or a key press, and a program's copy arrives a moment after the
 *  selection ends: then it's kept and written on the next one. */
export function copy(text: string) {
  pendingCopy = text
  navigator.clipboard?.writeText(text).then(() => { if (pendingCopy === text) pendingCopy = null }, () => {})
}
export const flushCopy = () => { if (pendingCopy !== null) copy(pendingCopy) }

/** iOS asks first (its own small Paste button); dismissed, nothing happens. */
async function readClipboard(t: Term, sendFiles: (files: File[]) => void) {
  const clip = navigator.clipboard
  if (!clip?.read) { const text = await clip?.readText(); if (text) t.paste(text); return }
  const files: File[] = []
  let text = ""
  for (const item of await clip.read()) {
    const image = item.types.find((type) => type.startsWith("image/"))
    if (image) files.push(new File([await item.getType(image)], `pasted.${image.split("/")[1] || "png"}`, { type: image }))
    else if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text()
  }
  if (files.length) sendFiles(files)
  else if (text) t.paste(text)
}

export const pasteClipboard = (t: Term, sendFiles: (files: File[]) => void) =>
  void readClipboard(t, sendFiles).catch((e) => { if (!(e instanceof DOMException && e.name === "NotAllowedError")) notifyError(e, "Couldn't paste") })
