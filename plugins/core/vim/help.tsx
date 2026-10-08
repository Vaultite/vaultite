// Vim's keys as a sheet (? outside the editor, :help): read from the commands as they are now (hotkeys.json included),
// then the editor's additions and the : commands.
import { useMemo, type ReactNode } from "react"
import { Keyboard } from "lucide-react"
import { keyCaps, keysOf, Section, SheetHead, useCommandList } from "@vaultite"
import { EX } from "./ex"

type Row = { name: string; keys: string[] }

function Caps({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {keyCaps(keys).map((k, i) => (
        <kbd key={i} className="grid h-[22px] min-w-[22px] place-items-center rounded-[5px] border-[0.5px] border-border bg-foreground/[0.06] px-1.5 font-mono text-[12px] leading-none text-muted-foreground">{k}</kbd>
      ))}
    </span>
  )
}

/** A command's keys, each one's caps together, "or" between them. */
const alternatives = (keys: string[]) => keys.flatMap((k, i) => [
  ...(i ? [<span key={`or${i}`} className="self-center text-[12px] text-muted-foreground">or</span>] : []),
  <Caps key={k} keys={k} />,
])

function Rows({ rows }: { rows: { name: ReactNode; keys: ReactNode }[] }) {
  return (
    <div className="mb-5 divide-y-[0.5px] divide-border">
      {rows.map((r, i) => (
        <div key={i} className="flex min-h-9 items-center justify-between gap-4 py-1.5 text-[15px]">
          <span className="min-w-0">{r.name}</span>
          <span className="flex flex-wrap justify-end gap-2">{r.keys}</span>
        </div>
      ))}
    </div>
  )
}

/** A step that types (no ⌘, ⌃ or ⌥), or Vim's ⌃W window keys: the keys Vim adds, not the app's own shortcuts. */
const vimish = (keys: string) => /^(ctrl\+w |ctrl\+[dufb]$)/i.test(keys) || !/(^|\+)(mod|ctrl|alt)\+/i.test(keys.split(" ")[0])

/** The editor's own keys, on top of Vim's (editor.ts), spelled like commands' keys. */
const EDITOR: [string, string][] = [
  ["Next or previous heading", "] ]  ·  [ ["],
  ["Next or previous link", "G L  ·  G Shift+L"],
  ["Follow the link under the cursor", "G F  ·  G D"],
  ["Follow it in a new tab", "G Shift+F"],
  ["Open the address under the cursor", "G X"],
  ["Fold or unfold a section", "Z A  ·  Z C  ·  Z O"],
  ["Unfold or fold everything", "Z Shift+R  ·  Z Shift+M"],
  ["Open the link under the cursor to the right", "Shift+K"],
  ["The leader's keys", "Space"],
  ["Move between panes", "Ctrl+W H  ·  Ctrl+W L"],
  ["Back to reading (after i)", "Escape"],
]

export function KeysSheet() {
  const list = useCommandList()
  const groups = useMemo(() => {
    const outside: Row[] = [], leader: Row[] = [], windows: Row[] = []
    for (const c of list) {
      const ks = keysOf(c).filter(vimish)
      if (!ks.length) continue
      const lead = ks.filter((k) => /^space\b/i.test(k)), rest = ks.filter((k) => !/^space\b/i.test(k))
      if (lead.length) leader.push({ name: c.name, keys: lead })
      if (!rest.length) continue
      ;(c.id.startsWith("vim:") ? outside : windows).push({ name: c.name, keys: rest })
    }
    const byKeys = (a: Row, b: Row) => a.keys[0].localeCompare(b.keys[0])
    return { outside, leader: leader.sort(byKeys), windows: windows.sort(byKeys) }
  }, [list])
  const caps = (r: Row) => alternatives(r.keys)
  return (
    <div data-vim-keys>
      <SheetHead icon={Keyboard} tint="var(--primary)" kicker="Vim" title="Keys"
        sub="Outside the editor while the keyboard isn't in a text field; the leader and window keys in the editor's normal mode too." />
      <Section title="Reading view and pages"><Rows rows={groups.outside.map((r) => ({ name: r.name, keys: caps(r) }))} /></Section>
      {!!groups.windows.length && <Section title="Tabs and windows"><Rows rows={groups.windows.map((r) => ({ name: r.name, keys: caps(r) }))} /></Section>}
      {!!groups.leader.length && <Section title="Leader (Space)"><Rows rows={groups.leader.map((r) => ({ name: r.name, keys: caps(r) }))} /></Section>}
      <Section title="In the editor, on top of Vim's own">
        <Rows rows={EDITOR.map(([name, keys]) => ({ name, keys: alternatives(keys.split("  ·  ")) }))} />
      </Section>
      <Section title="Commands (:)">
        <Rows rows={EX.map((x) => ({ name: x.help, keys: <code className="font-mono text-[13px] text-muted-foreground">{x.usage}</code> }))} />
      </Section>
    </div>
  )
}
