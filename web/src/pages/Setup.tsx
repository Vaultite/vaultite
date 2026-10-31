// Setup: what the app is made of. Bundles (whole setups to start from, save and share) and Plugins (a feature at a time),
// each yours or to get. Wide, a menu beside them as Settings has; narrow, two tabs. Each tab is an address of its own.
import { Bot, Code, Compass, Download, FileType, HeartPulse, Package, PenLine, Puzzle, Settings2, Shapes, Sparkles, Sprout, Store as StoreIcon, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { openSetup, type SetupTab } from "@/core/apppages"
import { byCategory, categoryTint, switchedOn, usePlugins } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { cell } from "@/core/signal"
import { replaceTabTarget } from "@/core/workspace"
import { DenseRows, PageHeader, Segmented, SheetHead } from "@/components/kit"
import { RailLayout, RailMenu, useRail, type RailItem } from "@/components/RailLayout"
import { Bundles, BundlesActions, type BundlesView } from "@/pages/Bundles"
import { Plugins, type PluginsView } from "@/pages/Plugins"

/** Yours or to get, on each tab: kept while the app runs. */
const bundlesView = cell<BundlesView>("yours")
const pluginsView = cell<PluginsView>("installed")

/** `at`: the workspace tab it's drawn in. */
export function Setup({ store, tab, at }: { store: Store; tab: SetupTab; at?: string }) {
  const rail = useRail(), wide = rail[1]
  // A new vault being offered the bundles: a welcome, only them.
  const welcome = tab === "bundles" && !!store.bundles?.onboarding
  const pick = (to: SetupTab) => { if (at) replaceTabTarget(at, to); else openSetup(to) }
  const bv = bundlesView.use(), pv = pluginsView.use()
  if (wide && !welcome) return (
    <div data-setup={tab}>
      <RailLayout rail={rail} page={`${tab}:${tab === "bundles" ? bv : pv}`}
        side={<SetupMenu tab={tab} bv={bv} pv={pv} pick={(t, v) => {
          if (t === "bundles") bundlesView.set(v as BundlesView)
          else if (v.startsWith("cat:")) { pluginsView.set("installed"); jumpTo(v.slice(4)) }
          else pluginsView.set(v as PluginsView)
          if (t !== tab) pick(t)
        }} />}>
        <DenseRows.Provider value>
          {tab === "bundles" ? <>
            <SheetHead icon={bv === "get" ? Download : Package} tint="var(--purple)" title={bv === "get" ? "Get bundles" : "Your bundles"}
              sub={bv === "get" ? "Setups others shared, to try or keep" : "Whole setups: try one, save and share yours"} />
            <Bundles store={store} view={bv} onView={(v) => bundlesView.set(v)} />
          </> : <>
            <SheetHead icon={pv === "get" ? StoreIcon : Puzzle} tint="var(--blue)" title={pv === "get" ? "Get plugins" : "Your plugins"}
              sub={pv === "get" ? "From Vaultite's directory and other sources" : "A feature at a time, on or off"} />
            <Plugins store={store} view={pv} onView={(v) => pluginsView.set(v)} />
          </>}
        </DenseRows.Provider>
      </RailLayout>
    </div>
  )
  return (
    <div data-setup={tab}>
      <RailLayout rail={rail} page={tab} side={null}>
        <PageHeader title={welcome ? "Welcome to Vaultite" : "Setup"} subtitle={welcome ? "Pick a setup to start from. You can change all of it later." : undefined}
          tabs={!welcome && (
            <Segmented<SetupTab> label="Setup" value={tab} onChange={pick} big className="w-full md:w-[240px]"
              options={[{ value: "bundles", label: "Bundles", attrs: { "data-setup-tab": "bundles" } }, { value: "plugins", label: "Plugins", attrs: { "data-setup-tab": "plugins" } }]} />
          )}>
          {tab === "bundles" && <BundlesActions store={store} />}
        </PageHeader>
        {tab === "bundles" ? <Bundles store={store} /> : <Plugins store={store} />}
      </RailLayout>
    </div>
  )
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  navigation: Compass, writing: PenLine, life: Sprout, health: HeartPulse, "ai-apps": Bot, agents: Sparkles, developer: Code, formats: FileType, system: Settings2,
}

/** Scroll Your plugins to a category's section. */
function jumpTo(cat: string) {
  requestAnimationFrame(() => document.querySelector(`[data-setup] [data-plugin-category="${CSS.escape(cat)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }))
}

/** The menu: Bundles and Plugins, each yours or to get, and under Your plugins its categories (each a jump to its
 *  section, with how many are on). */
function SetupMenu({ tab, bv, pv, pick }: { tab: SetupTab; bv: BundlesView; pv: PluginsView; pick: (tab: SetupTab, view: string) => void }) {
  const all = usePlugins(), prefs = usePrefs()
  const mine = all.filter((p) => !p.alwaysOn && !p.switchIn)
  const on = mine.filter((p) => switchedOn(p, prefs)).length
  // (the attributes the narrow layout's tabs have, so either is found the same way)
  const item = (id: string, label: string, icon: RailItem["icon"], tint: string, attr: `data-${string}`, more: Partial<RailItem> = {}): RailItem =>
    ({ id, label, icon, tint, attrs: { "data-setup-nav": id, [attr]: "" }, ...more })
  const items: RailItem[] = [
    item("bundles:yours", "Your bundles", Package, "var(--purple)", "data-bundles-yours", { heading: "Bundles", attrs: { "data-setup-nav": "bundles:yours", "data-bundles-yours": "", "data-setup-tab": "bundles" } }),
    item("bundles:get", "Get bundles", Download, "var(--purple)", "data-bundles-get"),
    item("plugins:installed", "Your plugins", Puzzle, "var(--blue)", "data-plugins-installed", { heading: "Plugins", count: on, attrs: { "data-setup-nav": "plugins:installed", "data-plugins-installed": "", "data-setup-tab": "plugins" } }),
    item("plugins:get", "Get plugins", StoreIcon, "var(--blue)", "data-plugins-get"),
    ...(tab === "plugins" && pv === "installed" ? byCategory(mine).filter((s) => s.plugins.length).map((s, i) =>
      ({ id: `plugins:cat:${s.id}`, label: s.label, icon: CATEGORY_ICONS[s.id] ?? Shapes, tint: categoryTint(s.id), heading: i === 0 ? "Categories" : undefined,
        count: s.plugins.length, attrs: { "data-setup-nav": `cat:${s.id}` } })) : []),
  ]
  const active = tab === "bundles" ? `bundles:${bv}` : `plugins:${pv}`
  return <RailMenu label="Setup" tiles items={items} active={active} data-setup-list=""
    pick={(id) => { const [t, ...v] = id.split(":"); pick(t as SetupTab, v.join(":")) }} />
}
