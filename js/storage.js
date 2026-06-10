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

const _IDB_NAME = 'hudl-studio-media';
const _IDB_VER  = 1;
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

async function saveMediaFile(projectId, file, mediaId) {
  // mediaId / UUID is the permanent identity key.
  // key = projectId/__uuid__mediaId so it is unique across all projects and filenames.
  const db  = await _openMediaDB();
  const buf = await file.arrayBuffer();
  const key = mediaId
    ? (projectId + '/__uuid__' + mediaId)  // UUID-keyed — collision-free
    : (projectId + '/' + file.name);       // legacy fallback for old code paths
  await new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put({ key, name: file.name, mediaId: mediaId || null, type: file.type, buf });
    tx.oncomplete = res;
    tx.onerror    = e => rej(e.target.error);
  });
  db.close();
}

async function loadMediaFiles(projectId) {
  const db = await _openMediaDB();
  const files = await new Promise((res, rej) => {
    const tx  = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e.target.error);
  });
  db.close();
  // Return all files for this project (both new ID-keyed and legacy name-keyed)
  return files
    .filter(f => f.key.startsWith(projectId + '/') || f.key.startsWith(projectId + '/__mid__') || f.key.startsWith(projectId + '/__uuid__'))
    .map(f => {
      const blob = new Blob([f.buf], { type: f.type });
      return {
        name:    f.name,
        mediaId: f.mediaId || null,   // new ID field (null for legacy records)
        type:    f.type,
        url:     URL.createObjectURL(blob),
        blob,
      };
    });
}

async function deleteProjectMediaFiles(projectId) {
  const db = await _openMediaDB();
  const tx = db.transaction(_IDB_STORE, 'readwrite');
  const store = tx.objectStore(_IDB_STORE);
  const keys = await new Promise((res, rej) => {
    const r = store.getAllKeys();
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e.target.error);
  });
  // Delete both new ID-keyed AND legacy name-keyed records for this project
  keys
    .filter(k => k.startsWith(projectId + '/') || k.startsWith(projectId + '/__mid__') || k.startsWith(projectId + '/__uuid__'))
    .forEach(k => store.delete(k));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = e => rej(e.target.error); });
  db.close();
}
