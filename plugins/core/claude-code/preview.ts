import type { Entry } from "./chatlog.ts"

const PREVIEW_URL = /https?:\/\/(?:(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d{2,5})?)(?:\/[^\s<>)"'`]*)?/gi
const TRIM = /[.,;:!?)\]]+$/

const seen = new Map<string, string>()

export const isWebView = (to: string) => to === "view:web" || to.startsWith("view:web/")
export const previewOf = (id: string) => seen.get(id) ?? ""
export const rememberPreview = (id: string, url: string) => { if (id && url) seen.set(id, url) }

function urlsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(PREVIEW_URL)) {
    const clean = m[0].replace(TRIM, "")
    if (clean) out.push(clean)
  }
  return out
}

function entryText(e: Entry): string {
  if (e.k === "text" || e.k === "user" || e.k === "note") return e.text
  if (e.k === "tool") return [e.summary, e.result ?? ""].join("\n")
  return ""
}

export function previewUrlFrom(entries: readonly Entry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const found = urlsIn(entryText(entries[i]))
    if (found.length) return found.at(-1)!
  }
  return ""
}
