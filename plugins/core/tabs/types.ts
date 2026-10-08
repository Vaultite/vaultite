// Tabs' part of the store (plugin.ts: `tabDevices` in /api/state): what each device has open, the latest first.
export type DeviceTab = { to: string; label?: string; pinned?: boolean }
export type Device = { id: string; name: string; kind: "desktop" | "phone" | "web"; at: string; tabs: DeviceTab[] }

declare module "@vaultite" {
  interface PluginState { tabDevices?: Device[] }
}
