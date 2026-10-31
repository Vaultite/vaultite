// Settings > Appearance, in groups: colours (gallery under More…), the window, tabs, text (this device's sizes), a phone's
// pull-down actions, snippets. Saved in appearance.json; rows off their default show a reset.
import { useState, type ReactNode } from "react"
import { Check, FolderOpen, Minus, Palette, Plus, Type } from "lucide-react"
import { onlyMode, SNIPPETS_FOLDER, THEMES_FOLDER, useVaultAppearance } from "@/core/appearance"
import { openFile } from "@/core/files"
import { openDetail } from "@/core/nav"
import { opensChoices, setOpens } from "@/core/launcher"
import { getPrefs, setPrefs, usePrefs, type Density, type Theme } from "@/core/prefs"
import { DEFAULT_SCHEME, SCHEMES, schemeId } from "@/themes/schemes"
import { STEPS, stepTextSize, textSizeKinds, useTextSize } from "@/core/textsize"
import { coreSwitch } from "@/core/switches"
import { SwitchRow } from "@/components/SwitchRow"
import { cn, isDark } from "@/lib/utils"
import { useDesktop } from "@/core/platform"
import { canOpenHere, openOnComputer } from "@/components/FileActions"
import { post } from "@/core/http"
import { FontPicker } from "@/components/FontPicker"
import { FONTS, fontPicker, type FontKey } from "@/components/FontChooser"
import { Group, ResetButton, Section, SettingRow, SheetHead, Switch } from "@/components/kit"
import { PictureChoice, SystemPicture, WindowPicture, type Scene } from "@/components/ChoicePictures"
import { errorText } from "@/core/notify"
import { available, commandList, useCommandList } from "@/core/commands"
import { choose } from "@/components/Chooser"
import { DEFAULT_PULL, PULL_SLOTS, pullActions, pullLabel } from "@/components/PullActions"


/** A scheme's swatches drawn in its own colours (the tile carries its data-scheme, so its CSS gives the tokens), in the
 *  app's mode or `mode`. */
export function Swatches({ id, mode, className }: { id: string; mode?: "light" | "dark"; className?: string }) {
  const only = onlyMode(id)
  const dark = only ? only === "dark" : mode ? mode === "dark" : isDark()
  return (
    <div data-scheme={id === "default" ? undefined : id} aria-hidden
      className={cn("scheme-preview flex h-10 items-center gap-1.5 overflow-hidden rounded-[7px] border-[0.5px] border-border bg-background px-2 text-foreground", dark && "dark", className)}>
      <span className="shrink-0 text-[14px] leading-none font-semibold">Aa</span>
      {/* (narrow, the last dots go, never over the Aa) */}
      <span className="flex min-w-0 flex-1 justify-end-safe gap-[3px] overflow-hidden">
        {["primary", "red", "yellow", "green", "blue"].map((c) => <span key={c} className="size-2 shrink-0 rounded-full" style={{ background: `var(--${c})` }} />)}
      </span>
    </div>
  )
}

/** A scheme in the gallery: its swatches and its name; the one in use has a ring and a check. */
function Tile({ id, name, tip, on, onClick }: { id: string; name: string; tip?: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={name} onClick={onClick} data-tip={tip}
      className={cn("flex min-w-0 cursor-pointer flex-col rounded-[10px] p-1 text-left ring-2 transition-shadow", on ? "ring-primary" : "ring-transparent hover:ring-border")}>
      <Swatches id={id} />
      <span className="flex h-6 items-center gap-1 px-0.5 text-[13px] font-medium">
        <span className="truncate">{name}</span>{on && <Check className="size-3.5 shrink-0 text-primary" strokeWidth={2.5} />}
      </span>
    </button>
  )
}

const nameOf = (scheme: string) => scheme.startsWith("theme:") ? scheme.slice(6) : SCHEMES.find((s) => s.id === scheme)?.name ?? scheme
const modeTip = (only?: string) => only ? `${only === "dark" ? "Dark" : "Light"} only` : undefined

/** Every colour scheme: the app's, then the vault's Obsidian themes (an unreadable one a dashed tile saying why), and a
 *  button to their folder on this machine. */
