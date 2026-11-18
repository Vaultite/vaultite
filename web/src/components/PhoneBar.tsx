import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Check, ChevronLeft, ChevronRight, Command, FilePlus, Menu, Plus, Search, X } from "lucide-react"
import { activeTab, closeTab, closeTabs, tabCount, useWorkspace } from "@/core/workspace"
import { slide } from "@/core/motion"
import { fadeAway } from "@/core/animation"
import { canGoBack, canGoForward, entriesToward } from "@/core/nav"
import { menuAbove } from "@/components/ContextMenu"
import { liftFrom } from "@/core/pageLift"
import { usePageLock } from "@/core/pagelock"
import { newPhoneTab, openSwitcher } from "@/core/phoneTabs"
import { shootTab } from "@/core/tabShots"
import { hrefOf, openAppPage, type AppPage } from "@/core/apppages"
import { cn } from "@/lib/utils"

export const NAV_BUTTON = "grid size-11 shrink-0 cursor-pointer place-items-center text-primary active:opacity-50"
export const BOTTOM_BAR = "fixed inset-x-3 bottom-(--phone-bar-gap) mx-auto max-w-md rounded-full p-0.5"
const fadeAwayOnUnmount = (el: HTMLElement | null) => () => fadeAway([el])
export const BAR_SLOT = "flex h-11 min-w-0 cursor-pointer items-center justify-center rounded-full text-primary transition-colors active:bg-foreground/[0.08] active:duration-0"
export const BAR_PLUS = <Plus className="size-[26px]" strokeWidth={1.6} />

type Item = "back" | "forward" | "new" | "tabs" | "menu"
const BAR: Item[] = ["back", "forward", "new", "tabs", "menu"]
const lit = "bg-foreground/[0.08]"
const off = "text-muted-foreground opacity-35"

const onHistory = (f: () => void) => {
  addEventListener("hashchange", f); addEventListener("popstate", f)
  return () => { removeEventListener("hashchange", f); removeEventListener("popstate", f) }
}
const useCanGoBack = () => useSyncExternalStore(onHistory, canGoBack)
const useCanGoForward = () => useSyncExternalStore(onHistory, canGoForward)
const go = (dir: -1 | 1) => { void shootTab().then(() => slide(dir)) }
const historyMenu = (dir: -1 | 1) => (e: React.MouseEvent) => {
  const items = entriesToward(dir).map(({ steps, title }) => ({ label: title, run: () => { if (steps === dir) go(dir); else history.go(steps) } }))
  if (items.length) menuAbove(e, items)
}

const tabsMenu = (n: number, button: Element | null) => {
  const t = activeTab()
  return [
    { label: "New tab", icon: Plus, run: () => { void newPhoneTab(button) } },
    ...(t ? [
      { label: "Close tab", icon: X, sep: true, run: () => closeTab(t.id) },
      { label: "Close other tabs", run: () => closeTabs("others", t.id), disabled: n < 2 },
      { label: "Close all tabs", danger: true, run: () => closeTabs("all", t.id) },
    ] : []),
  ]
}

function TabsButton({ listOpen }: { listOpen: boolean }) {
  const n = tabCount(useWorkspace())
  return (
    <button type="button" data-tabs-button onClick={() => { void openSwitcher() }} aria-label={`Open tabs: ${n}`} aria-expanded={listOpen}
      onContextMenu={(e) => menuAbove(e, tabsMenu(n, e.currentTarget))}
      className={cn(BAR_SLOT, listOpen && lit)}>
      <span className="num grid h-[22px] min-w-[22px] place-items-center rounded-control border-[1.75px] border-current px-[3px] text-[12px] font-semibold">
        {n > 99 ? "99+" : n}
      </span>
    </button>
  )
}

export function PhoneBar({ system, active, listOpen, onSearch, onCommands, onNewNote }: {
  system: AppPage[]; active: AppPage | null; listOpen: boolean
  onSearch: () => void; onCommands: () => void; onNewNote: () => void
}) {
  const back = useCanGoBack(), forward = useCanGoForward()
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
        <button key={it} type="button" data-bar="back" aria-label="Back" disabled={!back} onClick={() => go(-1)} onContextMenu={historyMenu(-1)}
          className={cn(BAR_SLOT, !back && off)}>
          <ChevronLeft className="size-7" strokeWidth={1.5} />
        </button>
      )
      case "forward": return (
        <button key={it} type="button" data-bar="forward" aria-label="Forward" disabled={!forward} onClick={() => go(1)} onContextMenu={historyMenu(1)}
          className={cn(BAR_SLOT, !forward && off)}>
          <ChevronRight className="size-7" strokeWidth={1.5} />
        </button>
      )
      case "new": return (
        <button key={it} type="button" data-bar="new" aria-label="New tab" onClick={(e) => newPhoneTab(e.currentTarget)} className={BAR_SLOT}>
          {BAR_PLUS}
        </button>
      )
      case "tabs": return <TabsButton key={it} listOpen={listOpen} />
      case "menu": return (
        <button key={it} type="button" data-bar="menu" aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} aria-controls="bar-menu"
          onClick={() => setMenuAt(menu ? null : here)} className={cn(BAR_SLOT, (menu || inMenu) && lit)}>
          <Menu className="size-6" strokeWidth={1.75} />
        </button>
      )
    }
  }
  return (
    <>
      {menu && (
        <>
          <button type="button" aria-label="Close menu" tabIndex={-1} className="fixed inset-0 z-[60] cursor-default md:hidden" onClick={() => setMenuAt(null)} />
          <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--phone-bar)+0.5rem)] z-[61] mx-auto flex max-w-md justify-end md:hidden">
            <div id="bar-menu" role="menu" ref={fadeAwayOnUnmount} className="glass-strong pointer-events-auto w-56 rounded-[12px] p-1 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-(--motion-fast)">
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
                  <a key={t.id} href={hrefOf(t)} role="menuitem" data-bar-menu={t.id} onClick={(e) => { e.preventDefault(); setMenuAt(null); openAppPage(t) }} className={item}>
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
      <nav ref={nav} data-phone-bar aria-label="Navigation" style={{ viewTransitionName: listOpen ? undefined : "phone-bar", touchAction: "none" }}
        className={cn("sight-foot glass-strong z-30 md:hidden", BOTTOM_BAR)}>
        <div className="grid grid-cols-5 gap-0.5">{BAR.map(button)}</div>
      </nav>
    </>
  )
}
