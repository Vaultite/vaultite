// Lighthouse's frontend: ```block-lighthouse, drawn from its route (GET /api/lighthouse).
import { definePlugin, notify, Panel, useLive } from "@vaultite"
import { Lamp } from "lucide-react"
import { EditorView } from "@codemirror/view"
import { label } from "./label"

type Beam = { beam: string; keepers: number }

function BeamCard() {
  const { data } = useLive<Beam>("lighthouse")
  return (
    <Panel title="Lighthouse" icon={Lamp} tint="var(--blue)">
      <p className="text-[15px] tracking-[0.0625em] md:tracking-[0.125em] md:hidden" data-lighthouse>{label(data)}</p>
    </Panel>
  )
}

export default definePlugin({
  blocks: { lighthouse: () => <BeamCard /> },
  commands: [{ id: "lighthouse:beam", name: "Say the lighthouse's beam", run: () => notify("The beam is on") },
    { id: "lighthouse:logbook", name: "Read the lighthouse's logbook", run: async () => notify((await import("./logbook")).logbook()) }],
  // (notes say whether the beam's plugin is in their editor: the app's CodeMirror, not a copy of it)
  editor: (ctx) => (ctx.kind === "markdown" ? EditorView.contentAttributes.of({ "data-lighthouse": "" }) : []),
  mockLive: () => ({ lighthouse: { beam: "on", keepers: 2 } }),
})
