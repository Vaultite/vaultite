// The browsing history as the app asks it of the desktop app (electron/browser/history.ts, import.ts): suggestions,
// visits by day, deleting them (with what Undo puts back) and importing another browser's.
import { useEffect } from "react"
import { webPages } from "@vaultite"

export type How = "typed" | "link" | "bookmark" | "form" | "other"
export type Suggestion = { url: string; title: string; host: string; visits: number; typed: number; last: number }
export type Visit = { id: number; url: string; title: string; host: string; at: number; profile: string; how: How }
/** Visits taken out, as the desktop app answers them: what Undo puts back. */
export type Removed = { url: string; title: string; at: number; profile: string; how: How; source: string }
/** `rows`' `score`: how well each matches what's typed (frecency, more for a match at the start). */
export type Found = { complete: { text: string; url: string } | null; rows: (Suggestion & { score: number })[] }
export type ImportSource = { browser: "brave" | "chrome"; name: string; profiles: { dir: string; name: string; history: boolean; bookmarks: boolean }[] }
export type ImportedBookmark = { url: string; title: string; folder: string }

/** Whether this app keeps a history (the desktop app, new enough). */
export const hasHistory = () => !!webPages?.engine

const ask = <T,>(name: string, ...args: unknown[]): Promise<T> =>
  webPages?.engine ? (webPages.engine(name, ...args) as Promise<T>) : Promise.reject(new Error("web pages open in Vaultite's desktop app"))

export const searchHistory = (text: string, limit = 8) => ask<Found>("history:search", text, limit)
export const topSites = (limit = 8) => ask<Suggestion[]>("history:top", limit)
export const listHistory = (o: { before?: number; text?: string; limit?: number }) => ask<{ visits: Visit[]; more: boolean }>("history:list", o)
/** The address bar is about to open `url`: its visit counts as typed (or a bookmark's). */
export const markTyped = (url: string, how: "typed" | "bookmark" = "typed") => { void ask("history:typed", url, how).catch(() => {}) }
export const removeVisits = (o: { visits?: number[]; urls?: string[] }) => ask<Removed[]>("history:remove", o)
export const removeSite = (site: string) => ask<Removed[]>("history:remove-site", site)
export const clearHistory = (from: number | null, to: number | null) => ask<number>("history:clear", from, to)
export const restoreVisits = (visits: Removed[]) => ask<number>("history:restore", visits)

export const importSources = () => ask<ImportSource[]>("import:sources")
export const importHistory = (browser: string, dir: string, profile: string) => ask<{ found: number; added: number }>("import:history", browser, dir, profile)
export const importBookmarks = (browser: string, dir: string) => ask<ImportedBookmark[]>("import:bookmarks", browser, dir)

/** `fn` runs when the history changes (a visit, a delete, an import), at most once a second. */
export function useHistoryChanged(fn: () => void) {
  useEffect(() => webPages?.on((m) => { if (m.type === "engine:history:changed") fn() }), [fn])
}
