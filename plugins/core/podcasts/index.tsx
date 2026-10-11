// Podcasts: Follow a podcast… (a name looked up, or a feed's address) and the shows followed, in its settings.
import { useEffect, useState } from "react"
import { Podcast, RefreshCw, Rss, Search } from "lucide-react"
import { choose, definePlugin, Group, notify, notifyError, op, SettingRow } from "@vaultite"

type Feed = { url: string; title: string; added: string }
type Found = { title: string; author: string; feed: string }
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

const follow = (show: string) =>
  op<{ title: string; already?: boolean; episodes?: number }>("podcast.follow", { show }).then((r) =>
    notify(r.already ? `Already following ${r.title}` : `Following ${r.title}${r.episodes ? ": its latest episode lands in the inbox shortly" : ""}`),
  (e) => notifyError(e, "Couldn't follow it"))

/** Ask for a show: what's typed is looked up (or followed, an address), then its matches to pick from. */
function ask() {
  choose({
    title: "Follow a podcast", placeholder: "A podcast's name, or its feed's address", items: [],
    other: (typed) => typed.trim() ? (isUrl(typed)
      ? { id: typed.trim(), label: `Follow ${typed.trim()}`, icon: Rss }
      : { id: `?${typed.trim()}`, label: `Search for "${typed.trim()}"`, icon: Search }) : null,
    empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Type a show's name, or paste its feed.</p>,
    onPick: (it) => {
      if (!it.id.startsWith("?")) return void follow(it.id)
      op<{ results: Found[] }>("podcast.search", { term: it.id.slice(1) }).then(({ results }) => choose({
        title: "Follow a podcast", placeholder: "Pick the show", heading: results.length ? undefined : "None found",
        items: results.map((r) => ({ id: r.feed, label: r.title, detail: r.author, icon: Podcast })),
        onPick: (r) => void follow(r.id),
      }), (e) => notifyError(e, "Couldn't search"))
    },
  })
}

function Shows() {
  const [shows, setShows] = useState<Feed[] | null>(null)
  const load = () => op<{ shows: Feed[] }>("podcast.list").then((r) => setShows(r.shows), () => setShows([]))
  useEffect(() => { void load() }, [])
  const btn = "h-9 cursor-pointer rounded-[8px] bg-foreground/[0.06] px-3 text-[15px] hover:bg-foreground/[0.1] md:h-7 md:text-[13px]"
  return (
    <div>
    <p className="mb-1.5 px-1 text-[13px] text-muted-foreground">Following</p>
    <Group>
      {shows?.map((s) => (
        <SettingRow key={s.url} label={s.title} sub={`Since ${s.added}`}>
          <button type="button" className={btn} onClick={() => op("podcast.unfollow", { show: s.url }).then(load, (e) => notifyError(e, "Couldn't unfollow"))}>Unfollow</button>
        </SettingRow>
      ))}
      <SettingRow label="Follow a podcast" sub={shows && !shows.length ? "Not following any yet" : undefined}>
        <button type="button" className={btn} onClick={() => { ask(); setTimeout(load, 4000) }}>Follow…</button>
      </SettingRow>
      {!!shows?.length && (
        <SettingRow label="New episodes" sub="Looked for every hour">
          <button type="button" className={btn} onClick={() => op<{ saved: string[] }>("podcast.check").then((r) => notify(r.saved.length ? `${r.saved.length} new episode${r.saved.length === 1 ? "" : "s"} in the inbox` : "No new episodes"), (e) => notifyError(e, "Couldn't check"))}>
            <RefreshCw className="mr-1 inline size-3.5" strokeWidth={2} />Check now
          </button>
        </SettingRow>
      )}
    </Group>
    </div>
  )
}

export default definePlugin({
  commands: [{ id: "podcasts:follow", name: "Follow a podcast…", run: ask, icon: Podcast, label: "Follow podcast" }],
  settingsPanel: () => <Shows />,
  settingsSearch: [{ label: "Following" }, { label: "Follow a podcast" }],
})
