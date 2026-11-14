import type { RefObject } from "react"
import { useStore } from "@/core/data"
import { placeBelow, type HoverShown } from "@/core/hovercard"
import { tabMeta } from "@/core/phoneTabs"
import { focusedPane, type Pane, type Tab } from "../../../core/layout.ts"
import { Badged } from "@/components/kit"
import { Captioned, HoverCard } from "@/components/HoverCard"
import { TabPreview } from "@/components/TabPreview"
import type { TabInfo } from "@/components/Tabs"
import { cn } from "@/lib/utils"

export function TabCard({ shown, chip, tab, info }: { shown: HoverShown; chip: RefObject<HTMLElement | null>; tab: Tab; info: (t: Tab | Pane) => TabInfo }) {
  const { store } = useStore()
  const pane = focusedPane(tab), own = info(tab), Icon = own.icon
  const icon = (
    <Badged on={own.badge}>
      <Icon className={cn("size-3.5 shrink-0", !own.tint && "text-muted-foreground", own.iconClassName)} strokeWidth={2.25} style={own.tint ? { color: own.tint } : undefined} />
    </Badged>
  )
  return (
    <HoverCard shown={shown} anchor={chip} place={placeBelow} data-tab-hover-card={tab.id}>
      <Captioned picture={store && <TabPreview store={store} pane={pane} info={info(pane)} />} icon={icon} title={own.label}
        about={pane.to.startsWith("file:") ? tabMeta(pane.to) : null} />
    </HoverCard>
  )
}
