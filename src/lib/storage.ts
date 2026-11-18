import type { DraftSnapshot } from "../types";

const DATABASE_NAME = "paperplane-local-pdf";
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
  });
}

export async function saveDraft(snapshot: DraftSnapshot): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(snapshot, DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the local draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The local draft save was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function loadDraft(): Promise<DraftSnapshot | null> {
  const database = await openDatabase();
  try {
    return await new Promise<DraftSnapshot | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DRAFT_KEY);
      request.onsuccess = () => resolve((request.result as DraftSnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the local draft."));
    });
  } finally {
    database.close();
  }
}
