---
type: dashboard
icon: house
---

```base
filters:
  and:
    - file.ext == "md"
views:
  - type: table
    name: Recently edited
    order: [file.name, updated]
    sort:
      - property: updated
        direction: DESC
    limit: 8
```
