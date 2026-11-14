import { Globe } from "lucide-react"
import { get, notifyError, setProperty, type MenuItem } from "@vaultite"
import { forgetFormatted, settings } from "./client.ts"
import { follow } from "./menus.ts"
import type { StyleChoices, StyleInfo } from "./wire.ts"

export async function styleMenu(style: StyleInfo, note: string): Promise<MenuItem[]> {
  let choices: StyleChoices["choices"] = []
  try { choices = (await get<StyleChoices>("references/styles")).choices } catch (e) { notifyError(e, "Couldn't list the styles") }
  const pick = (value: string) => () => {
    forgetFormatted()
    if (style.own && note) void setProperty(note, "csl", value).catch((e) => notifyError(e, "Couldn't change the note's style"))
    else void settings.set({ style: value })
  }
  return [
    ...choices.map((c, i) => ({ label: c.label, checked: c.value === style.id, run: pick(c.value), sep: i === 6 })),
    { label: "Find more styles", icon: Globe, sep: true, run: () => follow("https://www.zotero.org/styles") },
  ]
}
