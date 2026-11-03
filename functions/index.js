// =====================================================================
// functions/index.js — DOORBELL'S TWO SMALL SERVER JOBS (Firebase Cloud Functions)
// ---------------------------------------------------------------------
// 1. sendSms:     whenever a text is saved with status 'queued', send it through Semaphore
//                 and change it to 'sent' (or 'failed' with the reason).
// 2. autoConfirm: every 15 minutes on school days, confirm classes whose auto-confirm time
//                 has passed, even when nobody has Doorbell open. It uses the SAME rules as the
//                 website (src/engine.js and src/logic.js are bundled in by esbuild).
// Setup and deploy: see functions/README.md. Needs the Firebase Blaze plan.
// =====================================================================
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Engine, emptyState, realClock } from '../src/engine.js';
import { addDays, isSchoolDay, manilaTime, manilaToday, shouldAutoFinalize, autoFinalizeTime } from '../src/logic.js';

// Same region as the database (Singapore), so the functions are close to the data.
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 5 });
initializeApp();
const db = getFirestore();

// The Semaphore API key is a SECRET: it is never in the code or on GitHub.
// Saved once with:  firebase functions:secrets:set SEMAPHORE_API_KEY
const SEMAPHORE_API_KEY = defineSecret('SEMAPHORE_API_KEY');

// '+639171234567' or '0917 123 4567' -> '639171234567' (a format Semaphore accepts). null if not a PH mobile.
function toSemaphoreNumber(to) {
  const digits = String(to ?? '').replace(/[^\d]/g, '');
  const m = digits.match(/^(?:63|0)?(9\d{9})$/);
  return m ? `63${m[1]}` : null;
}

// Semaphore's error answer can be a list or an object of messages; make it one readable line.
function errorText(json, text, status) {
  if (json && typeof json === 'object') {
    const parts = Array.isArray(json) ? json : Object.values(json);
    const flat = parts.flat().map((p) => (typeof p === 'string' ? p : JSON.stringify(p)));
    if (flat.length) return flat.join(' ').slice(0, 300);
  }
  return `Semaphore answered ${status}: ${String(text).slice(0, 200)}`;
}

/* =====================================================================
   1. SEND A TEXT
   ===================================================================== */
export const sendSms = onDocumentWritten({ document: 'sms/{id}', secrets: [SEMAPHORE_API_KEY], retry: false }, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!after || after.status !== 'queued') return; // only texts waiting to be sent
  const ref = event.data.after.ref;

  // The same text saved again by a second device (same attempt number) was already sent: keep it 'sent'.
  if (before && (before.status === 'sent' || before.status === 'sending') && (after.attempts ?? 1) <= (before.attempts ?? 1)) {
    await ref.update({ status: before.status });
    return;
  }

  // Claim the text, so it is never sent twice even if this function runs twice for one change.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('status') !== 'queued') return false;
    tx.update(ref, { status: 'sending' });
    return true;
  });
  if (!claimed) return;

  const fail = async (reason) => {
    logger.warn('SMS failed', { id: ref.id, reason });
    await ref.update({ status: 'failed', error: reason, failedAt: new Date().toISOString() });
    // Tell the teacher (Alerts page), like a failed text on the website.
    if (after.studentId) {
      const sid = `smsf_${ref.id}`;
      await db.doc(`notifications/${sid}`).set({
        id: sid,
        kind: 'sms_failed',
        studentId: after.studentId,
        sectionId: after.sectionId ?? null,
        createdAt: after.createdAt ?? new Date().toISOString(),
        read: false,
        title: 'A text to a guardian did not go through',
        body: `Semaphore said: ${reason}. Check the number on the Students page, then press Resend.`,
      });
    }
  };

  const number = toSemaphoreNumber(after.to);
  if (!number) return fail(`"${after.to}" is not a Philippine mobile number`);

  const settings = (await db.doc('meta/school').get()).get('settings') ?? {};
  const form = new URLSearchParams({ apikey: SEMAPHORE_API_KEY.value(), number, message: after.body ?? '' });
  if (settings.senderName) form.set('sendername', settings.senderName);

  let res, text, json;
  try {
    res = await fetch('https://api.semaphore.co/api/v4/messages', { method: 'POST', body: form });
    text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } catch (e) {
    return fail(`Could not reach Semaphore (${e.message})`);
  }
  const first = Array.isArray(json) ? json[0] : null;
  if (!res.ok || !first?.message_id) return fail(errorText(json, text, res.status));

  await ref.update({
    status: 'sent',
    provider: 'semaphore',
    providerId: String(first.message_id),
    providerStatus: first.status ?? '', // Semaphore's own status: Queued / Pending / Sent
    network: first.network ?? '',
    sentAt: new Date().toISOString(),
    error: FieldValue.delete(),
  });
  logger.info('SMS sent', { id: ref.id, providerId: first.message_id });
});

