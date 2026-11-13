import { getStore, mutate, type Store } from "@/core/data"
import { patch } from "@/core/http"
import { linkStyle } from "@/core/links"
import { notifyError } from "@/core/notify"
import { LINK_STYLE, type LinkFormat, type LinkStyle } from "../../../core/linkformat.ts"

const seeded = (key: string) => getStore()?.settingDefaults?.files?.[key]
const restyled = (st: Store, change: Partial<LinkStyle>): Store => (st.filing ? { ...st, filing: { ...st.filing, links: { ...linkStyle(st), ...change } } } : st)

function save(key: "linkFormat" | "wikilinks", change: Partial<LinkStyle>, value: LinkFormat | boolean, fallback: LinkFormat | boolean) {
  mutate((st) => restyled(st, change))
  patch("config/files", { [key]: value === (seeded(key) ?? fallback) ? null : value }).catch((e) => notifyError(e, "Couldn't save it"))
}

export const setLinkFormat = (format: LinkFormat) => save("linkFormat", { format }, format, LINK_STYLE.format)
export const setWikilinks = (on: boolean) => save("wikilinks", { wikilinks: on }, on, LINK_STYLE.wikilinks)
