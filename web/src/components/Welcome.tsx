import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Check, Feather, Monitor, Moon, MousePointerClick, ScanEye, Sun } from "lucide-react"
import { aiOn, codingAgents, setAi, setCompanion, type CodingAgent } from "@/core/ai"
import { skipOnboarding } from "@/core/bundles"
import { appShortcut, firstKeys, keyCaps, keyHint, runCommandById, sameKeys, shortcutOf, typingIn } from "@/core/commands"
import { getStore } from "@/core/data"
import { desktop } from "@/core/desktop"
import { op } from "@/core/http"
import { notifyError } from "@/core/notify"
import { usePageLock } from "@/core/pagelock"
import { usePermissions } from "@/core/permissions"
import { isMac } from "@/core/platform"
import { getPrefs, setPrefs, usePrefs, type Theme } from "@/core/prefs"
import { pluginById, setSwitch, switchedOn } from "@/core/plugins"
import { openSettings, openSetup } from "@/core/apppages"
import { closeWelcome, useWelcome, type WelcomeAsk } from "@/core/welcome"
import { Button } from "@/components/Button"
import { Bar, Segmented } from "@/components/kit"
import { LayoutPicker } from "@/components/LayoutPicker"
import { Dots, PageFoot } from "@/components/WelcomeParts"
import { cn } from "@/lib/utils"
import type { Permission, PermissionReport } from "../../../core/permissions.ts"
import { closestOf, focusableOf } from "@/core/dom"

type Page = "look" | "ai" | "permissions" | "done"
const DOT: Record<Page, number> = { look: 0, ai: 1, permissions: 1, done: 2 }
const LEARN = "switcher:open"
const computer = isMac ? "Mac" : "computer"
const listed = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names)

export const WelcomeCards = memo(function WelcomeCards() {
  const ask = useWelcome()
  return ask ? createPortal(<Welcome ask={ask} />, document.body) : null
})

