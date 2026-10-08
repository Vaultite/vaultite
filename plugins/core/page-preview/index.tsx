import { definePlugin } from "@vaultite"
import { Previews } from "./Previews"

// Page preview: a background listener on the whole page, so any `data-wiki` link or `data-preview`
// row previews, whichever plugin drew it.
export default definePlugin({
  background: ({ store }) => <Previews store={store} />,
})
