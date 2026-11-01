// An import's job, as the API answers it (the app's toast reads it too).
export type Source = "notion" | "evernote" | "keep" | "html" | "bear" | "csv" | "roam"
export type Job = {
  id: string; state: "queued" | "running" | "done" | "failed"; name: string; source: Source | null
  notes: number; created: number; unchanged: number; files: number; folder: string | null
  problems: string[]; started: number; finished?: number; error?: string
}
