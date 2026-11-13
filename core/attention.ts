export const waitsOnUser = (s: { state?: string }) => s.state === "blocked"
export const hasNews = (s: { needs?: boolean; review?: boolean }) => !!s.needs || !!s.review
