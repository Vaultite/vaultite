// While the server reads the vault (GET /api/loading): that it's reading, and the files iCloud is still downloading,
// which can take minutes. Once read, files still downloading are a toast (they show when they arrive).
import { useEffect, useState } from "react"
import { type Store } from "@/core/data"
import { get } from "@/core/http"
import { notify } from "@/core/notify"

/** "Alpha, Beta and 3 more": the files' names. */
function namesOf(files: string[]) {
  const names = files.slice(0, 3).map((f) => f.slice(f.lastIndexOf("/") + 1).replace(/\.md$/, ""))
  return files.length > 3 ? `${names.join(", ")} and ${files.length - 3} more` : names.join(", ")
}

export function VaultLoading() {
  const [shown, setShown] = useState(false) // (not for a vault read in a moment)
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    let on = true, timer: ReturnType<typeof setTimeout>
    const look = async () => {
      try {
        const r = await get<{ ready: boolean; downloading: string[] }>("loading")
        if (on) { setFiles(r.downloading); setShown(true) }
      } catch { /* the server isn't up yet */ }
      if (on) timer = setTimeout(look, 1000)
    }
    timer = setTimeout(look, 500)
    return () => { on = false; clearTimeout(timer) }
  }, [])
  if (!shown) return null
  return (
    <div className="mt-10 space-y-1 text-[15px] text-muted-foreground">
      <p>Reading the vault…</p>
      {files.length > 0 && <p>Waiting for iCloud to download {files.length === 1 ? "a file" : `${files.length} files`}: {namesOf(files)}</p>}
    </div>
  )
}

let told = false
/** The vault read without some files iCloud is still downloading: said once, when the store first comes. */
export function DownloadingNotice({ store }: { store: Store | null }) {
  useEffect(() => {
    if (!store || told) return
    told = true
    const files = store.vault.downloading ?? []
    if (files.length) notify(`iCloud is still downloading ${files.length === 1 ? "a file" : `${files.length} files`} (${namesOf(files)}): they show when they arrive`, { duration: 8000 })
  }, [store])
  return null
}
