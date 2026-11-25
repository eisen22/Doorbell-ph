// =====================================================================
// parent/parentCloud.js — THE PARENT PORTAL'S CONNECTION TO FIREBASE
// ---------------------------------------------------------------------
// The parent portal (/parent) uses its OWN copy of Firebase (named 'parent'), separate from the
// staff website, so a parent's sign-in never mixes with a teacher's. It stays signed in on the
// parent's phone (local persistence) until they press Sign out.
//
// How signing in works (no SMS, no email):
//   * The mobile number becomes a sign-in email: 09171234567 -> p09171234567@parents...  (logic.js)
//   * FIRST sign-in: the parent types the default password (child's initials + birthday, MMDDYY).
//     There is no account yet, so one is created, and parents/{uid} is saved with that password as
//     "proof". firestore.rules only allows it when the proof matches the hash the school saved in
//     parentKeys/{number}; otherwise the new account is deleted again and the parent sees
//     "Wrong mobile number or password".
//   * Later sign-ins are normal Firebase email + password sign-ins.
// What a parent can read: parentKeys/{their number}, parentDays of their children, their own excuses,
// and the message threads they are in (threads/messages with 'p:<their number>' in members).
// =====================================================================
import { getApps, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  setPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updatePassword,
} from 'firebase/auth';
import { arrayUnion, collection, deleteField, doc, getDoc, getFirestore, onSnapshot, query, setDoc, updateDoc, where, writeBatch, FieldPath } from 'firebase/firestore';
import { firebaseConfig, cloudConfigured } from '../firebase';
import { parentEmail, parentKeyOf, sha256Hex } from '../logic';
import { OFFICE, OFFICE_NAME, MAX_FILES, parentMsgKey, cleanMessage, buildThread, buildMessage, buildAttachment, afterMessage, isUnread, orderMembers, mailQueueDocs } from '../messaging';

export const portalAvailable = cloudConfigured;

// REMEMBER ME for parents: ticked (the default, a parent's own phone) keeps them signed in until "Sign out";
// not ticked (a shared or borrowed phone) signs them out when the tab is closed.
const PARENT_REMEMBER_KEY = 'doorbell-remember-parent';
const parentRemembered = () => {
  try {
    return localStorage.getItem(PARENT_REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
};
let fb = null;
function start() {
  if (fb) return fb;
  const app = getApps().find((a) => a.name === 'parent') ?? initializeApp(firebaseConfig, 'parent');
  let auth;
  try {
    auth = initializeAuth(app, { persistence: parentRemembered() ? browserLocalPersistence : browserSessionPersistence });
  } catch {
    auth = getAuth(app);
  }
  fb = { auth, db: getFirestore(app) };
  return fb;
}

const WRONG = 'Wrong mobile number or password. Use the password the school texted you, or press "Forgot password?".';
const isCredentialError = (e) => /invalid-credential|wrong-password|user-not-found|invalid-login/.test(e?.code ?? '');
const friendly = (e) => {
  const code = e?.code ?? '';
  if (code.includes('too-many-requests')) return new Error('Too many tries. Wait a few minutes and try again.');
  if (code.includes('network')) return new Error('No internet connection. Check your data or Wi-Fi.');
  return e instanceof Error ? e : new Error(String(e));
};

// Makes sure the parent profile exists. On the first sign-in it is created with the typed password as
// proof (checked by firestore.rules), then the proof is removed right away.
async function ensureProfile(uid, key, password) {
  const { db } = start();
  const ref = doc(db, 'parents', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, { mobile: key, proof: password, defaultPassword: true, createdAt: new Date().toISOString() });
  await updateDoc(ref, { proof: deleteField() });
}

/** Signs a parent in with their mobile number and password (creates the account on the first sign-in). */
export async function signInParent(mobileInput, passwordInput, remember = true) {
  const { auth } = start();
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  try {
    localStorage.setItem(PARENT_REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    /* storage blocked */
  }
  const key = parentKeyOf(mobileInput);
  if (!key) throw new Error('Enter your mobile number, e.g. 0917 123 4567.');
  const password = passwordInput.trim();
  if (!password) throw new Error('Enter your password.');
  const email = parentEmail(key);
  // 1. Normal sign-in (also tries the password in small letters: the default password is in small letters).
  for (const pw of [...new Set([password, password.toLowerCase()])]) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      try {
        await ensureProfile(cred.user.uid, key, pw);
      } catch {
        await fbSignOut(auth);
        throw new Error('This number is not linked to a child at this school. Ask the teacher to check the number on file.');
      }
      return;
    } catch (e) {
      if (!isCredentialError(e)) throw friendly(e);
    }
  }
  // 2. No account yet: the first sign-in must use the default password, which creates the account.
  const first = password.toLowerCase();
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, first);
  } catch (e) {
    if (/email-already-in-use|weak-password|invalid-password/.test(e?.code ?? '')) throw new Error(WRONG);
    throw friendly(e);
  }
  try {
    await ensureProfile(cred.user.uid, key, first);
  } catch {
    // The password is not this number's default password (or the number is not registered): undo.
    await cred.user.delete().catch(() => fbSignOut(auth));
    throw new Error(WRONG);
  }
}

