// A plugin's built-in page (core/pages.ts) is read-only and updates with its plugin: its header says so, with Copy to
// my vault, which makes it a file of the user's in a folder they pick (its pins and links follow; the built-in goes).
import { Package } from "lucide-react"
import { chooseFolder, inPagesDir, notify, notifyError, op, openFile, pluginById } from "@vaultite"

/** Copy a built-in page into a folder the user picks, and open the copy. */
export function copyToVault(path: string) {
  chooseFolder("Copy to my vault", (folder) => {
    op<{ path: string }>("dashboard.copy", { path, folder }).then((r) => {
      notify(`Copied to ${r.path}: it's yours to change`, { id: "page-copy" })
      openFile(r.path)
    }, (e) => notifyError(e, "Couldn't copy the page"))
  })
}

export function BuiltInBar({ path, plugin }: { path: string; plugin: unknown }) {
  if (!inPagesDir(path)) return null
  const name = typeof plugin === "string" ? pluginById(plugin)?.name : null
  return (
    <div data-page-builtin className="mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
      <Package className="size-4 shrink-0" strokeWidth={2} />
      <span className="min-w-0 flex-1">Built in: it updates with {name ?? "the app"}. To change it, copy it to your vault.</span>
      <button type="button" onClick={() => copyToVault(path)} data-page-copy
        className="h-7 shrink-0 cursor-pointer rounded-[6px] border-[0.5px] border-border bg-card px-2.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.05]">
        Copy to my vault
      </button>
    </div>
  )
}
