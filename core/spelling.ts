export function closest(name: string, names: string[]): string | null {
  const low = name.toLowerCase()
  let best: string | null = null, score = 3
  for (const n of names) {
    const d = n.startsWith(low) || low.startsWith(n) ? 1 : distance(low, n)
    if (d < score) { best = n; score = d }
  }
  return best
}

export function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}
