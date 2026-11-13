import { definePlugin } from "@vaultite"
import { Previews } from "./Previews"

export default definePlugin({
  background: ({ store }) => <Previews store={store} />,
})
