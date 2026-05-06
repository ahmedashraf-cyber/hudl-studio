import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPJffGPYetfjeThcZ46AbHZjj4RS06C8s",
  authDomain: "hudl-studio.firebaseapp.com",
  projectId: "hudl-studio",
  storageBucket: "hudl-studio.firebasestorage.app",
  messagingSenderId: "899214204971",
  appId: "1:899214204971:web:f6993b99687b896e980a6e"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
