/**
 * IndexedDB persistence for browser-picked files. The in-memory File
 * map dies with the page, so before this store every recent turned
 * "Not available" after a reload and could never reopen. Desktop
 * reads the file back from disk; this store is the browser
 * equivalent. It is the "cache" the settings screen clears, with a
 * byte cap and oldest-first eviction so it cannot grow forever.
 */

const DB_NAME = "paperwren-files";
const DB_VERSION = 1;
const STORE = "files";
/** Total stored bytes before the oldest copies are evicted. */
const CAP_BYTES = 256 * 1024 * 1024;

interface StoredRecord {
	source: string;
	blob: Blob;
	bytes: number;
	storedAt: number;
}

const hasIndexedDB = typeof indexedDB !== "undefined" && indexedDB !== null;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(STORE)) {
					database.createObjectStore(STORE, { keyPath: "source" });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	return dbPromise;
}

function request<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return db().then(
		(database) =>
			new Promise<T>((resolve, reject) => {
				const transaction = database.transaction(STORE, mode);
				const request = run(transaction.objectStore(STORE));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			}),
	);
}

/** Drop oldest copies until the store fits the cap. Best effort: an
 * eviction failure must never fail the pick that triggered it. */
async function evictOverCap(): Promise<void> {
	const records = await request<StoredRecord[]>("readonly", (s) => s.getAll());
	let total = records.reduce((sum, r) => sum + r.bytes, 0);
	if (total <= CAP_BYTES) return;
	const byAge = [...records].sort((a, b) => a.storedAt - b.storedAt);
	for (const record of byAge) {
		if (total <= CAP_BYTES) break;
		await request("readwrite", (s) => s.delete(record.source));
		total -= record.bytes;
	}
}

export async function storedFilePut(source: string, blob: Blob): Promise<void> {
	if (!hasIndexedDB) return;
	await request("readwrite", (s) =>
		s.put({ source, blob, bytes: blob.size, storedAt: Date.now() }),
	);
	await evictOverCap();
}

export async function storedFileGet(source: string): Promise<Blob | null> {
	if (!hasIndexedDB) return null;
	const record = await request<StoredRecord | undefined>("readonly", (s) =>
		s.get(source),
	);
	return record?.blob ?? null;
}

export async function storedFileClear(): Promise<void> {
	if (!hasIndexedDB) return;
	await request("readwrite", (s) => s.clear());
}

export async function storedFileBytes(): Promise<number> {
	if (!hasIndexedDB) return 0;
	const records = await request<StoredRecord[]>("readonly", (s) => s.getAll());
	return records.reduce((sum, r) => sum + r.bytes, 0);
}
