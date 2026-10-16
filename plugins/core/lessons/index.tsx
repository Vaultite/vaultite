import { BookOpenCheck } from "lucide-react"
import { definePlugin } from "@vaultite"
import { DeckPage, LessonsBlock, Review } from "./Cards"
import { LessonPage } from "./Lesson"
import { mockLessons } from "./mock"

export default definePlugin({
  mock: mockLessons,
  mockLive: () => ({ "lessons/state": { reviews: {}, retention: 0.9, newPerDay: 20 } }),
  files: {
    types: ["lesson", "cards"], folders: ["Lessons", "Cards"], icon: BookOpenCheck, tint: "var(--lessons)",
    page: { render: (ctx) => (ctx.fm.type === "cards" ? <DeckPage {...ctx} /> : <LessonPage {...ctx} />) },
  },
  details: {
    // review: every card due; review/<source>: one cards file's or lesson's.
    review: { render: (s, [source]) => <Review store={s} source={source} />, title: () => "Review" },
  },
  // ```block-lessons: lessons in progress, cards files and what's due (on Learning).
  blocks: { lessons: (ctx) => <LessonsBlock {...ctx} /> },
})
