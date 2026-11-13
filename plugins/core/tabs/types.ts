export type DeviceTab = { to: string; label?: string; pinned?: boolean }
export type Device = { id: string; name: string; label?: string; kind: "desktop" | "phone" | "web"; at: string; tabs: DeviceTab[]
  live?: boolean; windows?: number }
