// Toasts drawn by sonner in the app's tokens, so every scheme recolours them: bottom right on desktop, above the tab
// bar on phones, three at most. No icons but an error's.
import { CircleAlert } from "lucide-react"
import { Toaster as Sonner } from "sonner"
import { byTab } from "@/core/focus"

// Tabbing out of a toast, sonner gives the keyboard back to where it came from (the Tab undone): not when the user
// sent it somewhere (or past the page's end).
if (typeof window !== "undefined") {
  addEventListener("focusout", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("[data-sonner-toaster]")) return
    const to = e.relatedTarget
    if (to instanceof Element ? !to.closest("[data-sonner-toaster]") : byTab(e)) e.stopPropagation()
  }, true)
}

export function Toaster({ desktop }: { desktop: boolean }) {
  // Phones: above the bar (components/PhoneBar.tsx, its height: --phone-bar).
  const phone = { bottom: "calc(var(--phone-bar) + 0.75rem)", left: 16, right: 16 }
  return (
    <Sonner position={desktop ? "bottom-right" : "bottom-center"} visibleToasts={3} gap={8} duration={4000}
      offset={desktop ? { bottom: 40, right: 16 } : phone} mobileOffset={phone} className="vau-toaster"
      icons={{ error: <CircleAlert className="size-4 text-[var(--red)]" strokeWidth={2.25} /> }}
      toastOptions={{ className: "vau-toast" }} containerAriaLabel="Notifications" />
  )
}
