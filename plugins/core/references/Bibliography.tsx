import { cn, useLive } from "@vaultite"
import { settings, touchesLibrary } from "./client.ts"
import { useLibraryVersion } from "./hooks.ts"
import { safeHtml } from "./safe.ts"
import type { NoteAnswer } from "./wire.ts"
import "./references.css"

function List({ path, print }: { path: string; print: boolean }) {
  const { data } = useLive<NoteAnswer>(`references/note?path=${encodeURIComponent(path)}`, useLibraryVersion(), (p) => p === path || touchesLibrary(p))
  if (!data?.entries.length) return null
  return (
    <section className={cn("vau-bibliography", data.place !== "end" ? "mt-3" : print ? "mt-8" : "mt-10 border-t border-border pt-6")} data-bibliography={path} aria-label="References">
      {data.place === "end" && <h2 className="mb-3 text-[20px] leading-[26px] font-semibold">References</h2>}
      <div className={cn("flex flex-col gap-2", data.numbered && "vau-ref-numbered-list")}>
        {data.entries.map((e) => (
          <div key={e.key} className={cn("vau-ref-text select-text text-[15px] leading-[22px]", data.numbered ? "vau-ref-numbered" : data.hanging && "vau-ref-hanging")}
            dangerouslySetInnerHTML={{ __html: safeHtml(e.html) }} />
        ))}
      </div>
    </section>
  )
}

export function Bibliography({ path, place }: { path: string; place: "page" | "sheet" | "print" }) {
  const inDocument = settings.use().inDocument === true
  if (!/\.md$/i.test(path) || (place !== "print" && !inDocument)) return null
  return <List path={path} print={place === "print"} />
}
