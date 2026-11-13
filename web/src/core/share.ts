export type Share = { guest: string; role: "read" | "comment" | "edit"; folder: string; expires: string; plugins: string[] }

export const share: Share | null = globalThis.vaultiteShare ?? null

/** Whether the guest may change notes (else the app is read-only for them). */
export const guestEdits = () => !share || share.role === "edit"

const COMMANDS = /^(switcher|palette|sidebar|tab|split|theme|scheme|density|properties|editor|find|outline|search|folding|backlinks|page-preview|tags|companion:comment|vault:reload|file:(new|reveal)$|file:copy-path)/
export const guestCommand = (id: string) => !share || (COMMANDS.test(id) && (guestEdits() || id !== "file:new"))
