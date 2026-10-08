// A plugin's detail sheet: what it does, its switch and settings, a vault plugin's approval on this machine (what changed,
// what it says it does, Allow), and an inert live preview of its dashboards with made-up data (core/mock.ts).
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRight, Folder, Server, Settings2, ShieldAlert } from "lucide-react"
import { dateText, PreviewLive, type Store } from "@/core/data"
import { mockStore } from "@/core/mock"
import { noteParts } from "@/core/frontmatter"
import { allowPlugin, hostOf, isEnabled, names, pageViewOf, pluginById, PLUGINS, setSwitch, switchedOn, templatesOf, tintOfPlugin, usePluginsVersion, type Plugin } from "@/core/plugins"
import { openWebLink } from "@/core/links"
import { disclosed } from "../../../core/pluginmeta.ts"
import { usePrefs } from "@/core/prefs"
import { hasSettings, openPluginSettings, settingsFile } from "@/core/pluginSettings"
import { openFile } from "@/core/files"
import { showInTree } from "@/components/FileTree"
import { Where } from "@/components/PluginSettings"
import { Catch } from "@/components/Guard"
import { confirmDialog } from "@/components/ConfirmDialog"
import { List, PageHeader, Row, Section, SheetHead, Switch } from "@/components/kit"
import { capitalize, cn } from "@/lib/utils"

const noPreview = () => <p className="p-6 text-center text-[15px] text-muted-foreground">No preview for this one yet.</p>

function preview(p: Plugin, s: Store, disabled: string[]): ReactNode {
  if (typeof p.preview === "function") return p.preview(s)
  const pages = templatesOf(typeof p.preview === "string" ? p.preview : p.id)
  if (!pages.length) return null
  // Shown even while it's off (that's what the switch above would bring).
  const on = disabled.filter((id) => id !== p.id && !(p.requires ?? []).includes(id))
  // Drawn as the page it would be (Dashboards' grid, even while that's off).
  const view = pageViewOf("dashboard")
  if (!view) return null
  return pages.map(({ name, text }) => {
    const { fm: props, body } = noteParts(text)
    const sub = typeof props.subtitle === "string" ? props.subtitle.replace("{date}", dateText(new Date(), { weekday: "long", day: "numeric", month: "long" })) : undefined
    return (
      <div key={name}>
        <PageHeader title={name} subtitle={sub} className="md:pt-6" />
        {view.render({ store: s, path: `Dashboards/${name}.md`, fm: props, body, title: name, place: "page", disabled: on })}
      </div>
    )
  })
}

// Every plugin's made-up live data, so a page that shows another plugin's cards (Today's calendar) previews fully.
const mockLive = () => Object.assign({}, ...PLUGINS.map((p) => p.mockLive?.() ?? {}))

/** A small window onto the page: laid out at phone or desktop width, then zoomed to fit the sheet. */
function Frame({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const inner = matchMedia("(min-width: 768px)").matches ? 960 : 390
  useLayoutEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  return (
    // The scrollbar's room is kept either way, and nothing scrolls sideways (the zoom rounds): else a scrollbar coming
    // narrows the frame, the zoom shrinks the page, the scrollbar goes, and round again (a flicker).
    <div ref={box} className="h-[440px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[12px] border-[0.5px] border-border bg-background [scrollbar-gutter:stable]">
      {w > 0 && (
        // translateZ(0) keeps position: fixed parts (the phone's compact title bar) inside the frame.
        <div inert style={{ width: inner, zoom: w / inner, transform: "translateZ(0)" }} className="px-4 pb-6">
          {children}
        </div>
      )}
    </div>
  )
}

/** Where it's kept in the vault: a vault plugin's folder; an app plugin only has its settings file there, once set. */
function Kept({ plugin, files }: { plugin: Plugin; files: string[] }) {
  const folder = plugin.folder
  if (folder) return <div className="mt-5"><Where path={folder} lead="Kept in" icon={Folder} open={() => showInTree(folder)} /></div>
  if (!files.includes(plugin.id)) return null
  const file = settingsFile(plugin.id)
  return <div className="mt-5"><Where path={file} lead="Settings kept in" open={() => openFile(file)} /></div>
}

const sentence = (s: string) => s[0].toUpperCase() + s.slice(1)
const button = "h-9 cursor-pointer rounded-[8px] px-3.5 text-[15px] font-medium transition-colors md:h-8 md:text-[13px]"

/** On in the vault but not allowed on this machine at this version: why, what changed, what it says it does, and Allow. */
function Approval({ plugin }: { plugin: Plugin }) {
  const a = plugin.meta!.approval!
  const says = disclosed(plugin.meta!.disclosures)
  const shown = a.changed.slice(0, 8)
  const host = plugin.tier === "hosted" ? hostOf(plugin) : null
  return (
    <div className="mb-5 rounded-[10px] bg-muted px-3.5 py-3" data-plugin-approval={plugin.id}>
      <div className="flex items-center gap-2 text-[15px] font-medium">
        <ShieldAlert className="size-[18px] shrink-0 text-[var(--orange)]" strokeWidth={2} />
        {a.state === "new" ? "Waiting for you to allow it on this machine" : "Changed since you allowed it"}
      </div>
      <p className="mt-1 text-[14px] leading-[19px] text-muted-foreground md:text-[13px] md:leading-[18px]">
        {host ? host.trust ?? "It runs code on this machine."
          : a.state === "new" ? "It's on in this vault, but this machine hasn't run it: it came by sync, a shared vault or a bundle."
          : `Its files changed since you allowed ${a.since ? `version ${a.since}` : "it"}, here or wherever the vault syncs.`}{host ? "" : " It runs code on this machine, so nothing of it runs until you allow it."} Allow
        it only if you trust where it came from.
      </p>
      {a.state === "changed" && shown.length > 0 && (
        <p className="mt-1.5 font-mono text-[12px] leading-[17px] break-words text-muted-foreground" data-plugin-changed>
          {shown.join(", ")}{a.changed.length > shown.length ? ` and ${a.changed.length - shown.length} more` : ""}
        </p>
      )}
      {says.length > 0 && <p className="mt-1.5 text-[14px] leading-[19px] text-[var(--orange)] md:text-[13px] md:leading-[18px]" data-plugin-discloses>{host ? "A look at its code found it can" : "It says it"} {says.join("; ")}.</p>}
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => void allowPlugin(plugin)} data-plugin-allow={plugin.id}
          className={cn(button, "bg-primary text-primary-foreground hover:opacity-90")}>Allow</button>
        <button type="button" onClick={() => setSwitch(plugin, false)} className={cn(button, "bg-foreground/[0.06] hover:bg-foreground/[0.1]")}>{host ? "Not now" : "Turn off"}</button>
      </div>
    </div>
  )
}

