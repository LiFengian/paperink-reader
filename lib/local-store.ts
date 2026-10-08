import type { ReaderDocument, ReaderPage, Mark, ChatMessage } from "./reader-types";

const DB_NAME = "paperink-local-v1", DB_VERSION = 2;
const META = "document-meta", PAGES = "page-meta", MARKS = "mark-deltas", CHATS = "chat-deltas";
const snapshots = new Map<string, { ref: WeakRef<ReaderDocument>; revision?: string }>();
const pending = new Map<string, Promise<IDBValidKey>>();
let connection: Promise<IDBDatabase> | null = null;
type DocumentMeta = Omit<ReaderDocument, "pages" | "chat"> & { pageIds: string[]; revision: string };
type PageMeta = Omit<ReaderPage, "marks"> & { documentId: string; markIds: string[] };
type StoredMark = Mark & { documentId: string; pageId: string };
const remember = (document: ReaderDocument, revision?: string) => { snapshots.set(document.id, { ref: new WeakRef(document), revision }); return document; };

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs");
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES, { keyPath: ["documentId", "id"] }).createIndex("documentId", "documentId");
      if (!db.objectStoreNames.contains(MARKS)) db.createObjectStore(MARKS, { keyPath: ["documentId", "pageId", "id"] }).createIndex("documentId", "documentId");
      if (!db.objectStoreNames.contains(CHATS)) db.createObjectStore(CHATS);
      // Legacy documents remain untouched. Small deltas override them on read.
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; snapshots.clear(); };
      db.onclose = () => { connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}
const value = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const complete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error("本地保存已取消。"));
});

export async function getDocument(id: string): Promise<ReaderDocument | undefined> {
  const db = await openDatabase(), transaction = db.transaction(["documents", META, PAGES, MARKS, CHATS], "readonly");
  const done = complete(transaction);
  const [base, meta, pages, marks, chat] = await Promise.all([
    value<ReaderDocument | undefined>(transaction.objectStore("documents").get(id)),
    value<DocumentMeta | undefined>(transaction.objectStore(META).get(id)),
    value<PageMeta[]>(transaction.objectStore(PAGES).index("documentId").getAll(id)),
    value<StoredMark[]>(transaction.objectStore(MARKS).index("documentId").getAll(id)),
    value<ChatMessage[] | undefined>(transaction.objectStore(CHATS).get(id)),
  ]);
  await done;
  if (!meta) return base ? remember(base) : undefined;
  const cached = snapshots.get(id), cachedDocument = cached?.ref.deref();
  if (cached?.revision === meta.revision && cachedDocument) return cachedDocument;
  const basePages = new Map(base?.pages.map(page => [page.id, page]) || []), pageMap = new Map(pages.map(page => [page.id, page]));
  const overrides = new Map<string, Map<string, Mark>>();
  for (const stored of marks) {
    const { documentId: _document, pageId, ...mark } = stored;
    if (!overrides.has(pageId)) overrides.set(pageId, new Map()); overrides.get(pageId)!.set(mark.id, mark as Mark);
  }
  const decoded = meta.pageIds.map(id => {
    const saved = pageMap.get(id), original = basePages.get(id);
    if (!saved) { if (!original) throw new Error("页面笔记数据缺失，请恢复完整备份。"); return original; }
    const { documentId: _document, markIds, ...attributes } = saved;
    const originals = new Map(original?.marks.map(mark => [mark.id, mark]) || []), changed = overrides.get(id);
    return { ...attributes, marks: markIds.map(markId => {
      const mark = changed?.get(markId) || originals.get(markId);
      if (!mark) throw new Error("笔迹数据缺失，请恢复完整备份。"); return mark;
    }) };
  });
  const { pageIds: _ids, revision, ...attributes } = meta;
  return remember({ ...attributes, pages: decoded, chat: chat ?? base?.chat ?? [] }, revision);
}

