// The command "Change colour scheme": every scheme in the palette, the whole app shown in the selected one as the
// selection moves; Enter keeps it, Esc goes back. Settings' gallery (Appearance.tsx) is the other way in.
import { choose } from "@/components/Chooser"
import { getVaultAppearance, onlyMode, previewScheme } from "@/core/appearance"
import { getPrefs, setPrefs } from "@/core/prefs"
import { SCHEMES, schemeId } from "@/themes/schemes"
import { cn, isDark } from "@/lib/utils"

/** A scheme's accent and colours as four dots in a tile of its background, drawn in its own CSS (its data-scheme) in
 *  the mode it would show in. */
function Dots({ id }: { id: string }) {
  const only = onlyMode(id)
  return (
    <span data-scheme={id === "default" ? undefined : id} aria-hidden
      className={cn("scheme-preview grid size-5 grid-cols-2 place-items-center rounded-[5px] border-[0.5px] border-border bg-background p-[3px]", (only ? only === "dark" : isDark()) && "dark")}>
      {["primary", "red", "green", "blue"].map((c) => <span key={c} className="size-[5px] rounded-full" style={{ background: `var(--${c})` }} />)}
    </span>
  )
}

export function chooseScheme() {
  const items = [
    ...SCHEMES.map((s) => ({ id: s.id, label: s.name, detail: s.only ? `${s.only === "dark" ? "Dark" : "Light"} only` : undefined })),
    ...getVaultAppearance().themes.filter((t) => !t.problem).map((t) => ({ id: `theme:${t.name}`, label: t.name, detail: "From your vault" })),
  ].map((it) => ({ ...it, icon: <Dots id={it.id} /> }))
  choose({
    title: "Change colour scheme", placeholder: "Colour scheme…", items, current: schemeId(getPrefs().scheme),
    preview: (it) => previewScheme(it?.id ?? null),
    onPick: (it) => { void setPrefs({ scheme: it.id }) },
  })
}
