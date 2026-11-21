// =====================================================================
// firebase.js — CONNECTING THE APP TO THE CLOUD (Firebase)
// ---------------------------------------------------------------------
// The Engine (engine.js) keeps the school's data in memory and runs all the
// rules. This file connects it to Firebase:
//   * Authentication  -> email + password sign-in
//   * Firestore       -> the online database (every change is saved there,
//                        and changes from other devices arrive live)
// It also contains the first-time setup (create the first admin) and the
// "Load sample school" button's code.
// =====================================================================

import { getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, initializeFirestore, limit, onSnapshot, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { DEPED_SY_2026_2027, manilaToday } from './logic';
import { Engine, emptyState, realClock, schoolYear as defaultYear, settings as defaultSettings, buildDemoState } from './engine';

// ----- WHICH MODE TO RUN IN -----
// 'cloud' = real sign-in and data saved in Firebase (normal use).
// 'demo'  = no internet needed: sample accounts and data that reset when the tab closes.
//           Good for presentations. Change this word and save to switch.
export const MODE = 'cloud';

// ----- YOUR FIREBASE PROJECT -----
// Copied from Firebase console -> Project settings -> Your apps -> Web app.
// These values are not secret; the security rules (firestore.rules) protect the data.
export const firebaseConfig = {
  apiKey: 'AIzaSyClVWQwsBbDPrIUqrASHSnowVWqVLowT4o',
  authDomain: 'doorbell-ph-f12d0.firebaseapp.com',
  projectId: 'doorbell-ph-f12d0',
  storageBucket: 'doorbell-ph-f12d0.firebasestorage.app',
  messagingSenderId: '870779183956',
  appId: '1:870779183956:web:21fa604c5f23c0c5301ec1',
};

// True when the app should use Firebase.
export const cloudConfigured = () => MODE === 'cloud' && Boolean(firebaseConfig.apiKey);

// Minimum shape of a document for each collection (see the data model in README.md).
function looksRight(col, d) {
  if (col === 'sections') return !!d.schedule && typeof d.name === 'string';
  if (col === 'students') return typeof d.qrToken === 'string' && typeof d.lastName === 'string';
  if (col === 'attendance') return typeof d.sectionId === 'string' && !!d.records;
  if (col === 'sms' || col === 'notifications') return typeof d.createdAt === 'string';
  if (col === 'audit') return typeof d.at === 'string';
  if (col === 'threads') return Array.isArray(d.members) && typeof d.lastAt === 'string';
  if (col === 'messages') return Array.isArray(d.members) && typeof d.threadId === 'string' && typeof d.at === 'string';
  if (col === 'excuses') return typeof d.studentId === 'string' && Array.isArray(d.dates) && typeof d.createdAt === 'string';
  return true;
}

// An empty school (used before data arrives, and after signing out).
const blankState = () => emptyState({ settings: structuredClone(defaultSettings), schoolYear: { ...defaultYear } });

// Password given to the 4 sample teachers created by "Load sample school".
export const SAMPLE_TEACHER_PASSWORD = 'Teacher-2026!';

// REMEMBER ME (sign-in page). Ticked: the sign-in is kept on this device until "Sign out" (every tab).
// Not ticked: only this browser tab, until it is closed (one tab can be the admin and another a teacher).
// The choice is remembered in localStorage so the next visit opens with the right kind of sign-in.
const REMEMBER_KEY = 'doorbell-remember-staff';
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
};
const setRemembered = (on) => {
  try {
    if (on) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage blocked */
  }
};

