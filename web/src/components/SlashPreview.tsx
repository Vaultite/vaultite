import { useMemo, type ReactNode } from "react"
import { PreviewLive, type Store } from "@/core/data"
import type { SlashItem } from "@/core/define"
import { mockLive } from "@/core/mock"
import { getPrefs } from "@/core/prefs"
import { BlockView, segments } from "@/components/Blocks"
import { Catch } from "@/components/Guard"
import { Markdown } from "@/components/Markdown"
import { Picture, PreviewCard, Zoomed } from "@/components/PreviewCard"

function NoteSample({ text, store }: { text: string; store: Store }) {
  const parts = useMemo(() => segments(text), [text])
  const disabled = getPrefs().disabled
  return (
    <div className="flex flex-col gap-3">
      {parts.map((s) => "block" in s
        ? <BlockView key={s.line} name={s.block} text={s.text} ctx={{ store, path: "Lighthouse.md", fm: {}, body: text }} disabled={disabled} quiet />
        : <Markdown key={s.line} text={"md" in s ? s.md : `![[${s.embed}]]`} store={store} full from="Lighthouse.md" />)}
    </div>
  )
}

export function SlashPreview({ item, store }: { item: SlashItem; store: Store }) {
  const live = useMemo(() => mockLive(), [])
  const small = matchMedia("(max-width: 767px)").matches
  const w = small ? Math.min(340, innerWidth * 0.9) - 20 : 240, h = small ? 112 : 150
  const sample = item.sample ?? item.text?.replace("$|", "")
  const drawn: ReactNode = item.preview ? item.preview(store) : sample !== undefined && <NoteSample text={sample} store={store} />
  return (
    <PreviewCard className="slash-preview" style={{ width: w + 20, background: "var(--card)" }}>
      {drawn && (
        <Picture width={w} height={h} className="mb-2 bg-background">
          <Zoomed inner={small ? 340 : 360} width={w} className="px-5 py-4">
            <PreviewLive.Provider value={live}><Catch fallback={() => null}>{drawn}</Catch></PreviewLive.Provider>
          </Zoomed>
        </Picture>
      )}
      {item.description && <p className="line-clamp-3 px-0.5 text-[12px] leading-[16px] text-muted-foreground max-md:text-[13px] max-md:leading-[18px]">{item.description}</p>}
    </PreviewCard>
  )
}
