// For scripts that write to the vault through the running server (importers): read the API, POST items to it (VAULTITE_URL).

export const URL = process.env.VAULTITE_URL || "http://127.0.0.1:8793"

/** Upsert items (a list) into a collection, e.g. post("logs", [...]). Returns how many were written. */
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

/** GET a route of the API (`state`), as JSON. */
export async function get<T = unknown>(route: string): Promise<T> {
  const r = await fetch(`${URL}/api/${route}`)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return await r.json() as T
}
