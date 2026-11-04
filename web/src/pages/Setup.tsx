// Plugins (id "setup"): Your plugins, and Get: the store (plugins, layouts, packs) and imports. Wide, a menu beside them
// as Settings has, with the categories (Yours: jumps; Get: filters); narrow, two tabs. Each its own address.
import { useEffect } from "react"
import { Bot, Code, Compass, FileType, HeartPulse, PenLine, Puzzle, Settings2, Shapes, Sparkles, Sprout, Store as StoreIcon, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { openSetup, type SetupTab } from "@/core/apppages"
import { byCategory, categoryTint, offWithAi, switchedOn, usePlugins } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { replaceTabTarget } from "@/core/workspace"
import { DenseRows, PageHeader, Segmented, SheetHead } from "@/components/kit"
import { RailLayout, RailMenu, useRail, type RailItem } from "@/components/RailLayout"
import { getCategories, getCategory, primeCategories } from "@/components/PluginBrowse"
import { StoreBundles } from "@/pages/Bundles"
import { Plugins } from "@/pages/Plugins"
import { glide } from "@/core/animation"

type Tab = SetupTab

/** `at`: the workspace tab it's drawn in. */
export function Setup({ store, tab, at }: { store: Store; tab: SetupTab; at?: string }) {
  const rail = useRail(), wide = rail[1]
  const pick = (to: SetupTab) => { if (at) replaceTabTarget(at, to); else openSetup(to) }
  const page = (t: Tab) => <Plugins store={store} view={t === "get" ? "get" : "installed"} onView={(v) => pick(v === "get" ? "get" : "plugins")}
    above={t === "get" ? (query, filters) => !filters.source && !filters.cat && <StoreBundles query={query} /> : undefined} />
  if (wide) return (
    <div data-setup={tab}>
      <RailLayout rail={rail} page={tab} side={<SetupMenu tab={tab} pick={(id) => {
        if (id.startsWith("cat:")) {
          const cat = id.slice(4)
          // (Get's: picked again, every category)
          if (tab === "get") getCategory.set(getCategory.get() === cat ? "" : cat)
          else jumpTo(cat)
        } else {
          if (id === "get") getCategory.set("")
          pick(id as Tab)
        }
      }} />}>
        <DenseRows.Provider value>
          {tab === "get"
            ? <SheetHead icon={StoreIcon} tint="var(--blue)" title="Get" sub="Plugins, layouts and packs others made" />
            : <SheetHead icon={Puzzle} tint="var(--blue)" title="Your plugins" sub="A feature at a time, on or off" />}
          {page(tab)}
        </DenseRows.Provider>
      </RailLayout>
    </div>
  )
  return (
    <div data-setup={tab}>
      <RailLayout rail={rail} page={tab} side={null}>
        <PageHeader title="Plugins" tabs={
          <Segmented<Tab> label="Plugins" value={tab} onChange={pick} big className="w-full md:w-[240px]"
            options={[{ value: "plugins", label: "Yours", attrs: { "data-setup-tab": "plugins", "data-plugins-installed": "" } }, { value: "get", label: "Get", attrs: { "data-setup-tab": "get", "data-plugins-get": "" } }]} />
        } />
        {page(tab)}
      </RailLayout>
    </div>
  )
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  navigation: Compass, writing: PenLine, life: Sprout, health: HeartPulse, "ai-apps": Bot, agents: Sparkles, developer: Code, formats: FileType, system: Settings2,
}

/** Scroll Your plugins to a category's section. */
function jumpTo(cat: string) {
  requestAnimationFrame(() => document.querySelector(`[data-setup] [data-plugin-category="${CSS.escape(cat)}"]`)?.scrollIntoView({ behavior: glide(), block: "start" }))
}

/** The menu: Your plugins (how many are on) and Get, then the categories of the one shown (each with how many there
 *  are): Your plugins', a jump to its section; Get's, the directory's, what Get lists (the one picked is lit). */
function SetupMenu({ tab, pick }: { tab: Tab; pick: (id: string) => void }) {
  const all = usePlugins(), prefs = usePrefs()
  const getCats = getCategories.use(), getCat = getCategory.use()
  useEffect(primeCategories, [])
  const mine = all.filter((p) => !p.alwaysOn && !p.switchIn && !offWithAi(p, prefs))
  const on = mine.filter((p) => switchedOn(p, prefs)).length
  const cats = tab === "get" ? getCats : byCategory(mine).filter((s) => s.plugins.length).map((s) => ({ id: s.id, label: s.label, count: s.plugins.length }))
  // (the attributes the narrow layout's tabs have, so either is found the same way)
  const items: RailItem[] = [
    { id: "plugins", label: "Your plugins", icon: Puzzle, tint: "var(--blue)", count: on, attrs: { "data-setup-nav": "plugins", "data-setup-tab": "plugins", "data-plugins-installed": "" } },
    { id: "get", label: "Get", icon: StoreIcon, tint: "var(--blue)", attrs: { "data-setup-nav": "get", "data-setup-tab": "get", "data-plugins-get": "" } },
    ...cats.map((c, i) => ({ id: `cat:${c.id}`, label: c.label, icon: CATEGORY_ICONS[c.id] ?? Shapes, tint: categoryTint(c.id), heading: i === 0 ? "Categories" : undefined,
      count: c.count, attrs: { "data-setup-nav": `cat:${c.id}` } })),
  ]
  const active = tab === "get" && getCats.some((c) => c.id === getCat) ? `cat:${getCat}` : tab
  return <RailMenu label="Plugins" tiles items={items} active={active} data-setup-list="" pick={pick} />
}
