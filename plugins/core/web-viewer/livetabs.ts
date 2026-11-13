
export type LiveTab = { tab: number; url: string; title: string; loading: boolean; paused: boolean; asking: string | null; askedBy: string | null
  container: string | null; by: string | null; task: string; summary: string; shown: boolean; opened: number | null; appTab: string
  machine?: string; machineLabel?: string }
export type LiveTabs = { tabs: LiveTab[]; self?: string | null }
export type LiveStep = { t: number; by: string; text: string; failed: boolean }
