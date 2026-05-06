import { storage } from './firebase-config.js';
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

export function uploadMedia(userId, projectId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const path = `users/${userId}/projects/${projectId}/media/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        if (onProgress) onProgress(pct);
      },
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, path, name: file.name });
      }
    );
  });
}

export async function deleteMedia(path) {
  await deleteObject(ref(storage, path));
}

export async function listProjectMedia(userId, projectId) {
  const listRef = ref(storage, `users/${userId}/projects/${projectId}/media`);
  const res = await listAll(listRef);
  return Promise.all(res.items.map(item => getDownloadURL(item)));
}
