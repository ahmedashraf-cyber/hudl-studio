import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export async function createProject(userId, projectData) {
  const ref = await addDoc(collection(db, 'projects'), {
    userId,
    name: projectData.name,
    appType: projectData.appType,
    width: projectData.width,
    height: projectData.height,
    fps: projectData.fps,
    duration: projectData.duration,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    state: {}
  });
  return ref.id;
}

export async function getUserProjects(userId) {
  const q = query(
    collection(db, 'projects'),
    where('userId', '==', userId),
    orderBy('updatedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveProjectState(projectId, state) {
  const ref = doc(db, 'projects', projectId);
  await updateDoc(ref, { state, updatedAt: serverTimestamp() });
}

export async function loadProject(projectId) {
  const ref = doc(db, 'projects', projectId);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  return null;
}

export async function deleteProject(projectId) {
  await deleteDoc(doc(db, 'projects', projectId));
}
