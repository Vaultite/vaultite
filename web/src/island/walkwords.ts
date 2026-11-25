import { countText, type WalkScene } from "../../../core/desktop/walks"

export function walkWords(w: WalkScene) {
  const lesson = w.of === "lesson"
  return { name: lesson ? "Watching" : "QA walk", count: lesson ? (w.count === 1 ? "1 step" : `${w.count} steps`) : countText(w.count), lesson }
}
export const walkWidth = (w: WalkScene | null) => (w ? 30 + walkWords(w).name.length * 7 + String(w.count).length * 7 : 0)