/** A vault plugin's version, author, repository, support link, where it was installed from, and what it says it does. */
function About({ plugin }: { plugin: Plugin }) {
  const m = plugin.meta!
  const says = disclosed(m.disclosures)
  const from = m.source
  if (!m.version && !m.author && !m.repo && !m.fundingUrl && !from && !says.length) return null
  const link = (url: string, text: string) => <button type="button" onClick={() => openWebLink(url)} className="cursor-pointer text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground">{text}</button>
  return (
    <>
      {says.length > 0 && (
        <Section title="What it says it does" className="mb-5">
          <List>{says.map((x) => <Row key={x} title={sentence(x)} />)}</List>
        </Section>
      )}
      <Section title="About" className="mb-5">
        <List>
          {m.version && <Row title="Version" right={m.version} />}
          {m.author && <Row title="Author" right={m.author} />}
          {m.repo && <Row title="Repository" right={link(`https://github.com/${m.repo}`, m.repo)} />}
          {m.fundingUrl && <Row title={plugin.tier === "hosted" ? "Website" : "Support it"} right={link(m.fundingUrl, new URL(m.fundingUrl).host)} />}
          {from && <Row title="Installed from" right={<span data-tip={from.source}>{from.repo ?? from.source}{from.tag ? ` ${from.tag}` : from.commit ? ` at ${from.commit.slice(0, 7)}` : ""}, {dateText(new Date(`${from.installed}T12:00:00`), { day: "numeric", month: "short", year: "numeric" })}</span>} />}
        </List>
      </Section>
    </>
  )
}

// (the "core" tier's plugins are the app's built-in ones: "core" alone is the app itself; those not `essential` are
// Vaultite plugins, first-party extras)
const kickerOf = (p: Plugin) => (p.tier === "vault" ? "Vault plugin" : p.essential ? "Built-in plugin" : "Vaultite plugin")

