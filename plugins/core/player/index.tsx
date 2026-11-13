import { definePlugin } from "@vaultite"
import { Player } from "./Player"
import { MiniPlayer } from "./Mini"
import { QueueBlock } from "./Queue"
import { Resume } from "./steady"

export default definePlugin({
  player: Player,
  background: () => <><Resume /><MiniPlayer /></>,
  editor: (ctx) => import("./timestamps").then((m) => m.timestamps(ctx)),
  blocks: { queue: ({ store, options }) => <QueueBlock store={store} options={options} /> },
})
