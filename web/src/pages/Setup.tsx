// Setup: Your plugins (a feature at a time), and Get: the store, plugins, layouts and packs together, and imports (layouts
// are picked in Settings > Appearance). Wide, a menu beside them as Settings has; narrow, two tabs; each its own address.
import { Bot, Code, Compass, FileType, HeartPulse, PenLine, Puzzle, Settings2, Shapes, Sparkles, Sprout, Store as StoreIcon, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { openSetup, type SetupTab } from "@/core/apppages"
import { byCategory, categoryTint, switchedOn, usePlugins } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { replaceTabTarget } from "@/core/workspace"
import { DenseRows, PageHeader, Segmented, SheetHead } from "@/components/kit"
import { RailLayout, RailMenu, useRail, type RailItem } from "@/components/RailLayout"
import { StoreBundles, Welcome } from "@/pages/Bundles"
import { Plugins } from "@/pages/Plugins"
import { glide } from "@/core/animation"

type Tab = Exclude<SetupTab, "welcome">

/** `at`: the workspace tab it's drawn in. */
export function Setup({ store, tab, at }: { store: Store; tab: SetupTab; at?: string }) {
  const rail = useRail(), wide = rail[1]
  const pick = (to: SetupTab) => { if (at) replaceTabTarget(at, to); else openSetup(to) }
  if (tab === "welcome") return <div data-setup="welcome"><RailLayout rail={rail} page={tab} side={null}><Welcome store={store} at={at} /></RailLayout></div>
  const page = (t: Tab) => <Plugins store={store} view={t === "get" ? "get" : "installed"} onView={(v) => pick(v === "get" ? "get" : "plugins")}
    above={t === "get" ? (query, filters) => !filters.source && <StoreBundles query={query} /> : undefined} />
  if (wide) return (
    <div data-setup={tab}>
      <RailLayout rail={rail} page={tab} side={<SetupMenu tab={tab} pick={(id) => {
        if (id.startsWith("cat:")) { if (tab !== "plugins") pick("plugins"); jumpTo(id.slice(4)) } else pick(id as Tab)
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
        <PageHeader title="Setup" tabs={
          <Segmented<Tab> label="Setup" value={tab} onChange={pick} big className="w-full md:w-[240px]"
            options={[{ value: "plugins", label: "Plugins", attrs: { "data-setup-tab": "plugins", "data-plugins-installed": "" } }, { value: "get", label: "Get", attrs: { "data-setup-tab": "get", "data-plugins-get": "" } }]} />
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

/** The menu: Your plugins (how many are on) and Get, and under Your plugins its categories (each a jump to its section,
 *  with how many there are). */
function SetupMenu({ tab, pick }: { tab: Tab; pick: (id: string) => void }) {
  const all = usePlugins(), prefs = usePrefs()
  const mine = all.filter((p) => !p.alwaysOn && !p.switchIn)
  const on = mine.filter((p) => switchedOn(p, prefs)).length
  // (the attributes the narrow layout's tabs have, so either is found the same way)
  const items: RailItem[] = [
    { id: "plugins", label: "Your plugins", icon: Puzzle, tint: "var(--blue)", count: on, attrs: { "data-setup-nav": "plugins", "data-setup-tab": "plugins", "data-plugins-installed": "" } },
    { id: "get", label: "Get", icon: StoreIcon, tint: "var(--blue)", attrs: { "data-setup-nav": "get", "data-setup-tab": "get", "data-plugins-get": "" } },
    ...(tab === "plugins" ? byCategory(mine).filter((s) => s.plugins.length).map((s, i) =>
      ({ id: `cat:${s.id}`, label: s.label, icon: CATEGORY_ICONS[s.id] ?? Shapes, tint: categoryTint(s.id), heading: i === 0 ? "Categories" : undefined,
        count: s.plugins.length, attrs: { "data-setup-nav": `cat:${s.id}` } })) : []),
  ]
  return <RailMenu label="Setup" tiles items={items} active={tab} data-setup-list="" pick={pick} />
}
