// Plugins (id "setup"): Your plugins, and Get (the store and imports). Wide, sections of Settings (PluginsPane), where a
// pane showing #plugins or #get goes; narrow (a phone), their own page with two tabs, each its own address.
import { useEffect, useLayoutEffect } from "react"
import { Puzzle, Store as StoreIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { openSetup, settingsSection, type SetupTab } from "@/core/apppages"
import { replaceTabTarget } from "@/core/workspace"
import { PageHeader, Segmented, SheetHead } from "@/components/kit"
import { RailLayout, useRail } from "@/components/RailLayout"
import { getCategories, getCategory, primeCategories } from "@/components/PluginBrowse"
import { StoreBundles } from "@/pages/Bundles"
import { Plugins } from "@/pages/Plugins"
import { cn } from "@/lib/utils"

type Tab = SetupTab

/** `at`: the workspace tab it's drawn in. */
export function Setup({ store, tab, at }: { store: Store; tab: SetupTab; at?: string }) {
  const rail = useRail(), wide = rail[1]
  const pick = (to: SetupTab) => { if (at) replaceTabTarget(at, to); else openSetup(to) }
  // Wide, it's Settings' section: the tab shows Settings there (an old tab, a link, a page opened in a new tab).
  useLayoutEffect(() => {
    if (!wide || !at) return
    settingsSection.set(tab)
    replaceTabTarget(at, "settings")
  }, [wide, at, tab])
  return (
    <div data-setup={tab}>
      <RailLayout rail={rail} page={tab} side={null}>
        <PageHeader title="Plugins" tabs={
          <Segmented<Tab> label="Plugins" value={tab} onChange={pick} big className="w-full md:w-[240px]"
            options={[{ value: "plugins", label: "Yours", attrs: { "data-setup-tab": "plugins", "data-plugins-installed": "" } }, { value: "get", label: "Get", attrs: { "data-setup-tab": "get", "data-plugins-get": "" } }]} />
        } />
        <PluginsList store={store} tab={tab} pick={pick} />
      </RailLayout>
    </div>
  )
}

/** The list a tab shows: yours, or Get's (the store's layouts and packs over its plugins, while nothing narrows them). */
function PluginsList({ store, tab, pick }: { store: Store; tab: Tab; pick: (to: Tab) => void }) {
  return <Plugins store={store} view={tab === "get" ? "get" : "installed"} onView={(v) => pick(v === "get" ? "get" : "plugins")}
    above={tab === "get" ? (query, filters) => !filters.source && !filters.cat && <StoreBundles query={query} /> : undefined} />
}

/** Your plugins or Get as a section of Settings: its head, Get's categories as chips, then the list. */
export function PluginsPane({ store, tab, pick }: { store: Store; tab: Tab; pick: (to: Tab) => void }) {
  return (
    <div data-setup={tab}>
      {tab === "get"
        ? <SheetHead icon={StoreIcon} tint="var(--blue)" title="Get plugins" sub="Plugins, layouts and packs others made" />
        : <SheetHead icon={Puzzle} tint="var(--blue)" title="Plugins" sub="Turn features on or off" />}
      {tab === "get" && <Categories />}
      <PluginsList store={store} tab={tab} pick={pick} />
    </div>
  )
}

/** Get's categories, each narrowing what it lists (picked again: every category). */
function Categories() {
  const cats = getCategories.use(), picked = getCategory.use()
  useEffect(primeCategories, [])
  if (!cats.length) return null
  const chip = (id: string, label: string, count?: number) => {
    const on = picked === id
    return (
      <button key={id || "all"} type="button" aria-pressed={on} data-setup-nav={id ? `cat:${id}` : "cat:"}
        onClick={() => getCategory.set(on && id ? "" : id)}
        className={cn("flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors",
          on ? "bg-foreground/[0.1] font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground")}>
        {label}{count !== undefined && <span className="tabular-nums opacity-60">{count}</span>}
      </button>
    )
  }
  return (
    <div role="group" aria-label="Categories" className="-mx-1 mb-3 flex gap-1 overflow-x-auto [scrollbar-width:none]" data-setup-categories>
      {chip("", "All")}
      {cats.map((c) => chip(c.id, c.label, c.count))}
    </div>
  )
}
