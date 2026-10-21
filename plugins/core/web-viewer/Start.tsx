// A new web tab's page, under its address (which has the keyboard): the sites visited most, a click away.
import { useCallback, useEffect, useState } from "react"
import { History } from "lucide-react"
import { SidebarHeading, SidebarRow, openView } from "@vaultite"
import { hostOf } from "./address"
import { hasHistory, topSites, useHistoryChanged, type Suggestion } from "./history"
import { siteIcon } from "./icons"

export function Start({ onOpen }: { onOpen: (url: string, newTab: boolean) => void }) {
  const [sites, setSites] = useState<Suggestion[] | null>(null)
  const read = useCallback(() => { void topSites(8).then(setSites, () => setSites([])) }, [])
  useEffect(read, [read])
  useHistoryChanged(read)
  if (!hasHistory()) return null
  return (
    <div className="mx-auto max-w-[520px] px-4 pt-[12vh] pb-10" data-size-up data-web-start>
      {sites && sites.length > 0 && (
        <>
          <SidebarHeading title="Frequently visited" open />
          <div className="flex flex-col gap-px">
            {sites.map((s) => (
              <SidebarRow key={s.url} icon={siteIcon(s.url)} label={s.title || hostOf(s.url)} open tip={s.url} data-web-top={s.url}
                onClick={(e) => onOpen(s.url, e.metaKey || e.ctrlKey || e.button === 1)}>
                <span className="mr-1 min-w-0 shrink truncate text-[12px] text-tertiary">{hostOf(s.url)}</span>
              </SidebarRow>
            ))}
          </div>
        </>
      )}
      <div className={sites?.length ? "mt-3" : ""}>
        <SidebarRow icon={History} label="History" open onClick={() => openView("web-history", { newTab: true })} data-web-start-history />
      </div>
    </div>
  )
}
