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
