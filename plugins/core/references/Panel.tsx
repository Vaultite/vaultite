import { useState } from "react"
import { NotebookPen, Settings2 } from "lucide-react"
import { cn, menuBelow, menuFor, openPluginSettings, Segmented, SidebarHeading, useFocusedFile, useLive, type SidebarCtx } from "@vaultite"
import { openLiterature, touchesLibrary } from "./client.ts"
import { entryMenu } from "./menus.ts"
import { useLibraryVersion } from "./hooks.ts"
import { LibraryList } from "./LibraryList.tsx"
import { safeHtml } from "./safe.ts"
import { styleMenu } from "./styleMenu.ts"
import type { NoteAnswer, Shown, StatusAnswer } from "./wire.ts"
import "./references.css"

const isNote = (p: string) => /\.md$/i.test(p)


function Entry({ e, hanging, numbered }: { e: Shown; hanging: boolean; numbered: boolean }) {
  return (
    <div role="button" tabIndex={0} data-keyrow data-reference={e.key} onClick={(ev) => { if (!(ev.target instanceof Element && ev.target.closest("a"))) void openLiterature(e.key) }}
      onKeyDown={(ev) => { if (ev.key === "Enter") void openLiterature(e.key) }} onContextMenu={menuFor(() => entryMenu(e))}
      className={cn("group/ref relative cursor-pointer rounded-[5px] py-1.5 pr-5 pl-1.5 hover:bg-foreground/[0.04]", numbered && "vau-ref-numbered", hanging && !numbered && "vau-ref-hanging")}>
      <div className="vau-ref-text select-text text-[13px] leading-[18px]" dangerouslySetInnerHTML={{ __html: safeHtml(e.html) }} />
      {e.note && <NotebookPen aria-label="Has a literature note" className="absolute top-2 right-1 size-3.5 text-tertiary" strokeWidth={2} />}
    </div>
  )
}

function Cited({ path }: { path: string }) {
  const { data, error } = useLive<NoteAnswer>(`references/note?path=${encodeURIComponent(path)}`, useLibraryVersion(), (p) => p === path || touchesLibrary(p) || (!p.startsWith(".") && p.endsWith(".md")))
  const answer = data
  if (error) return <p className="px-1.5 text-[13px] text-muted-foreground">Couldn't read this note's references.</p>
  if (!answer) return <div className="loading-in px-1.5 text-[13px] text-tertiary" aria-busy>Loading…</div>
  if (!answer.entries.length && !answer.missing.length) {
    return <p className="px-1.5 py-1 text-[13px] leading-[18px] text-muted-foreground" data-references-empty>This note cites nothing yet. Type <code>[@</code> to cite from your library.</p>
  }
  return (
    <div role="list" data-keylist data-references-cited className="flex flex-col gap-0.5">
      {answer.entries.map((e) => <Entry key={e.key} e={e} hanging={answer.hanging} numbered={answer.numbered} />)}
      {answer.missing.length > 0 && (
        <p className="px-1.5 pt-1 text-[12px] leading-[16px] text-tertiary" data-references-missing>Not in your library: {answer.missing.map((k) => `@${k}`).join(", ")}</p>
      )}
      {answer.style.problem && <p className="px-1.5 pt-1 text-[12px] leading-[16px] text-tertiary">{answer.style.problem}</p>}
    </div>
  )
}

function NoLibrary() {
  return (
    <div className="flex flex-col items-start gap-2 px-1.5 py-1" data-references-setup>
      <p className="text-[13px] leading-[18px] text-muted-foreground">Your library goes here: Zotero, or a .bib, CSL JSON or RIS file from any reference manager in your vault.</p>
      <button type="button" onClick={() => openPluginSettings("references")} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-control bg-foreground/[0.06] px-2.5 text-[13px] font-medium hover:bg-foreground/[0.1]">
        <Settings2 className="size-3.5" strokeWidth={2} />Connect a library
      </button>
    </div>
  )
}

function References({ note }: { note: string }) {
  const [mode, setMode] = useState<"cited" | "library">("cited")
  const lib = useLive<StatusAnswer>("references/status", useLibraryVersion(), touchesLibrary).data
  if (lib && lib.items === 0 && lib.notes === 0) return <NoLibrary />
  const showing = note ? mode : "library"
  return <>
    {note && <Segmented label="Show" value={showing} onChange={setMode} className="mx-1.5 mb-1.5"
      options={[{ value: "cited", label: "This note" }, { value: "library", label: "Library", count: lib?.items }]} />}
    {showing === "cited" ? <Cited key={note} path={note} /> : <LibraryList path={note} />}
  </>
}

function StyleButton({ note }: { note: string }) {
  const version = useLibraryVersion()
  const noted = useLive<NoteAnswer>(note ? `references/note?path=${encodeURIComponent(note)}` : null, version, (p) => p === note || touchesLibrary(p)).data
  const vault = useLive<StatusAnswer>("references/status", version, touchesLibrary).data
  const style = noted?.style ?? vault?.style
  if (!style) return null
  return (
    <button type="button" data-references-style={style.id} data-tip={style.own ? "This note's style (its csl:)" : "Citation style"}
      onClick={(e) => void styleMenu(style, note).then((items) => menuBelow(e, items))}
      className="h-5 max-w-[45%] cursor-pointer truncate rounded-[4px] px-1 text-[11px] font-medium text-tertiary hover:bg-foreground/[0.06] hover:text-muted-foreground">
      {style.title.replace(/ (Style )?\d+(th|rd|nd|st) edition.*$/, "").replace(/ Reference Guide.*$/, "")}
    </button>
  )
}

export function ReferencesPanel({ open, file: focused }: SidebarCtx) {
  const last = useFocusedFile()
  const path = focused || last.path
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-references-panel>
      <SidebarHeading title="References" open={open} aside={<StyleButton note={isNote(path) ? path : ""} />} />
      <References note={isNote(path) ? path : ""} />
    </div>
  )
}

export function ReferencesView() {
  const { path } = useFocusedFile()
  const note = isNote(path) ? path : ""
  return (
    <div className="pb-10" data-references-view>
      <div className="mb-3 flex items-center gap-2 max-md:hidden">
        <h1 className="min-w-0 flex-1 truncate text-[22px] leading-[28px] font-bold">References</h1>
        <StyleButton note={note} />
      </div>
      <div className="size-up-bleed"><div data-size-up><References note={note} /></div></div>
    </div>
  )
}
