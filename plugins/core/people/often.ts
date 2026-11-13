
const NAMED: Record<number, string> = { 1: "daily", 7: "weekly", 14: "every 2 weeks", 30: "monthly", 60: "every 2 months" }
export const often = (n: number) => NAMED[n] ?? `every ${n} days`
