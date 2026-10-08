// A font setting: a button in its own font that opens the Chooser with this device's fonts; a name not listed can
// still be used.
import { ChevronsUpDown, HardDrive } from "lucide-react"
import { choose, type Choice } from "@/components/Chooser"
import { Marked } from "@/components/Palette"
import { fontStack } from "@/core/appearance"
import { canListAll, fonts, listAllowed, listedAll, loadAll } from "@/core/fonts"
import { cn } from "@/lib/utils"

type FontChoice = Choice & { family?: string; all?: boolean }

export type FontPickerProps = {
  /** The setting: a family name, or "" for the default. */
  value: string
  onChange: (value: string) => void
  /** The setting's name ("Text font"): the button's label and the palette's. */
  label: string
  /** The default: its name ("System font") and the CSS font-family it draws with. */
  fallback: { name: string; css: string }
  /** Code: monospace fonts listed first, and the stack falls back to a monospace one. */
  mono?: boolean
  className?: string
}

async function pickFont({ value, onChange, label, fallback, mono }: FontPickerProps) {
  if (!listedAll() && await listAllowed()) await loadAll()
  const css = (f: FontChoice) => (f.family ? fontStack(f.family, mono) : f.all ? undefined : fallback.css)
  const list = fonts().sort((a, b) => (mono ? Number(b.mono) - Number(a.mono) : 0))
  const items: FontChoice[] = [
    { id: "", label: fallback.name, detail: "Default" },
    ...list.map((f) => ({ id: f.family, label: f.family, family: f.family, detail: f.mono ? "Monospace" : undefined })),
  ]
  if (value && !items.some((it) => it.id === value)) items.splice(1, 0, { id: value, label: value, family: value, detail: "Not on this device" })
  if (canListAll() && !listedAll()) items.push({ id: "\0all", label: "Show every installed font…", all: true, detail: "The browser asks first" })
  choose<FontChoice>({
    title: label, placeholder: `${label}: type a font's name`, items, current: value,
    other: (typed) => ({ id: typed, label: `Use "${typed}"`, family: typed }),
    label: (it, marks) => (
      <span className={cn("flex min-w-0 items-center gap-2", it.all && "text-primary")} style={{ fontFamily: css(it) }}>
        {it.all && <HardDrive className="size-4 shrink-0" strokeWidth={2} />}
        <span className="truncate"><Marked text={it.label} marks={marks} /></span>
      </span>
    ),
    onPick: async (it) => {
      if (!it.all) return onChange(it.family ?? "")
      if (await loadAll()) pickFont({ value, onChange, label, fallback, mono })
    },
  })
}

/** The setting's control: the current font, drawn in itself; click for the picker. */
export function FontPicker(props: FontPickerProps) {
  const { value, label, fallback, mono, className } = props
  return (
    <button type="button" aria-haspopup="dialog" aria-label={`${label}: ${value || fallback.name}`} onClick={() => pickFont(props)}
      className={cn("flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] border-[0.5px] border-border bg-background pr-1.5 pl-2 text-left text-[14px] hover:bg-foreground/[0.03]", className)}>
      <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")} style={{ fontFamily: value ? fontStack(value, mono) : fallback.css }}>{value || fallback.name}</span>
      <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
    </button>
  )
}
