---
type: dashboard
icon: house
tint: primary
---

```base wide
filters:
  and:
    - file.inFolder("Projects")
    - type == "project"
views:
  - type: kanban
    name: Projects
    order: [tagline]
    groupBy:
      property: status
      direction: ASC
    groups: [idea, building, live, paused]
```

```base wide
filters:
  and:
    - file.inFolder("Notes")
    - kind == "idea"
views:
  - type: kanban
    name: Ideas
    groupBy:
      property: status
      direction: ASC
    groups: [seed, exploring, parked, done]
```

```base
filters:
  and:
    - file.ext == "md"
    - '!file.inFolder("Templates")'
views:
  - type: table
    name: Recently edited
    order: [file.name, file.folder, updated]
    sort:
      - property: updated
        direction: DESC
    limit: 8
```

```base
filters:
  and:
    - file.inFolder("Books")
    - type == "book"
views:
  - type: cards
    name: Reading
    order: [author, status]
```

```base wide
filters:
  and:
    - file.ext == "md"
    - '!file.inFolder("Templates")'
views:
  - type: calendar
    name: This month
    date: updated
```