function SchemeGrid() {
  const { scheme } = usePrefs()
  const { themes } = useVaultAppearance()
  const pick = (id: string) => setPrefs({ scheme: id })
  return (
    <div className="@container">
      <div role="radiogroup" aria-label="Colour scheme" className="grid grid-cols-2 gap-1.5 @xs:grid-cols-3 @md:grid-cols-4 @2xl:grid-cols-5">
        {SCHEMES.map((s) => <Tile key={s.id} id={s.id} name={s.name} tip={modeTip(s.only) ?? s.note} on={scheme === s.id} onClick={() => pick(s.id)} />)}
        {themes.map((t) => {
          const id = `theme:${t.name}`
          return t.problem
            ? (
              <div key={t.name} data-tip={t.problem} className="flex min-w-0 flex-col p-1">
                <div className="flex h-10 items-center rounded-[7px] border-[0.5px] border-dashed border-border px-2 text-[12px] text-muted-foreground">Can't read it</div>
                <span className="flex h-6 items-center truncate px-0.5 text-[13px] font-medium text-muted-foreground">{t.name}</span>
              </div>
            )
            : <Tile key={t.name} id={id} name={t.name} on={scheme === id} onClick={() => pick(id)}
                tip={[t.author && `By ${t.author}`, modeTip(t.modes.length === 1 ? t.modes[0] : undefined), "a theme from your vault"].filter(Boolean).join(" · ")} />
        })}
      </div>
      {canOpenHere() && <FolderButton folder={THEMES_FOLDER} label="Open themes folder" className="mt-2 -ml-2 h-7 text-[13px]" />}
    </div>
  )
}

/** Settings' three tiles: the default (Gruvbox), the scheme in use (Classic while that's the default), and More…, which
 *  opens the gallery. The second tile changes its scheme and name, never its box. */
function SchemePicker() {
  const { scheme } = usePrefs()
  const second = scheme === DEFAULT_SCHEME ? "default" : scheme
  return (
    <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 sm:w-[372px] sm:flex-none">
      <div role="radiogroup" aria-label="Colour scheme" className="contents">
        {[DEFAULT_SCHEME, second].map((id) => <Tile key={id} id={id} name={nameOf(id)} on={scheme === id} onClick={() => setPrefs({ scheme: id })} />)}
      </div>
      <button type="button" aria-label="More colour schemes" data-tip="Every colour scheme, and your vault's themes" onClick={() => openDetail("schemes")}
        className="flex min-w-0 cursor-pointer flex-col rounded-[10px] p-1 text-left ring-2 ring-transparent transition-shadow hover:ring-border">
        <div aria-hidden className="grid h-10 grid-cols-4 overflow-hidden rounded-[7px] border-[0.5px] border-border">
          {["nord", "catppuccin", "rose-pine", "tokyo-night"].map((id) => (
            <div key={id} data-scheme={id} className={cn("scheme-preview grid place-items-center bg-background", isDark() && "dark")}>
              <span className="size-2 rounded-full bg-primary" />
            </div>
          ))}
        </div>
        <span className="flex h-6 items-center px-0.5 text-[13px] font-medium">More…</span>
      </button>
    </div>
  )
}

/** The gallery as a sheet (Settings' More…; the command "Change colour scheme…" is the palette's, SchemeChooser.tsx). */
export function SchemeGallery() {
  return (
    <>
      <SheetHead icon={Palette} tint="var(--primary)" kicker="Appearance" title="Colour schemes" />
      <SchemeGrid />
    </>
  )
}

function FolderButton({ folder, label, className }: { folder: string; label: string; className?: string }) {
  return (
    <button type="button" onClick={() => openOnComputer(folder)} className={cn("mt-3 flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[14px] text-primary hover:bg-foreground/[0.05]", className)}>
      <FolderOpen className="size-4" strokeWidth={2} />{label}
    </button>
  )
}


/** A stacked row's control with its reset before it: the pair fills the line on a phone, sits at the end from sm up. */
function WithReset({ on, onReset, label, children }: { on: boolean; onReset: () => void; label: string; children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
      {/* (its room always kept, so nothing moves; stacked under its label on a phone, at the end: the control flush with it) */}
      <div className="shrink-0 max-sm:order-last"><ResetButton on={on} onClick={onReset} label={label} /></div>
      {children}
    </div>
  )
}

function FontRow({ k }: { k: FontKey }) {
  const raw = usePrefs()[k]
  const value = typeof raw === "string" ? raw.trim() : ""
  const f = FONTS[k]
  return (
    <SettingRow stack label={f.label} sub={f.sub}>
      <WithReset on={!!value} onReset={() => setPrefs({ [k]: "" })} label={`Reset ${f.label.toLowerCase()}`}>
        <FontPicker {...fontPicker(k, value)} className="min-w-0 flex-1 sm:w-[220px] sm:flex-none" />
      </WithReset>
    </SettingRow>
  )
}

/** The three fonts as one "Fonts" row saying which are set; it opens their pickers in a sheet. */
function Fonts() {
  const prefs = usePrefs()
  const names = [...new Set((Object.keys(FONTS) as FontKey[]).map((k) => (typeof prefs[k] === "string" ? prefs[k].trim() : "")).filter(Boolean))]
  return (
    <SettingRow label="Fonts" value={<span data-tip={names.join(", ") || undefined} data-tip-trunc>{names.length ? names.join(", ") : "Default"}</span>}
      onClick={() => openDetail("fonts")} data-fonts-open />
  )
}

