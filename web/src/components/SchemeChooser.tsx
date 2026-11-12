import { choose } from "@/components/Chooser"
import { getVaultAppearance, onlyMode, previewLook } from "@/core/appearance"
import { getPrefs, setPrefs } from "@/core/prefs"
import { SCHEMES, schemeId } from "@/themes/schemes"
import { cn, isDark } from "@/lib/utils"

function Dots({ id }: { id: string }) {
  const only = onlyMode(id)
  return (
    <span data-scheme={id === "default" ? undefined : id} aria-hidden
      className={cn("scheme-preview grid size-5 grid-cols-2 place-items-center rounded-[5px] border-[0.5px] border-border bg-background p-[3px]", (only ? only === "dark" : isDark()) && "dark")}>
      {["primary", "red", "green", "blue"].map((c) => <span key={c} className="size-[5px] rounded-full" style={{ background: `var(--${c})` }} />)}
    </span>
  )
}

export const schemeName = (scheme = schemeId(getPrefs().scheme)) => scheme.startsWith("theme:") ? scheme.slice(6) : SCHEMES.find((s) => s.id === scheme)?.name ?? scheme

export function chooseScheme() {
  const items = [
    ...SCHEMES.map((s) => ({ id: s.id, label: s.name, detail: s.only ? `${s.only === "dark" ? "Dark" : "Light"} only` : undefined })),
    ...getVaultAppearance().themes.filter((t) => !t.problem).map((t) => ({ id: `theme:${t.name}`, label: t.name, detail: "From your vault" })),
  ].map((it) => ({ ...it, icon: <Dots id={it.id} /> }))
  choose({
    title: "Colour scheme", placeholder: "Colour scheme…", items, current: schemeId(getPrefs().scheme),
    preview: (it) => previewLook(it ? { scheme: it.id } : null),
    onPick: (it) => { void setPrefs({ scheme: it.id }) },
  })
}
