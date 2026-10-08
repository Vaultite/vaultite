import { BookOpenCheck } from "lucide-react"
import { definePlugin, PageHeader, type PageCtx } from "@vaultite"
import { DeckPage, LessonsBlock, Review } from "./Cards"
import { LessonPage } from "./Lesson"
import { mockLessons } from "./mock"

/** In a tab the page's name, and what it's about; in a sheet the file's title is there already. */
function Header({ title, fm, place }: PageCtx) {
  const about = typeof fm.source === "string" ? fm.source.replace(/^\[\[|\]\]$/g, "").split("|").pop() : ""
  const sub = `${fm.type === "cards" ? "Cards" : "Lesson"}${about ? ` on ${about}` : ""}`
  return place === "page" ? <PageHeader title={title} subtitle={sub} /> : null
}

export default definePlugin({
  mock: mockLessons,
  mockLive: () => ({ "lessons/state": { reviews: {}, retention: 0.9, newPerDay: 20 } }),
  files: {
    types: ["lesson", "cards"], folders: ["Lessons", "Cards"], icon: BookOpenCheck, tint: "var(--lessons)",
    kicker: ({ fm }) => (fm.type === "cards" ? "Cards" : "Lesson"),
    page: { header: (ctx) => <Header {...ctx} />, render: (ctx) => (ctx.fm.type === "cards" ? <DeckPage {...ctx} /> : <LessonPage {...ctx} />) },
  },
  details: {
    // review: every card due; review/<source>: one cards file's or lesson's.
    review: { render: (s, [source]) => <Review store={s} source={source} />, title: () => "Review" },
  },
  // ```block-lessons: lessons in progress, cards files and what's due (on Learning).
  blocks: { lessons: (ctx) => <LessonsBlock {...ctx} /> },
})
