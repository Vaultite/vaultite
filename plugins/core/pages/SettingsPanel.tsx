// Pinned's settings sheet: the pinned pages to reorder, then the pages not pinned, then archived ones; unpinning only
// hides a page. It's the sidebar's menu again, here so the list is findable at all.
import { FileText, GripVertical } from "lucide-react"
import { cn, currentWorkspace, fileAt, Group, iconOf, isPage, offPlugin, pluginById, Section, SortableList, stem, Switch, tintOf, useEnabled, useWorkspaceVersion, type Store } from "@vaultite"
import { currentPins, movePinned, pin } from "./types"

export function PinnedSettings({ store }: { store: Store }) {
  useWorkspaceVersion()
  const desk = currentWorkspace()
  useEnabled() // drawn again when a plugin is turned on or off
  const pinned = currentPins(store)
  const files = store.files.files
  const archived = (p: string) => !!fileAt(files, p)?.archived
  const shown = pinned.filter((p) => fileAt(files, p) && !archived(p))
  const at = (p: string) => { const i = pinned.indexOf(p); return i < 0 ? Infinity : i }
  const all = files.filter((f) => isPage(f.path, store)).map((f) => f.path).sort((a, b) => at(a) - at(b) || a.localeCompare(b))
  const rest = all.filter((p) => !pinned.includes(p) && !archived(p))
  const gone = [...pinned.filter((p) => fileAt(files, p) && archived(p) && !all.includes(p)), ...all.filter(archived)]
  const row = (p: string, sortable: boolean) => {
    const f = fileAt(files, p)
    const Icon = iconOf(f) ?? FileText
    const off = offPlugin(f)
    const name = stem(p)
    const folder = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""
    const note = off ? `${pluginById(f!.plugin!)?.name ?? f!.plugin} is off` : isPage(p, store) ? "" : folder
    return (
      <div className="group/page flex h-11 items-center gap-2.5 md:h-10" data-page-row={p}>
        {/* The handle says it drags (the whole row does); the list that doesn't drag keeps its place, so icons line up. */}
        <GripVertical aria-hidden className={cn("-mx-1 size-4 shrink-0 text-tertiary transition-opacity",
          sortable ? "cursor-grab md:opacity-0 md:group-hover/page:opacity-100" : "invisible")} strokeWidth={2} />
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-[7px] bg-muted md:size-6 md:rounded-[6px]", off && "opacity-45")}
          style={{ color: tintOf(f?.tint) ?? "var(--primary)" }}>
          <Icon className="size-4 md:size-[15px]" strokeWidth={2} />
        </span>
        <div className={cn("min-w-0 flex-1 truncate text-[15px] md:text-[14px]", off && "opacity-55")} data-tip={note ? `${name} · ${note}` : name} data-tip-trunc>
          {name}
          {note && <span className="text-muted-foreground">{" · "}{note}</span>}
        </div>
        <Switch on={pinned.includes(p)} onChange={(v) => pin(p, v)} label={`Pin ${name}`} />
      </div>
    )
  }
  return (
    <div className="space-y-5" data-pinned-settings>
      <Section title={`Pinned, ${shown.length}`}>
        <Group><SortableList ids={shown} onMove={movePinned} className="hairline" lift="wide">{(p) => row(p, true)}</SortableList></Group>
        <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground" data-pages-count>
          {`${shown.length} pinned${desk ? ` in ${desk.label}: each workspace has its own` : ""}. Drag to reorder.`}
        </p>
      </Section>
      {!!rest.length && (
        <Section title="Not pinned">
          <Group>{rest.map((p) => <div key={p}>{row(p, false)}</div>)}</Group>
        </Section>
      )}
      {!!gone.length && (
        <Section title="Archived">
          <Group>{gone.map((p) => <div key={p}>{row(p, false)}</div>)}</Group>
        </Section>
      )}
    </div>
  )
}
