import { z } from "zod"
import { defineOp, OpError } from "../ops.ts"
import { noWindow } from "./common.ts"

const Shown = z.object({ found: z.boolean().catch(false), label: z.string().optional(), where: z.string().optional(), sub: z.string().optional(), near: z.array(z.string()).optional() }).nullable().catch(null)

export const settingShowOp = () => defineOp({
  id: "settings.show",
  cli: "settings show",
  summary: "Open Settings in the user's window at one setting, scrolled to and flashed: by its key, its label or words of it.",
  help: `For "take me to the setting that...": one step to the row itself, wherever it lives (a section, a plugin's own
sheet), in the window the user was in last. The setting by its key (summoned_model; companion.summoned_model when two
plugins share it), its label as Settings shows it ("Model for summoned asks") or words of it ("dark mode"). Answers
which one it opened and where; nothing matching lists the closest. To change a value: settings set.

  vau settings show summoned_model
  vau settings show companion.summoned_model
  vau settings show "dark mode"`,
  kind: "write",
  params: { setting: { type: "string", required: true, description: "its key (summoned_model, or plugin.key), its label, or words of it" } },
  args: ["setting"],
  run: async ({ setting }, ctx) => {
    const r = Shown.parse(await ctx.ui({ action: "setting", text: setting }).catch(noWindow))
    if (!r?.found) throw new OpError(`no setting matches "${setting}"${r?.near?.length ? `; the closest: ${r.near.join(", ")}` : ""}`, 404)
    return r
  },
  text: (r) => `Opened Settings at ${JSON.stringify(r.label)} (${r.where}), flashed on screen.`,
  did: ({ setting }) => ({ action: "ui", text: `Showed the setting ${setting} in the app` }),
})