function Welcome({ ask }: { ask: WelcomeAsk }) {
  const [trail, setTrail] = useState<Page[]>(["look"])
  const [dir, setDir] = useState<1 | -1>(1)
  const [agents, setAgents] = useState<CodingAgent[] | null>(null)
  const [answer, setAnswer] = useState<"use" | "not-now" | null>(null)
  const [busy, setBusy] = useState(false)
  const [pressed, setPressed] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const page = trail[trail.length - 1]
  const found = usable(agents ?? [])
  usePageLock()

  useEffect(() => { codingAgents().then(setAgents, () => setAgents([])) }, [])
  useLayoutEffect(() => {
    const root = document.getElementById("root"), back = document.activeElement
    root?.setAttribute("inert", "")
    return () => { root?.removeAttribute("inert"); focusableOf(back)?.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => { (card.current?.querySelector<HTMLElement>("[data-primary]") ?? card.current)?.focus({ preventScroll: true, focusVisible: false }) }, [page, agents])

  const go = (to: Page) => { setDir(1); setTrail((t) => [...t, to]) }
  const back = trail.length > 1 ? () => { setDir(-1); setTrail((t) => t.slice(0, -1)) } : undefined

  const ending = useRef<Promise<unknown> | null>(null)
  const endOffer = () => (ending.current ??= getStore()?.bundles?.onboarding
    ? skipOnboarding().catch((e) => notifyError(e, "Couldn't set up the vault")) : Promise.resolve())
  const finish = (how: "done" | "skip") => {
    closeWelcome()
    const off = how === "skip" && ask.newVault && !answer
    void endOffer().then(() => { if (off && aiOn()) return setAi(false) })
  }

  const use = async () => {
    setBusy(true)
    try {
      setAnswer("use")
      await endOffer()
      if (!aiOn()) await setAi(true)
      await Promise.all(found.map((a) => { const p = pluginById(a.id); return p && !switchedOn(p, getPrefs()) ? setSwitch(p, true, true) : null }))
      const lead = found.find((a) => Object.keys(pluginById(a.id)?.agents ?? {})[0]) ?? found[0]
      const first = Object.keys(pluginById(lead.id)?.agents ?? {})[0]
      if (first && pluginById("companion")) await setCompanion(first)
      if (ask.firstRun || ask.newVault) await op("vault.starter", { agent: lead.id })
      go(await permissionsWanted() ? "permissions" : "done")
    } catch (e) { notifyError(e, "Couldn't turn on the agents") } finally { setBusy(false) }
  }
  const notNow = () => { setAnswer("not-now"); void endOffer().then(() => { if (aiOn()) return setAi(false) }); go("done") }
  const without = () => { if (ask.firstRun || ask.newVault) notNow(); else go("done") }

  const count = 3, at = DOT[page]
  const next = page === "look" ? () => { void endOffer(); go("ai") } : page === "permissions" ? () => go("done") : page === "done" ? () => finish("done") : null

  const keys = (e: KeyboardEvent) => {
    e.stopPropagation()
    const n = e.nativeEvent
    if (e.key === "Escape") { e.preventDefault(); return finish("skip") }
    const learn = firstKeys(LEARN)
    if (page === "done" && learn && sameKeys(shortcutOf(n), learn)) {
      e.preventDefault()
      if (!pressed) { setPressed(true); setTimeout(() => { finish("done"); runCommandById(LEARN) }, 750) }
      return
    }
    if (appShortcut(n)) { e.preventDefault(); return }
    if (e.defaultPrevented || typingIn(e.target) || closestOf(e.target, "[role=radiogroup]") || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "ArrowRight" && next && page !== "done" && !busy) { e.preventDefault(); next() }
    else if (e.key === "ArrowLeft" && back && !busy) { e.preventDefault(); back() }
  }

  return (
    <div className="welcome-scrim fixed inset-0 z-[80] grid place-items-center p-6" data-welcome-page={page} data-overlay>
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="welcome-title" tabIndex={-1} onKeyDown={keys} data-welcome={ask.firstRun ? "first-run" : ask.newVault ? "new-vault" : "again"}
        className="relative flex w-full max-w-[492px] flex-col overflow-hidden rounded-[16px] border-[0.5px] border-border bg-card text-[13px] shadow-[0_32px_80px_-16px_rgb(0_0_0/0.4),0_4px_14px_rgb(0_0_0/0.1)] outline-none animate-in fade-in zoom-in-[0.97] duration-200">
        {page !== "done" && (
          <Button size="small" look="quiet" className="absolute top-3 right-3 z-[1] h-6.5 px-2 text-[12.5px]" onClick={() => finish("skip")} data-welcome-skip>Skip</Button>
        )}
        <div key={page} className={cn("flex min-h-[300px] flex-col justify-center px-[32px] pt-9 pb-3 animate-in fade-in duration-200", dir > 0 ? "slide-in-from-right-3" : "slide-in-from-left-3")} data-welcome-body={page}>
          {page === "look" && <LookPage />}
          {page === "ai" && <AiPage agents={agents} />}
          {page === "permissions" && <PermissionsPage />}
          {page === "done" && <DonePage pressed={pressed} finish={() => finish("done")} />}
        </div>
        <PageFoot className="px-5 pt-2 pb-5"
          left={back && <Button look="quiet" className="h-8 px-3 text-[13px]" disabled={busy} onClick={back} data-welcome-back>Back</Button>}
          dots={<Dots count={count} at={at} />}
          right={page === "ai" ? (
            !agents ? <span className="skeleton h-8 w-[92px] rounded-[8px]" />
              : found.length ? <>
                <Button look="secondary" className="h-8 px-3.5 text-[13px]" disabled={busy} onClick={notNow} data-welcome-not-now>Not now</Button>
                <Button look="primary" className="h-8 px-3.5 text-[13px]" busy={busy} onClick={() => void use()} data-welcome-use>{found.length > 1 ? "Use them" : "Use it"}</Button>
              </>
                : <Button look="primary" className="h-8 min-w-[92px] px-4 text-[13px]" onClick={without} data-primary data-welcome-next>Continue</Button>
          ) : (
            <Button look="primary" className="h-8 min-w-[92px] px-4 text-[13px]" onClick={() => next?.()} data-primary data-welcome-next>
              {page === "done" ? "Done" : page === "permissions" ? "Continue" : "Next"}
            </Button>
          )} />
      </div>
    </div>
  )
}

function Head({ title, children, art }: { title: string; children?: ReactNode; art?: ReactNode }) {
  return (
    <div className="flex flex-col items-center pb-6 text-center">
      {art}
      <h2 id="welcome-title" className="text-[19px] leading-[24px] font-semibold tracking-[-0.01em] text-balance">{title}</h2>
      {children && <p className="mt-1.5 max-w-[380px] text-[13px] leading-[18px] text-balance text-muted-foreground">{children}</p>}
    </div>
  )
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "System", icon: Monitor }]

function LookPage() {
  const { theme } = usePrefs()
  return (
    <>
      <Head title="Choose a layout">It changes behind this card as you pick. {"Settings > Appearance"} has it too.</Head>
      <LayoutPicker builtInOnly menus={false} open="none" silent describe="center" className="flex-nowrap justify-center gap-x-[12px]" />
      <Segmented<Theme> label="Theme" value={theme} onChange={(t) => setPrefs({ theme: t })} options={THEMES.map((t) => ({ ...t, attrs: { "data-welcome-theme": t.value } }))}
        className="mx-auto mt-4 w-full max-w-[300px]" />
    </>
  )
}

const usable = (agents: CodingAgent[]) => agents.filter((a) => a.path && a.plugin)

function AiPage({ agents }: { agents: CodingAgent[] | null }) {
  if (!agents) return (
    <div className="loading-in flex flex-col items-center gap-2 pb-6" aria-busy data-welcome-loading>
      <span className="mb-3 flex gap-2"><span className="skeleton size-11 rounded-[12px]" /><span className="skeleton size-11 rounded-[12px]" /></span>
      <span className="w-full text-center text-[19px]"><Bar w="62%" /></span>
      <span className="w-full text-center"><Bar w="78%" /></span>
    </div>
  )
  const found = usable(agents)
  const more = agents.filter((a) => a.path && !a.plugin).map((a) => a.name)
  const also = more.length ? `${listed(more)} ${more.length === 1 ? "is" : "are"} here too: Settings > AI can add ${more.length === 1 ? "it" : "them"}.` : ""
  if (!found.length) return (
    <div data-welcome-ai="none">
      <Head title="Vaultite works fully without AI" art={<Art><Feather className="size-5.5" strokeWidth={1.75} /></Art>}>
        {more.length ? `${listed(more)} ${more.length === 1 ? "is" : "are"} on this ${computer}: Settings > AI can add ${more.length === 1 ? "it" : "them"}, and connect the Claude or ChatGPT app.` : "You can connect the Claude or ChatGPT app, or a coding agent, any time in Settings."}
      </Head>
    </div>
  )
  const one = found.length === 1
  return (
    <div data-welcome-ai="found">
      <Head title={`${listed(found.map((a) => a.name))} ${one ? "is" : "are"} on this ${computer}`}
        art={<span className="mb-4 flex gap-2">{found.slice(0, 4).map((a) => <AgentMark key={a.id} a={a} />)}</span>}>
        Use {one ? "it" : "them"} in Vaultite? {one ? "It works" : "They work"} in its terminals and on your notes, when you ask. {also || "You can change this in Settings."}
      </Head>
    </div>
  )
}

const Art = ({ children }: { children: ReactNode }) => (
  <span className="mb-4 grid size-11 place-items-center rounded-[12px] bg-foreground/[0.05] text-muted-foreground shadow-[inset_0_0_0_0.5px_var(--border)]">{children}</span>
)

function AgentMark({ a }: { a: CodingAgent }) {
  const Icon = pluginById(a.id)?.icon
  return <Art>{Icon ? <Icon className="size-5.5 text-foreground" strokeWidth={1.75} /> : <span className="text-[15px] font-semibold text-foreground">{a.name[0]}</span>}</Art>
}

const WANT: Record<string, { icon: typeof Sun; why: string }> = {
  accessibility: { icon: MousePointerClick, why: "To click and type in your apps" },
  screen: { icon: ScanEye, why: "To see what's on your screen" },
}
const readReport = () => op<PermissionReport>("app.permissions")
const press = (id: string) => desktop!.permission!(id)
const listOf = (r: PermissionReport) => r.mac?.permissions

async function permissionsWanted() {
  if (!isMac || !desktop?.permission) return false
  try { return !!(await readReport()).mac?.permissions.some((p) => WANT[p.id] && p.state !== "allowed") } catch { return false }
}

function PermissionsPage() {
  const { report, grant, pending } = usePermissions(readReport, press, listOf)
  const rows = report?.mac?.permissions.filter((p) => WANT[p.id]) ?? null
  const asked = useRef(false)
  const allow = (id: string) => {
    if (!asked.current && desktop?.computerUse) {
      asked.current = true
      desktop.computerUse().then((failed) => { const f = Object.values(failed)[0]; if (f) notifyError(new Error(f), "Couldn't turn on computer use") }, (e) => notifyError(e, "Couldn't turn on computer use"))
    }
    grant(id).catch((e) => notifyError(e, "Couldn't open System Settings"))
  }
  return (
    <div data-welcome-permissions>
      <Head title={`Let agents use your ${computer}`}>Optional. With these, agents can see your screen and use your apps, only when you ask.</Head>
      <div className="flex flex-col gap-2">
        {!rows ? [0, 1].map((i) => (
          <div key={i} className="loading-in flex h-[58px] items-center gap-3 rounded-[11px] px-3.5 shadow-[inset_0_0_0_0.5px_var(--border)]" aria-busy>
            <span className="skeleton size-5 rounded-[6px]" />
            <span className="flex-1"><span className="block"><Bar w={i ? "36%" : "30%"} /></span><span className="block text-[12px]"><Bar w={i ? "52%" : "58%"} /></span></span>
            <span className="skeleton h-7 w-16 rounded-[6px]" />
          </div>
        )) : rows.map((p) => <PermissionRow key={p.id} p={p} busy={pending.has(p.id)} onAllow={() => allow(p.id)} />)}
      </div>
    </div>
  )
}

function PermissionRow({ p, busy, onAllow }: { p: Permission; busy: boolean; onAllow: () => void }) {
  const { icon: Icon, why } = WANT[p.id], on = p.state === "allowed"
  return (
    <div className="flex min-h-[58px] items-center gap-3 rounded-[11px] px-3.5 py-2.5 shadow-[inset_0_0_0_0.5px_var(--border)]" data-permission={p.id} data-state={p.state}>
      <Icon className={cn("size-5 shrink-0 transition-colors", on ? "text-ink-(--green)" : "text-muted-foreground")} strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{p.name}</span>
        <span className="block text-[12px] leading-[16px] text-muted-foreground">{why}</span>
      </span>
      {on
        ? <span className="dot-in flex items-center gap-1 text-[12.5px] font-medium text-ink-(--green)" data-allowed><Check className="size-3.5" strokeWidth={2.75} />Allowed</span>
        : <Button size="small" look="secondary" busy={busy} onClick={onAllow} data-act={p.id}>Allow…</Button>}
    </div>
  )
}

function DonePage({ pressed, finish }: { pressed: boolean; finish: () => void }) {
  const keys = firstKeys(LEARN)
  const settings = () => { finish(); openSettings("appearance") }
  const plugins = () => { finish(); openSetup("plugins") }
  return (
    <div className="flex flex-1 flex-col items-center text-center" data-welcome-done={pressed ? "pressed" : ""}>
      <div className="flex flex-1 flex-col items-center justify-center">
      {keys && (
        <span className={cn("mb-6 flex items-center gap-1.5 transition-transform duration-150", pressed && "scale-[0.96]")} aria-hidden>
          {keyCaps(keys).map((k, i) => (
            <kbd key={i} className={cn("grid h-12 min-w-12 place-items-center rounded-[10px] px-3 font-keys text-[20px] leading-none transition-[background-color,color,box-shadow] duration-200",
              pressed ? "bg-primary text-primary-foreground shadow-[0_1px_0_rgb(0_0_0/0.15)]"
                : "bg-card text-foreground shadow-[inset_0_0_0_0.5px_var(--border),0_1.5px_0_color-mix(in_oklab,var(--foreground)_14%,transparent)]")}>{k}</kbd>
          ))}
        </span>
      )}
      <h2 id="welcome-title" className="text-[19px] leading-[24px] font-semibold tracking-[-0.01em]">{pressed ? "That's the one" : "You're all set"}</h2>
      <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground" aria-live="polite">
        {keys ? (pressed ? "It finds any note in a moment." : <>Press {keyHint(keys)} to find any note.</>) : "Your vault is ready."}
      </p>
      </div>
      <p className="pt-6 pb-1 text-[12px] leading-[16px] text-muted-foreground">
        Change the layout in <TextLink onClick={settings}>Settings</TextLink>, and add features in <TextLink onClick={plugins}>Plugins</TextLink>.
      </p>
    </div>
  )
}

const TextLink = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="cursor-pointer font-medium text-foreground underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground/60 focus-visible:rounded-[3px] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none">{children}</button>
)
