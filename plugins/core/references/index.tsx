import { BookBookmark, FilePlus2, Quote, RefreshCw } from "lucide-react"
import { askText, currentEditor, definePlugin, isDesktop, notify, notifyError, op, openFile, Panel, post, showPanel } from "@vaultite"
import { citeFromZotero, forgetFormatted, insertCitation } from "./client.ts"
import { DrawnCitations } from "./Drawn.tsx"
import { LazyBibliography, LazyPanel, LazySources, LazyView } from "./Lazy.tsx"

const inNote = () => currentEditor()?.kind === "markdown"

async function startCiting() {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown") { notify("Open a note to cite in it"); return }
  const at = ed.view.state.selection.main
  ed.view.dispatch({ changes: { from: at.from, to: at.to, insert: "[@]" }, selection: { anchor: at.from + 2 }, userEvent: "input" })
  ed.view.focus()
  const { startCompletion } = await import("@codemirror/autocomplete")
  startCompletion(ed.view)
}

function addByIdentifier() {
  askText({
    title: "Add a reference", placeholder: "A DOI, an arXiv id or an ISBN", icon: FilePlus2,
    hint: "It's looked up at doi.org (Crossref, DataCite, arXiv) or Open Library, and kept as a note in your vault.",
    label: (t) => `Add ${t}`,
    onText: (id) => void (async () => {
      try {
        const r = await op<{ key: string; path: string | null; already: boolean }>("references.add", { identifier: id })
        notify(r.already ? `Already in your library as @${r.key}` : `Added @${r.key}`, {
          action: inNote() ? { label: "Cite", run: () => { insertCitation([r.key]) } } : r.path ? { label: "Open", run: () => openFile(r.path ?? "") } : undefined,
        })
      } catch (e) { notifyError(e, "Couldn't add it") }
    })(),
  })
}

const references = definePlugin({
  sidebar: {
    references: { title: "References", heading: false, needsHeading: true, sort: 38, side: "right", view: "references", flyout: { icon: BookBookmark }, names: ["bibliography", "citations", "zotero"],
      render: (ctx) => <LazyPanel {...ctx} /> },
  },
  views: { references: { icon: BookBookmark, title: () => "References", render: () => <LazyView /> } },
  editor: (ctx) => (ctx.kind === "markdown" ? import("./editor.ts").then((m) => m.citationsExtension(ctx)) : []),
  noteEnd: { references: { print: true, sort: 90, render: ({ path, place }) => <LazyBibliography path={path} place={place} /> } },
  background: () => <DrawnCitations />,
  settingsPanel: () => <LazySources />,
  settingsPanelFirst: true,
  slash: () => [{ id: "references:cite", title: "Citation", section: "Insert", keywords: "cite reference zotero bibliography pandoc", detail: "[@key]",
    run: () => void startCiting() }],
  commands: [
    { id: "references:cite", name: "Insert citation", when: inNote, run: () => void startCiting(), icon: Quote },
    { id: "references:zotero", name: "Cite from Zotero", when: () => inNote() && isDesktop(), run: () => void citeFromZotero(), icon: Quote },
    { id: "references:add", name: "Add a reference by DOI, arXiv or ISBN", run: addByIdentifier, icon: FilePlus2 },
    { id: "references:show", name: "Show references", fromLink: true, run: () => { showPanel("references:references") }, icon: BookBookmark },
    { id: "references:refresh", name: "Read the reference library again", run: () => void post("references/refresh", {}).then(() => { forgetFormatted(); notify("Read the library again") }, (e) => notifyError(e, "Couldn't read the library")), icon: RefreshCw },
  ],
  preview: () => (
    <Panel title="References" icon={BookBookmark} tint="var(--orange)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Cite from Zotero or any reference manager's export as you write: type [@ for your library, see citations in APA, Chicago, MLA or
        any CSL style, the note's references beside it, and a References section in exported PDFs.
      </p>
    </Panel>
  ),
})

export default references
