export type Level = "poor" | "weak" | "good" | "excellent"
export const levelOf = (bits: number): Level => (bits < 40 ? "poor" : bits < 75 ? "weak" : bits < 100 ? "good" : "excellent")
export const isWeak = (bits: number | null | undefined) => bits != null && bits < 75
export const LEVELS: Record<Level, { label: string; color: string; steps: number }> = {
  poor: { label: "Poor", color: "var(--red)", steps: 1 },
  weak: { label: "Weak", color: "var(--orange)", steps: 2 },
  good: { label: "Good", color: "var(--green)", steps: 3 },
  excellent: { label: "Excellent", color: "var(--green)", steps: 4 },
}
export const FULL_BITS = 128
