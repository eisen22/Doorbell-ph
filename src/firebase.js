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
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { collection, doc, getDoc, initializeFirestore, limit, onSnapshot, orderBy, query, where, writeBatch } from 'firebase/firestore';
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
  return true;
}

// An empty school (used before data arrives, and after signing out).
const blankState = () => emptyState({ settings: structuredClone(defaultSettings), schoolYear: { ...defaultYear } });

// Password given to the 4 sample teachers created by "Load sample school".
export const SAMPLE_TEACHER_PASSWORD = 'Teacher-2026!';

export function createCloudEngine() {
  // Start Firebase (only once, even if this runs twice during development).
  const app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp(firebaseConfig);
  const auth = getAuth(app);
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

  const authAdapter = {
    async signIn(email, password) {
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
    async signOut() {
      await fbSignOut(auth);
    },
    async sendPasswordReset(email) {
      await sendPasswordResetEmail(auth, email);
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
  let tick = null; // the once-a-minute auto-confirm timer
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
    if (account.role === 'admin') {
      // The admin sees everything (the newest 300-400 texts, alerts and audit entries).
      await Promise.all([
        all('users'),
        all('attendance'),
        all('confirmations'),
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

  // A teacher reads only their own classes. If the admin adds or removes a class, the listeners follow.
  const listenToClasses = async (account) => {
    const ids = engine
      .classesOf(account.teacherId)
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
        await fbSignOut(auth);
        signInFailer?.(new Error('This account is not set up in Doorbell yet. Ask the school admin.'));
        return;
      }
      const account = { ...snap.data(), uid: user.uid };
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
            .classesOf(account.teacherId)
            .map((c) => c.id)
            .join(',');
          if (key !== classKey) {
            engine.refreshSession();
            void listenToClasses(account);
          }
        });
      }
      // Auto-confirm: past days nobody confirmed, and today after the auto-confirm time.
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
        problems.push(`${t.email}: ${e.code === 'auth/email-already-in-use' ? 'account already exists' : e.message}`);
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

  return engine;
}
