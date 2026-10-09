// Asked once per vault: pages copied in before plugins' pages were built in, which the user never changed, can go, so
// the built-in ones (which update with their plugins) come back in their place, pins and links following.
import { useEffect } from "react"
import { confirmDialog, notify, notifyError, op } from "@vaultite"

type Copies = { offered: boolean; copies: { path: string; plugin: string }[] }

let asked = false

export function CopiesOffer() {
  useEffect(() => {
    if (asked) return
    asked = true
    // (a moment after the app has drawn, not over its first frame)
    const t = setTimeout(() => void op<Copies>("dashboard.copies").then(async (r) => {
      if (r.offered || !r.copies.length) return
      const names = r.copies.map((c) => c.path.split("/").pop()!.replace(/\.md$/i, ""))
      const one = names.length === 1
      const ok = await confirmDialog({
        title: one ? "Use the built-in page?" : "Use the built-in pages?",
        body: `Plugins' pages are built in now, and update with their plugins. ${one ? "This page in your vault is a copy" : `These ${names.length} pages in your vault are copies`} you never changed: ${names.join(", ")}. Move ${one ? "it" : "them"} to the trash and use the built-in ${one ? "one" : "ones"}? Pins and links follow. Asked once.`,
        confirm: "Use built-in", cancel: "Keep mine",
      })
      const done = await op<{ removed: string[] }>("dashboard.uncopy", ok ? {} : { keep: true })
      if (ok) notify(`Moved ${done.removed.length} ${done.removed.length === 1 ? "copy" : "copies"} to the trash: the built-in pages are back`)
    }).catch((e) => notifyError(e, "Couldn't check the pages")), 3000)
    return () => clearTimeout(t)
  }, [])
  return null
}
