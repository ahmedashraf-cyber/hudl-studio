// Storage functions using Firebase compat SDK (window.storage is set in firebase-config.js)

function uploadMedia(userId, projectId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const storageRef = storage.ref('projects/' + userId + '/' + projectId + '/' + file.name);
    const task = storageRef.put(file);
    task.on('state_changed',
      snap => { if(onProgress) onProgress(snap.bytesTransferred / snap.totalBytes * 100); },
      err  => reject(err),
      ()   => task.snapshot.ref.getDownloadURL().then(resolve).catch(reject)
    );
  });
}

async function getMediaFiles(userId, projectId) {
  try {
    const listRef = storage.ref('projects/' + userId + '/' + projectId);
    const result  = await listRef.listAll();
    return await Promise.all(result.items.map(async item => ({
      name: item.name,
      url:  await item.getDownloadURL(),
      ref:  item.fullPath,
    })));
  } catch(e) { return []; }
}

async function deleteMediaFile(filePath) {
  await storage.ref(filePath).delete();
}

// ── IndexedDB: store media files locally (survives page reload without re-upload) ──

const _IDB_NAME  = 'hudl-studio-media';
const _IDB_VER   = 1;
const _IDB_STORE = 'files';

function _openMediaDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, _IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(_IDB_STORE))
        db.createObjectStore(_IDB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── saveMediaFile: store file binary in IDB ──────────────────────────────────
// Uses arrayBuffer() — this is fine because it's a one-time write during import,
// not during playback or project open.
async function saveMediaFile(projectId, file, mediaId) {
  const db  = await _openMediaDB();
  const buf = await file.arrayBuffer();
  const _legacyKey = projectId + '/' + file.name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,5);
  const key = mediaId
    ? (projectId + '/__uuid__' + mediaId)
    : _legacyKey;
  await new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put({ key, name: file.name, mediaId: mediaId || null, type: file.type, buf });
    tx.oncomplete = res;
    tx.onerror    = e => rej(e.target.error);
  });
  db.close();
}

// ── loadMediaFilesMetaOnly: FAST — reads only key/name/mediaId/type, NO buffers ──
// Returns metadata records without loading binary data into RAM.
// Call loadMediaFileByKey(db, key) separately to get the actual blob on demand.
async function loadMediaFilesMetaOnly(projectId) {
  const db = await _openMediaDB();
  const allKeys = await new Promise((res, rej) => {
    const tx  = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).getAllKeys();
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e.target.error);
  });
  // Filter to this project's keys
  const projKeys = allKeys.filter(k =>
    k.startsWith(projectId + '/') ||
    k.startsWith(projectId + '/__mid__') ||
    k.startsWith(projectId + '/__uuid__')
  );
  // Fetch metadata only (no buf) for each key — IDB doesn't support partial reads
  // so we read the full record but immediately discard buf to free RAM
  const metas = [];
  for(const key of projKeys){
    await new Promise((res, rej) => {
      const tx  = db.transaction(_IDB_STORE, 'readonly');
      const req = tx.objectStore(_IDB_STORE).get(key);
      req.onsuccess = () => {
        const r = req.result;
        if(r) metas.push({ key: r.key, name: r.name, mediaId: r.mediaId||null, type: r.type });
        // buf is NOT kept — only metadata
        res();
      };
      req.onerror = e => { res(); }; // skip missing
    });
  }
  db.close();
  return metas;
}

// ── loadMediaFileByKey: load ONE file's binary on demand ──────────────────────
// Called lazily when a clip's media is first needed (playhead approaches it).
async function loadMediaFileByKey(key) {
  const db = await _openMediaDB();
  const record = await new Promise((res, rej) => {
    const tx  = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e.target.error);
  });
  db.close();
  if(!record || !record.buf) return null;
  const blob = new Blob([record.buf], { type: record.type });
  return { url: URL.createObjectURL(blob), blob, name: record.name, type: record.type, mediaId: record.mediaId };
}
window.loadMediaFileByKey = loadMediaFileByKey;

// ── loadMediaFiles: BACKWARD COMPAT wrapper — still works but now loads lazily ──
// Returns stubs with url=null and a _idbKey for on-demand loading.
// Each stub has a .loadUrl() async method to populate the url when needed.
async function loadMediaFiles(projectId) {
  const metas = await loadMediaFilesMetaOnly(projectId);
  return metas.map(m => ({
    name:    m.name,
    mediaId: m.mediaId,
    type:    m.type,
    url:     null,       // NOT loaded yet — lazy
    blob:    null,
    _idbKey: m.key,      // key to fetch on demand
  }));
}

// ── resolveMediaUrl: populate a stub's url from IDB on demand ─────────────────
async function resolveMediaUrl(stub) {
  if(stub.url) return stub.url; // already loaded
  if(!stub._idbKey) return null;
  const result = await loadMediaFileByKey(stub._idbKey);
  if(result) {
    stub.url  = result.url;
    stub.blob = result.blob;
  }
  return stub.url || null;
}
window.resolveMediaUrl = resolveMediaUrl;

async function deleteProjectMediaFiles(projectId) {
  const db = await _openMediaDB();
  const tx = db.transaction(_IDB_STORE, 'readwrite');
  const store = tx.objectStore(_IDB_STORE);
  const keys = await new Promise((res, rej) => {
    const r = store.getAllKeys();
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e.target.error);
  });
  keys
    .filter(k => k.startsWith(projectId + '/') || k.startsWith(projectId + '/__mid__') || k.startsWith(projectId + '/__uuid__'))
    .forEach(k => store.delete(k));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = e => rej(e.target.error); });
  db.close();
}
