import { ListChecks } from "lucide-react"
import { AmbientButton, definePlugin, dow, formatDate, isArchived, openFile, pageOf, Panel, parse, plainText, today, useStore } from "@vaultite"
import { RoutineDay, RoutineHistory } from "./RoutineDetail"
import { RoutineGrid } from "./RoutineGrid"
import { mockRoutines } from "./mock"
import { routineDone } from "./routines"

/** Today in the routines' heading, as /api/render gives it (plugin.ts): "Thursday 15 October". */
const DAY = "dddd D MMMM"

/** The status bar's count of today's routines done, which opens Today. */
function RoutinesToday() {
  const { store } = useStore()
  if (!store?.routines) return null
  const d = today(), due = store.routines.filter((r) => !isArchived(r) && r.days.includes(String(dow(d))))
  if (!due.length) return null
  const done = due.filter((r) => routineDone(store, r, d)).length
  const page = pageOf(store, "today", "Today")
  return <AmbientButton icon={ListChecks} text={`${done}/${due.length}`} tip={`${done} of ${due.length} routines done today`}
    tint={done === due.length ? "var(--green)" : undefined} onClick={() => page && openFile(page.path)} />
}

export default definePlugin({
  mock: mockRoutines,
  // ```block-routines: this week's routines, to tick, under today's date. Its page is the Today dashboard
  // (pages/Today.md), where other plugins' blocks sit too (the calendar, this week's goals, sleep, meals).
  blocks: {
    routines: ({ store }) => (
      <Panel title={<>Routines <span className="font-normal text-muted-foreground">· {formatDate(parse(today()), DAY)}</span></>} icon={ListChecks} tint="var(--primary)">
        <RoutineGrid store={store} />
      </Panel>
    ),
  },
  ambient: { routines: { title: "Routines today", sort: 10, render: () => <RoutinesToday /> } },
  details: {
    // routine/<id> (history) and routine/<id>/<date> (that day)
    routine: {
      render: (s, [id, date]) => {
        const r = s.routines.find((x) => x.id === id)
        return r ? (date ? <RoutineDay store={s} r={r} date={date} /> : <RoutineHistory store={s} r={r} />) : null
      },
      title: (s, [id]) => s.routines.find((x) => x.id === id)?.name ?? "",
    },
  },
  search: (s) => s.routines.map((r) => ({
    id: `routine-${r.id}`, title: r.name, meta: "Routine", kind: "Routine", icon: ListChecks, tint: "var(--primary)",
    detail: `routine/${encodeURIComponent(r.id)}`, file: `${r.id}.md`, text: plainText(r.notes), recent: 0, weight: 4,
  })),
})
