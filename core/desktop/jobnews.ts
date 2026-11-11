// Which of a job's moves are news (the companion's job_news), apart from its jobs' machine (jobs.ts): the menu-bar
// helper notifies the same ones the companion says.

/** Whether a job now `state` is a notification (job_news): needing them or failed (one ready knocks: the companion's proofs.ts). */
export const jobTold = (state: string, news: unknown) => news !== "off" && (state === "needs you" || state === "failed")