/** The sheet: the interface, text and monospace fonts' pickers. */
export function FontsSheet() {
  return (
    <>
      <SheetHead icon={Type} tint="var(--primary)" kicker="Appearance" title="Fonts" sub="Interface, text, code and terminals" />
      <div className="hairline">
        <FontRow k="interfaceFont" />
        <FontRow k="textFont" />
        <FontRow k="monoFont" />
      </div>
    </>
  )
}

/** A kind's text size (notes, terminals): a reset back to 100%, then smaller, its percentage, bigger. */
function TextSizeRow({ kind, label, sub }: { kind: string; label: string; sub?: string }) {
  const size = useTextSize(kind)
  const name = `${label} text size`
  const btn = "flex size-8 cursor-pointer items-center justify-center rounded-[7px] text-foreground/80 hover:bg-card disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <SettingRow label={name} sub={sub} data-settings-row={`text-size-${kind}`}>
      <div className="flex shrink-0 items-center gap-1">
        <ResetButton on={size !== 100} onClick={() => stepTextSize(kind, 0)} label={`Reset ${name.toLowerCase()}`} />
        <div role="group" aria-label={name} className="flex shrink-0 items-center rounded-[9px] bg-muted p-[2px]" data-text-size-row={kind}>
          <button type="button" className={btn} aria-label={`Decrease ${name.toLowerCase()}`} disabled={size <= STEPS[0]} onClick={() => stepTextSize(kind, -1)}>
            <Minus className="size-3.5" strokeWidth={2.5} />
          </button>
          <span className="min-w-14 text-center text-[13px] font-medium tabular-nums">{size}%</span>
          <button type="button" className={btn} aria-label={`Increase ${name.toLowerCase()}`} disabled={size >= STEPS[STEPS.length - 1]} onClick={() => stepTextSize(kind, 1)}>
            <Plus className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </SettingRow>
  )
}

const THEMES: { value: Theme; label: string }[] = [{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]
const themePicture = (t: Theme, scene: Scene = "note") => t === "system" ? <SystemPicture scene={scene} /> : <WindowPicture scene={scene} mode={t} />

export function AppearancePanel() {
  const prefs = usePrefs()
  const only = onlyMode(prefs.scheme)
  const row = (k: string) => <SwitchRow key={k} s={coreSwitch(`setting:${k}`)} />
  return (
    <div className="flex flex-col gap-6">
      <Section title="Colours">
        <Group>
          {/* A scheme with one mode says so beside the label, on its line: it changes what the row says, never the layout. */}
          <SettingRow below data-settings-row="theme" label={<>Theme{only && <span className="ml-2 align-top text-[13px] leading-[20px] text-muted-foreground">{nameOf(prefs.scheme)} is {only} only</span>}</>}>
            <PictureChoice<Theme> label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })}
              options={THEMES.map((t) => ({ ...t, picture: themePicture(t.value) }))} />
          </SettingRow>
          <SettingRow stack label="Colour scheme" data-settings-row="scheme">
            <WithReset on={schemeId(prefs.scheme) !== DEFAULT_SCHEME} onReset={() => setPrefs({ scheme: DEFAULT_SCHEME })} label="Reset colour scheme">
              <SchemePicker />
            </WithReset>
          </SettingRow>
          {["translucent", ...(prefs.translucent ? ["translucent-pages"] : [])].map(row)}
        </Group>
      </Section>
      <Section title="Window">
        <Group>
          <SettingRow below label="Density" data-settings-row="density">
            <PictureChoice<Density> label="Density" value={prefs.density === "comfortable" ? "comfortable" : "compact"} onChange={(density) => setPrefs({ density })}
              options={[{ value: "compact", label: "Compact", picture: <WindowPicture scene="compact" /> }, { value: "comfortable", label: "Comfortable", picture: <WindowPicture scene="comfortable" /> }]} />
          </SettingRow>
          <SettingRow label="Sidebars" sub={prefs.rails ? "Hidden, they fold to icon rails" : "Hidden, they slide in from the window's edge"}
            onClick={() => openDetail("sidebars")} data-settings-row="sidebars" />
          {["file-icons", "typing-fade"].map(row)}
        </Group>
      </Section>
      <Section title="Tabs">
        <Group>
          <NewTabsRow />
          {["tab-bar", ...(prefs.tabBar ? ["tab-tint"] : ["pane-titles"])].map(row)}
        </Group>
      </Section>
      <Section title="Text">
        <Group>
          <Fonts />
          {textSizeKinds(prefs.disabled).map(([kind, k]) => (
            <TextSizeRow key={kind} kind={kind} label={k.label} sub="This device only" />
          ))}
          {["quick-text-size", "line-numbers"].map(row)}
        </Group>
      </Section>
      <PullRows />
      <Snippets />
    </div>
  )
}

