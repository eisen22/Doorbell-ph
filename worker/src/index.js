// =====================================================================
// index.js — DOORBELL'S FREE SERVER (a Cloudflare Worker)
// ---------------------------------------------------------------------
// Runs every minute on Cloudflare's free plan (no Firebase Blaze plan needed):
//   1. sendQueuedSms():  when Settings -> How texts are sent = Semaphore, sends every text saved
//                        as 'queued' through Semaphore and marks it 'sent' or 'failed'.
//   2. autoConfirm():    every 5 minutes, 6 AM to 6 PM, Monday to Saturday (Philippine time):
//                        confirms each class after its auto-confirm time, even if nobody has
//                        Doorbell open. Uses the SAME rules as the website (src/engine.js).
// It signs in to Firebase with a Doorbell gate account (see README.md), so firestore.rules
// decides what it may do, like for any user. Secrets (passwords, API key) are kept in Cloudflare.
// =====================================================================
import { Firestore } from './firestore.js';
import { Engine, emptyState, realClock } from '../../src/engine.js';
import { addDays, isSchoolDay, manilaTime, manilaToday, shouldAutoFinalize, autoFinalizeTime, semesterOf } from '../../src/logic.js';

export default {
  // The schedule (wrangler.toml: every minute).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env, new Date(controller.scheduledTime)));
  },
  // Opening the Worker's address in a browser shows that it is alive (nothing secret is shown).
  async fetch() {
    return new Response('Doorbell worker is running. It sends Semaphore texts and auto-confirms classes on a schedule.\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

export async function run(env, now = new Date(), fetchFn = (...args) => fetch(...args)) {
  const db = new Firestore(env, fetchFn);
  const report = { sms: null, confirm: null };
  try {
    report.sms = await sendQueuedSms(db, env, fetchFn);
  } catch (e) {
    console.error('SMS step failed:', e.message);
  }
  // Auto-confirm every 5 minutes during school hours (fewer database reads).
  const hour = Number(manilaTime(now).slice(0, 2));
  const weekday = new Date(`${manilaToday(now)}T12:00:00+08:00`).getUTCDay(); // 0 = Sunday
  if (now.getUTCMinutes() % 5 === 0 && hour >= 6 && hour <= 18 && weekday !== 0) {
    try {
      report.confirm = await autoConfirm(db, now);
    } catch (e) {
      console.error('Auto-confirm step failed:', e.message);
    }
  }
  return report;
}

/* =====================================================================
   1. SEND QUEUED TEXTS THROUGH SEMAPHORE
   ===================================================================== */
// '+639171234567' or '0917 123 4567' -> '639171234567'. null if not a PH mobile number.
export function toSemaphoreNumber(to) {
  const digits = String(to ?? '').replace(/[^\d]/g, '');
  const m = digits.match(/^(?:63|0)?(9\d{9})$/);
  return m ? `63${m[1]}` : null;
}

async function sendQueuedSms(db, env, fetchFn) {
  const school = await db.get('meta/school');
  const settings = school?.data.settings ?? {};
  if (settings.smsProvider !== 'semaphore') return 'skipped (Semaphore is not chosen in Settings)';
  if (!env.SEMAPHORE_API_KEY) throw new Error('SEMAPHORE_API_KEY secret is missing');
  const queued = await db.query('sms', [['status', 'EQUAL', 'queued']], 20);
  let sent = 0;
  let failed = 0;
  for (const m of queued) {
    // Claim it: only works if nobody changed it since we read it, so a text is never sent twice.
    try {
      await db.commit([{ path: `sms/${m.id}`, patch: { status: 'sending' }, ifUpdateTime: m.updateTime }]);
    } catch {
      continue;
    }
    const fail = async (reason) => {
      failed += 1;
      const writes = [{ path: `sms/${m.id}`, patch: { status: 'failed', error: reason, failedAt: new Date().toISOString() } }];
      if (m.data.studentId) {
        const nid = `smsf_${m.id}`;
        writes.push({
          path: `notifications/${nid}`,
          data: {
            id: nid, kind: 'sms_failed', studentId: m.data.studentId, sectionId: m.data.sectionId ?? null,
            createdAt: m.data.createdAt ?? new Date().toISOString(), read: false,
            title: 'A text to a guardian did not go through',
            body: `Semaphore said: ${reason}. Check the number on the Students page, then press Resend.`,
          },
        });
      }
      await db.commit(writes);
    };
    const number = toSemaphoreNumber(m.data.to);
    if (!number) {
      await fail(`"${m.data.to}" is not a Philippine mobile number`);
      continue;
    }
    const form = new URLSearchParams({ apikey: env.SEMAPHORE_API_KEY, number, message: m.data.body ?? '' });
    if (settings.senderName) form.set('sendername', settings.senderName);
    let res, text, json;
    try {
      res = await fetchFn('https://api.semaphore.co/api/v4/messages', { method: 'POST', body: form });
      text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    } catch (e) {
      // Could not reach Semaphore: put it back in the queue for the next minute.
      await db.commit([{ path: `sms/${m.id}`, patch: { status: 'queued' } }]);
      continue;
    }
    const first = Array.isArray(json) ? json[0] : null;
    if (!res.ok || !first?.message_id) {
      const parts = json && typeof json === 'object' ? Object.values(json).flat().map(String) : [];
      await fail(parts.length ? parts.join(' ').slice(0, 300) : `Semaphore answered ${res.status}: ${String(text).slice(0, 200)}`);
      continue;
    }
    await db.commit([
      {
        path: `sms/${m.id}`,
        patch: { status: 'sent', provider: 'semaphore', providerId: String(first.message_id), providerStatus: first.status ?? '', sentAt: new Date().toISOString(), error: null },
      },
    ]);
    sent += 1;
  }
  return { queued: queued.length, sent, failed };
}

/* =====================================================================
   2. AUTO-CONFIRM
   Looks at today and the last 7 days, so a day missed while nobody had Doorbell open is
   still confirmed, stamped with the class's own auto-confirm time (e.g. 8:45 AM).
   ===================================================================== */
async function autoConfirm(db, now) {
  const today = manilaToday(now);
  const time = manilaTime(now);
  const [school, cal, secs] = await Promise.all([db.get('meta/school'), db.get('meta/calendar'), db.query('sections')]);
  const meta = school?.data;
  if (!meta?.schoolYear) return 'no school year yet';
  const days = cal?.data.days ?? [];
  const calendar = new Map(days.map((c) => [c.date, c]));
  const sections = secs.map((s) => ({ ...s.data, id: s.id })).filter((s) => !s.archived && s.schedule);

  // 1. Which class days should be confirmed by now?
  const due = [];
  for (const sec of sections) {
    for (let i = 7; i >= 0; i--) {
      const d = addDays(today, -i);
      if (d < meta.schoolYear.start || d > meta.schoolYear.end || !isSchoolDay(d, sec.schedule, calendar)) continue;
      if (d === today && !shouldAutoFinalize(time, sec.schedule)) continue;
      due.push({ sec, d });
    }
  }
  if (!due.length) return { confirmed: 0 };
  const have = await db.getMany(due.map(({ sec, d }) => `confirmations/${sec.id}_${d}`));
  const todo = due.filter(({ sec, d }) => !have.has(`confirmations/${sec.id}_${d}`));
  if (!todo.length) return { confirmed: 0 };

  // 2. Load what finalize() needs, only for the classes being confirmed (keeps the Worker fast):
  //    children, guardians, placements, and attendance since the semester started (at least the last
  //    60 days), for the 3-day texts and the month / semester totals.
  const semStart = semesterOf(today, meta.schoolYear, meta.settings?.semester2Start).from;
  const since = semStart < addDays(today, -60) ? semStart : addDays(today, -60);
  const span = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000);
  const ids = [...new Set(todo.map(({ sec }) => sec.id))];
  const bySection = async (col) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 30) out.push(...(await db.query(col, [['sectionId', 'IN', ids.slice(i, i + 30)]])));
    return out;
  };
  const [students, guardians, enrollments, attendance, teachers, excuses] = await Promise.all([
    db.query('students'),
    db.query('guardians'),
    bySection('enrollments'),
    // Attendance documents are named <section>_<date> (like the website), so they are fetched by
    // name: no Firestore index needed, and missing days are simply skipped.
    db.getMany(ids.flatMap((id) => Array.from({ length: span + 1 }, (_, i) => `attendance/${id}_${addDays(since, i)}`))),
    // For the parent portal months (teacher's name) and the excuses the teacher already approved.
    db.query('teachers'),
    db.query('excuses', [['status', 'EQUAL', 'approved']]),
  ]);
  const writes = new Map();
  const persistence = {
    put: (col, id, data) => writes.set(`${col}/${id}`, JSON.parse(JSON.stringify(data))),
    remove: () => {},
  };
  const engine = new Engine('cloud', emptyState(meta, days), persistence, {}, realClock);
  sections.forEach((s) => engine.s.sections.set(s.id, s));
  for (const [map, rows] of [
    [engine.s.students, students],
    [engine.s.guardians, guardians],
    [engine.s.enrollments, enrollments],
    [engine.s.teachers, teachers],
    [engine.s.excuses, excuses],
  ])
    rows.forEach((r) => map.set(r.id, { ...r.data, id: r.data.id ?? r.id }));
  for (const [path, data] of attendance) engine.s.attendance.set(path.split('/')[1], { ...data, id: path.split('/')[1] });

  // 3. Confirm, stamped with each class's own auto-confirm time.
  for (const { sec, d } of todo) engine.finalize(sec.id, d, 'Auto-confirm', true, `${d}T${autoFinalizeTime(sec.schedule)}:00+08:00`);

  // 4. Save everything.
  await db.commit([...writes].map(([path, data]) => ({ path, data })));
  console.log('Auto-confirmed', todo.map(({ sec, d }) => `${sec.name} ${d}`).join(', '), `(${writes.size} writes)`);
  return { confirmed: todo.length, writes: writes.size };
}
