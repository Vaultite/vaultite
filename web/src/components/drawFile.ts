import type { ReactNode } from "react"
import type { Store } from "@/core/data"

type DrawFile = (store: Store, path: string, docked?: string) => ReactNode
let fileView: DrawFile | null = null
export const setFileView = (fn: DrawFile) => { fileView = fn }
export const drawFileView: DrawFile = (store, path, docked) => fileView?.(store, path, docked) ?? null
