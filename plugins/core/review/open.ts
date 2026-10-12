// Where the review opens, and what it shows, for every part of it (the views, the status bar, a file's header).
import { openView, useLive } from "@vaultite"

/** A file to review, as review.list answers it (plugin.ts). */
export type Pending = { path: string; by: string[]; first: number; last: number; added?: number; removed?: number; created?: boolean }

/** What's to review, shared by every part that shows it (one request); asked again after changes in the vault and each
 *  minute (Activity may name a change's writer a moment after the change). */
export const useReview = () => useLive<{ files: Pending[] }>("review", undefined, true, 60_000)

export const reviewView = (by?: string) => openView(by ? `review/${encodeURIComponent(by)}` : "review")
export const reviewFileView = (path: string) => openView(`review-file/${path}`)
/** A view's arg as given: `review/Grok%20Bot`. */
export const argOf = (arg: string) => { try { return decodeURIComponent(arg) } catch { return arg } }
