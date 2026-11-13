import { User } from "lucide-react"
import { definePlugin, detailPath, plainText } from "@vaultite"
import { PeopleBirthdays, PeopleDue, PeopleGroup, PeopleWants, PersonBlock, TIMELINE_KINDS } from "./People"
import { mockPeople } from "./mock"

export default definePlugin({
  mock: mockPeople,
  details: {
    person: {
      render: () => null,
      title: (s, [id]) => s.people.find((x) => x.id === id)?.name ?? "",
      file: (s, [id]) => (s.people.some((x) => x.id === id) ? `${id}.md` : null),
    },
  },
  files: {
    types: ["person"], folders: ["People"], icon: User, tint: "var(--people)",
  },
  blocks: {
    person: (ctx) => <PersonBlock {...ctx} />,
    "people-due": (ctx) => <PeopleDue {...ctx} />,
    "people-wants": (ctx) => <PeopleWants {...ctx} />,
    "people-birthdays": (ctx) => <PeopleBirthdays {...ctx} />,
    "people-group": (ctx) => <PeopleGroup {...ctx} />,
  },
  timeline: TIMELINE_KINDS,
  search: (s) => s.people.map((p) => ({
    id: `person-${p.id}`, title: p.name, meta: [p.context, p.location].filter(Boolean).join(" · "), kind: "Person", icon: User,
    tint: "var(--people)", detail: detailPath("person", p.id), file: `${p.id}.md`,
    text: [p.context, p.location, p.tags, plainText(p.notes), p.want_to].join(" "), recent: 0, weight: 10,
  })),
  links: (s) => s.people.map((p) => ({
    kind: "person", id: p.id, title: p.name, detail: detailPath("person", p.id), names: p.aliases,
  })),
})
