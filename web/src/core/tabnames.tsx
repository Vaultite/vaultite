// Naming tabs and tab groups from the palette, which turns into a field as Rex's Rename Session does. A tab of one pane's
// name belongs to what it shows: a file's is the file's, a terminal's its session's; anything else's (a split) is its own.
import { PencilLine, Plus } from "lucide-react"
import { askText, choose } from "@/components/Chooser"
import { dotIcon } from "@/components/ColorDot"
import { editGroup, groupName, namesItself, shownLabel, tabLabel } from "@/components/Tabs"
import { getStore } from "@/core/data"
import { isProtected } from "@/core/files"
import { getPrefs } from "@/core/prefs"
import { viewFor } from "@/core/plugins"
import { addToGroup, allGroups, groupById, makeGroup, renameGroup } from "@/core/tabgroups"
import { activeTab, askRename, nameTab, selectTab, tabById } from "@/core/workspace"
import { COLOR_NAMES, colorVar } from "../../../core/colors.ts"
import { isBlankTab, isSplit, vaultPath, type Tab } from "../../../core/layout.ts"

/** The one place a tab shows (null: a split, named only as a tab). */
const placeOf = (t: Tab) => (isSplit(t.root) ? null : t.root.to)

/** The view a tab shows, when its name is its own (a terminal's session): its name now, and how to change it. */
function ownName(t: Tab) {
  const to = placeOf(t), v = to?.startsWith("view:") ? viewFor(to, getPrefs().disabled) : null
  return v?.on && v.def.rename ? v.def.rename(v.arg) : null
}

/** Whether Rename tab… can name it: not a blank tab, a protected file, nor a view whose name isn't known yet. */
export function canRenameTab(t: Tab | undefined) {
  if (!t || isBlankTab(t)) return false
  const to = placeOf(t), file = to && vaultPath(to)
  if (file) return !isProtected(file)
  return !to || !namesItself(to) || !!ownName(t)
}

/** The palette as a field holding its name (`typed`, else `name`), selected: Enter names it what's typed, an empty
 *  field gives the automatic name back, Esc leaves it. */
function askName(o: { what: string; placeholder: string; name: string; typed?: string; auto: string; set: (name: string) => void }) {
  const typed = o.typed ?? o.name
  askText({
    title: `Rename ${o.what}`, heading: `Rename ${o.what} "${o.name}"`, placeholder: o.placeholder, typed,
    hint: o.name === o.auto ? "Type a name" : `Enter to go back to the automatic name, "${o.auto}"`,
    label: (t) => `Rename to "${t}"`, icon: PencilLine, onText: o.set, onBlank: () => o.set(""),
  })
}

/** Rename tab `id` (the current one): its file as Rename current file does, its terminal's session, or the tab. */
export function renameTab(id = activeTab().id) {
  const t = tabById(id)
  if (!t || !canRenameTab(t)) return
  const to = placeOf(t), file = to && vaultPath(to)
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
  const id = activeTab().group, g = id ? groupById(id) : null
  if (!id || !g) return
  askName({ what: "group", placeholder: "Name this group…", name: groupName(g), typed: g.name, auto: `${COLOR_NAMES[g.color]} group`, set: (n) => renameGroup(id, n) })
}

const NEW = "\u0000new:"
/** Put the current tab in a group: one there is, or a new one named as typed (nothing typed: named for its tabs, its
 *  editor open, as "Add tab to new group" in its menu). */
export function chooseTabGroup() {
  const t = activeTab()
  const sets = allGroups().filter((s) => s.id !== t.group)
  const fresh = () => { const id = makeGroup([t.id]); if (id) editGroup(id) }
  choose({
    title: "Add tab to group", heading: sets.length ? "Add to a group, or type a new group's name" : undefined,
    placeholder: sets.length ? "Pick a group or name a new one…" : "Name the new group…",
    items: sets.map((s) => ({ id: s.id, label: groupName(s), icon: dotIcon(colorVar(s.color)) })),
    empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Type its name, or Enter for a new group</p>,
    other: (typed) => ({ id: `${NEW}${typed.trim()}`, label: `New group "${typed.trim()}"`, icon: Plus }),
    onPick: (it) => (it.id.startsWith(NEW) ? makeGroup([t.id], { name: it.id.slice(NEW.length) }) : addToGroup([t.id], it.id)),
    onBlank: fresh,
  })
}
