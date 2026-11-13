import { Sparkles } from "lucide-react"
import { currentEditor, definePlugin, notify, notifyError, Panel, pluginSettings, post } from "@vaultite"
import { formatMarkdown, rulesOf } from "./format"

async function formatOpen() {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown" || !ed.path) return notify("Open a note to format it")
  const s = pluginSettings("linter")
  await s.ready()
  const view = ed.view, text = view.state.doc.toString()
  const next = formatMarkdown(text, rulesOf(s.get()))
  if (next === text) return notify("Already formatted")
  let a = 0
  while (a < text.length && a < next.length && text[a] === next[a]) a++
  let b = 0
  while (b < text.length - a && b < next.length - a && text[text.length - 1 - b] === next[next.length - 1 - b]) b++
  view.dispatch({ changes: { from: a, to: text.length - b, insert: next.slice(a, next.length - b) }, userEvent: "input.format" })
  notify("Formatted")
}

async function formatFile(path: string) {
  try {
    const r = await post<{ changed: string[] }>("ops/linter.format", { path })
    notify(r.changed.length ? "Formatted" : "Already formatted")
  } catch (e) { notifyError(e, "Couldn't format it") }
}

export default definePlugin({
  commands: [{ id: "linter:format", name: "Format note", when: () => currentEditor()?.kind === "markdown", run: () => void formatOpen() }],
  fileMenu: (path) => (/\.md$/i.test(path) ? [{ label: "Format note", icon: Sparkles, section: "actions", run: () => void formatFile(path) }] : []),
  preview: () => (
    <Panel title="Linter" icon={Sparkles} tint="var(--purple)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Format note tidies the note you're on by your rules: no trailing spaces or runs of blank lines, a blank line around
        headings, one kind of bullet. Frontmatter, code and math stay as they are; undo takes it back.
      </p>
    </Panel>
  ),
})
