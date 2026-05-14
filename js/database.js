// Database functions using Firebase compat SDK (window.db is set in firebase-config.js)

async function createProject(userId, data) {
  // Accept either (userId, name, type) old style or (userId, {name, appType, ...}) new style
  let doc;
  if(typeof data === 'string'){
    // Old style: createProject(uid, name, type) - kept for compat
    const type = arguments[2];
    doc = { userId, name: data, appType: type||'cut',
            width:1920, height:1080, fps:30, duration:30 };
  } else {
    doc = { userId, ...data };
    // Ensure no undefined fields (Firestore rejects them)
    Object.keys(doc).forEach(k => { if(doc[k]===undefined) delete doc[k]; });
  }
  doc.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  doc.updatedAt  = firebase.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection('projects').add(doc);
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