/** What ⌘T and the + buttons open (newtab.json's `opens`): a blank tab's page, the quick switcher, or a view (a web page). */
function NewTabsRow() {
  const { newTab } = usePrefs()
  const choices = opensChoices()
  const value = choices.some((c) => c.value === newTab.opens) ? newTab.opens ?? "" : ""
  return (
    <SettingRow below label="New tabs open" data-settings-row="new-tabs">
      <PictureChoice<string> label="New tabs open" value={value} onChange={(v) => void setOpens(v || null)}
        options={choices.map((c) => ({ value: c.value ?? "", label: c.label, picture: <WindowPicture scene={!c.value ? "page" : c.value === "switcher" ? "switcher" : "view"} /> }))} />
    </SettingRow>
  )
}

/** The commands a page pulled down on a phone offers (appearance.json's `pullActions`): a row for each way, its command
 *  picked from the palette's. Only at a phone's width, where pulling does it. */
function PullRows() {
  const prefs = usePrefs()
  const desktop = useDesktop()
  const byId = new Map(useCommandList().map((c) => [c.id, c]))
  const ids = pullActions(prefs)
  const pick = (i: number) => choose({
    title: PULL_SLOTS[i], placeholder: "A command to run…", current: ids[i],
    items: available(commandList()).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, label: c.name })),
    onPick: (it) => {
      const next = pullActions(getPrefs())
      next[i] = it.id
      void setPrefs({ pullActions: next.join() === DEFAULT_PULL.join() ? null : next })
    },
  })
  if (desktop) return null
  return (
    <Section title="Pull-down actions">
      <Group>
        {PULL_SLOTS.map((label, i) => {
          const c = byId.get(ids[i])
          return <SettingRow key={label} label={label} value={c ? pullLabel(c) : ids[i]}
            onClick={() => pick(i)} data-settings-row={`pull-${i}`} />
        })}
      </Group>
    </Section>
  )
}

/** CSS snippets, the end of Appearance: the vault's .vaultite/snippets/*.css (and an Obsidian vault's), a switch each, and New snippet. */
function Snippets() {
  const { snippets: on } = usePrefs()
  const { snippets } = useVaultAppearance()
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const enabled = Array.isArray(on) ? on : []
  const toggle = (n: string, v: boolean) => setPrefs({ snippets: v ? [...enabled.filter((x) => x !== n), n] : enabled.filter((x) => x !== n) })
  const create = async () => {
    const n = name.trim()
    if (!n) return
    let out: { name: string; path: string }
    try { out = await post("snippets", { name: n }) } catch (e) { return setError(errorText(e)) }
    setName(""); setError("")
    await setPrefs({ snippets: [...getPrefs().snippets.filter((x) => x !== out.name), out.name] })
    openFile(out.path)
  }
  return (
    <section aria-label="CSS snippets">
      <Section title="CSS snippets">
        <Group>
          {snippets.map((s) => (
            <SettingRow key={s.name} label={s.path.startsWith(`${SNIPPETS_FOLDER}/`)
              ? <button type="button" onClick={() => openFile(s.path)} data-tip="Edit" className="max-w-full cursor-pointer truncate text-left hover:text-primary">{s.name}</button>
              // (Obsidian's, in .obsidian/snippets: the app never writes there)
              : <span className="truncate">{s.name} <span className="text-muted-foreground">· Obsidian</span></span>}>
              <Switch on={enabled.includes(s.name)} onChange={(v) => toggle(s.name, v)} label={`${s.name} snippet`} />
            </SettingRow>
          ))}
          <form className="flex min-h-10 items-center gap-2 py-1.5" onSubmit={(e) => { e.preventDefault(); create() }}>
            <input value={name} onChange={(e) => { setName(e.target.value); setError("") }} placeholder={snippets.length ? "New snippet name" : "No snippets yet: name a new one"} aria-label="New snippet name" spellCheck={false}
              className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground md:text-[13px]" />
            <button type="submit" disabled={!name.trim()} className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[13px] text-primary hover:bg-foreground/[0.05] disabled:cursor-default disabled:opacity-40">
              <Plus className="size-4" strokeWidth={2} />New snippet
            </button>
          </form>
        </Group>
      </Section>
      {error && <p className="mt-1 px-1 text-[13px] text-[var(--red)]">{error}</p>}
      {canOpenHere() && <FolderButton folder={SNIPPETS_FOLDER} label="Open snippets folder" className="mt-1 h-7 text-[13px]" />}
    </section>
  )
}
