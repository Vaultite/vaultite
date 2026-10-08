// Learning: a dashboard of Logs' and Books' blocks; its only backend is the areas it brings to Logs (`log-areas`: a vault
// without them gets them, one without an icon or colour takes theirs).
import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

plugin.provide("log-areas", () => [
  { slug: "learning", name: "Learning", icon: "graduation-cap", tint: "learning" },
  { slug: "reading", name: "Reading", icon: "book-open", tint: "orange", parent: "learning", fields: [
    { key: "book_id", label: "Book", type: "book" },
    { key: "pages", label: "Pages read", type: "number" }] },
  { slug: "study", name: "Study", icon: "notebook-pen", tint: "purple", parent: "learning", fields: [
    { key: "subject", label: "Subject", type: "text" },
    { key: "focus", label: "Worked on", type: "text" },
    { key: "link", label: "Link", type: "text" }] },
])
