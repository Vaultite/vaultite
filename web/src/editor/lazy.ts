import { apart } from "@/core/apart"

export const Editor = apart(() => import("@/editor/Editor").then((m) => m.default))
export const preloadEditor = Editor.preload
