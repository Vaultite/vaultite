// Site styles: a site's own CSS, a file each in the plugin's folder (STYLES/<site>.css), added to its pages with the
// vault's look as variables (--vault-background...); the same on the server (plugin.ts) and in the app.

/** Where they are, beside the plugin's settings. */
export const STYLES = ".vaultite/plugins/web-viewer/sites"
/** A site's file: youtube.com.css. */
export const styleFile = (site: string) => `${STYLES}/${site}.css`

/** A site as its file names it (youtube.com for https://www.youtube.com/watch), or "" when it isn't one. */
export function siteName(v: string) {
  const s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "")
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) ? s : ""
}

/** The app's tokens a page gets, as --vault-<name>: its colours, then its fonts (resolved, so a page can use them). */
export const COLORS = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "muted",
  "muted-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground",
  "border", "input", "ring", "sidebar", "red", "blue"]
export const FONTS = { "font-ui": "--font-sans", "font-text": "--font-text", "font-code": "--font-code" }

export type SiteStyle = { site: string; path: string; css: string }

/** A new site's file: what it can use, and nothing applied until written. */
export const template = (site: string) => `/* ${site} in your vault's look: this CSS is added to its pages (its subdomains' too), and each declaration
   wins over the site's own, so no !important is needed. Saved, it applies at once.

   The vault's look, kept up to date as it changes (light or dark, colour scheme, fonts):
   ${COLORS.map((c) => `--vault-${c}`).join(" ")}
   ${Object.keys(FONTS).map((f) => `--vault-${f}`).join(" ")} --vault-radius --vault-color-scheme (light or dark)

   For example:
   :root { color-scheme: var(--vault-color-scheme); }
   html, body { background: var(--vault-background); color: var(--vault-foreground); font-family: var(--vault-font-ui); }
*/
`
