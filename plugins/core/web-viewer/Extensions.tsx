// Chrome extensions in web pages (the engine's, electron/browser/extensions.ts): their buttons in a page's bar, the
// Extensions tab, and "Add to Vaultite" on a Web Store page. What's installed is this Mac's: code run on every site.
import { forwardRef, useEffect, useState, type FormEvent, type MouseEvent } from "react"
import { ArrowDownToLine, Download, FolderOpen, Lock, MoreHorizontal, Pin, PinOff, Plus, Puzzle, RefreshCw, Settings2, Trash2, type LucideIcon, type LucideProps } from "lucide-react"
import { Button, cn, confirmDialog, Empty, menuBelow, notify, notifyError, PageHeader, Panel, plural, removals, Switch, type MenuItem } from "@vaultite"
import { addExtension, changeExtension, engine, extensionsChanged, hasExtensions, openExtensions, popupOpen, storeIdOf, useExtensions, version, type Ext } from "./extstate"

/** Extensions removed from here: gone at once, back if it fails. */
const removing = removals()
/** Pin an extension's button to the bar, or take it off: at once in the list (which the bar follows), then the engine. */
const pin = (b: { id: string; pinned: boolean }) => changeExtension(b.id, { pinned: !b.pinned }, () => engine("ext:pin", b.id, !b.pinned), b.pinned ? "Couldn't unpin it" : "Couldn't pin it")

/** An extension's button as one page shows it (its badge and icon may be that page's own). */
type Button = { id: string; name: string; pinned: boolean; title: string; icon: string; badge: string; badgeColor: string; badgeTextColor: string; popup: boolean; enabled: boolean }
/** One installed in another browser of this Mac. */
type Other = { browser: string; id: string; name: string; version: string; icon: string }


/** An extension's icon where a lucide icon goes (menus): one component per picture, so a menu isn't drawn afresh. */
const iconComponents = new Map<string, LucideIcon>()
function imageIcon(src: string): LucideIcon {
  let c = iconComponents.get(src)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => src
      ? <img src={src} alt="" draggable={false} className={cn(className, "object-contain")} />
      : <Puzzle className={className} strokeWidth={2} />) as unknown as LucideIcon
    iconComponents.set(src, c)
  }
  return c
}

// ---------- the page's bar ----------

/** The extensions that are on, as the page `pageId` shows their buttons (badge and icon may be its own), and a click
 *  on one: its popup under `el`. */
export function useExtensionBar(pageId: number, url: string) {
  const [buttons, setButtons] = useState<Button[]>([])
  const v = version.use((n) => n)
  useEffect(() => {
    if (!pageId || !hasExtensions()) return
    let gone = false
    void engine<Button[]>("ext:bar", pageId).then((b) => { if (!gone) setButtons(b) }, () => {})
    return () => { gone = true }
  }, [pageId, v, url])
  const click = (b: Button, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    void engine("ext:click", pageId, b.id, { x: r.left, y: r.top, width: r.width, height: r.height }).catch((e) => notifyError(e, `Couldn't open ${b.name}`))
  }
  return { buttons, click, url }
}
export type ExtensionBar = ReturnType<typeof useExtensionBar>

/** The page's … menu's Extensions ▸: every one that's on (its popup opens under `at`), then the Extensions tab. */
export function extensionItems(bar: ExtensionBar, at: HTMLElement): MenuItem[] {
  if (!hasExtensions()) return []
  return [{ label: "Extensions", icon: Puzzle, run: () => openExtensions(), items: [
    ...bar.buttons.map((b): MenuItem => ({ label: b.name, icon: imageIcon(b.icon), hint: b.badge || undefined, disabled: !b.enabled, run: () => bar.click(b, at) })),
    { label: "Manage extensions", icon: Settings2, sep: bar.buttons.length > 0, run: () => openExtensions() },
  ] }]
}

/** The bar's pinned extensions' buttons; on a Web Store extension's page, "Add to Vaultite". */
export function ExtensionButtons({ bar, className }: { bar: ExtensionBar; className?: string }) {
  const exts = useExtensions()
  const open = popupOpen.use((s) => s)
  if (!hasExtensions()) return null
  const storeId = storeIdOf(bar.url)
  return (
    <>
      {storeId && <StoreButton id={storeId} exts={exts} />}
      {bar.buttons.filter((b) => exts?.find((x) => x.id === b.id)?.pinned ?? b.pinned).map((b) => (
        <button key={b.id} type="button" aria-label={b.title} data-tip={b.title} data-ext-button={b.id} disabled={!b.enabled}
          onClick={(e) => bar.click(b, e.currentTarget)}
          onContextMenu={(e) => { e.preventDefault(); menuBelow(e, buttonMenu(b)) }}
          className={cn("relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] hover:bg-foreground/[0.06] disabled:cursor-default disabled:opacity-40",
            open === b.id && "bg-foreground/[0.08]", className)}>
          {b.icon ? <img src={b.icon} alt="" draggable={false} className="size-4 object-contain" /> : <Puzzle className="size-4 text-muted-foreground" strokeWidth={2} />}
          {b.badge && (
            <span className="pointer-events-none absolute right-0 bottom-0 max-w-[26px] truncate rounded-[3px] px-[2px] text-[8px] leading-[10px] font-semibold"
              style={{ background: b.badgeColor || "var(--muted-foreground)", color: b.badgeTextColor || "#fff" }}>{b.badge}</span>
          )}
        </button>
      ))}
    </>
  )
}

