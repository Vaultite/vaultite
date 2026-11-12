import { pickFont } from "@/components/FontPicker"
import { DEFAULT_FONTS, previewLook } from "@/core/appearance"
import { getPrefs, setPrefs } from "@/core/prefs"
import { openDetail } from "@/core/nav"

export const FONTS = {
  interfaceFont: { label: "Interface font", sub: "Sidebars, menus and the app's pages", fallback: { name: "System font", css: DEFAULT_FONTS.ui } },
  textFont: { label: "Text font", sub: "Notes' text", fallback: { name: "Interface font", css: "var(--font-sans)" } },
  monoFont: { label: "Monospace font", sub: "Code and terminals", fallback: { name: "System monospace", css: DEFAULT_FONTS.code }, mono: true },
}
export type FontKey = keyof typeof FONTS

export const fontPicker = (k: FontKey, value: string) => {
  const f = FONTS[k]
  return { value, onChange: (v: string) => void setPrefs({ [k]: v }), label: f.label, heading: f.sub, fallback: f.fallback, mono: "mono" in f,
    preview: (v: string | null) => previewLook(v === null ? null : { [k]: v }) }
}

const fontOf = (k: FontKey) => { const raw = getPrefs()[k]; return typeof raw === "string" ? raw.trim() : "" }
export const fontSetting = (k: FontKey) => ({ value: () => fontOf(k) || FONTS[k].fallback.name, place: { name: "Appearance", open: () => openDetail("fonts") } })

export function chooseFont(k: FontKey) {
  void pickFont(fontPicker(k, fontOf(k)))
}
