// Which of a job's moves are news (job_news), apart from the jobs' machine (jobs.ts), so the desktop app's menu-bar helper
// says them without loading it.

/** Whether a job now `state` is a notification (job_news): needing them or failed (one ready knocks: proofs.ts). */
export const jobTold = (state: string, news: unknown) => news !== "off" && (state === "needs you" || state === "failed")
