import { openView, useLive } from "@vaultite"

export type Pending = { path: string; by: string[]; first: number; last: number; added?: number; removed?: number; created?: boolean }

export const useReview = () => useLive<{ files: Pending[] }>("review", undefined, true, 60_000)

export const reviewView = (by?: string) => openView(by ? `review/${encodeURIComponent(by)}` : "review")
export const reviewFileView = (path: string) => openView(`review-file/${path}`)
export const argOf = (arg: string) => { try { return decodeURIComponent(arg) } catch { return arg } }
