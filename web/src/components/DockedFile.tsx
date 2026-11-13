import type { Store } from "@/core/data"
import { isOutside } from "@/core/desktop"
import { inVault, isHidden, isMd } from "@/core/files"
import { fileFormatFor, fileViewFor, formatFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { useCommandKeys } from "@/core/commands"
import { HeadingButton } from "@/components/Button"
import { menuOnCard } from "@/components/ContextMenu"
import { FileEmbed } from "@/components/FileEmbed"
import { drawFileView } from "@/components/drawFile"
import { MODES, useMode, viewItems, VIEWS } from "@/components/fileState"

function editsDocked(store: Store, path: string, disabled: string[]) {
  if (!isMd(path) || isHidden(path) || isOutside(path) || !inVault(store, path) || fileFormatFor(path, disabled) || formatFor(path, disabled)) return false
  const type = store.files.files.find((f) => f.path === path)?.type
  return !fileViewFor({ path, type }, disabled)?.view.page
}

export function DockedFile({ store, path, panel }: { store: Store; path: string; panel: string }) {
  const { disabled } = usePrefs()
  if (editsDocked(store, path, disabled)) return drawFileView(store, path, panel)
  return <FileEmbed store={store} path={path} fill />
}

export function DockedViewToggle({ store, path, panel }: { store: Store; path: string; panel: string }) {
  const { disabled } = usePrefs()
  const [mode, setMode, , edit] = useMode(panel)
  const keys = useCommandKeys("view:toggle", true)
  if (!editsDocked(store, path, disabled)) return null
  const reading = mode === "read"
  return (
    <HeadingButton icon={MODES[reading ? "live" : "read"].icon} label={reading ? "Edit" : "Read"} data-docked-view={mode}
      tip={`Current view: ${MODES[mode].label}\n${reading ? "Click to edit" : "Click to read"}${keys}\nRight-click for all views`}
      onClick={() => setMode(reading ? edit : "read")} onContextMenu={menuOnCard(() => viewItems(VIEWS, mode, setMode))} />
  )
}
