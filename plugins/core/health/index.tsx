import { definePlugin } from "@vaultite"
import { WorkoutsPanel } from "./Health"
import { LogSections } from "./LogSections"
import { NutritionPanel, SleepPanel } from "./sections"

export default definePlugin({
  // Its page is the Health dashboard (pages/Health.md); sleep and nutrition are on Today too.
  blocks: {
    workouts: ({ store, options }) => <WorkoutsPanel store={store} area={typeof options.area === "string" && options.area ? options.area : "workouts"} />,
    // ```block-sleep: last night and the average. Option: nights (default 7).
    sleep: ({ store, options }) => <SleepPanel store={store} nights={Math.max(1, Math.min(60, Number(options.nights) || 7))} />,
    nutrition: ({ store }) => <NutritionPanel store={store} />,
    // ```block-workout, in a workout log file: its exercises and sets, or its climbs.
    workout: ({ store, path }) => {
      const l = store.logs.find((x) => `${x.id}.md` === path)
      return l ? <LogSections log={l} /> : null
    },
  },
})
