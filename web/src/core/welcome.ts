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

/** As the vault loads (once): the card if it's new here or the first run brought it, else nothing. */
let started = false
export async function startWelcome() {
  if (started || share) return
  started = true
  const offered = offerWelcome()
  const firstRun = !!(await desktop?.welcome?.().catch(() => false))
  if (!offered && !firstRun) return
  if (isDesktop()) return openWelcome({ firstRun, newVault: offered })
  if (offered) await skipOnboarding().catch((e) => notifyError(e, "Couldn't set up the vault"))
}

registerCommands([{ id: "welcome:open", name: "Show welcome", run: () => openWelcome(), desktop: true, fromLink: true, icon: "hand",
  words: "onboarding first run setup start layout look ai tour" }])
