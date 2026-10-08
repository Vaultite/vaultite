import { User, Users } from "lucide-react"
import { definePlugin, detailPath, plainText } from "@vaultite"
import { PeopleDue, PeopleGroup, PeopleWants, PersonBlock, personKicker, TIMELINE_KINDS } from "./People"
import { mockPeople } from "./mock"

export default definePlugin({
  icon: Users,
  mock: mockPeople,
  // A person is their file (People/<name>.md): links and old #…/person/… addresses open it.
  details: {
    person: {
      render: () => null,
      title: (s, [id]) => s.people.find((x) => x.id === id)?.name ?? "",
      file: (s, [id]) => (s.people.some((x) => x.id === id) ? `${id}.md` : null),
    },
  },
  // How a person's file looks: their profile on top, the Timeline section drawn as a timeline.
  files: {
    types: ["person"], folders: ["People"], icon: User, tint: "var(--people)",
    kicker: personKicker,
  },
  // ```block-person: the profile, on top of a person's file. The People dashboard (pages/People.md): who's due, who you
  // want to reach, and groups by relation.
  blocks: {
    person: (ctx) => <PersonBlock {...ctx} />,
    "people-due": (ctx) => <PeopleDue {...ctx} />,
    "people-wants": (ctx) => <PeopleWants {...ctx} />,
    "people-group": (ctx) => <PeopleGroup {...ctx} />,
  },
  timeline: TIMELINE_KINDS,
  search: (s) => s.people.map((p) => ({
    id: `person-${p.id}`, title: p.name, meta: [p.context, p.location].filter(Boolean).join(" · "), kind: "Person", icon: User,
    tint: "var(--people)", detail: detailPath("person", p.id), file: `${p.id}.md`,
    text: [p.context, p.location, p.tags, plainText(p.notes), p.want_to].join(" "), recent: 0, weight: 10,
  })),
  // [[Alice Park]], an alias, or a first name only one person has ([[Bob]]). An archived person's names count only when
  // no one else answers to them (core/links.ts); search ranks them last (core/search.ts).
  links: (s) => s.people.map((p) => ({
    kind: "person", id: p.id, title: p.name, detail: detailPath("person", p.id), names: [p.name, ...p.aliases], weak: [p.name.split(" ")[0]],
  })),
})
