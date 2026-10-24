import { pluginSettings } from "@vaultite"

export const settings = pluginSettings<{ other_devices?: boolean; archive_after?: string }>("tabs")
