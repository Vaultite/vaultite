// Player: audio and video that keep playing as you move around the app (a mini player), on the lock screen, from where
// you stopped on any device, with skips, speed and captions; times in a note play from there; and the queue block.
import { definePlugin } from "@vaultite"
import { Player } from "./Player"
import { MiniPlayer } from "./Mini"
import { QueueBlock } from "./Queue"
import { timestamps } from "./timestamps"

export default definePlugin({
  player: Player,
  background: () => <MiniPlayer />,
  editor: timestamps,
  blocks: { queue: ({ store, options }) => <QueueBlock store={store} options={options} /> },
})
