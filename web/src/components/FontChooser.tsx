// The commands "Change text font…", "Change interface font…" and "Change monospace font…": the font picker in the
// palette, the whole app shown in the selected font as the selection moves. Settings' Fonts rows open the same one.
import { pickFont } from "@/components/FontPicker"
import { DEFAULT_FONTS, previewLook } from "@/core/appearance"
import { getPrefs, setPrefs } from "@/core/prefs"

export const FONTS = {
  interfaceFont: { label: "Interface font", sub: "Sidebars, menus and the app's pages", fallback: { name: "System font", css: DEFAULT_FONTS.ui } },
  textFont: { label: "Text font", sub: "Notes' text", fallback: { name: "Interface font", css: "var(--font-sans)" } },
  monoFont: { label: "Monospace font", sub: "Code and terminals", fallback: { name: "System monospace", css: DEFAULT_FONTS.code }, mono: true },
}
export type FontKey = keyof typeof FONTS

/** A font's picker, Settings' and the palette's: the whole app shows the selected font until one is picked. */
export const fontPicker = (k: FontKey, value: string) => {
  const f = FONTS[k]
  return { value, onChange: (v: string) => void setPrefs({ [k]: v }), label: f.label, heading: f.sub, fallback: f.fallback, mono: "mono" in f,
    preview: (v: string | null) => previewLook(v === null ? null : { [k]: v }) }
}

/** The commands "Change text font…" and the like. */
export function chooseFont(k: FontKey) {
  const raw = getPrefs()[k]
  void pickFont(fontPicker(k, typeof raw === "string" ? raw.trim() : ""))
}
