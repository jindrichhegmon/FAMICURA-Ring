/*
 * Writing recordings into a folder on disk - in practice the Google Drive
 * sync folder, so Drive carries them up.
 *
 * A page cannot be given an absolute path; the File System Access API is the
 * only way, and it requires the person to pick the folder once. The handle is
 * kept in IndexedDB so the choice survives reloads, but the browser still
 * wants a gesture to re-grant permission in a new session.
 *
 * Chrome and Edge on the desktop support this. Safari does not, on the Mac or
 * on iOS, so callers must check isSupported() and fall back to downloads.
 */

const DB = "famicura-folder";
const STORE = "handles";
const KEY = "videos";

export function isSupported() {
  return typeof globalThis.showDirectoryPicker === "function";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveHandle(handle) {
  await withStore("readwrite", (store) => store.put(handle, KEY));
}

export async function loadHandle() {
  try { return (await withStore("readonly", (store) => store.get(KEY))) || null; }
  catch { return null; }
}

export async function forgetHandle() {
  try { await withStore("readwrite", (store) => store.delete(KEY)); } catch { /* nothing kept */ }
}

/**
 * Asks for the folder. Must be called from a click. Failing to remember the
 * choice must not lose it for this session - private windows and blocked site
 * data can refuse IndexedDB.
 */
export async function pickFolder() {
  const handle = await globalThis.showDirectoryPicker({ id: "famicura-videos", mode: "readwrite" });
  try { await saveHandle(handle); }
  catch (e) { console.warn("Složku se nepodařilo zapamatovat", e); }
  return handle;
}

/**
 * Whether the handle may be written to. `prompt` re-asks, which only works
 * inside a user gesture; without one it just reports what is already granted.
 */
export async function ensurePermission(handle, prompt = false) {
  if (!handle?.queryPermission) return false;
  const opts = { mode: "readwrite" };
  if (await handle.queryPermission(opts) === "granted") return true;
  if (!prompt) return false;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Writes the blob as `name` in the folder. Returns the name actually used. */
export async function writeFile(handle, name, blob) {
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return name;
}
