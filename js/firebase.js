// =====================================================================
// firebase.js — CONNECTION TO THE CLOUD (Firebase)
// ---------------------------------------------------------------------
// Firebase gives us two things:
//   * Authentication: email + password sign-in for teachers and the admin
//   * Firestore: the online database where everything is saved
// Every other file imports `auth`, `db` and the Firestore functions from here,
// so the connection is set up in ONE place.
// The Firebase code is loaded straight from Google's servers (no npm needed).
// =====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ----- YOUR FIREBASE PROJECT -----
// Paste the firebaseConfig from Firebase console -> Project settings -> Your apps.
// These values are not secret: they only say WHICH project to talk to.
// What protects the data are the security rules in firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyClVWQwsBbDPrIUqrASHSnowVWqVLowT4o',
  authDomain: 'doorbell-ph-f12d0.firebaseapp.com',
  projectId: 'doorbell-ph-f12d0',
  storageBucket: 'doorbell-ph-f12d0.firebasestorage.app',
  messagingSenderId: '870779183956',
  appId: '1:870779183956:web:21fa604c5f23c0c5301ec1',
};

// Start Firebase once and share the connection.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Re-export the Firebase functions the pages use, so each page has one import line.
export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch,
};

// ----- Small helpers used by every page -----

// Reads every document in a query and returns plain objects with their id.
// Example: const sections = await readAll(collection(db, 'sections'));
//          -> [{ id: 'abc', name: 'Kinder - Apple', ... }, ...]
export async function readAll(q) {
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Waits until Firebase knows who is signed in, then checks their role.
//   role: 'admin' or 'teacher' — the role this page is for.
// Returns the signed-in user's profile { uid, name, email, role }.
// If nobody is signed in, or the role is wrong, it sends them to the right page.
export function requireUser(role) {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop(); // we only need the first answer
      if (!user) { location.href = 'index.html'; return; } // not signed in -> login page
      const snap = await getDoc(doc(db, 'users', user.uid)); // the profile saved when the account was made
      if (!snap.exists()) { await signOut(auth); alert('This account is not set up in Doorbell. Ask the admin.'); location.href = 'index.html'; return; }
      const profile = { uid: user.uid, ...snap.data() };
      if (profile.role !== role) { location.href = profile.role === 'admin' ? 'admin.html' : 'teacher.html'; return; } // wrong portal
      resolve(profile);
    });
  });
}

// Creates a sign-in account for a NEW teacher without signing the admin out.
// Firebase normally signs in whoever was just created, so we use a second,
// separate copy of Firebase ("helper") for that, then sign it out again.
export async function createTeacherAccount(email, password) {
  const helper = initializeApp(firebaseConfig, `helper-${Date.now()}`); // a second Firebase app with its own sign-in
  const helperAuth = getAuth(helper);
  const cred = await createUserWithEmailAndPassword(helperAuth, email, password);
  await signOut(helperAuth);
  return cred.user.uid; // the new teacher's account id
}

// Shows a message at the bottom of the screen for a few seconds.
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Makes text safe to put inside HTML (stops names like "<b>" from breaking the page).
export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
