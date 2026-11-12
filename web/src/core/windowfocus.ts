// A browser's window out of focus marks the page (data-window-inactive), as the desktop app does from its key window
// (electron/preload.cjs): what's selected goes grey (index.css). Focus in one of the page's frames is still this window's.
import { desktop } from "@/core/desktop"

if (typeof window !== "undefined" && !desktop) {
  const mark = () => document.documentElement.toggleAttribute("data-window-inactive", !document.hasFocus())
  // (after the blur: focus going into a frame has reached it by then, and the page still has it)
  addEventListener("blur", () => setTimeout(mark))
  addEventListener("focus", mark)
}
