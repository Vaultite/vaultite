// Page preview's server side: only its settings (the app draws the popover).
import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

plugin.route("GET", "page-preview/settings", () => plugin.settings())
