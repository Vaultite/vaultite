import { useEffect, useRef, type KeyboardEvent } from "react"
import { Check, Copy, Info, MoreHorizontal, RefreshCw, RotateCcw, Share, Trash2 } from "lucide-react"
import {
  applyBundle, bundlesNow, isLayout, saveNameNow, openImport, previewOf, refreshBundles, removeBundle, runsCode, saveBundle, useBundles, type ApplyOptions, type BundleInfo, type Plan,
} from "@/core/bundles"
import { AND, changeName, fewOf } from "@/core/bundlenames"
import { official } from "../../../core/updates.ts"
import { openDetail } from "@/core/nav"
import { notify, notifyError } from "@/core/notify"
import { useChosen } from "@/core/leaving"
import { haptic } from "@/core/haptics"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { confirmDialog } from "@/components/ConfirmDialog"
import { askText } from "@/components/Chooser"
import { LayoutDrawing } from "@/components/LayoutDrawings"
import { cn } from "@/lib/utils"

export const askToRun = (b: BundleInfo, plan: Plan, trial = false) => plan.code.every((c) => c.source && official(c.source)) ? confirmDialog({
  title: `Install ${AND.format(plan.code.map((c) => c.name))}?`,
  body: `${b.name} installs Vaultite's own plugins from its plugin directory. Like any plugin, they run on the machine that serves this app, with your files.`,
  confirm: trial ? "Install and try" : "Install and apply",
}) : confirmDialog({
  title: `Run code from ${b.name}?`,
  body: `It brings vault plugins (${plan.code.map((c) => c.source && !c.kept ? `${c.name}, from ${c.source}` : c.name).join("; ")}). They run on the machine that serves this app, with your files and permissions. Apply bundles that run code only from people you trust.`,
  confirm: trial ? "Try and run them" : "Apply and run them", danger: true,
})

export async function pickLayout(b: BundleInfo, o: Pick<ApplyOptions, "open" | "fresh" | "silent"> = {}) {
  const { plan } = await previewOf(b.id)
  const code = runsCode(plan)
  if (code && !(await askToRun(b, plan))) return false
  await applyBundle(b, plan, { allowCode: code, ...o })
  return true
}

export function useLayouts() {
  const l = useBundles()
  const list = (l?.bundles.filter(isLayout) ?? []) as BundleInfo[]
  const current = (l?.applied && list.find((b) => b.id === l.applied!.id)) || list.find((b) => b.inUse) || null
  return { loaded: !!l, list, current: current?.id ?? null }
}

const changedOf = (b: BundleInfo, current: boolean) =>
  current && b.modified ? `Changed since you picked it: ${fewOf(b.differs?.map(changeName) ?? [])}` : b.tweaked ? "Your changes to it come back when you pick it" : null

export function saveAsNew(from: BundleInfo | null) {
  const names = new Set(bundlesNow().map((b) => b.name.toLowerCase()))
  let typed = saveNameNow() ?? (from ? `My ${from.name.replace(/^My /, "")}` : "My layout")
  for (let n = 2; names.has(typed.toLowerCase()); n++) typed = `${typed.replace(/ \d+$/, "")} ${n}`
  askText({
    title: "Save as new layout", heading: "Name the new layout", placeholder: "Its name…", typed, icon: Copy,
    hint: "Its sidebars, pages, plugins and what they're set to", label: (t) => `Save as “${t}”`,
    onText: (name) => {
      saveBundle({ name, replace: false }).then((b) => notify(`Saved ${b.name}`, { action: { label: "Share", run: () => openDetail(`bundle-share/${b.id}`) } }),
        (e) => notifyError(e, "Couldn't save it"))
    },
  })
}

const place = (from: string) => from.replace(/@[0-9a-f]{40}$/, "")

function menuOf(b: BundleInfo, current: boolean, open: ApplyOptions["open"]): MenuItem[] {
  const changed = !!changedOf(b, current)
  return [
    { label: "Details…", icon: Info, run: () => openDetail(`bundle/${b.id}`) },
    ...(changed ? [{ label: "Reset", icon: RotateCcw, run: () => { pickLayout(b, { fresh: true, open: open === "front" ? "none" : open }).catch((e) => notifyError(e, `Couldn't reset ${b.name}`)) } }] : []),
    ...(current ? [{ label: "Save as new…", icon: Copy, run: () => saveAsNew(b) }] : []),
    ...(b.source === "vault" ? [
      { label: "Share…", icon: Share, run: () => openDetail(`bundle-share/${b.id}`) },
      ...(b.from ? [{ label: "Check for updates…", icon: RefreshCw, run: () => openImport(place(b.from!)) }] : []),
      { label: "Delete", icon: Trash2, danger: true, sep: true, run: () => void removeBundle(b) },
    ] : []),
  ]
}

