// The welcome card (components/Welcome.tsx): what a computer shows a new vault, what the desktop's first run goes on
// with once its vault opens, and Show welcome in the palette. Phones skip it: a new vault there starts on Standard.
import { offerWelcome, skipOnboarding } from "@/core/bundles"
import { registerCommands } from "@/core/commands"
import { getStore } from "@/core/data"
import { desktop } from "@/core/desktop"
import { notifyError } from "@/core/notify"
import { isDesktop } from "@/core/platform"
import { share } from "@/core/share"
import { signal } from "@/core/signal"

/** `firstRun`: the desktop's Set up Vaultite opened this window (its vault was page one); `newVault`: the vault is still
 *  offered a layout (core/bundles.ts' onboarding), ended as the card closes. */
export type WelcomeAsk = { firstRun: boolean; newVault: boolean }

let shown: WelcomeAsk | null = null
const subs = signal()
export const useWelcome = () => subs.use(() => shown)
export const welcomeOpen = () => !!shown

export function openWelcome(a: Partial<WelcomeAsk> = {}) {
  shown = { firstRun: !!a.firstRun, newVault: !!a.newVault || !!getStore()?.bundles?.onboarding }
  subs.notify()
}
export function closeWelcome() {
  shown = null
  subs.notify()
}

/** As each state comes: the card if the first run brought it (asked once) or once the vault says it's new here. Not
 *  just the first state's word: the server's watcher may hear an offer written just before the page loaded later. */
let asked: Promise<boolean> | null = null
export async function startWelcome() {
  if (share) return
  const first = !asked
  asked ??= desktop?.welcome?.().then((r) => !!r, () => false) ?? Promise.resolve(false)
  const firstRun = first && await asked
  const offered = offerWelcome()
  if (!offered && !firstRun) return
  if (isDesktop()) return openWelcome({ firstRun: firstRun || !!shown?.firstRun, newVault: offered || !!shown?.newVault })
  if (offered) await skipOnboarding().catch((e) => notifyError(e, "Couldn't set up the vault"))
}

registerCommands([{ id: "welcome:open", name: "Show welcome", run: () => openWelcome(), desktop: true, fromLink: true, icon: "hand",
  words: "onboarding first run setup start layout look ai tour" }])
