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
// What a parent can read: parentKeys/{their number}, parentDays of their children, their own excuses.
// =====================================================================
import { getApps, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
} from 'firebase/auth';
import { collection, deleteField, doc, getDoc, getFirestore, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { firebaseConfig, cloudConfigured } from '../firebase';
import { parentEmail, parentKeyOf, sha256Hex } from '../logic';

export const portalAvailable = cloudConfigured;

let fb = null;
function start() {
  if (fb) return fb;
  const app = getApps().find((a) => a.name === 'parent') ?? initializeApp(firebaseConfig, 'parent');
  let auth;
  try {
    auth = initializeAuth(app, { persistence: browserLocalPersistence });
  } catch {
    auth = getAuth(app);
  }
  fb = { auth, db: getFirestore(app) };
  return fb;
}

const WRONG = 'Wrong mobile number or password. First time? Use the default password from the school.';
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
export async function signInParent(mobileInput, passwordInput) {
  const { auth } = start();
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

/** Sends an excuse request to the child's teacher. */
export async function sendExcuse({ studentId, sectionId, studentName, guardianName, dates, reason, note }) {
  const { auth, db } = start();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in again first.');
  const id = `ex-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await setDoc(doc(db, 'excuses', id), {
    id,
    studentId,
    sectionId,
    parentUid: uid,
    studentName,
    guardianName: guardianName ?? '',
    dates: [...dates].sort(),
    reason,
    note: note.trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Watches everything the portal shows and calls onChange(state) whenever it changes:
 *   { status: 'loading' | 'signedOut' | 'ready' | 'error', profile, key, months: { studentId: [month docs] }, excuses, error }
 * Chain: sign-in -> parents/{uid} (the number) -> parentKeys/{number} (the children) -> each child's months + excuses.
 */
export function watchParent(onChange) {
  const { auth, db } = start();
  let state = { status: 'loading', months: {}, excuses: [] };
  const emit = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const fail = (e) => emit({ status: 'error', error: e.message });
  let profileUnsub = null;
  let keyUnsub = null;
  let childUnsubs = [];
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
    if (!user) return emit({ status: 'signedOut', profile: null, key: null, months: {}, excuses: [] });
    emit({ status: 'loading', profile: null, key: null, months: {}, excuses: [] });
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