export function createCloudEngine() {
  // Start Firebase (only once, even if this runs twice during development).
  const app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp(firebaseConfig);
  // Sign-in is kept PER BROWSER TAB (session persistence), so one tab can be the admin and
  // another tab a teacher at the same time. Refreshing keeps you signed in; closing the tab
  // signs you out. With "Remember me" it is kept on the device instead (see REMEMBER_KEY above).
  let auth;
  try {
    auth = initializeAuth(app, { persistence: remembered() ? browserLocalPersistence : browserSessionPersistence });
  } catch {
    auth = getAuth(app); // already started (happens when Vite reloads this file during development)
  }
  // ignoreUndefinedProperties: fields that are `undefined` are simply left out instead of causing an error.
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });

  /* =================================================================
     WRITING: the Engine calls persistence.put(collection, id, data).
     Changes are collected for 60 ms and then sent together as one
     "batch" (faster, and either all of them save or none do).
     ================================================================= */
  const pending = new Map(); // 'collection/id' -> what to write (null = delete)
  let timer = null;

  const flush = async () => {
    timer = null;
    const ops = [...pending.values()];
    pending.clear();
    // Firestore allows up to 500 writes per batch; we use 450 to be safe.
    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + 450)) {
        const ref = doc(db, op.col, op.id);
        if (op.data === null) batch.delete(ref);
        // JSON round-trip removes anything Firestore cannot store (like Map objects).
        else batch.set(ref, JSON.parse(JSON.stringify(op.data)));
      }
      try {
        await batch.commit();
      } catch (e) {
        // Most common cause: the security rules said no (see firestore.rules).
        console.error('Save failed', e);
        alert(`Could not save to the cloud: ${e.message}`);
      }
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 60);
  };
  const persistence = {
    put: (col, id, data) => {
      pending.set(`${col}/${id}`, { col, id, data });
      schedule();
    },
    remove: (col, id) => {
      pending.set(`${col}/${id}`, { col, id, data: null });
      schedule();
    },
  };
  // Save anything still waiting if the tab is closed.
  window.addEventListener('beforeunload', () => {
    if (pending.size) void flush();
  });

  /* =================================================================
     SIGNING IN
     signIn() waits until the account's data has loaded (see onAuthStateChanged below),
     so the page opens with everything ready.
     ================================================================= */
  let signInWaiter = null; // called with the account when loading succeeds
  let signInFailer = null; // called with an error when it fails
  let setupInProgress = null; // a Promise while the first admin is being created

  // Ticked "Remember me": keep the sign-in on this device; else only in this tab.
  const usePersistence = async (remember) => {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    setRemembered(!!remember);
  };
  const authAdapter = {
    async signIn(email, password, remember = false) {
      await usePersistence(remember);
      const done = new Promise((res, rej) => {
        signInWaiter = res;
        signInFailer = rej;
      });
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        // Turn Firebase error codes into plain words.
        const code = e.code ?? '';
        throw new Error(
          code.includes('invalid') || code.includes('wrong-password') || code.includes('user-not-found')
            ? 'Wrong email or password.'
            : code.includes('too-many')
              ? 'Too many tries. Wait a minute and try again.'
              : e.message,
        );
      }
      return done;
    },
    // SIGN IN WITH GOOGLE (teachers and admins). Google only proves who the person is: they get in only
    // if the admin already added that email (Teachers page / Admins), i.e. there is a users/{uid} profile.
    // A Gmail address added by the admin is the SAME Firebase account (same uid), so the profile is found.
    // Firebase console must have Authentication -> Sign-in method -> Google turned on, and the website's
    // address under Authentication -> Settings -> Authorized domains (e.g. eisen22.github.io).
    async signInWithGoogle(remember = false) {
      await usePersistence(remember);
      const done = new Promise((res, rej) => {
        signInWaiter = res;
        signInFailer = rej;
      });
      done.catch(() => {}); // handled by the caller through the returned promise
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' }); // always let them pick which Google account
      try {
        // The 3rd argument is required here: the app starts Firebase with initializeAuth (for the per-tab sign-in),
        // which does not include the pop-up helper, and without it Firebase says "auth/argument-error".
        await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      } catch (e) {
        signInWaiter = null;
        signInFailer = null;
        const code = e.code ?? '';
        throw new Error(
          code.includes('popup-closed') || code.includes('cancelled-popup')
            ? 'Google sign-in was closed before it finished.'
            : code.includes('popup-blocked')
              ? 'The browser blocked the Google window. Allow pop-ups for this site and try again.'
              : code.includes('account-exists-with-different-credential')
                ? 'This email signs in with a password. Use the email and password instead.'
                : code.includes('unauthorized-domain') || code.includes('operation-not-allowed')
                  ? 'Sign in with Google is not turned on for this website yet. Ask the school admin.'
                  : e.message,
        );
      }
      return done;
    },
    async signOut() {
      setRemembered(false);
      await fbSignOut(auth);
    },
    async sendPasswordReset(email) {
      await sendPasswordResetEmail(auth, email);
    },
    // Changes the signed-in staff member's password. Firebase asks for the current one again first.
    async changePassword(current, next) {
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in again first.');
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      } catch (e) {
        const code = e.code ?? '';
        throw new Error(
          code.includes('invalid') || code.includes('wrong-password')
            ? 'Your current password is wrong.'
            : code.includes('too-many')
              ? 'Too many tries. Wait a minute and try again.'
              : e.message,
        );
      }
      await updatePassword(user, next);
    },
    // Makes a sign-in account for a new teacher WITHOUT signing the admin out:
    // a second copy of Firebase ("account-maker") creates it, then signs it out.
    async createTeacherAccount(email, name, teacherId, password) {
      const second = getApps().find((a) => a.name === 'account-maker') ?? initializeApp(firebaseConfig, 'account-maker');
      const secondAuth = getAuth(second);
      const temp = password ?? `Db-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}!`; // random temporary password
      const cred = await createUserWithEmailAndPassword(secondAuth, email, temp);
      await fbSignOut(secondAuth);
      return { uid: cred.user.uid, tempPassword: temp };
    },
    demoAccounts: () => [], // demo buttons on the sign-in page only exist in demo mode
  };

  const engine = new Engine('cloud', blankState(), persistence, authAdapter, realClock);

  /* =================================================================
     READING: live listeners (onSnapshot). Whenever a document changes in
     Firestore (from this device or another), engine.applyRemote() updates
     the in-memory copy and every open page redraws itself.
     ================================================================= */
  let unsubs = []; // functions that stop each listener
  let tick = null; // the once-a-minute timer (absence texts, and closing classes nobody confirmed)
  let watchClasses = null;
  let classUnsubs = []; // listeners for a teacher's classes
  let classKey = ''; // which classes those listeners cover, e.g. 'sec-a,sec-b'

  const stop = () => {
    unsubs.forEach((u) => u());
    unsubs = [];
    classUnsubs.forEach((u) => u());
    classUnsubs = [];
    classKey = '';
    watchClasses?.();
    watchClasses = null;
    if (tick) clearInterval(tick);
    tick = null;
  };

  // Starts one listener; the Promise finishes when the first copy of the data has arrived.
  const listen = (col, q) =>
    new Promise((resolve, reject) => {
      let first = true;
      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            for (const ch of snap.docChanges()) {
              const data = ch.type === 'removed' ? null : ch.doc.data();
              // Skip documents that do not have the shape this app expects (e.g. made by an older version),
              // instead of letting one bad document break every screen. The console says which one.
              if (data && !looksRight(col, data)) {
                console.warn(`Skipped ${col}/${ch.doc.id}: not in the expected format`, data);
                continue;
              }
              engine.applyRemote(col, ch.doc.id, data);
            }
            if (first) {
              first = false;
              resolve();
            }
          },
          (err) => {
            console.error(`Listen ${col} failed`, err);
            reject(err);
          },
        ),
      );
    });

  // Loads what this account is allowed to see.
  const hydrate = async (account) => {
    engine.s = blankState();
    const all = (col) => listen(col, query(collection(db, col)));
    // Everyone needs the school setup data.
    await Promise.all(['meta', 'sections', 'teachers', 'students', 'guardians', 'enrollments'].map((c) => all(c)));
    // Messages (src/messaging.js): only the conversations this person is in. The admin answers as the
    // school office ('office'); a teacher as 't:<teacherId>'. Skipped if firestore.rules is older than Messages.
    const myKey = account.role === 'admin' ? 'office' : account.teacherId ? `t:${account.teacherId}` : null;
    if (myKey) {
      const mineMsg = (col) => listen(col, query(collection(db, col), where('members', 'array-contains', myKey)));
      // The admin also sees the list of EVERY conversation (who and when, for "Review conversations"),
      // but loads the messages of one they are not in only through engine.reviewThread (logged).
      const threads = account.role === 'admin' ? listen('threads', query(collection(db, 'threads'))) : mineMsg('threads');
      await Promise.all([threads, mineMsg('messages')]).catch((e) => console.warn('Messages not loaded: publish the new firestore.rules', e));
    }
    if (account.role === 'admin') {
      // The admin sees everything (the newest 300-400 texts, alerts and audit entries).
      await Promise.all([
        all('users'),
        all('attendance'),
        all('confirmations'),
        // Excuse requests from the parent portal (if firestore.rules is older than the portal, skip them).
        all('excuses').catch((e) => console.warn('Excuse requests not loaded: publish the new firestore.rules', e)),
        // Seating charts (skipped if firestore.rules is older than the seating chart).
        all('seating').catch((e) => console.warn('Seating charts not loaded: publish the new firestore.rules', e)),
        all('announcements').catch((e) => console.warn('Announcements not loaded: publish the new firestore.rules', e)),
        listen('sms', query(collection(db, 'sms'), orderBy('createdAt', 'desc'), limit(400))),
        listen('notifications', query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(300))),
        listen('audit', query(collection(db, 'audit'), orderBy('at', 'desc'), limit(300))),
      ]);
      // A school set up by an older version may be missing its settings or calendar: add the defaults.
      const fixes = writeBatch(db);
      let needed = false;
      if (!(await getDoc(doc(db, 'meta', 'school'))).exists()) {
        fixes.set(doc(db, 'meta', 'school'), JSON.parse(JSON.stringify({ settings: defaultSettings, schoolYear: defaultYear })));
        needed = true;
      }
      if (!(await getDoc(doc(db, 'meta', 'calendar'))).exists()) {
        fixes.set(doc(db, 'meta', 'calendar'), { days: DEPED_SY_2026_2027 });
        needed = true;
      }
      if (needed) await fixes.commit();
    } else {
      await listenToClasses(account);
    }
  };

  // A teacher reads only their own classes (plus a class they cover as a substitute today).
  // If the admin adds or removes a class, or sets a substitute, the listeners follow.
  const listenToClasses = async (account) => {
    const ids = engine
      .myClasses(account.teacherId)
      .map((c) => c.id)
      .slice(0, 29); // Firestore 'in' allows 30 values
    const key = ids.join(',');
    if (key === classKey && classUnsubs.length) return; // nothing changed
    classUnsubs.forEach((u) => u());
    classUnsubs = [];
    classKey = key;
    const before = unsubs.length;
    // 'all' = alerts meant for every teacher (calendar changes from the admin).
    // No orderBy here on purpose: "in" + orderBy would need an extra Firestore index to be created by hand.
    // The pages sort by date themselves.
    const jobs = [listen('notifications', query(collection(db, 'notifications'), where('sectionId', 'in', [...ids, 'all'])))];
    if (ids.length) {
      const mine = (col) => query(collection(db, col), where('sectionId', 'in', ids));
      jobs.push(
        listen('attendance', mine('attendance')),
        listen('confirmations', mine('confirmations')),
        listen('sms', query(collection(db, 'sms'), where('sectionId', 'in', ids))),
        // Excuse requests from parents of this class (skipped if firestore.rules is older than the portal).
        listen('excuses', mine('excuses')).catch((e) => console.warn('Excuse requests not loaded: publish the new firestore.rules', e)),
        listen('seating', mine('seating')).catch((e) => console.warn('Seating charts not loaded: publish the new firestore.rules', e)),
        // All of them: a teacher rewriting a parent's portal page must keep the school-wide ones too.
        listen('announcements', query(collection(db, 'announcements'))).catch((e) => console.warn('Announcements not loaded: publish the new firestore.rules', e)),
      );
    }
    classUnsubs = unsubs.splice(before); // keep these separate so they can be restarted alone
    await Promise.all(jobs);
  };

  // engine.ready finishes once we know who is signed in (pages wait for it).
  let resolveFirst = () => {};
  engine.ready = new Promise((r) => {
    resolveFirst = r;
  });

  // Firebase calls this when someone signs in, signs out, or the page opens while signed in.
  onAuthStateChanged(auth, async (user) => {
    stop();
    if (!user) {
      engine.s = blankState();
      engine.setSession(null);
      resolveFirst();
      return;
    }
    const load = (async () => {
      if (setupInProgress) await setupInProgress; // first admin: wait until their profile is saved
      const snap = await getDoc(doc(db, 'users', user.uid)); // the profile with the role
      if (!snap.exists()) {
        // A Google account the school never added: Google just created it, so remove it again
        // (keeps Firebase Authentication -> Users clean).
        const brandNew = user.metadata.creationTime === user.metadata.lastSignInTime;
        if (brandNew && user.providerData.length && user.providerData.every((p) => p.providerId === 'google.com')) await user.delete().catch(() => {});
        await fbSignOut(auth);
        signInFailer?.(
          new Error(
            user.providerData.some((p) => p.providerId === 'google.com')
              ? `${user.email ?? 'This Google account'} is not a Doorbell account. Ask the school admin to add your email first.`
              : 'This account is not set up in Doorbell yet. Ask the school admin.',
          ),
        );
        return;
      }
      const account = { ...snap.data(), uid: user.uid };
      // The gate phone's account only works in the Doorbell Gate app, not on this website.
      if (account.role === 'gate') {
        await fbSignOut(auth);
        signInFailer?.(new Error('This is the school gate account. Use it in the Doorbell Gate app on the gate phone.'));
        return;
      }
      const teacher = account.teacherId ? (await getDoc(doc(db, 'teachers', account.teacherId))).data() : undefined;
      if (teacher && teacher.active === false) {
        await fbSignOut(auth);
        signInFailer?.(new Error('This account is deactivated. Ask the school admin.'));
        return;
      }
      await hydrate(account);
      engine.setSession(account);
      if (account.role === 'teacher') {
        // If the admin assigns or removes a class, reconnect to the right classes.
        watchClasses = engine.subscribe(() => {
          const key = engine
            .myClasses(account.teacherId)
            .map((c) => c.id)
            .join(',');
          if (key !== classKey) {
            engine.refreshSession();
            void listenToClasses(account);
          }
        });
      }
      // Every minute: absence texts at the end of first period, and closing classes nobody confirmed.
      engine.catchUp();
      tick = setInterval(() => engine.catchUp(), 60_000);
      signInWaiter?.(account);
    })();
    engine.ready = load.catch((e) => {
      signInFailer?.(e);
    });
    await engine.ready;
    signInWaiter = null;
    signInFailer = null;
    resolveFirst();
  });

  /* =================================================================
     FIRST-TIME SETUP (only when the database is empty)
     ================================================================= */

  // True when no admin exists yet. meta/setup can be read without signing in (see firestore.rules).
  engine.needsSetup = async () => !(await getDoc(doc(db, 'meta', 'setup'))).exists();

  // Creates the first admin account plus the school's settings and DepEd calendar.
  engine.createFirstAdmin = async ({ name, email, password }) => {
    let finish;
    setupInProgress = new Promise((r) => {
      finish = r;
    });
    try {
      const done = new Promise((res, rej) => {
        signInWaiter = res;
        signInFailer = rej;
      });
      const cred = await createUserWithEmailAndPassword(auth, email, password); // also signs them in
      // Step 1: mark setup as done and save the admin profile (allowed only once, see firestore.rules).
      const b1 = writeBatch(db);
      b1.set(doc(db, 'meta', 'setup'), { done: true, at: new Date().toISOString() });
      b1.set(doc(db, 'users', cred.user.uid), { uid: cred.user.uid, email, name, role: 'admin' });
      await b1.commit();
      // Step 2: now that they are admin, save the school settings, school year and calendar.
      const b2 = writeBatch(db);
      b2.set(doc(db, 'meta', 'school'), JSON.parse(JSON.stringify({ settings: defaultSettings, schoolYear: defaultYear })));
      b2.set(doc(db, 'meta', 'calendar'), { days: DEPED_SY_2026_2027 });
      await b2.commit();
      finish();
      return await done;
    } finally {
      finish();
      setupInProgress = null;
    }
  };

  /* =================================================================
     LOAD SAMPLE SCHOOL (admin button): 4 sections, 89 children and
     attendance from the first day of classes up to yesterday, plus
     4 teacher accounts that can sign in with SAMPLE_TEACHER_PASSWORD.
     ================================================================= */
  engine.loadSampleSchool = async (onProgress = () => {}) => {
    const sample = buildDemoState(manilaToday(), realClock); // same generator the demo mode uses
    const uidFor = new Map(); // sample uid (e.g. 'u-maria') -> real Firebase account uid
    const problems = [];
    for (const t of sample.teachers.values()) {
      onProgress(`Creating account for ${t.name}…`);
      try {
        const { uid } = await authAdapter.createTeacherAccount(t.email, t.name, t.id, SAMPLE_TEACHER_PASSWORD);
        uidFor.set(t.uid, uid);
        t.uid = uid;
      } catch (e) {
        // Loaded before (then removed with "Remove all school data"): the sign-in still exists, so it is
        // reused if it still has the sample password.
        let reused = null;
        if (e.code === 'auth/email-already-in-use') {
          try {
            const second = getApps().find((a) => a.name === 'account-maker') ?? initializeApp(firebaseConfig, 'account-maker');
            const secondAuth = getAuth(second);
            const cred = await signInWithEmailAndPassword(secondAuth, t.email, SAMPLE_TEACHER_PASSWORD);
            reused = cred.user.uid;
            await fbSignOut(secondAuth);
          } catch {
            reused = null;
          }
        }
        if (reused) {
          uidFor.set(t.uid, reused);
          t.uid = reused;
        } else problems.push(`${t.email}: ${e.code === 'auth/email-already-in-use' ? 'account already exists with another password' : e.message}`);
      }
    }
    // Everything to write, as [collection, id, data].
    const writes = [];
    for (const u of sample.users.values()) {
      if (u.role !== 'teacher' || !uidFor.has(u.uid)) continue; // the sample admin is not needed: you are the admin
      const uid = uidFor.get(u.uid);
      writes.push(['users', uid, { ...u, uid }]);
    }
    for (const col of ['teachers', 'sections', 'students', 'guardians', 'enrollments', 'attendance', 'confirmations', 'sms', 'notifications']) {
      for (const [id, data] of sample[col]) writes.push([col, id, data]);
    }
    writes.push(['meta', 'calendar', { days: [...sample.calendar.values()].sort((a, b) => a.date.localeCompare(b.date)) }]);
    for (let i = 0; i < writes.length; i += 450) {
      onProgress(`Saving ${Math.min(i + 450, writes.length)} of ${writes.length}…`);
      const batch = writeBatch(db);
      for (const [col, id, data] of writes.slice(i, i + 450)) batch.set(doc(db, col, id), JSON.parse(JSON.stringify(data)));
      await batch.commit();
    }
    return { documents: writes.length, teachers: [...sample.teachers.values()].map((t) => t.email), problems };
  };

  // Messages -> Review conversations: one conversation's messages, read once (engine.reviewThread logs it first).
  engine.fetchThreadMessages = async (threadId) => {
    const snap = await getDocs(query(collection(db, 'messages'), where('threadId', '==', threadId)));
    return snap.docs.map((d) => d.data());
  };

  // Messages: one attachment, read when someone opens it (then kept in memory for this visit).
  engine.fetchAttachment = async (id) => {
    if (engine.s.attachments.has(id)) return engine.s.attachments.get(id);
    const snap = await getDoc(doc(db, 'attachments', id));
    const a = snap.exists() ? snap.data() : null;
    if (a) engine.s.attachments.set(id, a);
    return a;
  };

  // Audit Log -> a date: that day's entries come straight from Firestore (only the newest 300 are kept loaded).
  engine.listAuditOn = async (date) => {
    const since = new Date(`${date}T00:00:00+08:00`).toISOString();
    const next = new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 864e5).toISOString();
    const snap = await getDocs(query(collection(db, 'audit'), where('at', '>=', since), where('at', '<', next), orderBy('at', 'desc'), limit(3000)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  /* =================================================================
     START OVER (Settings -> Sample data -> "Remove all school data"): deletes the sections, teachers,
     students, guardians, attendance, texts, alerts and parent portal data, so the sample school can
     be loaded again. Kept: the admin accounts, the gate account, the settings, the calendar and the
     audit log (which can never be deleted). Teacher sign-ins stay in Firebase Authentication
     (only their Doorbell profile is removed); sample teachers are reused when the sample is loaded again.
     ================================================================= */
  engine.clearSchoolData = async (onProgress = () => {}) => {
    const cols = ['attendance', 'confirmations', 'sms', 'notifications', 'excuses', 'threads', 'messages', 'attachments', 'mailQueue', 'seating', 'announcements', 'parentDays', 'parentKeys', 'parents', 'enrollments', 'guardians', 'students', 'sections', 'teachers'];
    let removed = 0;
    for (const col of [...cols, 'users']) {
      onProgress(`Removing ${col}…`);
      const snap = await getDocs(collection(db, col));
      const docs = col === 'users' ? snap.docs.filter((d) => d.data().role === 'teacher') : snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db);
        docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      removed += docs.length;
    }
    await engine.logAudit('school.clear', 'all school data', `${removed} documents removed`);
    return removed;
  };

  return engine;
}
