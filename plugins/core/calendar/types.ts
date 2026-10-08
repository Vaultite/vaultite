// An event as the calendar's route answers it (live, never in the vault).
export type CalEvent = { calendar: string; title: string; location: string; start: string; end: string | null; all_day: boolean }
