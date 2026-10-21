// Setup: what the app is made of, as two tabs. Bundles (whole setups to start from, save and share) and Plugins (a
// feature at a time). Each tab is an address of its own (core/apppages.ts); switching swaps the tab's, adding no history.
import type { Store } from "@/core/data"
import { openSetup, type SetupTab } from "@/core/apppages"
import { replaceTabTarget } from "@/core/workspace"
import { PageHeader, Segmented } from "@/components/kit"
import { Bundles, BundlesActions } from "@/pages/Bundles"
import { Plugins } from "@/pages/Plugins"

/** `at`: the workspace tab it's drawn in. */
export function Setup({ store, tab, at }: { store: Store; tab: SetupTab; at?: string }) {
  // A new vault being offered the bundles: a welcome, only them.
  const welcome = tab === "bundles" && !!store.bundles?.onboarding
  const pick = (to: SetupTab) => { if (at) replaceTabTarget(at, to); else openSetup(to) }
  return (
    <div data-setup={tab}>
      <PageHeader title={welcome ? "Welcome to Vaultite" : "Setup"} subtitle={welcome ? "Pick a setup to start from. You can change all of it later." : undefined}
        tabs={!welcome && (
          <Segmented<SetupTab> label="Setup" value={tab} onChange={pick} big className="w-full md:w-[240px]"
            options={[{ value: "bundles", label: "Bundles", attrs: { "data-setup-tab": "bundles" } }, { value: "plugins", label: "Plugins", attrs: { "data-setup-tab": "plugins" } }]} />
        )}>
        {tab === "bundles" && <BundlesActions store={store} />}
      </PageHeader>
      {tab === "bundles" ? <Bundles store={store} /> : <Plugins store={store} />}
    </div>
  )
}
