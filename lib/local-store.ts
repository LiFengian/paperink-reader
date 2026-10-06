import type { ReaderDocument } from "./reader-types";

const DB_NAME = "paperink-local-v1";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestResult<T>(storeName: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = work(transaction.objectStore(storeName));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    db.close();
  }
}

export async function listDocuments(): Promise<ReaderDocument[]> {
  const documents = await requestResult<ReaderDocument[]>("documents", "readonly", store => store.getAll());
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveDocument(document: ReaderDocument): Promise<IDBValidKey> {
  return requestResult("documents", "readwrite", store => store.put(document));
}

export function savePdf(id: string, file: Blob): Promise<IDBValidKey> {
  return requestResult("pdfs", "readwrite", store => store.put(file, id));
}

export function getPdf(id: string): Promise<Blob | undefined> {
  return requestResult("pdfs", "readonly", store => store.get(id));
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["documents", "pdfs"], "readwrite");
      transaction.objectStore("documents").delete(id);
      transaction.objectStore("pdfs").delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
