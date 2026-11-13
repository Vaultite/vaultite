export const URL = process.env.VAULTITE_URL || "http://127.0.0.1:8793"

/** Upserts `items` into `collection` in batches; how many it wrote. */
export async function post(collection: string, items: unknown[], batch = 200) {
  let n = 0
  for (let i = 0; i < items.length; i += batch) {
    const r = await fetch(`${URL}/api/${collection}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items.slice(i, i + batch)),
    })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    n += (await r.json()).upserted
  }
  return n
}

export async function get<T = unknown>(route: string): Promise<T> {
  const r = await fetch(`${URL}/api/${route}`)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return await r.json() as T
}
