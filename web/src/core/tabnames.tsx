// Naming tabs and tab groups from the palette, which turns into a field as Rex's Rename Session does. A tab's name
// belongs to what it shows: a file's is the file's, a terminal's its session's, anything else's the tab's own.
import { PencilLine, Plus } from "lucide-react"
import { choose } from "@/components/Chooser"
import { dotIcon } from "@/components/ColorDot"
import { editSet, namesItself, setName, shownLabel, tabLabel } from "@/components/Tabs"
import { getStore } from "@/core/data"
import { isProtected } from "@/core/files"
import { getPrefs } from "@/core/prefs"
import { viewFor } from "@/core/plugins"
import { addToSet, allSets, makeSet, renameSet, setById } from "@/core/tabsets"
import { activeTab, askRename, groups, nameTab, selectTab } from "@/core/workspace"
import { COLOR_NAMES, colorVar } from "../../../core/colors.ts"
import { isBlank, vaultPath, type Tab } from "../../../core/layout.ts"

const tabById = (id: string) => groups().flatMap((g) => g.tabs).find((t) => t.id === id)

/** The view a tab shows, when its name is its own (a terminal's session): its name now, and how to change it. */
function ownName(t: Tab) {
  const v = t.to.startsWith("view:") ? viewFor(t.to, getPrefs().disabled) : null
  return v?.on && v.def.rename ? v.def.rename(v.arg) : null
}

/** Whether Rename tab… can name it: not a blank tab, a protected file, nor a view whose name isn't known yet. */
export function canRenameTab(t: Tab | undefined) {
  if (!t || isBlank(t)) return false
  const file = vaultPath(t.to)
  if (file) return !isProtected(file)
  return !namesItself(t.to) || !!ownName(t)
}

/** The palette as a field holding its name (`typed`, else `name`), selected: Enter names it what's typed, an empty
 *  field gives the automatic name back, Esc leaves it. */
function askName(o: { what: string; placeholder: string; name: string; typed?: string; auto: string; set: (name: string) => void }) {
  const typed = o.typed ?? o.name
  choose({
    title: `Rename ${o.what}`, heading: `Rename ${o.what} "${o.name}"`, placeholder: o.placeholder, typed, items: [],
    empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">
      {o.name === o.auto ? "Type a name" : `Enter to go back to the automatic name, "${o.auto}"`}</p>,
    other: (typed) => ({ id: typed.trim(), label: `Rename to "${typed.trim()}"`, icon: PencilLine }),
    onPick: (it) => o.set(it.id),
    onBlank: () => o.set(""),
  })
}

/** Rename tab `id` (the current one): its file as Rename current file does, its terminal's session, or the tab. */
export function renameTab(id = activeTab().id) {
  const t = tabById(id)
  if (!t || !canRenameTab(t)) return
  const file = vaultPath(t.to)
  if (file) { selectTab(t.id); askRename(file); return }
  const own = ownName(t)
  if (own) {
    askName({ what: "terminal", placeholder: "Name this terminal…", name: own.name, auto: own.auto, set: (n) => void own.set(n) })
    return
  }
  const store = getStore()
  askName({ what: "tab", placeholder: "Name this tab…", name: tabLabel(t, store).label, auto: shownLabel(t, store), set: (n) => nameTab(t.id, n) })
}

/** Rename the current tab's group. */
export function renameTabGroup() {
  const id = activeTab().set, s = id ? setById(id)?.s : null
  if (!id || !s) return
  askName({ what: "group", placeholder: "Name this group…", name: setName(s), typed: s.name, auto: `${COLOR_NAMES[s.color]} group`, set: (n) => renameSet(id, n) })
}

const NEW = "\u0000new:"
/** Put the current tab in a group: one there is, or a new one named as typed (nothing typed: named for its tabs, its
 *  editor open, as "Add tab to new group" in its menu). */
export function chooseTabGroup() {
  const t = activeTab()
  const sets = allSets().filter((s) => s.id !== t.set)
  const fresh = () => { const id = makeSet([t.id]); if (id) editSet(id) }
  choose({
    title: "Add tab to group", heading: sets.length ? "Add to a group, or type a new group's name" : undefined,
    placeholder: sets.length ? "Pick a group or name a new one…" : "Name the new group…",
    items: sets.map((s) => ({ id: s.id, label: setName(s), icon: dotIcon(colorVar(s.color)) })),
    empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Type its name, or Enter for a new group</p>,
    other: (typed) => ({ id: `${NEW}${typed.trim()}`, label: `New group "${typed.trim()}"`, icon: Plus }),
    onPick: (it) => (it.id.startsWith(NEW) ? makeSet([t.id], { name: it.id.slice(NEW.length) }) : addToSet([t.id], it.id)),
    onBlank: fresh,
  })
}
