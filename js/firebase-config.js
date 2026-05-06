// Firebase initialized via compat CDN scripts in index.html
// window.firebase is available globally

firebase.initializeApp({
  apiKey: "AIzaSyCPJffGPYetfjeThcZ46AbHZjj4RS06C8s",
  authDomain: "hudl-studio.firebaseapp.com",
  projectId: "hudl-studio",
  storageBucket: "hudl-studio.firebasestorage.app",
  messagingSenderId: "899214204971",
  appId: "1:899214204971:web:f6993b99687b896e980a6e"
});

var auth    = firebase.auth();
var db      = firebase.firestore();
var storage = firebase.storage();
