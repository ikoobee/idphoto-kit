/**
 * IndexedDB cache for model weights: download once, reuse offline. Entries are
 * keyed by the model id (not the URL) so switching source order — local →
 * release mirrors — never re-downloads. Only model bytes are stored, never
 * image data. Falls back to plain fetch when storage is unavailable.
 */
const DB_NAME = "idphoto-kit-models"
const STORE = "models"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key)
    tx.onsuccess = () => resolve(tx.result instanceof Uint8Array ? tx.result : undefined)
    tx.onerror = () => reject(tx.error)
  })
}

async function idbPut(key: string, bytes: Uint8Array): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, key)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function fetchModel(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`)
  // SPA hosts answer unknown paths with index.html (200) — reject that early
  const type = res.headers.get("content-type") ?? ""
  if (type.includes("text/html")) throw new Error(`not a model asset (html): ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Fetch model bytes with IndexedDB caching (best effort, keyed by model id). */
export async function cachedModelBytes(url: string, key: string): Promise<Uint8Array> {
  try {
    const hit = await idbGet(key)
    if (hit) return hit
    const bytes = await fetchModel(url)
    await idbPut(key, bytes).catch(() => {}) // cache failure is non-fatal
    return bytes
  } catch (e) {
    if (e instanceof Error && /download failed|not a model asset/.test(e.message)) throw e
    // storage unavailable → direct fetch
    return fetchModel(url)
  }
}