/* =====================================================================
   2. AUTO-CONFIRM ON A SCHEDULE
   Every 15 minutes, 6 AM to 6 PM, Monday to Saturday (Philippine time).
   Looks at today and the last 7 days, so a day missed while this was off is still confirmed.
   ===================================================================== */
export const autoConfirm = onSchedule({ schedule: '*/15 6-18 * * 1-6', timeZone: 'Asia/Manila' }, async () => {
  const today = manilaToday();
  const now = manilaTime();
  const [schoolDoc, calDoc, secSnap] = await Promise.all([db.doc('meta/school').get(), db.doc('meta/calendar').get(), db.collection('sections').get()]);
  const meta = schoolDoc.data();
  if (!meta?.schoolYear) return;
  const days = calDoc.get('days') ?? [];
  const calendar = new Map(days.map((c) => [c.date, c]));
  const sections = secSnap.docs.map((d) => d.data()).filter((s) => !s.archived && s.schedule);

  // 1. Which class days should be confirmed by now?
  const due = [];
  for (const sec of sections) {
    for (let i = 7; i >= 0; i--) {
      const d = addDays(today, -i);
      if (d < meta.schoolYear.start || d > meta.schoolYear.end || !isSchoolDay(d, sec.schedule, calendar)) continue;
      if (d === today && !shouldAutoFinalize(now, sec.schedule)) continue;
      due.push({ sec, d });
    }
  }
  if (!due.length) return;
  const confs = await db.getAll(...due.map(({ sec, d }) => db.doc(`confirmations/${sec.id}_${d}`)));
  const todo = due.filter((_, i) => !confs[i].exists);
  if (!todo.length) return;

  // 2. Load what finalize() needs: the children, their guardians and placements, and recent
  //    attendance (for the 3-day streak texts).
  const since = addDays(today, -60);
  const [stu, gua, enr, att] = await Promise.all([
    db.collection('students').get(),
    db.collection('guardians').get(),
    db.collection('enrollments').get(),
    db.collection('attendance').where('date', '>=', since).get(),
  ]);
  const writes = new Map();
  const persistence = {
    put: (col, id, data) => writes.set(`${col}/${id}`, { col, id, data }),
    remove: (col, id) => writes.set(`${col}/${id}`, { col, id, data: null }),
  };
  const engine = new Engine('cloud', emptyState(meta, days), persistence, {}, realClock);
  const fill = (map, snap) => snap.docs.forEach((d) => map.set(d.id, d.data()));
  sections.forEach((s) => engine.s.sections.set(s.id, s));
  fill(engine.s.students, stu);
  fill(engine.s.guardians, gua);
  fill(engine.s.enrollments, enr);
  fill(engine.s.attendance, att);

  // 3. Confirm, stamped with each class's own auto-confirm time.
  for (const { sec, d } of todo) engine.finalize(sec.id, d, 'Auto-confirm', true, `${d}T${autoFinalizeTime(sec.schedule)}:00+08:00`);

  // 4. Save everything (at most 450 writes per batch).
  const ops = [...writes.values()];
  for (let i = 0; i < ops.length; i += 450) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 450)) {
      const ref = db.doc(`${op.col}/${op.id}`);
      if (op.data === null) batch.delete(ref);
      else batch.set(ref, JSON.parse(JSON.stringify(op.data)));
    }
    await batch.commit();
  }
  logger.info('Auto-confirmed', { days: todo.map(({ sec, d }) => `${sec.name} ${d}`), writes: ops.length });
});
