import { lazy } from "react"

let editorChunk: Promise<typeof import("@/editor/Editor")> | null = null
export const preloadEditor = () => (editorChunk ??= import("@/editor/Editor"))
export const Editor = lazy(preloadEditor)