/**
 * Signs a parent in with Google. Works only for a Gmail the school saved on the child's guardian record
 * (Admin -> Students): parentEmails/{gmail} says which number it belongs to, and the parent profile is
 * linked to that number (firestore.rules checks both). The mobile number and password keep working too.
 */
export async function signInParentWithGoogle(remember = true) {
  const { auth, db } = start();
  try {
    localStorage.setItem(PARENT_REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    /* storage blocked */
  }
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let cred;
  try {
    // The 3rd argument: this Firebase copy starts with initializeAuth, which leaves out the pop-up helper.
    cred = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
  } catch (e) {
    const code = e?.code ?? '';
    if (code.includes('popup-closed') || code.includes('cancelled-popup')) throw new Error('Google sign-in was closed before it finished.');
    if (code.includes('popup-blocked')) throw new Error('The browser blocked the Google window. Allow pop-ups for this site and try again.');
    throw friendly(e);
  }
  const email = (cred.user.email ?? '').toLowerCase();
  const notLinked = new Error(
    `${email || 'This Google account'} is not linked to a child at this school. Sign in with your mobile number, or ask the school to add your Gmail to your child's record.`,
  );
  try {
    const link = await getDoc(doc(db, 'parentEmails', email));
    if (!link.exists()) throw notLinked;
    const mobile = link.data().mobile;
    const ref = doc(db, 'parents', cred.user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) await setDoc(ref, { mobile, via: 'google', email, defaultPassword: false, createdAt: new Date().toISOString() });
    else if (snap.data().via !== 'google') throw notLinked; // a password account with this address: not for Google
    else if (snap.data().mobile !== mobile) await updateDoc(ref, { mobile }); // the school moved the Gmail to another number
  } catch {
    await fbSignOut(auth);
    throw notLinked;
  }
}

/** Resolves to true when a parent is still signed in on this device ("Remember me"). */
export function parentSignedIn() {
  if (!portalAvailable()) return Promise.resolve(false);
  const { auth } = start();
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(!!user);
    });
  });
}

export async function signOutParent() {
  await fbSignOut(start().auth);
}

/** Changes the password. The parent types the current one again (Firebase asks for a recent sign-in). */
export async function changeParentPassword(current, next, codeHash) {
  const { auth, db } = start();
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in again first.');
  if (next.length < 8) throw new Error('Use at least 8 characters.');
  if (codeHash && (await sha256Hex(next.toLowerCase())) === codeHash) throw new Error("That's the default password. Choose a different one.");
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current.trim()));
  } catch (e) {
    try {
      // The default password may have been typed in capital letters.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current.trim().toLowerCase()));
    } catch {
      throw isCredentialError(e) ? new Error('Your current password is wrong.') : friendly(e);
    }
  }
  await updatePassword(user, next);
  await updateDoc(doc(db, 'parents', user.uid), { defaultPassword: false });
}

