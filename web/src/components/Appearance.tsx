// Settings > Appearance: theme, colour scheme (gallery under More…), density, icons, line numbers, sidebar
// scroll, fonts, text sizes (this device's), snippets. Saved in appearance.json; rows off their default show a reset.
import { useState, type ReactNode } from "react"
import { Check, FolderOpen, Minus, Palette, Plus, Type } from "lucide-react"
import { DEFAULT_FONTS, onlyMode, SNIPPETS_FOLDER, THEMES_FOLDER, useVaultAppearance } from "@/core/appearance"
import { openFile } from "@/core/files"
import { openDetail } from "@/core/nav"
import { getPrefs, setPrefs, usePrefs, type Density, type Theme } from "@/core/prefs"
import { DEFAULT_SCHEME, SCHEMES, schemeId } from "@/themes/schemes"
import { STEPS, stepTextSize, textSizeKinds, useTextSize } from "@/core/textsize"
import { cn, isDark } from "@/lib/utils"
import { canOpenHere, openOnComputer } from "@/components/FileActions"
import { post } from "@/core/http"
import { FontPicker } from "@/components/FontPicker"
import { Panel, ResetButton, Segmented, SettingRow, SheetHead, Switch } from "@/components/kit"


/** A scheme's swatches drawn in its own colours (the tile carries its data-scheme, so its CSS gives the tokens), in the
 *  app's mode or `mode`. */
