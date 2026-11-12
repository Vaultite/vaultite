import { offerWelcome, skipOnboarding } from "@/core/bundles"
import { registerCommands } from "@/core/commands"
import { getStore } from "@/core/data"
import { desktop } from "@/core/desktop"
import { notifyError } from "@/core/notify"
import { isDesktop } from "@/core/platform"
import { share } from "@/core/share"
import { signal } from "@/core/signal"

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