/** Sends an excuse request to the child's teacher. files: prepared photos/PDFs (excuse letter, medical certificate). */
export async function sendExcuse({ studentId, sectionId, studentName, guardianName, dates, reason, note, periods, files = [], mobile }) {
  const { auth, db } = start();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in again first.');
  if (files.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} files.`);
  const id = `ex-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const atts = files.map((file) => buildAttachment({ excuseId: id, from: { key: parentMsgKey(mobile) }, file }));
  const b = writeBatch(db);
  atts.forEach((a) => b.set(doc(db, 'attachments', a.id), a));
  b.set(doc(db, 'excuses', id), {
    id,
    studentId,
    sectionId,
    parentUid: uid,
    studentName,
    guardianName: guardianName ?? '',
    dates: [...dates].sort(),
    reason,
    note: note.trim(),
    // Excused for these class periods only (numbers, e.g. [1, 2]); left out = the whole day.
    ...(periods?.length ? { periods: [...periods].sort((a, b) => a - b) } : {}),
    ...(atts.length ? { files: atts.map(({ id: fid, name, type, size }) => ({ id: fid, name, type, size })) } : {}),
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  await b.commit();
}

/* ---------------------------------------------------------------------
   MESSAGES (src/messaging.js). The parent writes as 'p:<their number>'. A new conversation goes to one
   teacher of the child's class, the school office, or both (3-way). firestore.rules checks that the
   teacher teaches that class and that the class is one of the parent's children's.
   --------------------------------------------------------------------- */
/**
 * Sends a message. thread = an existing thread (or null to start one); to = ['t:<id>'] and/or ['office'];
 * about = { studentId, studentName, sectionId }; contacts = that child's teachers [{ key, name }].
 * Returns the thread id.
 */
// files: prepared attachments [{ name, type, size, data }] (src/shared/Attachments.jsx prepareFile), saved in
// the same batch as the message (firestore.rules checks each one belongs to a conversation of this parent).
export async function sendParentMessage({ mobile, parentName, thread, threads = [], to = [], about, contacts = [], text, files = [] }) {
  const { auth, db } = start();
  if (!auth.currentUser) throw new Error('Sign in again first.');
  if (files.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} files in one message.`);
  const body = cleanMessage(text, files.length > 0);
  const me = parentMsgKey(mobile);
  const from = { key: me, name: parentName || 'Parent' };
  if (!thread && about) {
    const teacher = contacts.find((c) => to.includes(c.key));
    const others = [...(teacher ? [{ key: teacher.key, name: teacher.name }] : []), ...(to.includes(OFFICE) ? [{ key: OFFICE, name: OFFICE_NAME }] : [])];
    if (!others.length) throw new Error('Choose who to send it to.');
    // Same people about the same child: continue that conversation.
    const members = orderMembers([me, ...others.map((o) => o.key)]).join();
    thread = threads.find((t) => t.members.join() === members && t.studentId === about.studentId) ?? null;
    if (!thread) {
      const t = buildThread({ from, others, about: { mobile, parentName: from.name, ...about }, text: body, files });
      const atts = files.map((file) => buildAttachment({ thread: t, from, file }));
      const m = buildMessage({ thread: t, from, text: body, files: atts, at: t.lastAt });
      const b = writeBatch(db);
      b.set(doc(db, 'threads', t.id), t);
      atts.forEach((a) => b.set(doc(db, 'attachments', a.id), a));
      b.set(doc(db, 'messages', m.id), m);
      await b.commit();
      await queueStaffEmails(db, mailQueueDocs(t, m));
      return t.id;
    }
  }
  if (!thread) throw new Error('Choose who to send it to.');
  const atts = files.map((file) => buildAttachment({ thread, from, file }));
  const m = buildMessage({ thread, from, text: body, files: atts });
  const next = afterMessage(thread, m);
  const b = writeBatch(db);
  atts.forEach((a) => b.set(doc(db, 'attachments', a.id), a));
  b.set(doc(db, 'messages', m.id), m);
  // Only these fields, and only the parent's own "read" time (firestore.rules allows nothing else).
  b.update(doc(db, 'threads', thread.id), 'lastAt', next.lastAt, 'lastText', next.lastText, 'lastFrom', next.lastFrom, 'lastName', next.lastName, new FieldPath('readAt', me), m.at);
  await b.commit();
  await queueStaffEmails(db, mailQueueDocs(next, m));
  return thread.id;
}
// One attachment of a conversation the parent is in (read when they open it; kept for this visit).
const attachmentCache = new Map();
export async function fetchParentAttachment(id) {
  if (attachmentCache.has(id)) return attachmentCache.get(id);
  const { db } = start();
  const snap = await getDoc(doc(db, 'attachments', id));
  const a = snap.exists() ? snap.data() : null;
  if (a) attachmentCache.set(id, a);
  return a;
}

// Email alerts for the teachers / office in the conversation (worker/src/index.js). Saved after the message,
// on their own: if this is refused (e.g. older firestore.rules), the message is still sent.
async function queueStaffEmails(db, docs) {
  if (!docs.length) return;
  const b = writeBatch(db);
  docs.forEach((q) => b.set(doc(db, 'mailQueue', q.id), q));
  await b.commit().catch((e) => console.warn('Email alert queue not saved (publish the newest firestore.rules):', e.message));
}

/** Opening a conversation marks it read for the parent. */
export async function markParentRead(mobile, thread) {
  const me = parentMsgKey(mobile);
  if (!thread || !isUnread(thread, me)) return;
  const { db } = start();
  await updateDoc(doc(db, 'threads', thread.id), new FieldPath('readAt', me), thread.lastAt);
}

/**
 * Watches everything the portal shows and calls onChange(state) whenever it changes:
 *   { status: 'loading' | 'signedOut' | 'ready' | 'error', profile, key, months: { studentId: [month docs] }, excuses, error }
 * Chain: sign-in -> parents/{uid} (the number) -> parentKeys/{number} (the children) -> each child's months + excuses.
 */
// The parent closed an announcement ("Got it"): saved on their profile, so it stays closed on every phone.
export async function dismissAnnouncement(id) {
  const { auth, db } = start();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, 'parents', uid), { dismissed: arrayUnion(id) });
}

export function watchParent(onChange) {
  const { auth, db } = start();
  let state = { status: 'loading', months: {}, excuses: [], threads: [], messages: [] };
  const emit = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const fail = (e) => emit({ status: 'error', error: e.message });
  let profileUnsub = null;
  let keyUnsub = null;
  let childUnsubs = [];
  let msgUnsubs = [];
  let watchedMobile = null;
  let watchedIds = null;
  const stopChildren = () => {
    childUnsubs.forEach((u) => u());
    childUnsubs = [];
    watchedIds = null;
  };
  const stopKey = () => {
    keyUnsub?.();
    keyUnsub = null;
    msgUnsubs.forEach((u) => u());
    msgUnsubs = [];
    watchedMobile = null;
    stopChildren();
  };
  const stopAll = () => {
    profileUnsub?.();
    profileUnsub = null;
    stopKey();
  };
  const watchChildren = (ids, uid) => {
    stopChildren();
    watchedIds = ids.join(',');
    for (const id of ids) {
      childUnsubs.push(
        onSnapshot(
          query(collection(db, 'parentDays'), where('studentId', '==', id)),
          (snap) => {
            const docs = snap.docs.map((d) => d.data()).sort((a, b) => a.month.localeCompare(b.month));
            emit({ months: { ...state.months, [id]: docs } });
          },
          fail,
        ),
      );
    }
    childUnsubs.push(
      onSnapshot(
        query(collection(db, 'excuses'), where('parentUid', '==', uid)),
        (snap) => emit({ excuses: snap.docs.map((d) => d.data()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }),
        fail,
      ),
    );
  };
  const watchKey = (mobile, uid) => {
    stopKey();
    watchedMobile = mobile;
    // The parent's conversations and their messages (skipped quietly if firestore.rules is older than Messages).
    const mine = (col) => query(collection(db, col), where('members', 'array-contains', parentMsgKey(mobile)));
    const quiet = (e) => console.warn('Messages not loaded: publish the new firestore.rules', e);
    msgUnsubs.push(
      onSnapshot(mine('threads'), (snap) => emit({ threads: snap.docs.map((d) => d.data()) }), quiet),
      onSnapshot(mine('messages'), (snap) => emit({ messages: snap.docs.map((d) => d.data()) }), quiet),
    );
    keyUnsub = onSnapshot(
      doc(db, 'parentKeys', mobile),
      (snap) => {
        const key = snap.exists() ? snap.data() : { studentIds: [], children: [] };
        emit({ key, status: 'ready' });
        if (key.studentIds.join(',') !== watchedIds) watchChildren(key.studentIds, uid);
      },
      fail,
    );
  };
  const offAuth = onAuthStateChanged(auth, (user) => {
    stopAll();
    if (!user) return emit({ status: 'signedOut', profile: null, key: null, months: {}, excuses: [], threads: [], messages: [] });
    emit({ status: 'loading', profile: null, key: null, months: {}, excuses: [], threads: [], messages: [] });
    profileUnsub = onSnapshot(
      doc(db, 'parents', user.uid),
      (snap) => {
        if (!snap.exists()) return; // still being created by signInParent
        const profile = snap.data();
        emit({ profile, email: user.email });
        if (profile.mobile !== watchedMobile) watchKey(profile.mobile, user.uid);
      },
      fail,
    );
  });
  return () => {
    stopAll();
    offAuth();
  };
}
