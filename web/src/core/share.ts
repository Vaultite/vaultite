// A shared folder opened by its guest (plugins/core/share): the server says so in the page, before the app's code runs.
// The app is then theirs alone: only the guest's plugins and commands, and writes only as their role allows.

export type Share = { guest: string; role: "read" | "comment" | "edit"; folder: string; expires: string; plugins: string[] }

export const share: Share | null = (globalThis as { vaultiteShare?: Share }).vaultiteShare ?? null

/** Whether the guest may change notes (else the app is read-only for them). */
export const guestEdits = () => !share || share.role === "edit"

/** The app's commands a guest has: finding and moving around, the look, writing when they may; never the owner's. */
const COMMANDS = /^(switcher|palette|sidebar|tab|split|theme|scheme|density|properties|editor|find|outline|search|folding|backlinks|page-preview|tags|companion:comment|vault:reload|file:(new|reveal)$|file:copy-path)/
export const guestCommand = (id: string) => !share || (COMMANDS.test(id) && (guestEdits() || id !== "file:new"))