export async function listDocuments(): Promise<ReaderDocument[]> {
  const db = await openDatabase(), transaction = db.transaction(["documents", META], "readonly"), done = complete(transaction);
  const [legacy, metadata] = await Promise.all([value<ReaderDocument[]>(transaction.objectStore("documents").getAll()), value<DocumentMeta[]>(transaction.objectStore(META).getAll())]);
  await done;
  const overlaid = new Set(metadata.map(meta => meta.id));
  const result = new Map(legacy.map(document => [document.id, overlaid.has(document.id) ? document : remember(document)]));
  for (const meta of metadata) { const document = await getDocument(meta.id); if (document) result.set(meta.id, document); }
  return [...result.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function writeDocument(document: ReaderDocument): Promise<IDBValidKey> {
  const before = snapshots.get(document.id)?.ref.deref() || await getDocument(document.id);
  if (before === document) return document.id;
  const db = await openDatabase(), transaction = db.transaction([META, PAGES, MARKS, CHATS], "readwrite"), done = complete(transaction);
  const revision = crypto.randomUUID();
  try {
    const { pages, chat, ...attributes } = document;
    transaction.objectStore(META).put({ ...attributes, pageIds: pages.map(page => page.id), revision });
    const oldPages = new Map(before?.pages.map(page => [page.id, page]) || []);
    for (const page of pages) {
      const previous = oldPages.get(page.id); if (previous === page) continue;
      const { marks, ...attributes } = page;
      transaction.objectStore(PAGES).put({ ...attributes, documentId: document.id, markIds: marks.map(mark => mark.id) });
      if (previous?.marks === marks) continue;
      const oldMarks = new Map(previous?.marks.map(mark => [mark.id, mark]) || []), ids = new Set(marks.map(mark => mark.id));
      for (const mark of marks) if (oldMarks.get(mark.id) !== mark) transaction.objectStore(MARKS).put({ ...mark, documentId: document.id, pageId: page.id });
      for (const markId of oldMarks.keys()) if (!ids.has(markId)) transaction.objectStore(MARKS).delete([document.id, page.id, markId]);
    }
    if (!before || before.chat !== chat) transaction.objectStore(CHATS).put(chat, document.id);
  } catch (error) { transaction.abort(); await done.catch(() => {}); throw error; }
  await done; remember(document, revision); return document.id;
}
export function saveDocument(document: ReaderDocument): Promise<IDBValidKey> {
  const prior = pending.get(document.id);
  const task = (prior ? prior.catch(() => {}) : Promise.resolve()).then(() => writeDocument(document));
  pending.set(document.id, task);
  void task.finally(() => { if (pending.get(document.id) === task) pending.delete(document.id); }).catch(() => {});
  return task;
}
export async function savePdf(id: string, file: Blob): Promise<IDBValidKey> {
  const db = await openDatabase(), transaction = db.transaction("pdfs", "readwrite"), done = complete(transaction);
  transaction.objectStore("pdfs").put(file, id); await done; return id;
}
export async function getPdf(id: string): Promise<Blob | undefined> {
  const db = await openDatabase(), transaction = db.transaction("pdfs", "readonly"), done = complete(transaction);
  const result = await value<Blob | undefined>(transaction.objectStore("pdfs").get(id)); await done; return result;
}
export async function deleteDocument(id: string): Promise<void> {
  await pending.get(id)?.catch(() => {});
  const db = await openDatabase(), transaction = db.transaction(["documents", "pdfs", META, PAGES, MARKS, CHATS], "readwrite"), done = complete(transaction);
  for (const name of ["documents", "pdfs", META, CHATS]) transaction.objectStore(name).delete(id);
  for (const name of [PAGES, MARKS]) {
    const store = transaction.objectStore(name), request = store.index("documentId").openKeyCursor(IDBKeyRange.only(id));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
  }
  await done; snapshots.delete(id);
}
// A single transaction preserves the existing library if any restore write fails.
export async function restoreDocuments(entries: { document: ReaderDocument; pdf: Blob }[]): Promise<void> {
  const db = await openDatabase(), transaction = db.transaction(["documents", "pdfs"], "readwrite"), done = complete(transaction);
  try { for (const entry of entries) { transaction.objectStore("documents").add(entry.document); transaction.objectStore("pdfs").add(entry.pdf, entry.document.id); } }
  catch (error) { transaction.abort(); await done.catch(() => {}); throw error; }
  await done; for (const entry of entries) remember(entry.document);
}
