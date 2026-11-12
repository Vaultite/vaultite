import { desktop } from "@/core/desktop"

if (typeof window !== "undefined" && !desktop) {
  const mark = () => document.documentElement.toggleAttribute("data-window-inactive", !document.hasFocus())
  // Only after the blur does focus moving into a frame show in document.hasFocus().
  addEventListener("blur", () => setTimeout(mark))
  addEventListener("focus", mark)
}
