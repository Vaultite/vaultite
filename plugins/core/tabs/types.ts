// Tabs' part of the store (plugin.ts: `tabDevices` in /api/state): what each device has open, the latest first.
export type DeviceTab = { to: string; label?: string; pinned?: boolean }
/** `label`: the user's name for it; `live`: open now (in `windows` windows), as GET tabs/devices says (the state
 *  doesn't). */
export type Device = { id: string; name: string; label?: string; kind: "desktop" | "phone" | "web"; at: string; tabs: DeviceTab[]
  live?: boolean; windows?: number }

declare module "@vaultite" {
  interface PluginState { tabDevices?: Device[] }
}
