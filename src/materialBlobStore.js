const STORE = "materialBlobs";
const MATERIALS_STORE = "materials";
const QUESTIONS_STORE = "questions";
const DB_VERSION = 3;
let activeOwnerId = null;

/** Scope IndexedDB to the signed-in user so shared browsers do not leak file blobs. */
export function setLibraryOwnerId(ownerId) {
  activeOwnerId = ownerId || null;
}

function libraryDbName() {
  return activeOwnerId
    ? `enlightly-library-${activeOwnerId}`
    : "enlightly-library-unsigned";
}

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(libraryDbName(), DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MATERIALS_STORE)) {
        const materials = db.createObjectStore(MATERIALS_STORE, { keyPath: "id" });
        materials.createIndex("classId", "classId", { unique: false });
        materials.createIndex("unitId", "unitId", { unique: false });
        materials.createIndex("chapterId", "chapterId", { unique: false });
        materials.createIndex("materialType", "materialType", { unique: false });
        materials.createIndex("examSource", "examSource", { unique: false });
      } else if (tx) {
        const materials = tx.objectStore(MATERIALS_STORE);
        if (materials.indexNames.contains("year")) {
          materials.deleteIndex("year");
        }
      }
      if (!db.objectStoreNames.contains(QUESTIONS_STORE)) {
        const questions = db.createObjectStore(QUESTIONS_STORE, { keyPath: "id" });
        questions.createIndex("materialId", "materialId", { unique: false });
        questions.createIndex("classId", "classId", { unique: false });
        questions.createIndex("unitId", "unitId", { unique: false });
        questions.createIndex("chapterId", "chapterId", { unique: false });
        questions.createIndex("examSource", "examSource", { unique: false });
        questions.createIndex("source", "source", { unique: false });
        questions.createIndex("topic", "topic", { unique: false });
      } else if (tx) {
        const questions = tx.objectStore(QUESTIONS_STORE);
        if (questions.indexNames.contains("year")) {
          questions.deleteIndex("year");
        }
      }
    };
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function materialsSave(record) {
  if (!record?.id) throw new Error("materialsSave requires a record with id");
  const db = await openLibraryDb();
  const payload = {
    ...record,
    schemaVersion: record.schemaVersion ?? 1,
    updatedAt: new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString(),
    questions: Array.isArray(record.questions) ? record.questions : [],
  };
  const tx = db.transaction(MATERIALS_STORE, "readwrite");
  tx.objectStore(MATERIALS_STORE).put(payload);
  await txComplete(tx);
  return payload;
}

export async function materialsGet(id) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MATERIALS_STORE, "readonly");
    const req = tx.objectStore(MATERIALS_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function materialsDelete(id) {
  const db = await openLibraryDb();
  const tx = db.transaction([MATERIALS_STORE, QUESTIONS_STORE], "readwrite");
  tx.objectStore(MATERIALS_STORE).delete(id);
  const qStore = tx.objectStore(QUESTIONS_STORE);
  const idx = qStore.index("materialId");
  await new Promise((resolve, reject) => {
    const cursorReq = idx.openKeyCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        qStore.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  return txComplete(tx);
}

export async function materialsList() {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MATERIALS_STORE, "readonly");
    const req = tx.objectStore(MATERIALS_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function materialsQuery(filters = {}) {
  const all = await materialsList();
  return all.filter((m) => {
    if (filters.classId && m.classId !== filters.classId) return false;
    if (filters.unitId && m.unitId !== filters.unitId) return false;
    if (filters.chapterId && m.chapterId !== filters.chapterId) return false;
    if (filters.materialType && m.materialType !== filters.materialType) return false;
    if (filters.examSource && m.examSource !== filters.examSource) return false;
    if (filters.source && m.source !== filters.source) return false;
    return true;
  });
}

export async function questionsSaveMany(records) {
  if (!records?.length) return;
  const db = await openLibraryDb();
  const tx = db.transaction(QUESTIONS_STORE, "readwrite");
  const store = tx.objectStore(QUESTIONS_STORE);
  for (const r of records) {
    if (!r?.id) continue;
    store.put({
      ...r,
      schemaVersion: r.schemaVersion ?? 1,
      updatedAt: new Date().toISOString(),
      createdAt: r.createdAt || new Date().toISOString(),
    });
  }
  return txComplete(tx);
}

export async function questionsByMaterial(materialId) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUESTIONS_STORE, "readonly");
    const idx = tx.objectStore(QUESTIONS_STORE).index("materialId");
    const req = idx.getAll(IDBKeyRange.only(materialId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function questionsQuery(filters = {}) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUESTIONS_STORE, "readonly");
    const req = tx.objectStore(QUESTIONS_STORE).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(
        all.filter((q) => {
          if (filters.classId && q.classId !== filters.classId) return false;
          if (filters.unitId && q.unitId !== filters.unitId) return false;
          if (filters.chapterId && q.chapterId !== filters.chapterId) return false;
          if (filters.examSource && q.examSource !== filters.examSource) return false;
          if (filters.source && q.source !== filters.source) return false;
          return true;
        })
      );
    };
    req.onerror = () => reject(req.error);
  });
}

export async function librarySaveBlob(id, blob, { name, mimeType } = {}) {
  const db = await openLibraryDb();
  const record = {
    id,
    blob,
    mimeType: blob.type || mimeType || "application/octet-stream",
    name: name || "file",
    updatedAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function libraryGet(id) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function libraryDelete(id) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function extractGoogleDriveFileId(urlString) {
  try {
    const u = new URL(urlString);
    const fromPath = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (fromPath) return fromPath[1];
    const id = u.searchParams.get("id");
    if (id) return id;
  } catch {
    return null;
  }
  return null;
}

export async function fetchDriveLinkAsBlob(link) {
  const fileId = extractGoogleDriveFileId(link);
  if (!fileId) {
    throw new Error("Could not read this Drive link. Use a share link that contains the file id.");
  }
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error("Could not download from Drive. Set sharing to “Anyone with the link” or upload the file from your device.");
  }
  const blob = await res.blob();
  if (blob.type.startsWith("text/html")) {
    const snippet = (await blob.slice(0, 8000).text()).toLowerCase();
    if (snippet.includes("virus scan") || snippet.includes("download anyway")) {
      throw new Error(
        "This Drive file needs a manual download. Upload the file from your device to store a copy here."
      );
    }
  }
  return blob;
}

export function newLibraryId() {
  return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isTextEditableMaterial(file) {
  if (file.type === "Text") return true;
  const mime = (file.mimeType || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/javascript") return true;
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) return true;
  return false;
}
