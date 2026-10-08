// The editor is its own chunk (CodeMirror: a third of the app's code), loaded by the first file that shows it or once the
// first page is drawn and idle. Everything that draws the editor takes it from here: one chunk, one load.
import { lazy } from "react"

let editorChunk: Promise<typeof import("@/editor/Editor")> | null = null
export const preloadEditor = () => (editorChunk ??= import("@/editor/Editor"))
export const Editor = lazy(preloadEditor)