export function Swatches({ id, mode, className }: { id: string; mode?: "light" | "dark"; className?: string }) {
  const only = onlyMode(id)
  const dark = only ? only === "dark" : mode ? mode === "dark" : isDark()
  return (
    <div data-scheme={id === "default" ? undefined : id} aria-hidden
      className={cn("scheme-preview flex h-10 items-center gap-1.5 overflow-hidden rounded-[7px] border-[0.5px] border-border bg-background px-2 text-foreground", dark && "dark", className)}>
      <span className="text-[14px] leading-none font-semibold">Aa</span>
      <span className="flex min-w-0 flex-1 justify-end gap-[3px]">
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
export function SchemeGrid() {
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

/** The gallery as a sheet (Settings' More…, the command "Change colour scheme"). */
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


const FONTS = {
  interfaceFont: { label: "Interface font", fallback: { name: "System font", css: DEFAULT_FONTS.ui } },
  textFont: { label: "Text font", fallback: { name: "Interface font", css: "var(--font-sans)" } },
  monoFont: { label: "Monospace font", fallback: { name: "System monospace", css: DEFAULT_FONTS.code }, mono: true },
}

/** A stacked row's control with its reset before it: the pair fills the line on a phone, sits at the end from sm up. */
function WithReset({ on, onReset, label, children }: { on: boolean; onReset: () => void; label: string; children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
      <ResetButton on={on} onClick={onReset} label={label} />
      {children}
    </div>
  )
}

function FontRow({ k }: { k: keyof typeof FONTS }) {
  const raw = usePrefs()[k]
  const value = typeof raw === "string" ? raw.trim() : ""
  const f = FONTS[k]
  return (
    <SettingRow stack label={f.label}>
      <WithReset on={!!value} onReset={() => setPrefs({ [k]: "" })} label={`Reset ${f.label.toLowerCase()}`}>
        <FontPicker value={value} onChange={(v) => setPrefs({ [k]: v })} label={f.label} fallback={f.fallback}
          mono={"mono" in f} className="min-w-0 flex-1 sm:w-[220px] sm:flex-none" />
      </WithReset>
    </SettingRow>
  )
}

/** The three fonts as one "Fonts" row saying which are set; it opens their pickers in a sheet. */
function Fonts() {
  const prefs = usePrefs()
  const names = [...new Set((Object.keys(FONTS) as (keyof typeof FONTS)[]).map((k) => (typeof prefs[k] === "string" ? prefs[k].trim() : "")).filter(Boolean))]
  return (
    <SettingRow label="Fonts" value={<span data-tip={names.join(", ") || undefined} data-tip-trunc>{names.length ? names.join(", ") : "Default"}</span>}
      onClick={() => openDetail("fonts")} data-fonts-open />
  )
}

/** The sheet: the interface, text and monospace fonts' pickers. */
export function FontsSheet() {
  return (
    <>
      <SheetHead icon={Type} tint="var(--primary)" kicker="Appearance" title="Fonts" sub="Interface, text and code" />
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

export function AppearancePanel() {
  const prefs = usePrefs()
  const only = onlyMode(prefs.scheme)
  return (
    <Panel title="Appearance">
      <div className="hairline">
        {/* A scheme with one mode says so beside the label, on its line: it changes what the row says, never the layout. */}
        <SettingRow stack data-settings-row="theme" label={<>Theme{only && <span className="ml-2 align-top text-[13px] leading-[20px] text-muted-foreground">{nameOf(prefs.scheme)} is {only} only</span>}</>}>
          <Segmented<Theme> label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} className="w-full shrink-0 sm:w-[220px]"
            options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </SettingRow>
        <SettingRow stack label="Colour scheme" data-settings-row="scheme">
          <WithReset on={schemeId(prefs.scheme) !== DEFAULT_SCHEME} onReset={() => setPrefs({ scheme: DEFAULT_SCHEME })} label="Reset colour scheme">
            <SchemePicker />
          </WithReset>
        </SettingRow>
        <SettingRow stack label="Density" data-settings-row="density">
          <Segmented<Density> label="Density" value={prefs.density === "comfortable" ? "comfortable" : "compact"} onChange={(density) => setPrefs({ density })} className="w-full shrink-0 sm:w-[220px]"
            options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} />
        </SettingRow>
        <SettingRow label="File icons" data-settings-row="file-icons">
          <Switch on={prefs.fileIcons} onChange={(fileIcons) => setPrefs({ fileIcons })} label="File icons" />
        </SettingRow>
        <SettingRow label="Tab bar" data-settings-row="tab-bar">
          <Switch on={prefs.tabBar} onChange={(tabBar) => setPrefs({ tabBar })} label="Tab bar" />
        </SettingRow>
        <SettingRow label="Line numbers" data-settings-row="line-numbers">
          <Switch on={prefs.lineNumbers} onChange={(lineNumbers) => setPrefs({ lineNumbers })} label="Line numbers" />
        </SettingRow>
        <SettingRow label="Scroll sidebar panels separately" data-settings-row="sidebar-scroll">
          <Switch on={prefs.sidebarScroll !== "sidebar"} onChange={(on) => setPrefs({ sidebarScroll: on ? "panels" : "sidebar" })} label="Scroll sidebar panels separately" />
        </SettingRow>
        <SettingRow label="Lines between sidebar panels" data-settings-row="panel-dividers">
          <Switch on={prefs.panelDividers} onChange={(panelDividers) => setPrefs({ panelDividers })} label="Lines between sidebar panels" />
        </SettingRow>
        <Fonts />
        {textSizeKinds(prefs.disabled, prefs.order).map(([kind, k]) => (
          <TextSizeRow key={kind} kind={kind} label={k.label} sub="This device only" />
        ))}
      </div>
      <Snippets />
    </Panel>
  )
}

/** CSS snippets, the end of Appearance: the vault's .vaultite/snippets/*.css, a switch each, and New snippet. */
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
    try { out = await post("snippets", { name: n }) } catch (e) { return setError((e as Error).message) }
    setName(""); setError("")
    await setPrefs({ snippets: [...getPrefs().snippets.filter((x) => x !== out.name), out.name] })
    openFile(out.path)
  }
  return (
    <section aria-label="CSS snippets" className="border-t-[0.5px] border-border pt-2">
      <div className="mb-1 text-[15px] leading-[20px]">CSS snippets</div>
      <div className="hairline">
        {snippets.map((s) => (
          <div key={s.name} className="flex min-h-11 items-center gap-3 py-1">
            <button type="button" onClick={() => openFile(`${SNIPPETS_FOLDER}/${s.name}.css`)} data-tip="Edit"
              className="min-w-0 flex-1 cursor-pointer truncate text-left text-[15px] hover:text-primary">{s.name}</button>
            <Switch on={enabled.includes(s.name)} onChange={(v) => toggle(s.name, v)} label={`${s.name} snippet`} />
          </div>
        ))}
      </div>
      {!snippets.length && <p className="text-[14px] text-muted-foreground">No snippets yet.</p>}
      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); create() }}>
        <input value={name} onChange={(e) => { setName(e.target.value); setError("") }} placeholder="New snippet name" aria-label="New snippet name" spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[14px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/60" />
        <button type="submit" disabled={!name.trim()} className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[14px] text-primary hover:bg-foreground/[0.05] disabled:cursor-default disabled:opacity-40">
          <Plus className="size-4" strokeWidth={2} />New snippet
        </button>
      </form>
      {error && <p className="mt-1 text-[13px] text-[var(--red)]">{error}</p>}
      {canOpenHere() && <FolderButton folder={SNIPPETS_FOLDER} label="Open snippets folder" />}
    </section>
  )
}
