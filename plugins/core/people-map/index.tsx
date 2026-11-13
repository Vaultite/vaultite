import { definePlugin } from "@vaultite"
import { PeoplePlaces } from "./PeoplePlaces"

export default definePlugin({
  blocks: { "people-map": ({ store, options }) => <PeoplePlaces store={store} list={options.places !== false} /> },
  preview: (s) => <PeoplePlaces store={s} />,
})
