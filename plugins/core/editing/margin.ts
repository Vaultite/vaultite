// Phones: what the editor scrolls into view (the cursor as you type) stays clear of the keys over the keyboard (keys.tsx).
import { EditorView } from "@codemirror/view"

export const keysMargin = EditorView.scrollMargins.of(() => {
  const bar = document.querySelector<HTMLElement>("[data-key-bar]")
  return bar ? { bottom: bar.offsetHeight } : null
})
