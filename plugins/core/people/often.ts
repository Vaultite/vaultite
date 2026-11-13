
const NAMED = new Map([[1, "daily"], [7, "weekly"], [14, "every 2 weeks"], [30, "monthly"], [60, "every 2 months"]])
export const often = (n: number) => NAMED.get(n) ?? `every ${n} days`
