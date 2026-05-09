// Database functions using Firebase compat SDK (window.db is set in firebase-config.js)

async function createProject(userId, name, type) {
  const ref = await db.collection('projects').add({
    userId, name, type,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function getUserProjects(userId) {
  const snap = await db.collection('projects')
    .where('userId','==',userId)
    .get();
  // Sort client-side to avoid needing a composite Firestore index
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  docs.sort((a,b) => {
    const ta = a.updatedAt?.seconds || a.updatedAt?.toDate?.()?.getTime()/1000 || 0;
    const tb = b.updatedAt?.seconds || b.updatedAt?.toDate?.()?.getTime()/1000 || 0;
    return tb - ta;
  });
  return docs;
}

async function saveProjectState(projectId, state) {
  await db.collection('projects').doc(projectId).update({
    state: JSON.stringify(state),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function loadProject(projectId) {
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function deleteProject(projectId) {
  await db.collection('projects').doc(projectId).delete();
}
