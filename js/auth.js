// Auth functions using Firebase compat SDK (window.firebase)

function onAuthChanged(callback) {
  return auth.onAuthStateChanged(callback);
}

async function signUp(email, password, displayName) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName: displayName });
  return cred.user;
}

async function signIn(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

async function signInGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await auth.signInWithPopup(provider);
  return cred.user;
}

async function logout() {
  await auth.signOut();
}

function currentUser() {
  return auth.currentUser;
}
