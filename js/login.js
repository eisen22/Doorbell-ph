// =====================================================================
// login.js — runs on index.html (the sign-in page)
// ---------------------------------------------------------------------
// 1. Checks if the school has an admin yet. If not, shows "First-time setup".
// 2. Signs people in and sends them to admin.html or teacher.html by role.
// =====================================================================

import {
  firebaseConfig, auth, db, doc, getDoc, writeBatch, serverTimestamp, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from './firebase.js';

// Short way to grab an element by its id="..."
const $ = (id) => document.getElementById(id);

// Opens the right portal for a signed-in account.
async function goToPortal(uid) {
  const profile = await getDoc(doc(db, 'users', uid));           // users/{uid} holds the role
  if (!profile.exists()) throw new Error('This account is not set up in Doorbell. Ask the admin.');
  location.href = profile.data().role === 'admin' ? 'admin.html' : 'teacher.html';
}

// ---- Step 0: is js/firebase.js filled in? ----
if (firebaseConfig.apiKey.startsWith('PASTE')) {
  $('login-error').textContent = 'Firebase is not connected yet: paste your firebaseConfig into js/firebase.js.';
  throw new Error('firebaseConfig missing'); // stops this file here
}

// ---- Step 1: first-time setup check ----
// meta/setup is created together with the first admin. Anyone may read it
// (see firestore.rules) so this page can tell if setup is still needed.
try {
  const setup = await getDoc(doc(db, 'meta', 'setup'));
  if (!setup.exists()) $('setup-form').hidden = false;
} catch (err) {
  // "permission-denied" here almost always means firestore.rules was not published yet.
  $('login-error').textContent = err.code === 'permission-denied'
    ? 'The database is locked: publish firestore.rules in Firebase console -> Firestore -> Rules.'
    : `Cannot reach the database: ${err.message}`;
}

// ---- Step 2: normal sign-in ----
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();                                             // stop the browser from reloading the page
  $('login-error').textContent = '';
  try {
    const cred = await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    await goToPortal(cred.user.uid);
  } catch (err) {
    // Firebase error codes look like 'auth/invalid-credential'. Show a friendly message.
    $('login-error').textContent = err.code?.startsWith('auth/') ? 'Wrong email or password.' : err.message;
  }
});

// "Forgot password?" emails a reset link (Firebase sends it).
$('forgot').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) { $('login-error').textContent = 'Type your email first, then click Forgot password.'; return; }
  try { await sendPasswordResetEmail(auth, email); $('login-error').textContent = `Reset link sent to ${email}.`; }
  catch (err) { $('login-error').textContent = err.message; }
});

// ---- First admin account ----
$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('setup-error').textContent = '';
  try {
    const email = $('setup-email').value.trim();
    const cred = await createUserWithEmailAndPassword(auth, email, $('setup-password').value); // makes the sign-in account
    // Save the admin profile AND the "setup done" flag in one batch (both or neither).
    const batch = writeBatch(db);
    batch.set(doc(db, 'meta', 'setup'), { done: true, at: serverTimestamp() });
    batch.set(doc(db, 'users', cred.user.uid), { name: $('setup-name').value.trim(), email, role: 'admin' });
    await batch.commit();
    location.href = 'admin.html';
  } catch (err) {
    $('setup-error').textContent = err.message;
  }
});
