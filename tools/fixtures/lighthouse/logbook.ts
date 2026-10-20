// The keepers' logbook, loaded only when asked for (its own chunk of the bundle, sharing the app's CodeMirror with it).
import { EditorView } from "@codemirror/view"

export const logbook = () => `The keepers' logbook: calm seas${EditorView ? "." : ""}`
