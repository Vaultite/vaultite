// Where the companion points, for the server and the window alike (no Node, no DOM): a pane (a tab today) and an anchor
// in it, the app's own UI, or (the helper's) an app window and a point on the screen.

/** A place: a note's line or text (`find`) or a drawing's point; a pane's terminal `row` or page element (`el`, a ref);
 *  the app's UI by data-ui id (`ui`); the helper's app, window and screen point (sx, sy on `display`). */
export type Target = { path?: string; line?: number; find?: string; x?: number; y?: number
  pane?: string; ui?: string; row?: number; el?: string
  app?: string; window?: number; sx?: number; sy?: number; display?: number }

/** The keys of a place: an agent's place is all of them, each set or cleared together. */
export const PLACE_KEYS = ["path", "line", "find", "x", "y", "pane", "ui", "row", "el", "app", "window", "sx", "sy", "display"] as const

/** What a pane shows, as the window says (a tab's target): a note, a drawing, a terminal, a web page, another view. */
export type PaneKind = "note" | "terminal" | "site" | "view"
/** A pane the window has: its id (today's tab id), what it shows (`to`, as a tab's: file:<path>, view:terminal/<id>,
 *  view:web/<url>), its title, and its tab group (a tab set's id). */
export type Pane = { id: string; to: string; title: string; group?: string }

/** A pane's kind and what it names: the file, the terminal, the address. */
export function paneSource(to: string): { kind: PaneKind; path?: string; terminal?: string; url?: string } {
  if (to.startsWith("file:") && !to.startsWith("file:/")) return { kind: "note", path: to.slice(5) }
  if (to.startsWith("view:terminal/")) return { kind: "terminal", terminal: to.slice(14) }
  if (to.startsWith("view:web/")) return { kind: "site", url: to.slice(9) }
  return { kind: "view" }
}

/** A place as an agent reads it: "Notes/A.md:12", "the terminal t3, row 4", "the page in t5, at e12", "the app's tab:t3". */
export function placeText(t: Target, title?: string) {
  if (t.path && !t.pane) return `${t.path}${t.line ? `:${t.line}` : ""}`
  if (t.ui) return `the app's ${t.ui}`
  if (t.pane) return `${title ? `"${title}" (pane ${t.pane})` : `pane ${t.pane}`}${t.row ? `, row ${t.row}` : ""}${t.el ? `, at ${t.el}` : ""}${t.find ? `, at "${t.find}"` : ""}`
  if (t.app) return `${t.app}${t.window ? ` window ${t.window}` : ""}`
  return "where they are"
}

/** Whether `host` (or a parent domain of it) is one of `sites` ("bank.com" covers "www.bank.com"). */
export function siteIn(host: string, sites: string[]) {
  const h = host.toLowerCase().replace(/^www\./, "")
  return sites.some((s) => { const x = s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); return !!x && (h === x || h.endsWith(`.${x}`)) })
}
/** An address's host, or "" when it has none. */
export const hostOf = (url: string) => { try { return new URL(url).hostname } catch { return "" } }
