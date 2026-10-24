const LAST = "paperink-last-document", OPENING = "paperink-opening-document";
export function lastDocumentToOpen(): { id: string | null; interrupted: boolean } {
  try {
    const id = localStorage.getItem(LAST);
    return { id, interrupted: !!id && localStorage.getItem(OPENING) === id };
  } catch { return { id: null, interrupted: false }; }
}
export function beginDocumentOpen(id: string) {
  try { localStorage.setItem(OPENING, id); } catch { /* Reading still works if preferences are unavailable. */ }
}
export function finishDocumentOpen(id: string) {
  try { if (localStorage.getItem(OPENING) === id) localStorage.removeItem(OPENING); } catch { /* This flag contains no document data. */ }
}
