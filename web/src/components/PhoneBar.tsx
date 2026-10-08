// Phones: the bottom bar, five buttons always in the same place (Back, Forward, new tab, tabs, menu). Back is the
// app's own, since an installed web app has none and Safari's edge swipe would leave it. Dragged up, it opens the tabs.
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Check, ChevronLeft, ChevronRight, Command, FilePlus, Menu, Plus, Search, type LucideIcon } from "lucide-react"
import { tabCount, useWorkspace } from "@/core/workspace"
import { slide } from "@/core/motion"
import { canGoBack, canGoForward } from "@/core/nav"
import { liftFrom } from "@/core/pageLift"
import { usePageLock } from "@/core/pagelock"
import { newPhoneTab, openSwitcher } from "@/core/phoneTabs"
import { shootTab } from "@/core/tabShots"
import { cn } from "@/lib/utils"

export type BarPage = { id: string; label: string; icon: LucideIcon }
type Item = "back" | "forward" | "new" | "tabs" | "menu"
/** The bar, left to right. */
const BAR: Item[] = ["back", "forward", "new", "tabs", "menu"]
const slot = "flex h-11 min-w-0 flex-1 items-center justify-center rounded-[12px] transition-colors"
const idle = "text-muted-foreground active:bg-foreground/[0.06]"
const lit = "bg-foreground/[0.08] text-primary"

const onHistory = (f: () => void) => {
  addEventListener("hashchange", f); addEventListener("popstate", f)
  return () => { removeEventListener("hashchange", f); removeEventListener("popstate", f) }
}
const useCanGoBack = () => useSyncExternalStore(onHistory, canGoBack)
const useCanGoForward = () => useSyncExternalStore(onHistory, canGoForward)

/** The count of open tabs, in a small rounded square: the tab list. */
function TabsButton({ listOpen }: { listOpen: boolean }) {
  const n = tabCount(useWorkspace())
  return (
    <button type="button" data-tabs-button onClick={() => { void openSwitcher() }} aria-label={`Open tabs: ${n}`} aria-expanded={listOpen}
      className={cn(slot, "cursor-pointer", listOpen ? lit : idle)}>
      <span className="grid h-[21px] min-w-[21px] place-items-center rounded-[6px] border-[1.75px] border-current px-[3px] text-[11px] leading-none font-semibold tabular-nums">
        {n > 99 ? "99+" : n}
      </span>
    </button>
  )
}

export function PhoneBar({ system, active, listOpen, onSearch, onCommands, onNewNote }: {
  system: BarPage[]; active: BarPage | null; listOpen: boolean
  onSearch: () => void; onCommands: () => void; onNewNote: () => void
}) {
  const back = useCanGoBack(), forward = useCanGoForward()
  // The menu, open for the page on screen: showing another page, or the tab list, closes it.
  const here = `${active?.id}|${listOpen}|${location.hash}`
  const [menuAt, setMenuAt] = useState<string | null>(null)
  const menu = menuAt === here
  usePageLock(menu)
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuAt(null)
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [menu])
  const inMenu = !!active && system.some((p) => p.id === active.id)
  const nav = useRef<HTMLElement>(null)
  const still = useRef(false)
  still.current = listOpen || menu
  useEffect(() => (nav.current ? liftFrom(nav.current, () => still.current) : undefined), [])
  const item = "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 text-left text-[17px] active:bg-foreground/[0.07]"
  const button = (it: Item) => {
    switch (it) {
      case "back": return (
        <button key={it} type="button" data-bar="back" aria-label="Back" disabled={!back} onClick={() => { void shootTab().then(() => slide(-1)) }}
          className={cn(slot, back ? cn("cursor-pointer", idle) : "text-muted-foreground opacity-35")}>
          <ChevronLeft className="size-[25px]" strokeWidth={2} />
        </button>
      )
      case "forward": return (
        <button key={it} type="button" data-bar="forward" aria-label="Forward" disabled={!forward} onClick={() => { void shootTab().then(() => slide(1)) }}
          className={cn(slot, forward ? cn("cursor-pointer", idle) : "text-muted-foreground opacity-35")}>
          <ChevronRight className="size-[25px]" strokeWidth={2} />
        </button>
      )
      case "new": return (
        <button key={it} type="button" data-bar="new" aria-label="New tab" onClick={(e) => newPhoneTab(e.currentTarget)} className={cn(slot, "cursor-pointer", idle)}>
          <Plus className="size-[25px]" strokeWidth={2} />
        </button>
      )
      case "tabs": return <TabsButton key={it} listOpen={listOpen} />
      case "menu": return (
        <button key={it} type="button" data-bar="menu" aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} aria-controls="bar-menu"
          onClick={() => setMenuAt(menu ? null : here)} className={cn(slot, "cursor-pointer", menu || inMenu ? lit : idle)}>
          <Menu className="size-[22px]" strokeWidth={2} />
        </button>
      )
    }
  }
  return (
    <>
      {menu && (
        <>
          <button type="button" aria-label="Close menu" tabIndex={-1} className="fixed inset-0 z-20 cursor-default md:hidden" onClick={() => setMenuAt(null)} />
          <div className="pointer-events-none fixed inset-x-2 bottom-[calc(var(--phone-bar)+0.5rem)] z-30 mx-auto flex max-w-md justify-end md:hidden">
            <div id="bar-menu" role="menu" className="glass-strong pointer-events-auto w-56 rounded-[12px] p-1 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-150">
              <div>
                <button type="button" role="menuitem" onClick={() => { setMenuAt(null); onNewNote() }} className={item}>
                  <FilePlus className="size-[20px] text-primary" strokeWidth={2} /><span className="flex-1">New note</span>
                </button>
                <button type="button" role="menuitem" data-bar-menu="search" onClick={() => { setMenuAt(null); onSearch() }} className={item}>
                  <Search className="size-[20px] text-primary" strokeWidth={2} /><span className="flex-1">Search</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuAt(null); onCommands() }} className={item}>
                  <Command className="size-[20px] text-primary" strokeWidth={2} /><span className="flex-1">Commands</span>
                </button>
                {system.map((t) => (
                  <a key={t.id} href={`#${t.id}`} role="menuitem" onClick={() => setMenuAt(null)} className={item}>
                    <t.icon className="size-[20px] text-primary" strokeWidth={2} />
                    <span className="flex-1">{t.label}</span>
                    {t.id === active?.id && <Check className="size-[18px] text-primary" strokeWidth={2.5} />}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {/* Its own group in the browser-like transitions (core/motion.ts), so it stays put while the page moves; the tab
          list's bar takes the name while it's open (one at a time). */}
      <nav ref={nav} data-phone-bar aria-label="Navigation" style={{ viewTransitionName: listOpen ? undefined : "phone-bar", touchAction: "none" }}
        className="glass-strong fixed inset-x-0 bottom-0 z-30 px-2 pt-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] md:hidden">
        <div className="mx-auto flex max-w-md items-stretch gap-0.5">{BAR.map(button)}</div>
      </nav>
    </>
  )
}
