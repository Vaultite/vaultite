// The Inbox's settings (data.json), live: its background and lists read them.
import { pluginSettings } from "@vaultite"

export type Settings = { toasts?: boolean; notifications?: boolean; show_read?: boolean }
export const settings = pluginSettings<Settings>("inbox")
