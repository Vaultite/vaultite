import { EditorState } from "@codemirror/state"
import { crosshairCursor, drawSelection, EditorView, rectangularSelection } from "@codemirror/view"

const altNotShift = (e: MouseEvent) => e.altKey && !e.shiftKey

export const cursors = [
  EditorState.allowMultipleSelections.of(true),
  drawSelection(),
  rectangularSelection(),
  crosshairCursor(),
  EditorView.clickAddsSelectionRange.of(altNotShift),
]
