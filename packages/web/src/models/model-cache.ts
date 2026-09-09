/**
 * IndexedDB cache for model weights: download once, reuse offline. Only the
 * model bytes are stored — never image data. Falls back to plain fetch when
 * storage is unavailable (private mode, quota).
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

async function idbGet(url: string): Promise<Uint8Array | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(url)
    tx.onsuccess = () => resolve(tx.result instanceof Uint8Array ? tx.result : undefined)
    tx.onerror = () => reject(tx.error)
  })
}

async function idbPut(url: string, bytes: Uint8Array): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, url)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Fetch model bytes with IndexedDB caching (best effort). */
export async function cachedModelBytes(url: string): Promise<Uint8Array> {
  try {
    const hit = await idbGet(url)
    if (hit) return hit
    const res = await fetch(url)
    if (!res.ok) throw new Error(`model download failed: ${res.status} ${url}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    await idbPut(url, bytes).catch(() => {}) // cache failure is non-fatal
    return bytes
  } catch (e) {
    if (e instanceof Error && e.message.includes("model download failed")) throw e
    // storage unavailable → direct fetch
    const res = await fetch(url)
    if (!res.ok) throw new Error(`model download failed: ${res.status} ${url}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}