const buttonMenu = (b: { id: string; name: string; pinned: boolean }): MenuItem[] => [
  { label: b.pinned ? "Unpin from the bar" : "Pin to the bar", icon: b.pinned ? PinOff : Pin, run: () => pin(b) },
  { label: "Extensions", icon: Puzzle, run: () => openExtensions() },
]

/** On a Web Store extension's page: add it, or say it's added. */
function StoreButton({ id, exts }: { id: string; exts: Ext[] | null }) {
  const [busy, setBusy] = useState(false)
  const have = exts?.some((x) => x.id === id)
  return (
    <button type="button" disabled={busy || have} data-ext-store={id} onClick={() => { setBusy(true); void addExtension(id).finally(() => setBusy(false)) }}
      className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] bg-primary px-2.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/85 disabled:cursor-default disabled:bg-foreground/[0.06] disabled:text-muted-foreground">
      <Plus className="size-4" strokeWidth={2.25} />
      {have ? "Added to Vaultite" : busy ? "Adding…" : "Add to Vaultite"}
    </button>
  )
}

// ---------- the Extensions view ----------

export function ExtensionsView({ openPage }: { openPage: (url: string) => void }) {
  const { list: exts, leaving } = removing.use(useExtensions(), (x) => x.id)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState("")
  const [others, setOthers] = useState<Other[] | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const v = version.use((n) => n)
  // Asked again as it opens and as the app comes back: what other browsers have changes outside it.
  useEffect(() => {
    if (!hasExtensions()) return
    extensionsChanged()
    addEventListener("focus", extensionsChanged)
    return () => removeEventListener("focus", extensionsChanged)
  }, [])
  useEffect(() => {
    if (!hasExtensions()) return
    void engine<Other[]>("ext:others").then(setOthers, () => setOthers([]))
    void engine<{ problems: string[] }>("ext:policy").then((p) => setProblems(p.problems), () => {})
  }, [v])
  if (!hasExtensions()) {
    return <div className="mx-auto max-w-[640px] px-4 pt-6"><PageHeader title="Extensions" /><Empty>Extensions run in web pages in Vaultite's desktop app.</Empty></div>
  }
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!typed.trim() || busy) return
    setBusy("add")
    if (await addExtension(typed)) setTyped("")
    setBusy("")
  }
  const run = (what: string, fn: () => Promise<unknown>, failed: string) => {
    setBusy(what)
    void fn().catch((e) => notifyError(e, failed)).finally(() => setBusy(""))
  }
  const remove = async (x: Ext) => {
    if (!await confirmDialog({ title: `Remove ${x.name}?`, body: "It's removed from every web page, with its settings and what it kept.", confirm: "Remove", danger: true })) return
    void removing.remove(x.id, () => engine("ext:remove", x.id), `Couldn't remove ${x.name}`)
  }
  const bring = async (x: Ext, from: Ext["settingsFrom"][number]) => {
    if (!await confirmDialog({ title: `Use ${from.browser}'s settings for ${x.name}?`, confirm: "Use them",
      body: `Its settings here (its options, sign-in and license) are replaced by ${from.browser}'s.` })) return
    run(x.id, async () => { await engine("ext:settings-from", x.id, from.browser, from.profile); notify(`${x.name} has ${from.browser}'s settings`) }, "Couldn't bring its settings")
  }
  const menu = (x: Ext) => (e: MouseEvent<HTMLButtonElement>) => menuBelow(e, [
    ...(x.options ? [{ label: "Options", icon: Settings2, run: () => void engine("ext:options", x.id) }] : []),
    // (a browser's profile named only when that browser has it in more than one)
    ...x.settingsFrom.map((f) => ({ label: `Settings from ${f.browser}${x.settingsFrom.filter((g) => g.browser === f.browser).length > 1 ? ` (${f.name})` : ""}`,
      icon: ArrowDownToLine, run: () => void bring(x, f) })),
    { label: x.pinned ? "Unpin from the bar" : "Pin to the bar", icon: x.pinned ? PinOff : Pin, run: () => pin(x) },
    ...(x.managed ? [] : [{ label: "Remove", icon: Trash2, danger: true, sep: true, run: () => void remove(x) }]),
  ])
  const line = "truncate text-[13px] leading-[18px] md:text-[12px] md:leading-[16px]"
  return (
    <div className="mx-auto max-w-[640px] px-4 pt-2 pb-10" data-extensions>
      <PageHeader title="Extensions" subtitle="Chrome extensions in this Mac's web pages" />
      <form onSubmit={(e) => void add(e)} className="mb-4 flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="A Chrome Web Store link or an extension's id" aria-label="Chrome Web Store link"
          spellCheck={false} autoComplete="off" data-ext-add
          className="h-8 min-w-0 flex-1 rounded-[8px] bg-foreground/[0.05] px-3 text-[13px] outline-none placeholder:text-tertiary focus:bg-background focus:ring-1 focus:ring-primary/50" />
        <Button type="submit" look="primary" disabled={!typed.trim() || !!busy}>{busy === "add" ? "Adding…" : "Add"}</Button>
      </form>
      {exts === null ? null : !exts.length ? (
        <Empty>
          None yet. Paste a link from the{" "}
          <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => openPage("https://chromewebstore.google.com/")}>Chrome Web Store</button>
          {" "}above, or open an extension's page there and choose Add to Vaultite.
        </Empty>
      ) : (
        <Panel className="py-1">
          <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
            {exts.map((x) => (
              <div key={x.id} className="flex min-h-12 items-center gap-3 py-1.5" data-ext-row={x.id} data-leaving={leaving(x.id)}>
                <span className={cn("grid size-8 shrink-0 place-items-center", !x.on && "opacity-45")}>
                  {x.icon ? <img src={x.icon} alt="" draggable={false} className="size-7 object-contain" /> : <Puzzle className="size-5 text-muted-foreground" strokeWidth={2} />}
                </span>
                <div className={cn("min-w-0 flex-1", !x.on && "opacity-55")}>
                  <div className="truncate text-[15px] leading-[20px] font-medium md:text-[14px]">
                    {x.name}<span className="ml-1.5 text-[12px] font-normal text-muted-foreground">{x.version}</span>
                  </div>
                  {x.error ? <div className={cn(line, "text-[var(--red)]")} data-tip={x.error}>Couldn't start</div>
                    : <div className={cn(line, "text-muted-foreground")}>{x.managed ? "Managed by this Mac" : x.from === "folder" ? `${x.description ? `${x.description} · ` : ""}not updated` : x.description}</div>}
                </div>
                {x.options && x.on && (
                  <button type="button" aria-label={`${x.name} options`} data-tip="Options" onClick={() => void engine("ext:options", x.id)}
                    className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                    <Settings2 className="size-4" strokeWidth={2} />
                  </button>
                )}
                <button type="button" aria-label={`More for ${x.name}`} data-tip="More" onClick={menu(x)} data-ext-more={x.id}
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                  <MoreHorizontal className="size-4" strokeWidth={2} />
                </button>
                {x.managed
                  ? <span className="grid size-7 shrink-0 place-items-center text-muted-foreground" data-tip="Always on" data-ext-managed><Lock className="size-4" strokeWidth={2} /></span>
                  : <Switch on={x.on} disabled={busy === x.id} label={x.name} onChange={(on) => changeExtension(x.id, { on }, () => engine("ext:on", x.id, on), on ? "Couldn't turn it on" : "Couldn't turn it off")} />}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {problems.map((p) => <div key={p} className={cn(line, "mt-2 whitespace-normal text-[var(--red)]")} data-ext-problem>Couldn't add what this Mac manages: {p}</div>)}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button look="quiet" size="small" onClick={() => run("file", () => engine("ext:add-file"), "Couldn't add it")} data-ext-file>
          <FolderOpen className="size-4" strokeWidth={2} />Add from a folder or file…
        </Button>
        {!!exts?.some((x) => x.from === "store") && (
          <Button look="quiet" size="small" disabled={busy === "update"} data-ext-update
            onClick={() => run("update", async () => { const n = await engine<number>("ext:update"); notify(n ? `Updated ${plural(n, "extension")}` : "They're up to date") }, "Couldn't look for updates")}>
            <RefreshCw className="size-4" strokeWidth={2} />{busy === "update" ? "Looking…" : "Look for updates"}
          </Button>
        )}
      </div>
      {!!others?.length && (
        <div className="mt-8" data-ext-others>
          <div className="mb-1 text-[13px] font-semibold text-muted-foreground">In your other browsers</div>
          <Panel className="py-1">
            <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
              {others.map((o) => (
                <div key={o.id} className="flex min-h-11 items-center gap-3 py-1.5" data-ext-other={o.id}>
                  <span className="grid size-8 shrink-0 place-items-center">
                    {o.icon ? <img src={o.icon} alt="" draggable={false} className="size-6 object-contain" /> : <Puzzle className="size-5 text-muted-foreground" strokeWidth={2} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] leading-[20px]">{o.name}</div>
                    <div className={cn(line, "text-muted-foreground")}>{o.browser}</div>
                  </div>
                  <Button size="small" disabled={!!busy} onClick={() => run(o.id, async () => { const r = await engine<{ name: string; settings: boolean }>("ext:import", o.id); notify(r.settings ? `Added ${r.name}, with its settings from ${o.browser}` : `Added ${r.name}`) }, "Couldn't add it")}>
                    <Download className="size-4" strokeWidth={2} />{busy === o.id ? "Adding…" : "Add"}
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