function Tile({ b, on, changed, onPick, menu }: { b: BundleInfo; on: boolean; changed: string | null; onPick: () => void; menu: (() => MenuItem[]) | null }) {
  return (
    <div className="group/tile relative w-[132px] shrink-0 max-md:w-auto" onContextMenu={menu ? menuFor(menu) : undefined} data-layout={b.id}>
      <button type="button" role="radio" aria-checked={on} aria-label={b.name} data-layout-pick={b.id}
        onClick={() => { if (!on) { haptic("selection"); onPick() } }}
        className="flex w-full cursor-pointer flex-col gap-1.5 rounded-[9px] text-left focus-visible:outline-none">
        <span className={cn("relative block aspect-[16/10] w-full overflow-hidden rounded-[8px] ring-[0.5px] ring-border transition-shadow",
          on ? "shadow-[0_0_0_2.5px_var(--background),0_0_0_4.5px_var(--primary)]"
            : "group-hover/tile:shadow-[0_0_0_2.5px_var(--background),0_0_0_4.5px_var(--border)] group-has-[:focus-visible]/tile:shadow-[0_0_0_2.5px_var(--background),0_0_0_4.5px_var(--ring)]")}>
          <LayoutDrawing b={b} className="block size-full" />
          {changed && (
            <span data-tip={changed} data-layout-changed
              className="absolute bottom-1 left-1 rounded-[4px] bg-background/90 px-1 text-[10px] leading-[14px] font-medium text-muted-foreground shadow-[0_0_0_0.5px_var(--border)] backdrop-blur-sm">
              Changed
            </span>
          )}
        </span>
        <span className={cn("flex min-w-0 items-center gap-1 px-0.5", menu && "pr-6 max-md:pr-7")}>
          <span className={cn("min-w-0 truncate text-[12.5px] leading-[16px] max-md:text-[15px] max-md:leading-[20px]", on ? "font-semibold" : "text-muted-foreground")}>{b.name}</span>
          {on && <Check className="size-3.5 shrink-0 text-primary max-md:size-4" strokeWidth={2.75} aria-hidden />}
        </span>
      </button>
      {menu && (
        <button type="button" aria-label={`${b.name}: more`} data-tip="More" data-layout-more={b.id} onClick={(e) => menuBelow(e, menu())}
          className="absolute right-0 bottom-0 grid h-4 w-5.5 cursor-pointer place-items-center rounded-[5px] text-muted-foreground opacity-0 transition-opacity group-hover/tile:opacity-100 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100 max-md:h-5 max-md:w-7 max-md:after:absolute max-md:after:-inset-2.5">
          <MoreHorizontal className="size-4" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}

const Placeholder = () => (
  <div className="w-[132px] shrink-0 max-md:w-auto">
    <div className="skeleton aspect-[16/10] w-full rounded-[8px]" />
    <div className="mt-1.5 h-4 px-0.5"><span className="skeleton block h-[9px] w-[55%] rounded-full" /></div>
  </div>
)

export type LayoutPickerProps = {
  menus?: boolean
  open?: ApplyOptions["open"]
  builtInOnly?: boolean
  silent?: boolean
  onPicked?: (b: BundleInfo) => void
  describe?: "start" | "center"
  className?: string
}

export function LayoutPicker({ menus = true, open = "behind", builtInOnly, silent, onPicked, describe, className }: LayoutPickerProps) {
  const { loaded, list, current } = useLayouts()
  const [shown, choose] = useChosen(current)
  const shownList = builtInOnly ? list.filter((b) => b.source === "app") : list
  useEffect(() => { if (bundlesNow().length) void refreshBundles() }, [])
  const group = useRef<HTMLDivElement>(null)
  const keys = (e: KeyboardEvent) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!by) return
    const all = [...group.current?.querySelectorAll<HTMLElement>("[data-layout-pick]") ?? []]
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    all[(i + by + all.length) % all.length]?.focus()
  }
  const about = shownList.find((b) => b.id === shown)?.description
  const tiles = (
    <div ref={group} role="radiogroup" aria-label="Layout" onKeyDown={keys} data-layout-picker className={cn("flex flex-wrap gap-x-3 gap-y-3.5 py-[5px] pl-[5px] max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-4 max-md:pl-0", className)}>
      {!loaded ? [0, 1, 2].map((i) => <Placeholder key={i} />) : shownList.map((b) => {
        const on = b.id === shown
        return (
          <Tile key={b.id} b={b} on={on} changed={menus ? changedOf(b, b.id === current) : null} menu={menus ? () => menuOf(b, b.id === current, open) : null}
            onPick={() => choose(b.id, async () => { if (await pickLayout(b, { open, silent })) onPicked?.(b) }, `Couldn't switch to ${b.name}`)} />
        )
      })}
    </div>
  )
  if (!describe) return tiles
  return (
    <div data-layout-picker-wrap>
      {tiles}
      {(about || describe === "center") && <p aria-live="polite" data-layout-about className={cn("mt-2 text-[13px] leading-[18px] text-pretty text-muted-foreground max-md:text-[15px] max-md:leading-[20px]",
        describe === "center" ? "mx-auto min-h-[54px] max-w-[400px] text-center max-md:min-h-[60px]" : "line-clamp-2 min-h-[36px] max-w-[600px] pl-[5px] max-md:min-h-[40px] max-md:pl-0")}>{about}</p>}
    </div>
  )
}