export function PluginPreview({ store, plugin: given }: { store: Store; plugin: Plugin }) {
  usePluginsVersion()
  // (as it is now: a vault plugin changes while its sheet is open, allowed or edited)
  const plugin = pluginById(given.id) ?? given
  const prefs = usePrefs(), { disabled } = prefs
  const waiting = switchedOn(plugin, prefs) && !plugin.problems?.length && !!plugin.meta?.approval
  const on = switchedOn(plugin, prefs) && !plugin.problems?.length && !waiting
  const mock = useMemo(() => mockStore(store), [store])
  const live = useMemo(mockLive, [])
  const blocked = (plugin.requires ?? []).filter((r) => !isEnabled(r, disabled))
  const toggle = (v: boolean) => setSwitch(plugin, v)
  return (
    <>
      <SheetHead icon={plugin.icon} tint={tintOfPlugin(plugin.id)} kicker={plugin.tier === "hosted" ? capitalize(hostOf(plugin)?.kind) : kickerOf(plugin)}
        title={plugin.name} sub={plugin.description} />
      {waiting ? <Approval plugin={plugin} /> : (
        <div className="mb-5 flex min-h-11 items-center gap-3 rounded-[10px] bg-muted px-3.5">
          <span className="flex-1 text-[15px]">{on && !blocked.length ? "On" : "Off"}</span>
          <Switch on={on && !blocked.length} onChange={toggle} label={`${plugin.name} plugin`} disabled={!!blocked.length} />
        </div>
      )}
      {/* A plugin its owner writes here: its edits may run without asking each time (never one installed from elsewhere). */}
      {plugin.tier === "vault" && on && !plugin.meta?.source && (
        <div className="-mt-3 mb-5 flex min-h-11 items-center gap-3 rounded-[10px] bg-muted px-3.5" data-plugin-edits={plugin.id}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Run its edits without asking</span>
            <span className="block text-[13px] leading-[18px] text-muted-foreground">While you write it on this machine. Anyone who can change the vault's files could then run code here.</span>
          </span>
          <Switch on={!!plugin.meta?.edits} onChange={(v) => void allowPlugin(plugin, v)} label={`Run ${plugin.name}'s edits without asking`} />
        </div>
      )}
      {on && !blocked.length && hasSettings(plugin, store.pluginSettings ?? []) && (
        <button type="button" onClick={() => openPluginSettings(plugin.id)} data-plugin-settings-open
          className="-mt-3 mb-5 flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[10px] bg-muted px-3.5 text-left hover:bg-foreground/[0.07]">
          <Settings2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="flex-1 text-[15px]">Settings</span>
          <ChevronRight className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
        </button>
      )}
      {plugin.meta && <About plugin={plugin} />}
      {/* Only what this plugin builds on, like VS Code's Dependencies tab (never what builds on it). */}
      {(plugin.requires || plugin.enhances || plugin.runsOnServer) && (
        <Section title="Works with" className="mb-5">
          <List>
            {plugin.requires && <Row title="Needs" right={
              <span className={cn(!!blocked.length && "dashed-under")}
                data-tip={blocked.length ? `Turn on ${names(blocked)} to use this` : undefined}>{names(plugin.requires)}</span>} />}
            {plugin.enhances && <Row title="Does more with" right={names(plugin.enhances)} />}
            {plugin.runsOnServer && <Row title="Runs on" right={<span className="flex items-center gap-1.5"><Server className="size-3.5" />The server's machine</span>} />}
          </List>
        </Section>
      )}
      {!!plugin.problems?.length && (
        <Section title="Problems" className="mb-5">
          <div className="space-y-2" data-plugin-problems>
            {plugin.problems.map((p, i) => (
              <p key={i} className="rounded-[10px] bg-muted px-3.5 py-2.5 font-mono text-[12px] leading-[18px] break-words whitespace-pre-wrap text-[var(--red)]">{p}</p>
            ))}
          </div>
        </Section>
      )}
      {/* A vault plugin's blocks without a declaration or a text side (core/rules.ts blockProblems): it runs anyway. */}
      {!!plugin.warnings?.length && (
        <Section title="To fix" className="mb-5">
          <div className="space-y-2" data-plugin-warnings>
            {plugin.warnings.map((p, i) => (
              <p key={i} className="rounded-[10px] bg-muted px-3.5 py-2.5 font-mono text-[12px] leading-[18px] break-words whitespace-pre-wrap text-muted-foreground">{p}</p>
            ))}
          </div>
        </Section>
      )}
      {plugin.tier === "vault" && !on ? (
        <p className="px-1 text-[15px] text-muted-foreground">
          A vault plugin runs code on the machine that serves this app, so nothing of it runs, not even its preview, until you turn it on.
          Turn on only plugins you trust.
        </p>
      ) : preview(plugin, mock, disabled) && (
        <PreviewLive.Provider value={live}><Frame><Catch fallback={noPreview}>{preview(plugin, mock, disabled)}</Catch></Frame></PreviewLive.Provider>
      )}
      <Kept plugin={plugin} files={store.pluginSettings ?? []} />
      {plugin.tier === "hosted" && hostOf(plugin)?.uninstall && (
        <button type="button" data-plugin-uninstall={plugin.id} className={cn(button, "mt-5 bg-foreground/[0.06] text-[var(--red)] hover:bg-foreground/[0.1]")}
          onClick={async () => { if (await confirmDialog({ title: `Uninstall ${plugin.name}?`, body: "Its files are removed from this vault. Its settings stay, in case you install it again.", confirm: "Uninstall", danger: true })) await hostOf(plugin)?.uninstall?.(plugin.id) }}>Uninstall</button>
      )}
    </>
  )
}
