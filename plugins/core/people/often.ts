// How often you keep in touch, said the same on the cards (People.tsx) and to agents (plugin.ts).

/** "daily", "every 2 weeks", "every 10 days". */
export const often = (n: number) => ({ 1: "daily", 7: "weekly", 14: "every 2 weeks", 30: "monthly", 60: "every 2 months" } as Record<number, string>)[n] ?? `every ${n} days`
