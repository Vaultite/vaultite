import { definePlugin } from "@vaultite"
import { PeoplePlaces } from "./PeoplePlaces"

export default definePlugin({
  // ```block-people-map: everyone's pin, and the same people by place (`places: false` leaves that list out).
  blocks: { "people-map": ({ store, options }) => <PeoplePlaces store={store} list={options.places !== false} /> },
  preview: (s) => <PeoplePlaces store={s} />,
})
