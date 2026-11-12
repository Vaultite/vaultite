import { useEffect, useState } from "react"
import { getStore, type Store } from "@/core/data"
import { get } from "@/core/http"
import { notify } from "@/core/notify"

function namesOf(files: string[]) {
  const names = files.slice(0, 3).map((f) => f.slice(f.lastIndexOf("/") + 1).replace(/\.md$/, ""))
  return files.length > 3 ? `${names.join(", ")} and ${files.length - 3} more` : names.join(", ")
}

export function VaultLoading() {
  const [shown, setShown] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    let on = true, timer: ReturnType<typeof setTimeout>
    const look = async () => {
      if (getStore()) return
      try {
        const r = await get<{ ready: boolean; downloading: string[] }>("loading")
        if (on) { setFiles(r.downloading); setShown(true) }
      } catch {}
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
export function DownloadingNotice({ store }: { store: Store | null }) {
  useEffect(() => {
    if (!store || told) return
    told = true
    const files = store.vault.downloading ?? []
    if (files.length) notify(`iCloud is still downloading ${files.length === 1 ? "a file" : `${files.length} files`} (${namesOf(files)}): they show when they arrive`, { duration: 8000 })
  }, [store])
  return null
}
