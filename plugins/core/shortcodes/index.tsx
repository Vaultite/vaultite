import { useEffect } from "react"
import { definePlugin, onMarkdownDrawn, pluginSettings } from "@vaultite"
import type { Settings } from "./editor"
import "./shortcodes.css"

// Shortcodes: `:fi` suggests emoji and icons, `:fire:` becomes 🔥, `:LiName:` draws as its icon. editor.ts and the
// data load when a note first needs them.
const settings = pluginSettings<Settings>("shortcodes")
let loading: Promise<typeof import("./editor")> | null = null
const load = () => (loading ??= import("./editor"))

function Icons() {
  const on = settings.use().icons !== false
  useEffect(() => {
    if (!on) return
    const draw = (el: HTMLElement) => { void load().then((m) => m.drawIcons(el)) }
    // (and what was drawn before this ran: a note opened with the app)
    document.querySelectorAll<HTMLElement>("[data-markdown-from]").forEach(draw)
    return onMarkdownDrawn(draw)
  }, [on])
  return null
}

export default definePlugin({
  editor: async (ctx) => (ctx.kind === "markdown" ? (await load()).shortcodesExtension(settings.get, !!ctx.source) : []),
  background: () => <Icons />,
})
