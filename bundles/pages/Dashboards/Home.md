---
type: dashboard
icon: house
tint: primary
subtitle: Your pages and databases
---

```block-query
title: Projects
from: Projects/
type: project
view: board
group: status
groups: [idea, building, live, paused]
columns: [tagline]
wide: true
```

```block-query
title: Ideas
from: Notes/
where: "kind = idea"
view: board
group: status
groups: [seed, exploring, parked, done]
wide: true
```

```block-query
title: Recently edited
columns: [file, folder, updated]
sort: -updated
limit: 8
```

```block-query
title: Reading
from: Books/
type: book
view: cards
columns: [author, status]
```

```block-query
title: This month
view: calendar
date: updated
wide: true
```
